import { HAS_ROUTING } from '@common/features';

export type RouteFetchResult =
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
