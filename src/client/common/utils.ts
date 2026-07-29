import type { Photo } from './types';

export function getYear(photo: Photo): string | null {
  if (photo.date === '') return null;
  return photo.date.split(':')[0] ?? null;
}

export function toUtcSortKey(date: string, tz: string | null) {
  const iso = date
    .replace(/^(?<y>\d{4}):(?<m>\d{2}):(?<d>\d{2})/v, '$1-$2-$3')
    .replace(' ', 'T');
  return new Date(iso + (tz ?? 'Z')).toISOString();
}

/** Sort photos in-place using precomputed sort keys (avoids repeated Date allocations). */
export function sortByDate(photos: Photo[]) {
  const keys = new Map<Photo, string>();
  for (const p of photos) {
    keys.set(p, p.date === '' ? '\uffff' : toUtcSortKey(p.date, p.tz));
  }
  photos.sort((a, b) => keys.get(a)!.localeCompare(keys.get(b)!));
}

function parseTimePart(timePart: string | undefined) {
  if (timePart === undefined || timePart === '') return '';
  const [hours, minutes, seconds] = timePart.split(':');
  if (hours !== undefined && minutes !== undefined && seconds !== undefined) {
    return ` ${hours}:${minutes}:${seconds}`;
  }
  if (hours !== undefined && minutes !== undefined) {
    return ` ${hours}:${minutes}`;
  }
  return '';
}

function parseDatePart(datePart: string): string | null {
  const parts = datePart.split(':');
  const hasAllParts =
    parts.length >= 3 &&
    parts[0] !== undefined &&
    parts[1] !== undefined &&
    parts[2] !== undefined;
  if (!hasAllParts) return null;
  return `${parseInt(parts[2]!, 10)}.${parseInt(parts[1]!, 10)}.${parts[0]!}`;
}

const tzPattern = /^(?<sign>[+-])(?<h>\d{2}):(?<m>\d{2})$/;

function formatTz(tz: string) {
  // "+03:00" -> "+3", "-05:30" -> "-5:30", "+00:00" -> "UTC"
  const match = tzPattern.exec(tz);
  if (match === null) return tz;
  const hours = parseInt(match.groups!.h!, 10);
  const minutes = match.groups!.m!;
  if (hours === 0 && minutes === '00') return 'UTC';
  const short = `${match.groups!.sign!}${hours}`;
  if (minutes === '00') return short;
  return `${short}:${minutes}`;
}

export function formatDate(dateStr: string, tz?: string | null) {
  if (dateStr === '') return 'Unknown date';
  // Input format: "YYYY:MM:DD HH:MM:SS" -> Output: "D.M.YYYY HH:MM:SS"
  const [datePart, timePart] = dateStr.split(' ');
  if (datePart === undefined || datePart === '') return dateStr;
  const formattedDate = parseDatePart(datePart);
  if (formattedDate === null) return dateStr;
  const base = formattedDate + parseTimePart(timePart);
  if (tz !== undefined && tz !== null && tz !== '') {
    return `${base} ${formatTz(tz)}`;
  }
  return base;
}

export function editableDateStr(exifDate: string) {
  if (exifDate === '') return '';
  const [datePart, timePart] = exifDate.split(' ');
  if (datePart === undefined) return '';
  const parts = datePart.split(':');
  if (parts.length < 3) return '';
  const d = `${parseInt(parts[2]!, 10)}.${parseInt(parts[1]!, 10)}.${parts[0]!}`;
  if (timePart === undefined) return d;
  const [h, m, s] = timePart.split(':');
  if (h === undefined || m === undefined) return d;
  if (s === undefined) return `${d} ${h}:${m}`;
  return `${d} ${h}:${m}:${s}`;
}

export function isVideo(item: Photo) {
  return item.type === 'video';
}

function toDMS(decimal: number) {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${deg}°${min.toFixed(1)}'`;
}

export function formatCoords(coords: { lat: number; lon: number } | null) {
  if (coords !== null) {
    const ns = coords.lat >= 0 ? 'N' : 'S';
    const ew = coords.lon >= 0 ? 'E' : 'W';
    return `${toDMS(coords.lat)}${ns}, ${toDMS(coords.lon)}${ew}`;
  }
  return 'No location';
}

export function getThumbUrl(photo: Photo) {
  if (photo.thumb === '') {
    return photo.filename ?? '';
  }
  return photo.thumb;
}

export function getFullUrl(photo: Photo) {
  if (photo.full === '') {
    return photo.filename ?? '';
  }
  return photo.full;
}

export function getVideoUrl(photo: Photo) {
  return `video/${photo.uuid}`;
}

export const exifDatePattern =
  /^(?<yr>\d{4}):(?<mo>\d{2}):(?<dy>\d{2}) (?<hr>\d{2}):(?<mi>\d{2}):(?<sc>\d{2})$/;

export function parseExifDate(dateStr: string): Date | null {
  const match = exifDatePattern.exec(dateStr);
  if (match?.groups === undefined) return null;
  const { yr, mo, dy, hr, mi, sc } = match.groups;
  return new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10),
    parseInt(hr!, 10),
    parseInt(mi!, 10),
    parseInt(sc!, 10)
  );
}

export function computeDateOffsetHours(
  originalDateStr: string,
  targetDatePart: string
): number | null {
  const orig = parseExifDate(originalDateStr);
  if (orig === null) return null;
  const parts = targetDatePart.split(':');
  if (parts.length < 3) return null;
  const target = new Date(
    parseInt(parts[0]!, 10),
    parseInt(parts[1]!, 10) - 1,
    parseInt(parts[2]!, 10),
    orig.getHours(),
    orig.getMinutes(),
    orig.getSeconds()
  );
  return (target.getTime() - orig.getTime()) / 3600000;
}

export function computeFullDatetimeOffsetHours(
  originalDateStr: string,
  targetDatetime: Date
): number | null {
  const orig = parseExifDate(originalDateStr);
  if (orig === null) return null;
  return (targetDatetime.getTime() - orig.getTime()) / 3600000;
}

const userDatePattern =
  /^(?<dy>\d{1,2})\.(?<mo>\d{1,2})\.(?<yr>\d{4})?\s*(?<tm>\d{1,2}:\d{2}(?::\d{2})?)?$/;

export function parseUserDatetime(
  input: string,
  fallbackYear: number
): { day: string; time: string | null } | null {
  const trimmed = input.trim();
  const match = userDatePattern.exec(trimmed);
  if (match?.groups === undefined) return null;
  const day = parseInt(match.groups.dy!, 10);
  const month = parseInt(match.groups.mo!, 10);
  const year =
    match.groups.yr !== undefined && match.groups.yr !== ''
      ? parseInt(match.groups.yr, 10)
      : fallbackYear;
  const time =
    match.groups.tm !== undefined && match.groups.tm !== ''
      ? match.groups.tm
      : null;
  function pad(n: number) {
    return String(n).padStart(2, '0');
  }
  return { day: `${year}:${pad(month)}:${pad(day)}`, time };
}
