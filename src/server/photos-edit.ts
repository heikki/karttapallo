/**
 * Write operations for Apple Photos: location, date/time, timezone.
 *
 * Replaces set_locations.py and set_times.py with native TypeScript.
 * - Location & date: AppleScript via Photos.app
 * - Timezone: direct SQLite write (no Core Data triggers on these columns)
 * - Timezone lookup: geo-tz package
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

import { runAppleScript } from '../../resources/native/native-bridge';
import { exifDatePattern } from './date-utils';

// Use require() for geo-tz: its CJS build declares ESM exports incorrectly,
// causing bundler failures in Electrobun's Bun version.
// Use geo-tz/all (comprehensive dataset) so Iceland returns Atlantic/Reykjavik
// instead of Africa/Abidjan (the default "alike since 1970" dataset merges
// timezones with identical rules and picks the highest-population one).
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports -- CJS interop
const { find: geoTzFind } = require('geo-tz/all') as typeof import('geo-tz');

// ---------- Test safety latch ----------

function assertWritesAllowed(): void {
  if (process.env.KARTTAKUVAT_NO_PHOTOS_WRITES === '1') {
    throw new Error(
      'Photos.app writes disabled by KARTTAKUVAT_NO_PHOTOS_WRITES=1'
    );
  }
}

// ---------- AppleScript helpers ----------

/** Set location via AppleScript (Photos.app must be running). */
export function setLocation(uuid: string, lat: number, lon: number): void {
  assertWritesAllowed();
  const script = `tell application "Photos" to set the location of media item id "${uuid}" to {${lat}, ${lon}}`;
  runAppleScript(script);
}

/** Set date/time via AppleScript. date: "YYYY-MM-DD", time: "HH:MM:SS" */
export function setDateTime(uuid: string, date: string, time: string): void {
  assertWritesAllowed();
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

function defaultLibraryPath(): string {
  return join(homedir(), 'Pictures/Photos Library.photoslibrary');
}

/** Set timezone via direct SQLite write (safe — no triggers on these columns). */
export function setTimezone(
  uuid: string,
  tzName: string,
  offsetSeconds: number,
  libraryPath?: string
): void {
  assertWritesAllowed();
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
  assertWritesAllowed();
  runAppleScript('tell application "Photos" to quit');
}

// ---------- Timezone helpers ----------

/** Get IANA timezone name from coordinates. Returns e.g. "Europe/Helsinki". */
export function tzNameFromCoords(lat: number, lon: number): string | null {
  const results = geoTzFind(lat, lon);
  return results[0] ?? null;
}

/**
 * Get UTC offset string (e.g. "+03:00") from coordinates and local date.
 * Accounts for DST at the given date.
 */
export function tzOffsetFromCoords(
  lat: number,
  lon: number,
  dateStr: string
): string | null {
  if (dateStr === '') return null;
  const tzName = tzNameFromCoords(lat, lon);
  if (tzName === null) return null;
  return tzOffsetFromTzName(tzName, dateStr);
}

/**
 * Get UTC offset string from IANA timezone name and local date string.
 * dateStr format: "YYYY:MM:DD HH:MM:SS"
 */
export function tzOffsetFromTzName(
  tzName: string,
  dateStr: string
): string | null {
  try {
    // Parse "YYYY:MM:DD HH:MM:SS" into components
    const match = exifDatePattern.exec(dateStr);
    if (match?.groups === undefined) return null;
    const { yr, mo, dy, hr, mi } = match.groups;

    // Use Intl.DateTimeFormat to get the UTC offset at this date in the timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      timeZoneName: 'longOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Create a date in the target timezone by interpreting as UTC first,
    // then using the formatter to extract the offset
    const utcDate = new Date(`${yr}-${mo}-${dy}T${hr}:${mi}:00Z`);
    const parts = formatter.formatToParts(utcDate);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart === undefined) return null;

    // tzPart.value is like "GMT+03:00" or "GMT-05:00" or "GMT"
    const gmtMatch = /^GMT(?<offset>[+-]\d{2}:\d{2})?$/v.exec(tzPart.value);
    if (gmtMatch === null) return null;
    return gmtMatch.groups?.offset ?? '+00:00';
  } catch {
    return null;
  }
}

export { tzOffsetToSeconds } from './date-utils';
