import { describe, expect, test } from 'bun:test';

import type { Photo } from '@common/types';

import { accuracyRing, ringFeature } from './geometry';

function photo(over: Partial<Photo> = {}): Photo {
  return {
    uuid: 'p1',
    type: 'photo',
    full: 'full/p1.jpg',
    thumb: 'thumb/p1.jpg',
    lat: 64,
    lon: 25,
    date: '2024:06:01 12:00:00',
    tz: '+03:00',
    camera: 'iPhone',
    gps: 'exif',
    gps_accuracy: 20,
    albums: [],
    place: [],
    description: [],
    labels: [],
    ...over
  };
}

const OPEN = { panelOpen: true, edited: false };

describe('accuracyRing', () => {
  test('draws the measured radius for an exif photo', () => {
    expect(accuracyRing(photo(), OPEN)).toEqual({
      lat: 64,
      lon: 25,
      metres: 20
    });
  });

  test('draws nothing while the info panel is closed', () => {
    expect(
      accuracyRing(photo(), { panelOpen: false, edited: false })
    ).toBeNull();
  });

  test('draws nothing once the photo has a pending edit', () => {
    expect(accuracyRing(photo(), { panelOpen: true, edited: true })).toBeNull();
  });

  test('draws nothing without a photo', () => {
    expect(accuracyRing(null, OPEN)).toBeNull();
  });

  // The placeholders Photos leaves behind where nothing was measured: -1 for
  // its own guess, and the constant it stamps on a hand-placed pin. Both
  // arrive classified, so the source is what disqualifies them — but assert
  // on the numbers too, since they are the reason the rule exists.
  test.each([
    ['inferred', -1],
    ['user', 10],
    ['user', 1]
  ])('draws nothing for a %s location (accuracy %p)', (gps, accuracy) => {
    expect(
      accuracyRing(photo({ gps, gps_accuracy: accuracy }), OPEN)
    ).toBeNull();
  });

  test('draws nothing for a photo with no location at all', () => {
    expect(
      accuracyRing(photo({ gps: null, gps_accuracy: null }), OPEN)
    ).toBeNull();
  });

  test('draws nothing when an exif photo carries no accuracy', () => {
    expect(accuracyRing(photo({ gps_accuracy: null }), OPEN)).toBeNull();
  });
});

/** Metres between two lon/lat points, by the haversine formula. */
function distance(a: number[], b: number[]): number {
  const [lon1, lat1] = [(a[0]! * Math.PI) / 180, (a[1]! * Math.PI) / 180];
  const [lon2, lat2] = [(b[0]! * Math.PI) / 180, (b[1]! * Math.PI) / 180];
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

describe('ringFeature', () => {
  test('closes the ring', () => {
    const coords = ringFeature({ lat: 64, lon: 25, metres: 100 }).geometry
      .coordinates;
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  // A flat approximation would drift by metres at this latitude; a circle
  // that is not round is the one way this can be visibly wrong.
  test.each([5, 20, 3104])(
    'puts every point %p m from the centre, at 64°N',
    (metres) => {
      const centre = [25, 64];
      for (const point of ringFeature({ lat: 64, lon: 25, metres }).geometry
        .coordinates) {
        expect(distance(centre, point)).toBeCloseTo(metres, 6);
      }
    }
  );

  test('crosses the antimeridian as continuous longitudes', () => {
    const coords = ringFeature({ lat: 0, lon: 179.999, metres: 3000 }).geometry
      .coordinates;
    const east = Math.max(...coords.map((c) => c[0]!));
    // Past +180 rather than wrapping to -180, so MapLibre draws one circle
    // instead of a line straight back across the globe.
    expect(east).toBeGreaterThan(180);
    expect(east).toBeLessThan(180.1);
  });
});
