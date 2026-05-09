import type { Feature, LineString } from 'geojson';

import * as data from '@common/data';
import * as edits from '@common/edits';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

export interface RoutePoint {
  type: 'photo' | 'waypoint';
  uuid?: string;
  lon: number;
  lat: number;
}

export interface RouteSegment {
  method: 'straight' | 'driving' | 'walking' | 'hiking' | 'cycling' | 'none';
  geometry: Array<[number, number]>;
}

export interface RouteData {
  points: RoutePoint[];
  segments: RouteSegment[];
}

// ---------- Internal helpers ----------

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

/** Remove point at index k, merging the surrounding segments into a straight line. */
export function removePointAt(route: RouteData, k: number): void {
  const { points, segments } = route;
  if (k === points.length - 1) {
    points.splice(k, 1);
    segments.splice(k - 1, 1);
    return;
  }
  points.splice(k, 1);
  segments.splice(k, 1);
  if (k > 0) {
    segments[k - 1] = makeStraightSegment(points[k - 1]!, points[k]!);
  }
}

/** Insert a point at index k, building straight-line segments to neighbors. */
export function insertPointAt(
  route: RouteData,
  k: number,
  pt: RoutePoint
): void {
  const { points, segments } = route;
  if (points.length === 0) {
    points.push(pt);
    return;
  }
  if (k <= 0) {
    segments.unshift(makeStraightSegment(pt, points[0]!));
    points.unshift(pt);
    return;
  }
  if (k >= points.length) {
    segments.push(makeStraightSegment(points[points.length - 1]!, pt));
    points.push(pt);
    return;
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
}

/**
 * Splice waypoints immediately adjacent to the point at idx (likely stale
 * after a coord change). Returns the new index of the original point and
 * whether any waypoint was removed.
 */
function removeAdjacentWaypoints(
  route: RouteData,
  idx: number
): { idx: number; removed: boolean } {
  const { points } = route;
  let cur = idx;
  let removed = false;
  if (cur + 1 < points.length && points[cur + 1]!.type === 'waypoint') {
    removePointAt(route, cur + 1);
    removed = true;
  }
  if (cur > 0 && points[cur - 1]!.type === 'waypoint') {
    removePointAt(route, cur - 1);
    cur -= 1;
    removed = true;
  }
  return { idx: cur, removed };
}

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

function resetSegmentsAroundIndex(
  route: RouteData,
  idx: number,
  pt: RoutePoint
): void {
  const { points, segments } = route;
  if (idx > 0 && idx - 1 < segments.length) {
    segments[idx - 1] = makeStraightSegment(points[idx - 1]!, pt);
  }
  const next = points[idx + 1];
  if (idx < segments.length && next !== undefined) {
    segments[idx] = makeStraightSegment(pt, next);
  }
}

// ---------- Public algebra ----------

/** Insert a waypoint at the given segment, splitting it into two with the same method. */
export function insertWaypoint(
  route: RouteData,
  segIdx: number,
  lon: number,
  lat: number
): void {
  const newPoint: RoutePoint = { type: 'waypoint', lon, lat };
  route.points.splice(segIdx + 1, 0, newPoint);

  const oldSeg = route.segments[segIdx]!;
  const prevPt = route.points[segIdx]!;
  const nextPt = route.points[segIdx + 2]!;
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
  route.segments.splice(segIdx, 1, seg1, seg2);
}

/** Remove a waypoint, merging adjacent segments. Returns the merged method, or null. */
export function removeWaypoint(
  route: RouteData,
  pointIdx: number
): RouteSegment['method'] | null {
  if (route.points[pointIdx]?.type !== 'waypoint') return null;

  const segBefore = pointIdx - 1;
  const prevPt = route.points[pointIdx - 1]!;
  const nextPt = route.points[pointIdx + 1]!;
  const method = route.segments[segBefore]?.method ?? 'straight';

  route.points.splice(pointIdx, 1);
  const merged: RouteSegment = {
    method,
    geometry: [
      [prevPt.lon, prevPt.lat],
      [nextPt.lon, nextPt.lat]
    ]
  };
  route.segments.splice(segBefore, 2, merged);
  return method;
}

/** Update adjacent segment endpoints when a point is dragged. */
export function updateAdjacentSegments(
  route: RouteData,
  pointIdx: number,
  lon: number,
  lat: number
): void {
  const pt = route.points[pointIdx];
  if (pt === undefined) return;
  pt.lon = lon;
  pt.lat = lat;
  const before = pointIdx - 1;
  const after = pointIdx;
  const segBefore = before >= 0 ? route.segments[before] : undefined;
  if (segBefore !== undefined) {
    const prev = route.points[pointIdx - 1]!;
    segBefore.geometry = [
      [prev.lon, prev.lat],
      [lon, lat]
    ];
  }
  const segAfter =
    after < route.segments.length ? route.segments[after] : undefined;
  if (segAfter !== undefined) {
    const next = route.points[pointIdx + 1]!;
    segAfter.geometry = [
      [lon, lat],
      [next.lon, next.lat]
    ];
  }
}

/**
 * Sync photo point coordinates with current effective locations. Splices
 * waypoints adjacent to points whose coords moved (likely stale). Returns
 * true if any waypoint was removed.
 */
export function syncPhotoPoints(
  route: RouteData,
  photos: Photo[] = data.filteredPhotos.get()
): boolean {
  const locMap = buildPhotoLocationMap(photos);
  const { points, segments } = route;
  let removed = false;
  let i = 0;
  while (i < points.length) {
    const loc = getMovedPhotoLocation(points[i]!, locMap);
    if (loc === null) {
      i++;
      continue;
    }
    const pt = points[i]!;
    pt.lon = loc.lon;
    pt.lat = loc.lat;
    const coord: [number, number] = [loc.lon, loc.lat];
    const before = segments[i - 1];
    if (before !== undefined) {
      if (before.method === 'straight') {
        before.geometry.splice(-1, 1, coord);
      } else {
        const prev = points[i - 1]!;
        segments[i - 1] = {
          method: 'straight',
          geometry: [[prev.lon, prev.lat], coord]
        };
      }
    }
    const after = segments[i];
    if (after !== undefined) {
      if (after.method === 'straight') {
        after.geometry.splice(0, 1, coord);
      } else {
        const next = points[i + 1]!;
        segments[i] = {
          method: 'straight',
          geometry: [coord, [next.lon, next.lat]]
        };
      }
    }
    const result = removeAdjacentWaypoints(route, i);
    if (result.removed) removed = true;
    i = result.idx + 1;
  }
  return removed;
}

/**
 * Reorder photo points to match current chronological order. Segments around
 * moved points reset to straight; adjacent waypoints are spliced. Returns
 * true if any reordering occurred.
 */
export function reorderRoutePhotoPoints(
  route: RouteData,
  photos: Photo[] = data.filteredPhotos.get()
): boolean {
  const sortKeys = buildPhotoSortKeys(photos);
  const { points } = route;
  const photoIndices = collectSortablePhotoIndices(points, sortKeys);
  if (photoIndices.length < 2) return false;

  const currentUuids = photoIndices.map((i) => points[i]!.uuid!);
  const sortedUuids = computeSortedUuids(currentUuids, sortKeys);
  if (currentUuids.every((uuid, i) => uuid === sortedUuids[i])) return false;

  const uuidToPoint = snapshotPointsByUuid(points, photoIndices);

  const movedIndices: number[] = [];
  for (let i = 0; i < photoIndices.length; i++) {
    const idx = photoIndices[i]!;
    if (currentUuids[i] === sortedUuids[i]) continue;
    const newPt = { ...uuidToPoint.get(sortedUuids[i]!)! };
    points[idx] = newPt;
    resetSegmentsAroundIndex(route, idx, newPt);
    movedIndices.push(idx);
  }

  for (let i = movedIndices.length - 1; i >= 0; i--) {
    removeAdjacentWaypoints(route, movedIndices[i]!);
  }

  return true;
}

/** Build display line features from route segments, breaking at 'none' segments. */
export function buildRouteLineFeatures(
  route: RouteData
): Array<Feature<LineString>> {
  const features: Array<Feature<LineString>> = [];
  let current: Array<[number, number]> = [];
  for (const seg of route.segments) {
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
export function buildDefaultRoute(
  photos: Photo[] = data.filteredPhotos.get()
): RouteData | null {
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
