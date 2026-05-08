/**
 * Write operations for Apple Photos: location, date/time, timezone.
 *
 * Replaces set_locations.py and set_times.py with native TypeScript.
 * - Location & date: AppleScript via Photos.app
 * - Timezone: direct SQLite write (no Core Data triggers on these columns)
 *
 * IANA timezone lookup lives in timezone.ts.
 */

import { join } from 'node:path';
import { runAppleScript } from '@native/native-bridge';
import { Database } from 'bun:sqlite';

import { defaultLibraryPath } from './photos-library';

// ---------- AppleScript helpers ----------

/** Set location via AppleScript (Photos.app must be running). */
export function setLocation(uuid: string, lat: number, lon: number): void {
  const script = `tell application "Photos" to set the location of media item id "${uuid}" to {${lat}, ${lon}}`;
  runAppleScript(script);
}

/** Set date/time via AppleScript. date: "YYYY-MM-DD", time: "HH:MM:SS" */
export function setDateTime(uuid: string, date: string, time: string): void {
  // Build date from components to avoid locale-dependent string parsing.
  // AppleScript's `date "..."` coercion is locale-sensitive and breaks
  // on non-US systems (e.g. Finnish expects "10.12.2014 klo 11.33.29").
  const [yr, mo, dy] = date.split('-');
  const [hr, mi, sc] = time.split(':');
  const script = [
    'set d to current date',
    `set year of d to ${yr}`,
    `set month of d to ${mo}`,
    `set day of d to ${dy}`,
    `set hours of d to ${hr}`,
    `set minutes of d to ${mi}`,
    `set seconds of d to ${sc}`,
    `tell application "Photos" to set the date of media item id "${uuid}" to d`
  ].join('\n');
  runAppleScript(script);
}

// ---------- SQLite timezone write ----------

/** Set timezone via direct SQLite write (safe — no triggers on these columns). */
export function setTimezone(
  uuid: string,
  tzName: string,
  offsetSeconds: number,
  libraryPath?: string
): void {
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

export function quitPhotosApp(): void {
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
