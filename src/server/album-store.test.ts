import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  createAlbumStore,
  InvalidNameError,
  type AlbumStore
} from './album-store';

let dataDir = '';
let store: AlbumStore = createAlbumStore('');

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'karttapallo-albumstore-'));
  store = createAlbumStore(dataDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function makeFormData(files: Array<{ name: string; body: string }>): FormData {
  const fd = new FormData();
  for (const f of files) {
    fd.append('file', new File([f.body], f.name));
  }
  return fd;
}

async function expectInvalidName(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidNameError);
    return;
  }
  throw new Error('expected InvalidNameError but no rejection occurred');
}

describe('listFiles', () => {
  test('returns empty list for missing album dir', async () => {
    expect(await store.listFiles('Helsinki')).toEqual([]);
  });

  test('lists uploaded files with default visible=true', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'route.gpx', body: '<gpx/>' }])
    );
    expect(await store.listFiles('Helsinki')).toEqual([
      { name: 'route.gpx', visible: true }
    ]);
  });

  test('reflects setFileVisibility', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'a.gpx', body: 'x' }])
    );
    store.setFileVisibility('Helsinki', 'a.gpx', false);
    expect(await store.listFiles('Helsinki')).toEqual([
      { name: 'a.gpx', visible: false }
    ]);
  });

  test('filters out non-allowed extensions', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([
        { name: 'route.gpx', body: 'x' },
        { name: 'notes.md', body: 'y' },
        { name: 'evil.exe', body: 'z' }
      ])
    );
    const names = (await store.listFiles('Helsinki')).map((f) => f.name).sort();
    expect(names).toEqual(['notes.md', 'route.gpx']);
  });
});

describe('uploadFiles', () => {
  test('returns names of accepted files', async () => {
    const accepted = await store.uploadFiles(
      'Helsinki',
      makeFormData([
        { name: 'a.gpx', body: 'x' },
        { name: 'evil.exe', body: 'y' },
        { name: 'b.md', body: 'z' }
      ])
    );
    expect(accepted.sort()).toEqual(['a.gpx', 'b.md']);
  });

  test('returns empty list when no allowed files in upload', async () => {
    const accepted = await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'evil.exe', body: 'x' }])
    );
    expect(accepted).toEqual([]);
  });

  test('writes file bytes to disk', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'route.gpx', body: '<gpx>hi</gpx>' }])
    );
    const path = join(dataDir, 'albums', 'Helsinki', 'route.gpx');
    expect(readFileSync(path, 'utf-8')).toBe('<gpx>hi</gpx>');
  });
});

describe('deleteFile', () => {
  test('removes file and visibility entry', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'a.gpx', body: 'x' }])
    );
    store.setFileVisibility('Helsinki', 'a.gpx', false);
    await store.deleteFile('Helsinki', 'a.gpx');
    expect(await store.listFiles('Helsinki')).toEqual([]);
  });

  test('idempotent on missing file', async () => {
    await store.deleteFile('Helsinki', 'never-existed.gpx');
    expect(await store.listFiles('Helsinki')).toEqual([]);
  });

  test('leaves other files untouched', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([
        { name: 'a.gpx', body: 'x' },
        { name: 'b.gpx', body: 'y' }
      ])
    );
    await store.deleteFile('Helsinki', 'a.gpx');
    expect((await store.listFiles('Helsinki')).map((f) => f.name)).toEqual([
      'b.gpx'
    ]);
  });
});

describe('routes', () => {
  test('getRouteBytes returns null when missing', async () => {
    expect(await store.getRouteBytes('Helsinki')).toBeNull();
  });

  test('putRouteBytes / getRouteBytes round-trip', async () => {
    const body = JSON.stringify({ points: [], segments: [] });
    await store.putRouteBytes('Helsinki', body);
    expect(await store.getRouteBytes('Helsinki')).toBe(body);
  });

  test('deleteRoute clears existing route', async () => {
    await store.putRouteBytes('Helsinki', '{}');
    await store.deleteRoute('Helsinki');
    expect(await store.getRouteBytes('Helsinki')).toBeNull();
  });

  test('deleteRoute is idempotent on missing route', async () => {
    await store.deleteRoute('Helsinki');
    expect(await store.getRouteBytes('Helsinki')).toBeNull();
  });

  test('putRouteBytes is opaque to content', async () => {
    await store.putRouteBytes('Helsinki', 'not even json');
    expect(await store.getRouteBytes('Helsinki')).toBe('not even json');
  });
});

describe('multi-album isolation', () => {
  test('uploads, visibility, routes do not bleed across albums', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'a.gpx', body: 'h' }])
    );
    await store.uploadFiles(
      'Lapland',
      makeFormData([{ name: 'b.gpx', body: 'l' }])
    );
    store.setFileVisibility('Helsinki', 'a.gpx', false);
    await store.putRouteBytes('Helsinki', 'h-route');

    expect((await store.listFiles('Helsinki')).map((f) => f.name)).toEqual([
      'a.gpx'
    ]);
    expect((await store.listFiles('Lapland')).map((f) => f.name)).toEqual([
      'b.gpx'
    ]);
    expect(await store.getRouteBytes('Helsinki')).toBe('h-route');
    expect(await store.getRouteBytes('Lapland')).toBeNull();
  });
});

describe('path traversal', () => {
  test.each(['..', '.', '', 'foo/bar', 'foo\\bar', '../escape', 'has\0null'])(
    'rejects album name %p',
    async (album) => {
      await expectInvalidName(store.listFiles(album));
    }
  );

  test.each(['..', '.', '', 'foo/bar', 'foo\\bar'])(
    'rejects file name %p in deleteFile',
    async (filename) => {
      await expectInvalidName(store.deleteFile('Helsinki', filename));
    }
  );

  test('rejects bad name in setFileVisibility', () => {
    expect(() => {
      store.setFileVisibility('Helsinki', '../escape.gpx', true);
    }).toThrow(InvalidNameError);
  });

  test('rejects bad album in putRouteBytes', async () => {
    await expectInvalidName(store.putRouteBytes('../escape', '{}'));
  });

  test('accepts album names with spaces, dots, unicode', async () => {
    await store.putRouteBytes('My Trip 2024.summer', 'x');
    expect(await store.getRouteBytes('My Trip 2024.summer')).toBe('x');
    await store.putRouteBytes('Lappi-Köngäs', 'y');
    expect(await store.getRouteBytes('Lappi-Köngäs')).toBe('y');
  });
});
