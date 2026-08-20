import type { Feature, LineString } from 'geojson';

import type { Photo } from '@common/types';

const EARTH_RADIUS_M = 6371008.8;

// Enough that the circle reads as round at the zoom where a ring is worth
// looking at, cheap enough to rebuild on every selection change.
const SEGMENTS = 64;

export interface AccuracyRing {
  lat: number;
  lon: number;
  metres: number;
}

/**
 * The ring to draw for a photo, or null where there is nothing to draw.
 *
 * Only `exif` photos qualify. The other sources do have a number in
 * `gps_accuracy`, but it is not a measurement: `inferred` carries -1, and
 * `user` carries the constant Photos stamps on a point picked off a map. A
 * circle drawn from either would claim a precision nobody ever measured.
 *
 * A pending edit disqualifies a photo for the same reason — the moment you
 * place the pin yourself, the camera's measurement no longer describes where
 * it sits.
 */
export function accuracyRing(
  photo: Photo | null,
  opts: { panelOpen: boolean; edited: boolean }
): AccuracyRing | null {
  if (!opts.panelOpen || photo === null || opts.edited) return null;
  if (photo.gps !== 'exif') return null;
  if (photo.lat === null || photo.lon === null) return null;
  const metres = photo.gps_accuracy;
  if (metres === null || metres <= 0) return null;
  return { lat: photo.lat, lon: photo.lon, metres };
}

/**
 * The ring as ground geometry — a closed line of points each `metres` away
 * from the centre, so MapLibre scales it with the map instead of us
 * recomputing pixels per zoom. Spherical rather than a flat approximation
 * because the radii here run to kilometres at high latitudes, where the two
 * visibly disagree.
 */
export function ringFeature(ring: AccuracyRing): Feature<LineString> {
  const lat1 = (ring.lat * Math.PI) / 180;
  const lon1 = (ring.lon * Math.PI) / 180;
  const angular = ring.metres / EARTH_RADIUS_M;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(angular);
  const cosAng = Math.cos(angular);

  const coordinates: Array<[number, number]> = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const bearing = (2 * Math.PI * i) / SEGMENTS;
    const sinLat2 = sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(bearing);
    const lat2 = Math.asin(sinLat2);
    // atan2 stays within ±π of the centre, so a ring straddling the
    // antimeridian comes out as continuous longitudes past ±180 — which is
    // what MapLibre wants — rather than snapping across the whole globe.
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * sinAng * cosLat1,
        cosAng - sinLat1 * sinLat2
      );
    coordinates.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates }
  };
}
