import type { Feature, LineString } from 'geojson';

import * as edits from '@common/edits';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

export interface RoutePoint {
  type: 'photo' | 'waypoint';
  uuid?: string;
  lon: number;
  lat: number;
}

export type SegMethod =
  | 'straight'
  | 'driving'
  | 'walking'
  | 'hiking'
  | 'cycling'
  | 'none';

export interface RouteSegment {
  method: SegMethod;
  geometry: Array<[number, number]>;
}

export interface RouteData {
  points: RoutePoint[];
  segments: RouteSegment[];
}

// ---------- Construction ----------

export function makeStraightSegment(
  from: RoutePoint,
  to: RoutePoint
): RouteSegment {
  return {
    method: 'straight',
    geometry: [
      [from.lon, from.lat],
      [to.lon, to.lat]
    ]
  };
}

/** Replace a segment at segIdx. Returns a new RouteData. */
export function withSegment(
  r: RouteData,
  segIdx: number,
  seg: RouteSegment
): RouteData {
  const segments = r.segments.slice();
  segments[segIdx] = seg;
  return { points: r.points, segments };
}

// ---------- Point insertion / removal ----------

/** Remove the point at index k, merging surrounding segments into a straight line. */
export function removePoint(r: RouteData, k: number): RouteData {
  const points = r.points.slice();
  const segments = r.segments.slice();
  if (k === points.length - 1) {
    points.splice(k, 1);
    segments.splice(k - 1, 1);
    return { points, segments };
  }
  points.splice(k, 1);
  segments.splice(k, 1);
  if (k > 0) {
    segments[k - 1] = makeStraightSegment(points[k - 1]!, points[k]!);
  }
  return { points, segments };
}

/** Insert a point at index k, building straight-line segments to neighbours. */
export function insertPoint(
  r: RouteData,
  k: number,
  pt: RoutePoint
): RouteData {
  const points = r.points.slice();
  const segments = r.segments.slice();
  if (points.length === 0) {
    points.push(pt);
    return { points, segments };
  }
  if (k <= 0) {
    segments.unshift(makeStraightSegment(pt, points[0]!));
    points.unshift(pt);
    return { points, segments };
  }
  if (k >= points.length) {
    segments.push(makeStraightSegment(points[points.length - 1]!, pt));
    points.push(pt);
    return { points, segments };
  }
  const prev = points[k - 1]!;
  const next = points[k]!;
  points.splice(k, 0, pt);
  segments.splice(
    k - 1,
    1,
    makeStraightSegment(prev, pt),
    makeStraightSegment(pt, next)
  );
  return { points, segments };
}

/**
 * Drop waypoints immediately adjacent to the point at idx (likely stale
 * after a coord change). Returns the new RouteData, the new index of the
 * original point, and whether any waypoint was removed.
 */
function withoutAdjacentWaypoints(
  r: RouteData,
  idx: number
): { route: RouteData; idx: number; removed: boolean } {
  let cur = r;
  let i = idx;
  let removed = false;
  if (i + 1 < cur.points.length && cur.points[i + 1]!.type === 'waypoint') {
    cur = removePoint(cur, i + 1);
    removed = true;
  }
  if (i > 0 && cur.points[i - 1]!.type === 'waypoint') {
    cur = removePoint(cur, i - 1);
    i -= 1;
    removed = true;
  }
  return { route: cur, idx: i, removed };
}

// ---------- Waypoint edit verbs ----------

/** Insert a waypoint into segment segIdx, splitting it into two with the same method. */
export function insertWaypoint(
  r: RouteData,
  segIdx: number,
  lon: number,
  lat: number
): RouteData {
  const newPoint: RoutePoint = { type: 'waypoint', lon, lat };
  const points = r.points.slice();
  points.splice(segIdx + 1, 0, newPoint);

  const oldSeg = r.segments[segIdx]!;
  const prevPt = r.points[segIdx]!;
  const nextPt = r.points[segIdx + 1]!;
  const seg1: RouteSegment = {
    method: oldSeg.method,
    geometry: [
      [prevPt.lon, prevPt.lat],
      [lon, lat]
    ]
  };
  const seg2: RouteSegment = {
    method: oldSeg.method,
    geometry: [
      [lon, lat],
      [nextPt.lon, nextPt.lat]
    ]
  };
  const segments = r.segments.slice();
  segments.splice(segIdx, 1, seg1, seg2);
  return { points, segments };
}

