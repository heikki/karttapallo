import type { Map as MapGL } from 'maplibre-gl';

import type { RouteData } from './route-data';

/** Distance from a point to a polyline. */
function distToPolyline(
  px: number,
  py: number,
  coords: Array<[number, number]>
): number {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i]!;
    const [bx, by] = coords[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Index of the segment closest to (lon, lat) in screen-space pixels. */
export function findNearestSegment(
  map: MapGL,
  route: RouteData,
  lon: number,
  lat: number
): number {
  const clickPx = map.project([lon, lat]);
  const toScreen = (c: [number, number]): [number, number] => {
    const p = map.project(c);
    return [p.x, p.y];
  };
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < route.segments.length; i++) {
    if (route.segments[i]!.method === 'none') continue;
    const screenCoords = route.segments[i]!.geometry.map(toScreen);
    const dist = distToPolyline(clickPx.x, clickPx.y, screenCoords);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
