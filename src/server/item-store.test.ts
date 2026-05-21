import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { openItemStore, type ItemEntry, type ItemStore } from './item-store';
import type { PhotosWriter } from './photos-edit';

let dataDir = '';

const sampleItem = (overrides: Partial<ItemEntry> = {}): ItemEntry => ({
  uuid: overrides.uuid ?? 'AAAA',
  type: 'photo',
  full: `full/${overrides.uuid ?? 'AAAA'}.jpg`,
  thumb: `thumb/${overrides.uuid ?? 'AAAA'}.jpg`,
  lat: 60.17,
  lon: 24.94,
  date: '2024:06:01 12:00:00',
  tz: '+03:00',
  camera: 'iPhone 15',
  gps: 'exif',
  gps_accuracy: 5,
  albums: ['Helsinki'],
  photos_url: `photos:albums?albumUuid=A&assetUuid=${overrides.uuid ?? 'AAAA'}`,
  ...overrides
});

interface RecordingWriter extends PhotosWriter {
  calls: string[];
}

const recordingWriter = (): RecordingWriter => {
  const calls: string[] = [];
  return {
    calls,
    setLocation: (uuid, lat, lon) => {
      calls.push(`setLocation ${uuid} ${lat} ${lon}`);
    },
    setDateTime: (uuid, date, time) => {
      calls.push(`setDateTime ${uuid} ${date} ${time}`);
    },
    setTimezone: (uuid, tz, off) => {
      calls.push(`setTimezone ${uuid} ${tz} ${off}`);
    },
    quitPhotosApp: () => {
      calls.push('quitPhotosApp');
    }
  };
};

function seedSnapshot(items: ItemEntry[]): void {
  writeFileSync(join(dataDir, 'items.json'), JSON.stringify(items));
}

function readSnapshot(): ItemEntry[] {
  return JSON.parse(
    readFileSync(join(dataDir, 'items.json'), 'utf-8')
  ) as ItemEntry[];
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'karttapallo-itemstore-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function open(
  opts: {
    fresh?: ItemEntry[];
    writer?: PhotosWriter;
  } = {}
): Promise<ItemStore> {
  const store = openItemStore({
    dataDir,
    photosWriter: opts.writer,
    buildFreshItems: () => opts.fresh ?? []
  });
  // Wait for the post-startup rebuild to settle so getAll reflects fresh state
  // when tests need to assert on it.
  await store.rebuildComplete;
  return store;
}

describe('item-store snapshot', () => {
  test('getAll returns empty when no snapshot exists and no fresh items', async () => {
    const store = await open();
    expect(store.getAll()).toEqual([]);
  });

  test('getAll returns snapshot items synchronously before rebuild', () => {
    const seed = [sampleItem({ uuid: 'AAAA' })];
    seedSnapshot(seed);
    const store = openItemStore({
      dataDir,
      buildFreshItems: () => seed
    });
    // Synchronous getAll must already reflect the snapshot — no await yet.
    expect(store.getAll().map((i) => i.uuid)).toEqual(['AAAA']);
  });

  test('corrupt snapshot falls back to empty list', async () => {
    writeFileSync(join(dataDir, 'items.json'), 'not json');
    const store = await open();
    expect(store.getAll()).toEqual([]);
  });
});

describe('item-store rebuild', () => {
  test('returns false when fresh items match snapshot', async () => {
    const seed = [sampleItem({ uuid: 'AAAA' })];
    seedSnapshot(seed);
    const store = openItemStore({
      dataDir,
      buildFreshItems: () => seed
    });
    expect(await store.rebuildComplete).toBe(false);
  });

  test('returns true and swaps when fresh items differ', async () => {
    seedSnapshot([sampleItem({ uuid: 'AAAA' })]);
    const fresh = [sampleItem({ uuid: 'AAAA' }), sampleItem({ uuid: 'BBBB' })];
    const store = await open({ fresh });
    expect(store.getAll().map((i) => i.uuid)).toEqual(['AAAA', 'BBBB']);
  });

  test('rewrites snapshot on change', async () => {
    seedSnapshot([sampleItem({ uuid: 'AAAA' })]);
    await open({
      fresh: [sampleItem({ uuid: 'AAAA' }), sampleItem({ uuid: 'BBBB' })]
    });
    expect(readSnapshot().map((i) => i.uuid)).toEqual(['AAAA', 'BBBB']);
  });

  test('sorts unsorted fresh items deterministically', async () => {
    const fresh = [
      sampleItem({ uuid: 'BBBB', date: '2024:07:01 12:00:00' }),
      sampleItem({ uuid: 'AAAA', date: '2024:06:01 12:00:00' })
    ];
    const store = await open({ fresh });
    expect(store.getAll().map((i) => i.uuid)).toEqual(['AAAA', 'BBBB']);
  });

  test('manual rebuild swaps and persists', async () => {
    let fresh = [sampleItem({ uuid: 'AAAA' })];
    const store = openItemStore({
      dataDir,
      buildFreshItems: () => fresh
    });
    await store.rebuildComplete;
    fresh = [sampleItem({ uuid: 'AAAA' }), sampleItem({ uuid: 'BBBB' })];
    expect(await store.rebuild()).toBe(true);
    expect(store.getAll().map((i) => i.uuid)).toEqual(['AAAA', 'BBBB']);
    expect(readSnapshot().map((i) => i.uuid)).toEqual(['AAAA', 'BBBB']);
  });
});