/** Remove a waypoint, merging adjacent segments. Returns null if the point isn't a waypoint. */
export function removeWaypoint(
  r: RouteData,
  pointIdx: number
): { route: RouteData; method: SegMethod } | null {
  if (r.points[pointIdx]?.type !== 'waypoint') return null;

  const segBefore = pointIdx - 1;
  const prevPt = r.points[pointIdx - 1]!;
  const nextPt = r.points[pointIdx + 1]!;
  const method = r.segments[segBefore]?.method ?? 'straight';

  const points = r.points.slice();
  points.splice(pointIdx, 1);
  const merged: RouteSegment = {
    method,
    geometry: [
      [prevPt.lon, prevPt.lat],
      [nextPt.lon, nextPt.lat]
    ]
  };
  const segments = r.segments.slice();
  segments.splice(segBefore, 2, merged);
  return { route: { points, segments }, method };
}

/** Update a point's position and adjacent segment endpoints (for drag). */
export function updateAdjacentSegments(
  r: RouteData,
  pointIdx: number,
  lon: number,
  lat: number
): RouteData {
  const pt = r.points[pointIdx];
  if (pt === undefined) return r;
  const points = r.points.slice();
  points[pointIdx] = { ...pt, lon, lat };

  const segments = r.segments.slice();
  const before = pointIdx - 1;
  if (before >= 0) {
    const seg = segments[before];
    if (seg !== undefined) {
      const prev = points[pointIdx - 1]!;
      segments[before] = {
        ...seg,
        geometry: [
          [prev.lon, prev.lat],
          [lon, lat]
        ]
      };
    }
  }
  const after = pointIdx;
  if (after < segments.length) {
    const seg = segments[after];
    if (seg !== undefined) {
      const next = points[pointIdx + 1]!;
      segments[after] = {
        ...seg,
        geometry: [
          [lon, lat],
          [next.lon, next.lat]
        ]
      };
    }
  }
  return { points, segments };
}

// ---------- Photo-driven reconciliation ----------

function buildPhotoLocationMap(
  photos: Photo[]
): Map<string, { lon: number; lat: number }> {
  const m = new Map<string, { lon: number; lat: number }>();
  for (const photo of photos) {
    const loc = edits.getEffectiveLocation(photo);
    if (loc !== null) m.set(photo.uuid, loc);
  }
  return m;
}

function getMovedPhotoLocation(
  pt: RoutePoint,
  locMap: Map<string, { lon: number; lat: number }>
): { lon: number; lat: number } | null {
  if (pt.type !== 'photo' || pt.uuid === undefined) return null;
  const loc = locMap.get(pt.uuid);
  if (loc === undefined || (loc.lon === pt.lon && loc.lat === pt.lat)) {
    return null;
  }
  return loc;
}

/**
 * Sync photo point coordinates with current effective locations. Drops
 * waypoints adjacent to points whose coords moved (likely stale).
 */
export function syncPhotoPoints(
  r: RouteData,
  photos: Photo[]
): { route: RouteData; changed: boolean } {
  const locMap = buildPhotoLocationMap(photos);
  let cur = r;
  let changed = false;
  let removed = false;
  let i = 0;
  while (i < cur.points.length) {
    const loc = getMovedPhotoLocation(cur.points[i]!, locMap);
    if (loc === null) {
      i++;
      continue;
    }
    const pt = cur.points[i]!;
    const newCoord: [number, number] = [loc.lon, loc.lat];

    const points = cur.points.slice();
    points[i] = { ...pt, lon: loc.lon, lat: loc.lat };
    const segments = cur.segments.slice();

    const before = segments[i - 1];
    if (before !== undefined) {
      if (before.method === 'straight') {
        segments[i - 1] = {
          ...before,
          geometry: [...before.geometry.slice(0, -1), newCoord]
        };
      } else {
        const prev = points[i - 1]!;
        segments[i - 1] = {
          method: 'straight',
          geometry: [[prev.lon, prev.lat], newCoord]
        };
      }
    }
    const after = segments[i];
    if (after !== undefined) {
      if (after.method === 'straight') {
        segments[i] = {
          ...after,
          geometry: [newCoord, ...after.geometry.slice(1)]
        };
      } else {
        const next = points[i + 1]!;
        segments[i] = {
          method: 'straight',
          geometry: [newCoord, [next.lon, next.lat]]
        };
      }
    }
    cur = { points, segments };
    changed = true;
    const result = withoutAdjacentWaypoints(cur, i);
    cur = result.route;
    if (result.removed) removed = true;
    i = result.idx + 1;
  }
  return { route: cur, changed: changed || removed };
}

function buildPhotoSortKeys(photos: Photo[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const photo of photos) {
    if (photo.date !== '') {
      m.set(photo.uuid, toUtcSortKey(edits.getEffectiveDate(photo), photo.tz));
    }
  }
  return m;
}

