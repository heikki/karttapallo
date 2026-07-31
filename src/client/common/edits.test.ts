import { beforeEach, describe, expect, test } from 'bun:test';

import {
  addTimeOffset,
  clear,
  editCount,
  getCoordEdits,
  getEffectiveCoords,
  getEffectiveDate,
  getEffectiveLocation,
  getTimeEdits,
  pendingCoords,
  pendingTimeOffsets,
  saving,
  setCoord,
  setTimeOffset
} from './edits';
import type { Photo } from './types';

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    uuid: 'p1',
    type: 'photo',
    full: 'full/p1.jpg',
    thumb: 'thumb/p1.jpg',
    lat: 60.17,
    lon: 24.94,
    date: '2024:06:01 12:00:00',
    tz: '+03:00',
    camera: 'iPhone 15',
    gps: 'exif',
    albums: ['Helsinki'],
    place: null,
    description: null,
    labels: [],
    ...overrides
  };
}

beforeEach(() => {
  clear();
  saving.set(false);
});

describe('initial state', () => {
  test('pendingCoords and pendingTimeOffsets start empty', () => {
    expect(pendingCoords.get().size).toBe(0);
    expect(pendingTimeOffsets.get().size).toBe(0);
  });

  test('editCount reflects both maps', () => {
    expect(editCount.get()).toBe(0);
    setCoord('a', 1, 2);
    setTimeOffset('b', 1);
    expect(editCount.get()).toBe(2);
  });

  test('saving defaults to false', () => {
    expect(saving.get()).toBe(false);
  });
});

describe('getEffectiveCoords', () => {
  test('returns the photo coords when no pending edit exists', () => {
    expect(getEffectiveCoords(photo({ lat: 10, lon: 20 }))).toEqual({
      lat: 10,
      lon: 20
    });
  });

  test('returns 0,0 for a photo with null coords and no pending edit', () => {
    expect(getEffectiveCoords(photo({ lat: null, lon: null }))).toEqual({
      lat: 0,
      lon: 0
    });
  });

  test('returns the pending edit when one exists', () => {
    setCoord('p1', 5, 6);
    expect(getEffectiveCoords(photo({ uuid: 'p1', lat: 10, lon: 20 }))).toEqual(
      { lat: 5, lon: 6 }
    );
  });
});

describe('getEffectiveLocation', () => {
  test('returns null when photo has no coords and no pending edit', () => {
    expect(getEffectiveLocation(photo({ lat: null, lon: null }))).toBe(null);
  });

  test('returns pending coords even when photo has none', () => {
    setCoord('p1', 5, 6);
    expect(
      getEffectiveLocation(photo({ uuid: 'p1', lat: null, lon: null }))
    ).toEqual({ lat: 5, lon: 6 });
  });

  test('returns photo coords when set, regardless of pending edits', () => {
    expect(getEffectiveLocation(photo({ lat: 10, lon: 20 }))).toEqual({
      lat: 10,
      lon: 20
    });
  });
});

describe('time offsets', () => {
  test('addTimeOffset accumulates across calls', () => {
    addTimeOffset('p1', 1);
    addTimeOffset('p1', 2);
    expect(pendingTimeOffsets.get().get('p1')).toBe(3);
  });

  test('addTimeOffset removes the entry when net total returns to zero', () => {
    addTimeOffset('p1', 2);
    addTimeOffset('p1', -2);
    expect(pendingTimeOffsets.get().has('p1')).toBe(false);
  });

  test('setTimeOffset overwrites and zero deletes', () => {
    setTimeOffset('p1', 5);
    expect(pendingTimeOffsets.get().get('p1')).toBe(5);
    setTimeOffset('p1', 0);
    expect(pendingTimeOffsets.get().has('p1')).toBe(false);
  });
});

describe('getEffectiveDate', () => {
  test('returns photo.date when there is no offset', () => {
    expect(getEffectiveDate(photo())).toBe('2024:06:01 12:00:00');
  });

  test('returns the empty string when photo.date is empty', () => {
    expect(getEffectiveDate(photo({ date: '' }))).toBe('');
  });

  test('applies a positive hour offset', () => {
    setTimeOffset('p1', 1);
    expect(getEffectiveDate(photo({ uuid: 'p1' }))).toBe('2024:06:01 13:00:00');
  });

  test('applies a negative hour offset', () => {
    setTimeOffset('p1', -2);
    expect(getEffectiveDate(photo({ uuid: 'p1' }))).toBe('2024:06:01 10:00:00');
  });

  test('rolls across midnight when offset crosses day boundary', () => {
    setTimeOffset('p1', 13);
    expect(
      getEffectiveDate(photo({ uuid: 'p1', date: '2024:06:01 22:00:00' }))
    ).toBe('2024:06:02 11:00:00');
  });
});

describe('edit list extractors', () => {
  test('getCoordEdits returns one entry per pending coord', () => {
    setCoord('a', 1, 2);
    setCoord('b', 3, 4);
    expect(
      getCoordEdits().sort((x, y) => x.uuid.localeCompare(y.uuid))
    ).toEqual([
      { uuid: 'a', lat: 1, lon: 2 },
      { uuid: 'b', lat: 3, lon: 4 }
    ]);
  });

  test('getTimeEdits returns one entry per pending offset', () => {
    setTimeOffset('a', 1);
    setTimeOffset('b', -3);
    expect(getTimeEdits().sort((x, y) => x.uuid.localeCompare(y.uuid))).toEqual(
      [
        { uuid: 'a', hours: 1 },
        { uuid: 'b', hours: -3 }
      ]
    );
  });

  test('clear empties both maps', () => {
    setCoord('a', 1, 2);
    setTimeOffset('a', 1);
    clear();
    expect(pendingCoords.get().size).toBe(0);
    expect(pendingTimeOffsets.get().size).toBe(0);
    expect(editCount.get()).toBe(0);
  });
});
