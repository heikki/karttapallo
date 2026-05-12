import { signal, type Signal } from '@lit-labs/signals';

import type { Photo } from '@common/types';

import * as routeData from './route-data';
import type { RouteData, SegMethod } from './route-data';
import { fetchRouteGeometry } from './route-routing';

// The Photo Route — one route, one album. Album+data live in the signal as
// a single atomic value so subscribers can never observe a mid-update where
// one moved and the other didn't.
export interface RouteRef {
  album: string;
  data: RouteData;
}

export const current: Signal.State<RouteRef | null> = signal<RouteRef | null>(
  null
);

// ---------- Primitives ----------

export function clear(): void {
  current.set(null);
}

export function setRoute(album: string, data: RouteData): void {
  current.set({ album, data });
}

// ---------- Server I/O ----------

export async function loadFromServer(album: string): Promise<RouteData | null> {
  try {
    const resp = await fetch(`/api/albums/${encodeURIComponent(album)}/route`);
    if (!resp.ok) return null;
    return (await resp.json()) as RouteData;
  } catch {
    return null;
  }
}

export async function saveToServer(
  album: string,
  data: RouteData
): Promise<void> {
  await fetch(`/api/albums/${encodeURIComponent(album)}/route`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// ---------- Sync verbs ----------

export function insertWaypoint(segIdx: number, lon: number, lat: number): void {
  const cur = current.get();
  if (cur === null) return;
  current.set({
    ...cur,
    data: routeData.insertWaypoint(cur.data, segIdx, lon, lat)
  });
}

export function removeWaypoint(pointIdx: number): SegMethod | null {
  const cur = current.get();
  if (cur === null) return null;
  const result = routeData.removeWaypoint(cur.data, pointIdx);
  if (result === null) return null;
  current.set({ ...cur, data: result.route });
  return result.method;
}

export function updateAdjacentSegments(
  pointIdx: number,
  lon: number,
  lat: number
): void {
  const cur = current.get();
  if (cur === null) return;
  current.set({
    ...cur,
    data: routeData.updateAdjacentSegments(cur.data, pointIdx, lon, lat)
  });
}

export function syncPhotoPoints(photos: Photo[]): boolean {
  const cur = current.get();
  if (cur === null) return false;
  const { route: next, changed } = routeData.syncPhotoPoints(cur.data, photos);
  if (changed) current.set({ ...cur, data: next });
  return changed;
}

export function reorderPhotoPoints(photos: Photo[]): boolean {
  const cur = current.get();
  if (cur === null) return false;
  const { route: next, changed } = routeData.reorderPhotoPoints(
    cur.data,
    photos
  );
  if (changed) current.set({ ...cur, data: next });
  return changed;
}

// ---------- Async verbs (race-guarded) ----------
//
// The signal's COW identity is the race token: capture the current RouteRef
// before await, and drop the result if `route.get()` returns a different
// reference. Any concurrent edit — drag, album switch, clear — invalidates
// the in-flight result.

/**
 * Re-fetch geometry for a segment that already has a non-straight method.
 * On failure, downgrades the method to 'straight' so method and geometry
 * stay consistent.
 */
export async function rerouteSegment(segIdx: number): Promise<void> {
  const before = current.get();
  if (before === null) return;
  const seg = before.data.segments[segIdx];
  if (seg === undefined || seg.method === 'straight' || seg.method === 'none') {
    return;
  }
  const startPt = before.data.points[segIdx];
  const endPt = before.data.points[segIdx + 1];
  if (startPt === undefined || endPt === undefined) return;

  const result = await fetchRouteGeometry(
    [startPt.lon, startPt.lat],
    [endPt.lon, endPt.lat],
    seg.method
  );
  if (current.get() !== before) return;

  const replacement: routeData.RouteSegment = result.ok
    ? { method: seg.method, geometry: result.coords }
    : {
        method: 'straight',
        geometry: [
          [startPt.lon, startPt.lat],
          [endPt.lon, endPt.lat]
        ]
      };
  current.set({
    ...before,
    data: routeData.withSegment(before.data, segIdx, replacement)
  });
}

/**
 * Change a segment's routing method. Returns false if the routing API
 * failed (method left unchanged).
 */
export async function applySegmentMethod(
  segIdx: number,
  method: SegMethod
): Promise<boolean> {
  const before = current.get();
  if (before === null) return false;
  const seg = before.data.segments[segIdx];
  if (seg === undefined) return false;

  const startPt = before.data.points[segIdx];
  const endPt = before.data.points[segIdx + 1];
  if (startPt === undefined || endPt === undefined) return false;

  if (method === 'straight' || method === 'none') {
    current.set({
      ...before,
      data: routeData.withSegment(before.data, segIdx, {
        method,
        geometry: [
          [startPt.lon, startPt.lat],
          [endPt.lon, endPt.lat]
        ]
      })
    });
    return true;
  }

  const result = await fetchRouteGeometry(
    [startPt.lon, startPt.lat],
    [endPt.lon, endPt.lat],
    method
  );
  if (current.get() !== before) return false;
  if (!result.ok) return false;

  current.set({
    ...before,
    data: routeData.withSegment(before.data, segIdx, {
      method,
      geometry: result.coords
    })
  });
  return true;
}
