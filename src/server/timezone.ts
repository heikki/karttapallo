/**
 * IANA timezone resolution for photo locations.
 *
 * - geo-tz turns coordinates into an IANA name.
 * - Intl.DateTimeFormat resolves the offset at a given instant (DST-aware).
 *
 * Photos.sqlite's ZTIMEZONEOFFSET column is not a durable IANA offset — a
 * restore can lose it (see docs/adr/0013). So displayed time is derived from
 * the journaled pair (UTC instant + coordinates) via localizeInstant; the
 * stored offset is only a fallback. See item-store.ts buildItemEntry.
 */

import {
  exifDatePattern,
  exifFromLocalEpoch,
  secondsToTzOffset
} from './date-utils';

// Use require() for geo-tz: its CJS build declares ESM exports incorrectly,
// causing bundler failures in Electrobun's Bun version.
// Use geo-tz/all (comprehensive dataset) so Iceland returns Atlantic/Reykjavik
// instead of Africa/Abidjan (the default "alike since 1970" dataset merges
// timezones with identical rules and picks the highest-population one).
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports -- CJS interop
const { find: geoTzFind } = require('geo-tz/all') as typeof import('geo-tz');

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
 * UTC offset in seconds for an IANA zone at a specific instant (DST-aware).
 * instantSec: UTC seconds since the Unix epoch. Returns e.g. 10800 for +03:00.
 */
export function tzOffsetSecondsAtInstant(
  tzName: string,
  instantSec: number
): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      timeZoneName: 'longOffset'
    });
    const parts = formatter.formatToParts(new Date(instantSec * 1000));
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart === undefined) return null;

    // tzPart.value is like "GMT+03:00", "GMT-05:00", or "GMT" (== +00:00).
    if (tzPart.value === 'GMT') return 0;
    const gmtMatch = /^GMT(?<sign>[+\-])(?<h>\d{2}):(?<m>\d{2})$/v.exec(
      tzPart.value
    );
    if (gmtMatch?.groups === undefined) return null;
    const { sign, h, m } = gmtMatch.groups;
    const magnitude = Number(h) * 3600 + Number(m) * 60;
    return sign === '-' ? -magnitude : magnitude;
  } catch {
    return null;
  }
}

/**
 * Localize a UTC instant using the timezone implied by coordinates (ADR-0013).
 *
 * Both inputs — the instant and the coordinates — are journaled by Photos, so
 * the derived wall clock and offset survive a restore even when the stored
 * ZTIMEZONEOFFSET does not. This is the durable temporal path.
 *
 * instantSec: UTC seconds since the Unix epoch. Returns EXIF-format local time
 * "YYYY:MM:DD HH:MM:SS" and offset "+HH:MM", or null if coords resolve to no
 * IANA zone.
 */
export function localizeInstant(
  lat: number,
  lon: number,
  instantSec: number
): { date: string; tz: string } | null {
  const tzName = tzNameFromCoords(lat, lon);
  if (tzName === null) return null;
  const offsetSec = tzOffsetSecondsAtInstant(tzName, instantSec);
  if (offsetSec === null) return null;
  return {
    date: exifFromLocalEpoch(instantSec + offsetSec),
    tz: secondsToTzOffset(offsetSec)
  };
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
    const match = exifDatePattern.exec(dateStr);
    if (match?.groups === undefined) return null;
    const { yr, mo, dy, hr, mi } = match.groups;

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      timeZoneName: 'longOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const utcDate = new Date(`${yr}-${mo}-${dy}T${hr}:${mi}:00Z`);
    const parts = formatter.formatToParts(utcDate);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart === undefined) return null;

    // tzPart.value is like "GMT+03:00" or "GMT-05:00" or "GMT"
    const gmtMatch = /^GMT(?<offset>[+\-]\d{2}:\d{2})?$/v.exec(tzPart.value);
    if (gmtMatch === null) return null;
    return gmtMatch.groups?.offset ?? '+00:00';
  } catch {
    return null;
  }
}