describe('item-store applyEdits', () => {
  test('time edit applies hour offset and calls setDateTime', async () => {
    const writer = recordingWriter();
    const store = await open({
      fresh: [sampleItem({ uuid: 'AAAA', date: '2024:06:01 12:00:00' })],
      writer
    });
    const result = store.applyEdits({
      locationEdits: [],
      timeEdits: [{ uuid: 'AAAA', hours: 1 }]
    });
    expect(result.timeResults).toEqual([{ uuid: 'AAAA', ok: true }]);
    expect(store.getAll()[0]?.date).toBe('2024:06:01 13:00:00');
    // setDateTime should have been called and quitPhotosApp at the end.
    expect(writer.calls.some((c) => c.startsWith('setDateTime AAAA'))).toBe(
      true
    );
    expect(writer.calls.at(-1)).toBe('quitPhotosApp');
  });

  test('location edit mutates lat/lon/gps and calls setLocation', async () => {
    const writer = recordingWriter();
    const store = await open({
      fresh: [sampleItem({ uuid: 'AAAA', lat: 0, lon: 0 })],
      writer
    });
    const result = store.applyEdits({
      locationEdits: [{ uuid: 'AAAA', lat: 60.17, lon: 24.94 }],
      timeEdits: []
    });
    expect(result.locationResults).toEqual([{ uuid: 'AAAA', ok: true }]);
    const item = store.getAll()[0];
    expect(item?.lat).toBe(60.17);
    expect(item?.lon).toBe(24.94);
    expect(item?.gps).toBe('user');
    expect(item?.gps_accuracy).toBe(1);
    expect(
      writer.calls.some((c) => c.startsWith('setLocation AAAA 60.17 24.94'))
    ).toBe(true);
  });

  test('rewrites snapshot after edits', async () => {
    const writer = recordingWriter();
    const store = await open({
      fresh: [sampleItem({ uuid: 'AAAA', lat: 0, lon: 0 })],
      writer
    });
    store.applyEdits({
      locationEdits: [{ uuid: 'AAAA', lat: 60.17, lon: 24.94 }],
      timeEdits: []
    });
    expect(readSnapshot()[0]?.lat).toBe(60.17);
  });

  test('does not call quitPhotosApp when no edits provided', async () => {
    const writer = recordingWriter();
    const store = await open({
      fresh: [sampleItem({ uuid: 'AAAA' })],
      writer
    });
    store.applyEdits({ locationEdits: [], timeEdits: [] });
    expect(writer.calls).not.toContain('quitPhotosApp');
  });

  test('records error and continues when writer throws', async () => {
    const writer = recordingWriter();
    writer.setDateTime = (uuid) => {
      throw new Error(`boom ${uuid}`);
    };
    const store = await open({
      fresh: [sampleItem({ uuid: 'AAAA' }), sampleItem({ uuid: 'BBBB' })],
      writer
    });
    const result = store.applyEdits({
      locationEdits: [],
      timeEdits: [
        { uuid: 'AAAA', hours: 1 },
        { uuid: 'BBBB', hours: 2 }
      ]
    });
    expect(result.timeResults.map((r) => r.ok)).toEqual([false, false]);
    expect(result.timeResults[0]?.error).toContain('boom');
  });

  test('time edit on missing uuid returns Item not found', async () => {
    const writer = recordingWriter();
    const store = await open({ fresh: [], writer });
    const result = store.applyEdits({
      locationEdits: [],
      timeEdits: [{ uuid: 'ZZZZ', hours: 1 }]
    });
    expect(result.timeResults).toEqual([
      { uuid: 'ZZZZ', ok: false, error: 'Item not found' }
    ]);
  });
});
