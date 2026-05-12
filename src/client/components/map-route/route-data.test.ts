import { beforeEach, describe, expect, test } from 'bun:test';

import { clear as clearEdits, setCoord } from '@common/edits';
import type { Photo } from '@common/types';

import {
  buildDefault,
  buildLineFeatures,
  insertWaypoint,
  removeWaypoint,
  reorderPhotoPoints,
  syncPhotoPoints,
  updateAdjacentSegments,
  withSegment
} from './route-data';
import type { RouteData, RoutePoint, RouteSegment } from './route-data';

const photoPt = (uuid: string, lon: number, lat: number): RoutePoint => ({
  type: 'photo',
  uuid,
  lon,
  lat
});

const wpPt = (lon: number, lat: number): RoutePoint => ({
  type: 'waypoint',
  lon,
  lat
});

const seg = (
  from: [number, number],
  to: [number, number],
  method: RouteSegment['method'] = 'straight'
): RouteSegment => ({ method, geometry: [from, to] });

const photo = (overrides: Partial<Photo> = {}): Photo => ({
  uuid: 'p1',
  type: 'photo',
  full: 'full/p1.jpg',
  thumb: 'thumb/p1.jpg',
  lat: 60.0,
  lon: 25.0,
  date: '2024:06:01 12:00:00',
  tz: '+00:00',
  camera: null,
  gps: 'exif',
  albums: [],
  ...overrides
});

beforeEach(() => {
  clearEdits();
});

describe('insertWaypoint', () => {
  test('splits one segment into two with the same method', () => {
    const r: RouteData = {
      points: [photoPt('a', 0, 0), photoPt('b', 10, 0)],
      segments: [seg([0, 0], [10, 0], 'driving')]
    };
    const next = insertWaypoint(r, 0, 5, 0);
    expect(next.points).toHaveLength(3);
    expect(next.points[1]).toEqual(wpPt(5, 0));
    expect(next.segments).toHaveLength(2);
    expect(next.segments[0]!.method).toBe('driving');
    expect(next.segments[1]!.method).toBe('driving');
    expect(next.segments[0]!.geometry).toEqual([
      [0, 0],
      [5, 0]
    ]);
    expect(next.segments[1]!.geometry).toEqual([
      [5, 0],
      [10, 0]
    ]);
  });

  test('does not mutate input', () => {
    const r: RouteData = {
      points: [photoPt('a', 0, 0), photoPt('b', 10, 0)],
      segments: [seg([0, 0], [10, 0])]
    };
    const before = structuredClone(r);
    insertWaypoint(r, 0, 5, 0);
    expect(r).toEqual(before);
  });
});

describe('removeWaypoint', () => {
  test('merges adjacent segments and returns method', () => {
    const r: RouteData = {
      points: [photoPt('a', 0, 0), wpPt(5, 0), photoPt('b', 10, 0)],
      segments: [
        seg([0, 0], [5, 0], 'driving'),
        seg([5, 0], [10, 0], 'driving')
      ]
    };
    const result = removeWaypoint(r, 1);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('driving');
    expect(result!.route.points).toHaveLength(2);
    expect(result!.route.segments).toHaveLength(1);
    expect(result!.route.segments[0]!.method).toBe('driving');
    expect(result!.route.segments[0]!.geometry).toEqual([
      [0, 0],
      [10, 0]
    ]);
  });

  test('returns null for a photo point', () => {
    const r: RouteData = {
      points: [photoPt('a', 0, 0), photoPt('b', 10, 0)],
      segments: [seg([0, 0], [10, 0])]
    };
    expect(removeWaypoint(r, 0)).toBeNull();
  });
});

describe('updateAdjacentSegments', () => {
  test('updates point and surrounding segment endpoints', () => {
    const r: RouteData = {
      points: [photoPt('a', 0, 0), photoPt('b', 5, 0), photoPt('c', 10, 0)],
      segments: [seg([0, 0], [5, 0]), seg([5, 0], [10, 0])]
    };
    const next = updateAdjacentSegments(r, 1, 5, 5);
    expect(next.points[1]).toMatchObject({ lon: 5, lat: 5 });
    expect(next.segments[0]!.geometry).toEqual([
      [0, 0],
      [5, 5]
    ]);
    expect(next.segments[1]!.geometry).toEqual([
      [5, 5],
      [10, 0]
    ]);
  });

  test('returns input unchanged when index is out of range', () => {
    const r: RouteData = {
      points: [photoPt('a', 0, 0)],
      segments: []
    };
    expect(updateAdjacentSegments(r, 5, 1, 1)).toBe(r);
  });
});

describe('withSegment', () => {
  test('returns a new route with the segment replaced', () => {
    const r: RouteData = {
      points: [photoPt('a', 0, 0), photoPt('b', 10, 0)],
      segments: [seg([0, 0], [10, 0])]
    };
    const replacement: RouteSegment = {
      method: 'driving',
      geometry: [
        [0, 0],
        [3, 1],
        [10, 0]
      ]
    };
    const next = withSegment(r, 0, replacement);
    expect(next.segments[0]).toBe(replacement);
    expect(next.segments).not.toBe(r.segments);
    expect(next.points).toBe(r.points);
  });
});

