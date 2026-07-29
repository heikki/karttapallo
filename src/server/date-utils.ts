/**
 * Shared date and timezone parsing utilities for server-side code.
 */

export const exifDatePattern =
  /^(?<yr>\d{4}):(?<mo>\d{2}):(?<dy>\d{2}) (?<hr>\d{2}):(?<mi>\d{2}):(?<sc>\d{2})$/v;

const pad = (n: number) => String(n).padStart(2, '0');

/** Apply an hour offset to an EXIF date string. */
export function applyHourOffset(dateStr: string, hours: number): string {
  if (dateStr === '' || hours === 0) return dateStr;
  const match = exifDatePattern.exec(dateStr);
  if (match?.groups === undefined) return dateStr;
  const { yr, mo, dy, hr, mi, sc } = match.groups;
  const d = new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10),
    parseInt(hr!, 10),
    parseInt(mi!, 10),
    parseInt(sc!, 10)
  );
  d.setTime(d.getTime() + Math.round(hours * 3600000));
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Convert local date + tz offset to UTC sortable string. */
export function dateToUtc(dateStr: string, tz: string | null): string {
  if (dateStr === '' || tz === null || tz === '') return dateStr;
  try {
    const match = exifDatePattern.exec(dateStr);
    if (match?.groups === undefined) return dateStr;
    const g = match.groups as {
      yr: string;
      mo: string;
      dy: string;
      hr: string;
      mi: string;
      sc: string;
    };
    const offsetMs = tzOffsetMs(tz);

    const d = new Date(
      Date.UTC(
        parseInt(g.yr, 10),
        parseInt(g.mo, 10) - 1,
        parseInt(g.dy, 10),
        parseInt(g.hr, 10),
        parseInt(g.mi, 10),
        parseInt(g.sc, 10)
      ) - offsetMs
    );

    return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  } catch {
    return dateStr;
  }
}

/** Parse a "+03:00" / "-05:30" offset into sign, hours, and minutes. */
function parseTzOffset(tz: string): { sign: number; h: number; m: number } {
  const sign = tz.startsWith('+') ? 1 : -1;
  const h = parseInt(tz.slice(1, 3), 10);
  const m = parseInt(tz.slice(4, 6), 10);
  return { sign, h, m };
}

/** Get timezone offset in fractional hours. "+03:00" -> 3, "-05:30" -> -5.5 */
export function tzOffsetHours(tz: string | null): number {
  if (tz === null || tz === '') return 0;
  const { sign, h, m } = parseTzOffset(tz);
  return sign * (h + m / 60);
}

/** Get timezone offset in milliseconds. */
function tzOffsetMs(tz: string): number {
  const { sign, h, m } = parseTzOffset(tz);
  return sign * (h * 3600000 + m * 60000);
}

/** Convert UTC offset string like "+03:00" to seconds. */
export function tzOffsetToSeconds(offset: string): number {
  const { sign, h, m } = parseTzOffset(offset);
  return sign * (h * 3600 + m * 60);
}

/** Inverse of tzOffsetToSeconds: 10800 -> "+03:00", -18000 -> "-05:00". */
export function secondsToTzOffset(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '-';
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return `${sign}${pad(h)}:${pad(m)}`;
}

/**
 * Format an EXIF local date "YYYY:MM:DD HH:MM:SS" from an epoch-seconds value
 * whose UTC components already spell the desired local wall clock (i.e. the
 * instant already shifted by the local offset). Reads UTC getters so the host
 * timezone never leaks in.
 */
export function exifFromLocalEpoch(localEpochSec: number): string {
  const d = new Date(localEpochSec * 1000);
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Get the system (OS) timezone offset in fractional hours at the date given
 * by an EXIF date string. DST-aware: uses the actual offset for that date.
 *
 * e.g. "2024:07:01 12:00:00" in Finland → +3 (EEST)
 *      "2024:01:15 12:00:00" in Finland → +2 (EET)
 */
export function systemTzOffsetHours(dateStr: string): number {
  const match = exifDatePattern.exec(dateStr);
  if (match?.groups === undefined) {
    return -new Date().getTimezoneOffset() / 60;
  }
  const { yr, mo, dy } = match.groups;
  const d = new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10)
  );
  return -d.getTimezoneOffset() / 60;
}
