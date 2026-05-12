import { beforeEach, describe, expect, test } from 'bun:test';

import { clear as clearEdits } from '@common/edits';
import type { Photo } from '@common/types';

import { reconcileWithAlbum } from './reconcile';
import type { RouteData, RoutePoint } from './route-data';

const photoPt = (uuid: string, lon: number, lat: number): RoutePoint => ({
  type: 'photo',
  uuid,
  lon,
  lat
});

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

describe('reconcileWithAlbum', () => {
  test('drops orphan photo points', () => {
    const r: RouteData = {
      points: [
        photoPt('a', 25, 60),
        photoPt('b', 26, 61),
        photoPt('c', 27, 62)
      ],
      segments: [
        {
          method: 'straight',
          geometry: [
            [25, 60],
            [26, 61]
          ]
        },
        {
          method: 'straight',
          geometry: [
            [26, 61],
            [27, 62]
          ]
        }
      ]
    };
    // 'b' is no longer in the album
    const result = reconcileWithAlbum(r, [
      photo({ uuid: 'a', lon: 25, lat: 60, date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'c', lon: 27, lat: 62, date: '2024:03:01 00:00:00' })
    ]);
    expect(result.changed).toBe(true);
    expect(result.route.points.map((p) => p.uuid)).toEqual(['a', 'c']);
  });

  test('inserts newly eligible photos at chronologically correct positions', () => {
    const r: RouteData = {
      points: [photoPt('a', 25, 60), photoPt('c', 27, 62)],
      segments: [
        {
          method: 'straight',
          geometry: [
            [25, 60],
            [27, 62]
          ]
        }
      ]
    };
    // 'b' is new in the album, dated between a and c
    const result = reconcileWithAlbum(r, [
      photo({ uuid: 'a', lon: 25, lat: 60, date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', lon: 26, lat: 61, date: '2024:02:01 00:00:00' }),
      photo({ uuid: 'c', lon: 27, lat: 62, date: '2024:03:01 00:00:00' })
    ]);
    expect(result.changed).toBe(true);
    expect(result.route.points.map((p) => p.uuid)).toEqual(['a', 'b', 'c']);
  });

  test('no-op when album matches route exactly', () => {
    const r: RouteData = {
      points: [photoPt('a', 25, 60), photoPt('b', 26, 61)],
      segments: [
        {
          method: 'straight',
          geometry: [
            [25, 60],
            [26, 61]
          ]
        }
      ]
    };
    const result = reconcileWithAlbum(r, [
      photo({ uuid: 'a', lon: 25, lat: 60, date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', lon: 26, lat: 61, date: '2024:02:01 00:00:00' })
    ]);
    expect(result.changed).toBe(false);
    expect(result.route).toBe(r);
  });

  test('combined: drop orphan, sync moved coords, insert missing, reorder', () => {
    const r: RouteData = {
      // Out of order: c, a, x — 'x' is no longer in the album
      points: [
        photoPt('c', 27, 62),
        photoPt('a', 25, 60),
        photoPt('x', 99, 99)
      ],
      segments: [
        {
          method: 'straight',
          geometry: [
            [27, 62],
            [25, 60]
          ]
        },
        {
          method: 'straight',
          geometry: [
            [25, 60],
            [99, 99]
          ]
        }
      ]
    };
    const result = reconcileWithAlbum(r, [
      // 'a' moved
      photo({ uuid: 'a', lon: 25.5, lat: 60.5, date: '2024:01:01 00:00:00' }),
      // 'b' is new
      photo({ uuid: 'b', lon: 26, lat: 61, date: '2024:02:01 00:00:00' }),
      photo({ uuid: 'c', lon: 27, lat: 62, date: '2024:03:01 00:00:00' })
    ]);
    expect(result.changed).toBe(true);
    expect(result.route.points.map((p) => p.uuid)).toEqual(['a', 'b', 'c']);
    expect(result.route.points[0]).toMatchObject({ lon: 25.5, lat: 60.5 });
  });
});
