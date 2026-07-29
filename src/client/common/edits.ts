import { computed, signal } from '@lit-labs/signals';

import type { Photo } from '@common/types';
import { exifDatePattern } from '@common/utils';

interface Coord {
  lat: number;
  lon: number;
}

export const pendingCoords = signal<Map<string, Coord>>(new Map());
export const pendingTimeOffsets = signal<Map<string, number>>(new Map());
export const saving = signal(false);

export const editCount = computed(
  () => pendingCoords.get().size + pendingTimeOffsets.get().size
);

export function getEffectiveCoords(photo: Photo): Coord {
  const pending = pendingCoords.get().get(photo.uuid);
  if (pending !== undefined) return pending;
  return { lat: photo.lat ?? 0, lon: photo.lon ?? 0 };
}

export function getEffectiveLocation(photo: Photo): Coord | null {
  if (
    photo.lat === null &&
    photo.lon === null &&
    !pendingCoords.get().has(photo.uuid)
  ) {
    return null;
  }
  return getEffectiveCoords(photo);
}

export function setCoord(uuid: string, lat: number, lon: number) {
  const next = new Map(pendingCoords.get());
  next.set(uuid, { lat, lon });
  pendingCoords.set(next);
}

export function addTimeOffset(uuid: string, deltaHours: number) {
  const cur = pendingTimeOffsets.get();
  const total = (cur.get(uuid) ?? 0) + deltaHours;
  const next = new Map(cur);
  if (total === 0) next.delete(uuid);
  else next.set(uuid, total);
  pendingTimeOffsets.set(next);
}

export function setTimeOffset(uuid: string, totalHours: number) {
  const next = new Map(pendingTimeOffsets.get());
  if (totalHours === 0) next.delete(uuid);
  else next.set(uuid, totalHours);
  pendingTimeOffsets.set(next);
}

function applyHourOffset(dateStr: string, hours: number) {
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
  function pad(n: number) {
    return String(n).padStart(2, '0');
  }
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function getEffectiveDate(photo: Photo) {
  const offset = pendingTimeOffsets.get().get(photo.uuid) ?? 0;
  if (offset === 0) return photo.date;
  return applyHourOffset(photo.date, offset);
}

export function getCoordEdits(): Array<{
  uuid: string;
  lat: number;
  lon: number;
}> {
  return Array.from(pendingCoords.get().entries()).map(([uuid, c]) => ({
    uuid,
    ...c
  }));
}

export function getTimeEdits(): Array<{ uuid: string; hours: number }> {
  return Array.from(pendingTimeOffsets.get().entries()).map(
    ([uuid, hours]) => ({
      uuid,
      hours
    })
  );
}

export function clear() {
  pendingCoords.set(new Map());
  pendingTimeOffsets.set(new Map());
}
