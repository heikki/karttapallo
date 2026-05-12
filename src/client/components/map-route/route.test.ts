import { beforeEach, describe, expect, test } from 'bun:test';

import { clear as clearEdits } from '@common/edits';
import type { Photo } from '@common/types';

import * as route from './route';
import type { RouteData, RoutePoint, RouteSegment } from './route-data';

const photoPt = (uuid: string, lon: number, lat: number): RoutePoint => ({
  type: 'photo',
  uuid,
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

const simpleRoute = (): RouteData => ({
  points: [photoPt('a', 25, 60), photoPt('b', 26, 61)],
  segments: [seg([25, 60], [26, 61])]
});

beforeEach(() => {
  route.clear();
  clearEdits();
});

describe('primitives', () => {
  test('setRoute + clear', () => {
    expect(route.current.get()).toBeNull();
    route.setRoute('Trip', simpleRoute());
    const cur = route.current.get();
    expect(cur).not.toBeNull();
    expect(cur!.album).toBe('Trip');
    expect(cur!.data.points).toHaveLength(2);
    route.clear();
    expect(route.current.get()).toBeNull();
  });
});

describe('sync verbs', () => {
  test('insertWaypoint mutates via the signal (immutable update)', () => {
    route.setRoute('Trip', simpleRoute());
    const before = route.current.get()!;
    route.insertWaypoint(0, 25.5, 60.5);
    const after = route.current.get()!;
    expect(after).not.toBe(before);
    expect(after.data.points).toHaveLength(3);
    expect(after.data.points[1]).toMatchObject({
      type: 'waypoint',
      lon: 25.5,
      lat: 60.5
    });
    // The original RouteData reference is untouched.
    expect(before.data.points).toHaveLength(2);
  });

  test('insertWaypoint is a no-op when route is null', () => {
    route.insertWaypoint(0, 25.5, 60.5);
    expect(route.current.get()).toBeNull();
  });

  test('removeWaypoint returns the merged segment method', () => {
    route.setRoute('Trip', {
      points: [photoPt('a', 0, 0), photoPt('b', 10, 0)],
      segments: [seg([0, 0], [10, 0], 'driving')]
    });
    route.insertWaypoint(0, 5, 0);
    const method = route.removeWaypoint(1);
    expect(method).toBe('driving');
    expect(route.current.get()!.data.points).toHaveLength(2);
  });

  test('updateAdjacentSegments moves a point in the signal value', () => {
    route.setRoute('Trip', simpleRoute());
    route.updateAdjacentSegments(0, 25.5, 60.5);
    expect(route.current.get()!.data.points[0]).toMatchObject({
      lon: 25.5,
      lat: 60.5
    });
  });

  test('syncPhotoPoints reports false when nothing changes', () => {
    route.setRoute('Trip', simpleRoute());
    const before = route.current.get();
    const changed = route.syncPhotoPoints([
      photo({ uuid: 'a', lat: 60, lon: 25 }),
      photo({ uuid: 'b', lat: 61, lon: 26 })
    ]);
    expect(changed).toBe(false);
    expect(route.current.get()).toBe(before);
  });
});

describe('applySegmentMethod (sync paths)', () => {
  test("setting method to 'straight' updates geometry from endpoints", async () => {
    route.setRoute('Trip', {
      points: [photoPt('a', 0, 0), photoPt('b', 10, 0)],
      segments: [
        {
          method: 'driving',
          geometry: [
            [0, 0],
            [3, 1],
            [7, 1],
            [10, 0]
          ]
        }
      ]
    });
    const ok = await route.applySegmentMethod(0, 'straight');
    expect(ok).toBe(true);
    expect(route.current.get()!.data.segments[0]!.method).toBe('straight');
    expect(route.current.get()!.data.segments[0]!.geometry).toEqual([
      [0, 0],
      [10, 0]
    ]);
  });

  test("setting method to 'none' updates geometry from endpoints", async () => {
    route.setRoute('Trip', {
      points: [photoPt('a', 0, 0), photoPt('b', 10, 0)],
      segments: [seg([0, 0], [10, 0])]
    });
    const ok = await route.applySegmentMethod(0, 'none');
    expect(ok).toBe(true);
    expect(route.current.get()!.data.segments[0]!.method).toBe('none');
  });
});
