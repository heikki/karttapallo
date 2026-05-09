import { HAS_ROUTING } from '@common/features';

import type { RouteData, RouteSegment } from './route-data';

type RouteFetchResult =
  | { ok: true; coords: Array<[number, number]> }
  | { ok: false; reason: 'no-key' | 'request-failed' };

/** Fetch routed geometry from the server for a segment. */
export async function fetchRouteGeometry(
  start: [number, number],
  end: [number, number],
  profile: string
): Promise<RouteFetchResult> {
  if (!HAS_ROUTING) return { ok: false, reason: 'no-key' };
  try {
    const resp = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [start, end], profile })
    });
    if (!resp.ok) return { ok: false, reason: 'request-failed' };
    const data = (await resp.json()) as {
      geometry: { coordinates: Array<[number, number]> };
    };
    return { ok: true, coords: data.geometry.coordinates };
  } catch {
    return { ok: false, reason: 'request-failed' };
  }
}

/**
 * Re-route a single segment in-place using the routing API. On failure
 * (no key or transient request error) downgrades the segment's method
 * to 'straight' so method and geometry stay consistent.
 */
export async function rerouteSegment(
  route: RouteData,
  segIdx: number
): Promise<void> {
  const seg = route.segments[segIdx];
  if (seg === undefined || seg.method === 'straight' || seg.method === 'none') {
    return;
  }
  const startPt = route.points[segIdx]!;
  const endPt = route.points[segIdx + 1]!;
  const result = await fetchRouteGeometry(
    [startPt.lon, startPt.lat],
    [endPt.lon, endPt.lat],
    seg.method
  );
  if (result.ok) {
    seg.geometry = result.coords;
  } else {
    seg.method = 'straight';
    seg.geometry = [
      [startPt.lon, startPt.lat],
      [endPt.lon, endPt.lat]
    ];
  }
}

/** Change a segment's routing method. Returns false if the routing API failed. */
export async function applySegmentMethod(
  route: RouteData,
  segIdx: number,
  method: RouteSegment['method']
): Promise<boolean> {
  const seg = route.segments[segIdx];
  if (seg === undefined) return false;

  const prevMethod = seg.method;
  const prevGeometry = seg.geometry;
  seg.method = method;

  const startPt = route.points[segIdx]!;
  const endPt = route.points[segIdx + 1]!;

  if (method === 'straight' || method === 'none') {
    seg.geometry = [
      [startPt.lon, startPt.lat],
      [endPt.lon, endPt.lat]
    ];
    return true;
  }

  const result = await fetchRouteGeometry(
    [startPt.lon, startPt.lat],
    [endPt.lon, endPt.lat],
    method
  );
  if (!result.ok) {
    seg.method = prevMethod;
    seg.geometry = prevGeometry;
    return false;
  }
  seg.geometry = result.coords;
  return true;
}
