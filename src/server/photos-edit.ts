/**
 * Write operations for Apple Photos: location, date/time, timezone.
 *
 * - Location & date: AppleScript via Photos.app — journaled immediately, durable.
 * - Timezone: direct SQLite write — invisible to Photos, NOT durable on its own.
 *   See setTimezone below and docs/adr/0013.
 *
 * IANA timezone lookup lives in timezone.ts.
 */

import { join } from 'node:path';
import { runAppleScript } from '@native/native-bridge';
import { Database } from 'bun:sqlite';

import { defaultLibraryPath } from './photos-library';

// ---------- AppleScript helpers ----------

/** Set location via AppleScript (Photos.app must be running). */
export function setLocation(uuid: string, lat: number, lon: number) {
  const script = `tell application "Photos" to set the location of media item id "${uuid}" to {${lat}, ${lon}}`;
  runAppleScript(script);
}

/**
 * Build the AppleScript that sets one asset's date. Exported for tests.
 *
 * The date is assembled from components rather than parsed from a string:
 * AppleScript's `date "..."` coercion is locale-sensitive and breaks on
 * non-US systems (e.g. Finnish expects "10.12.2014 klo 11.33.29").
 *
 * `current date` starts at today and every assignment re-normalises the whole
 * date, so the day must be parked on the 1st before year or month are touched.
 * Otherwise a day-of-month past the end of the target month rolls the date
 * forward and the later `set day` cannot undo it: run on 29 July, `set month
 * of d to 2` turns 29 Feb 2015 into 1 March, and the asset lands a whole month
 * late. The bug is calendar-dependent — it fires on a handful of days a year —
 * and it wrote two capture dates 28 days into the future before being caught.
 *
 * date: "YYYY-MM-DD", time: "HH:MM:SS"
 */
export function buildDateTimeScript(uuid: string, date: string, time: string) {
  const [yr, mo, dy] = date.split('-');
  const [hr, mi, sc] = time.split(':');
  return [
    'set d to current date',
    'set day of d to 1',
    `set year of d to ${yr}`,
    `set month of d to ${mo}`,
    `set day of d to ${dy}`,
    `set hours of d to ${hr}`,
    `set minutes of d to ${mi}`,
    `set seconds of d to ${sc}`,
    `tell application "Photos" to set the date of media item id "${uuid}" to d`
  ].join('\n');
}

/** Set date/time via AppleScript. date: "YYYY-MM-DD", time: "HH:MM:SS" */
export function setDateTime(uuid: string, date: string, time: string) {
  runAppleScript(buildDateTimeScript(uuid, date, time));
}

// ---------- SQLite timezone write ----------

/**
 * Set timezone via direct SQLite write.
 *
 * WARNING: this is NOT durable. Photos never journals this write; it only
 * survives a restore if photolibraryd happens to coalesce the journal
 * (folding live SQLite back into Asset-snapshot.plj) before the restore —
 * an opportunistic, unpredictable event. A batch of timezone edits was
 * silently lost this way. See docs/gotchas.md "Apple Photos library internals".
 *
 * Per ADR-0013, Karttapallo does not depend on this value: displayed time is
 * derived from the (journaled) UTC instant + coordinates. This write exists
 * only to keep Photos.app and rendered exports showing the same local time,
 * and can be re-applied at any point by recomputing from coordinates.
 */
export function setTimezone(
  uuid: string,
  tzName: string,
  offsetSeconds: number,
  libraryPath?: string
) {
  const dbPath = join(
    libraryPath ?? defaultLibraryPath(),
    'database/Photos.sqlite'
  );
  const db = new Database(dbPath, { readwrite: true });
  try {
    db.run('BEGIN IMMEDIATE');
    const result = db.run(
      `UPDATE ZADDITIONALASSETATTRIBUTES
       SET ZTIMEZONEOFFSET = ?, ZTIMEZONENAME = ?
       WHERE ZASSET = (SELECT Z_PK FROM ZASSET WHERE ZUUID = ?)`,
      [offsetSeconds, tzName, uuid]
    );
    if (result.changes === 0) {
      db.run('ROLLBACK');
      throw new Error(`No row found for UUID ${uuid}`);
    }
    db.run('COMMIT');
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch {
      // already rolled back
    }
    throw err;
  } finally {
    db.close();
  }
}

// ---------- Quit Photos.app ----------

export function quitPhotosApp() {
  runAppleScript('tell application "Photos" to quit');
}

// ---------- PhotosWriter interface ----------

/**
 * Write seam used by `item-store.applyEdits`. Production wires the real
 * AppleScript / SQLite functions above; tests inject a fake.
 */
export interface PhotosWriter {
  setLocation: (uuid: string, lat: number, lon: number) => void;
  setDateTime: (uuid: string, date: string, time: string) => void;
  setTimezone: (uuid: string, tzName: string, offsetSeconds: number) => void;
  quitPhotosApp: () => void;
}

export const defaultPhotosWriter: PhotosWriter = {
  setLocation,
  setDateTime,
  setTimezone,
  quitPhotosApp
};

/**
 * Writer bound to a specific library. Location and date go through AppleScript,
 * which always targets the active library (the one we read — see ADR 0012), so
 * they need no path; the timezone write is direct SQLite and must be pointed at
 * the resolved library.
 */
export function createPhotosWriter(libraryPath: string): PhotosWriter {
  return {
    setLocation,
    setDateTime,
    setTimezone: (uuid, tzName, offsetSeconds) => {
      setTimezone(uuid, tzName, offsetSeconds, libraryPath);
    },
    quitPhotosApp
  };
}