function collectSortablePhotoIndices(
  points: RoutePoint[],
  sortKeys: Map<string, string>
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    if (pt.type === 'photo' && pt.uuid !== undefined && sortKeys.has(pt.uuid)) {
      indices.push(i);
    }
  }
  return indices;
}

function computeSortedUuids(
  currentUuids: string[],
  sortKeys: Map<string, string>
): string[] {
  return [...currentUuids].sort((a, b) => {
    const ka = sortKeys.get(a)!;
    const kb = sortKeys.get(b)!;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function snapshotPointsByUuid(
  points: RoutePoint[],
  indices: number[]
): Map<string, RoutePoint> {
  const m = new Map<string, RoutePoint>();
  for (const i of indices) {
    const pt = points[i]!;
    m.set(pt.uuid!, { ...pt });
  }
  return m;
}

function withSegmentsResetAround(
  r: RouteData,
  idx: number,
  pt: RoutePoint
): RouteData {
  const segments = r.segments.slice();
  if (idx > 0 && idx - 1 < segments.length) {
    segments[idx - 1] = makeStraightSegment(r.points[idx - 1]!, pt);
  }
  const next = r.points[idx + 1];
  if (idx < segments.length && next !== undefined) {
    segments[idx] = makeStraightSegment(pt, next);
  }
  return { points: r.points, segments };
}

/**
 * Reorder photo points to match current chronological order. Segments
 * around moved points reset to straight; adjacent waypoints are dropped.
 */
export function reorderPhotoPoints(
  r: RouteData,
  photos: Photo[]
): { route: RouteData; changed: boolean } {
  const sortKeys = buildPhotoSortKeys(photos);
  const photoIndices = collectSortablePhotoIndices(r.points, sortKeys);
  if (photoIndices.length < 2) return { route: r, changed: false };

  const currentUuids = photoIndices.map((i) => r.points[i]!.uuid!);
  const sortedUuids = computeSortedUuids(currentUuids, sortKeys);
  if (currentUuids.every((uuid, i) => uuid === sortedUuids[i])) {
    return { route: r, changed: false };
  }

  const uuidToPoint = snapshotPointsByUuid(r.points, photoIndices);
  let cur = r;
  const points = cur.points.slice();

  const movedIndices: number[] = [];
  for (let i = 0; i < photoIndices.length; i++) {
    const idx = photoIndices[i]!;
    if (currentUuids[i] === sortedUuids[i]) continue;
    const newPt = { ...uuidToPoint.get(sortedUuids[i]!)! };
    points[idx] = newPt;
    movedIndices.push(idx);
  }
  cur = { points, segments: cur.segments };
  for (const idx of movedIndices) {
    cur = withSegmentsResetAround(cur, idx, cur.points[idx]!);
  }

  for (let i = movedIndices.length - 1; i >= 0; i--) {
    const result = withoutAdjacentWaypoints(cur, movedIndices[i]!);
    cur = result.route;
  }

  return { route: cur, changed: true };
}

// ---------- Display projections ----------

/** Build display line features from route segments, breaking at 'none' segments. */
export function buildLineFeatures(r: RouteData): Array<Feature<LineString>> {
  const features: Array<Feature<LineString>> = [];
  let current: Array<[number, number]> = [];
  for (const seg of r.segments) {
    if (seg.method === 'none') {
      if (current.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: current },
          properties: {}
        });
      }
      current = [];
      continue;
    }
    for (let j = 0; j < seg.geometry.length; j++) {
      if (current.length > 0 && j === 0) continue;
      current.push(seg.geometry[j]!);
    }
  }
  if (current.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: current },
      properties: {}
    });
  }
  return features;
}

/**
 * Build a default straight-line route from chronologically sorted, located
 * photos. Returns null if there are fewer than two eligible photos.
 */
export function buildDefault(photos: Photo[]): RouteData | null {
  const located: Array<{
    uuid: string;
    lon: number;
    lat: number;
    sortKey: string;
  }> = [];
  for (const photo of photos) {
    const loc = edits.getEffectiveLocation(photo);
    if (loc === null) continue;
    if (photo.date === '') continue;
    located.push({
      uuid: photo.uuid,
      lon: loc.lon,
      lat: loc.lat,
      sortKey: toUtcSortKey(edits.getEffectiveDate(photo), photo.tz)
    });
  }
  if (located.length < 2) return null;
  located.sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
  );

  const points: RoutePoint[] = located.map((p) => ({
    type: 'photo' as const,
    uuid: p.uuid,
    lon: p.lon,
    lat: p.lat
  }));
  const segments: RouteSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      method: 'straight',
      geometry: [
        [points[i]!.lon, points[i]!.lat],
        [points[i + 1]!.lon, points[i + 1]!.lat]
      ]
    });
  }
  return { points, segments };
}