describe('syncPhotoPoints', () => {
  test('moves photo points to their effective locations', () => {
    setCoord('a', 60.5, 25.1);
    const r: RouteData = {
      points: [photoPt('a', 25.0, 60.0), photoPt('b', 26.0, 61.0)],
      segments: [seg([25.0, 60.0], [26.0, 61.0])]
    };
    const result = syncPhotoPoints(r, [
      photo({ uuid: 'a' }),
      photo({ uuid: 'b', lat: 61.0, lon: 26.0 })
    ]);
    expect(result.changed).toBe(true);
    expect(result.route.points[0]).toMatchObject({ lon: 25.1, lat: 60.5 });
    expect(result.route.segments[0]!.geometry[0]).toEqual([25.1, 60.5]);
  });

  test('drops waypoints adjacent to moved photo points', () => {
    setCoord('a', 60.5, 25.1);
    const r: RouteData = {
      points: [
        photoPt('a', 25.0, 60.0),
        wpPt(25.5, 60.5),
        photoPt('b', 26.0, 61.0)
      ],
      segments: [
        seg([25.0, 60.0], [25.5, 60.5]),
        seg([25.5, 60.5], [26.0, 61.0])
      ]
    };
    const result = syncPhotoPoints(r, [
      photo({ uuid: 'a' }),
      photo({ uuid: 'b', lat: 61.0, lon: 26.0 })
    ]);
    expect(result.changed).toBe(true);
    expect(result.route.points).toHaveLength(2);
    expect(result.route.points[0]).toMatchObject({ lon: 25.1, lat: 60.5 });
  });

  test('no-op when locations match', () => {
    const r: RouteData = {
      points: [photoPt('a', 25.0, 60.0), photoPt('b', 26.0, 61.0)],
      segments: [seg([25.0, 60.0], [26.0, 61.0])]
    };
    const result = syncPhotoPoints(r, [
      photo({ uuid: 'a', lat: 60.0, lon: 25.0 }),
      photo({ uuid: 'b', lat: 61.0, lon: 26.0 })
    ]);
    expect(result.changed).toBe(false);
    expect(result.route).toBe(r);
  });
});

describe('reorderPhotoPoints', () => {
  test('reorders photo points by chronological order', () => {
    const r: RouteData = {
      points: [photoPt('b', 26.0, 61.0), photoPt('a', 25.0, 60.0)],
      segments: [seg([26.0, 61.0], [25.0, 60.0])]
    };
    const result = reorderPhotoPoints(r, [
      photo({ uuid: 'a', date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', date: '2024:02:01 00:00:00' })
    ]);
    expect(result.changed).toBe(true);
    expect(result.route.points.map((p) => p.uuid)).toEqual(['a', 'b']);
  });

  test('no-op when already sorted', () => {
    const r: RouteData = {
      points: [photoPt('a', 25.0, 60.0), photoPt('b', 26.0, 61.0)],
      segments: [seg([25.0, 60.0], [26.0, 61.0])]
    };
    const result = reorderPhotoPoints(r, [
      photo({ uuid: 'a', date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', date: '2024:02:01 00:00:00' })
    ]);
    expect(result.changed).toBe(false);
    expect(result.route).toBe(r);
  });
});

describe('buildLineFeatures', () => {
  test('breaks at none segments', () => {
    const r: RouteData = {
      points: [
        photoPt('a', 0, 0),
        photoPt('b', 5, 0),
        photoPt('c', 10, 0),
        photoPt('d', 15, 0)
      ],
      segments: [
        seg([0, 0], [5, 0]),
        seg([5, 0], [10, 0], 'none'),
        seg([10, 0], [15, 0])
      ]
    };
    const features = buildLineFeatures(r);
    expect(features).toHaveLength(2);
    expect(features[0]!.geometry.coordinates).toEqual([
      [0, 0],
      [5, 0]
    ]);
    expect(features[1]!.geometry.coordinates).toEqual([
      [10, 0],
      [15, 0]
    ]);
  });
});

describe('buildDefault', () => {
  test('returns null with fewer than two located photos', () => {
    expect(buildDefault([photo({ uuid: 'a', lat: 60, lon: 25 })])).toBeNull();
  });

  test('builds a chronologically sorted route', () => {
    const r = buildDefault([
      photo({
        uuid: 'b',
        lat: 61,
        lon: 26,
        date: '2024:02:01 00:00:00'
      }),
      photo({
        uuid: 'a',
        lat: 60,
        lon: 25,
        date: '2024:01:01 00:00:00'
      })
    ]);
    expect(r).not.toBeNull();
    expect(r!.points.map((p) => p.uuid)).toEqual(['a', 'b']);
    expect(r!.segments).toHaveLength(1);
    expect(r!.segments[0]!.method).toBe('straight');
  });

  test('skips photos without location or date', () => {
    const r = buildDefault([
      photo({ uuid: 'a', lat: 60, lon: 25, date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', lat: null, lon: null }),
      photo({ uuid: 'c', lat: 61, lon: 26, date: '' }),
      photo({ uuid: 'd', lat: 62, lon: 27, date: '2024:03:01 00:00:00' })
    ]);
    expect(r).not.toBeNull();
    expect(r!.points.map((p) => p.uuid)).toEqual(['a', 'd']);
  });
});
