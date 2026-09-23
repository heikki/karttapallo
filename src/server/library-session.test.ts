/**
 * Tier 2 — the wiring itself.
 *
 * These assert on ordering and omission, which is exactly what Tier 5 cannot
 * see: an E2E run passes just as happily whether or not the cache root was
 * claimed first or the orphaned albums were ever pruned.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { ItemEntry } from './item-store';
import { openLibrarySession, type LibrarySession } from './library-session';
import type { AlbumRoster, PhotosLibrary } from './photos-library';

const LIVE = '11111111-1111-4111-8111-111111111111';
const ORPHAN = '22222222-2222-4222-8222-222222222222';

let root = '';
let libraryPath = '';
let cacheRoot = '';
let supportDir = '';
let bundleDir = '';

function item(uuid: string): ItemEntry {
  return {
    uuid,
    type: 'photo',
    full: `full/${uuid}.jpg`,
    thumb: `thumb/${uuid}.jpg`,
    lat: 60.17,
    lon: 24.94,
    date: '2024:06:01 12:00:00',
    tz: '+03:00',
    camera: 'iPhone',
    gps: 'exif',
    gps_accuracy: 5,
    albums: [],
    place: [],
    description: [],
    labels: [],
    photos_url: `photos:albums?assetUuid=${uuid}`
  };
}

const photosLibrary: PhotosLibrary = {
  resolveImagePath: () => null,
  resolveVideoPath: () => null,
  getMetadata: () => null
};

const roster: AlbumRoster[] = [{ uuid: LIVE, title: 'Helsinki' }];

function open(overrides: { loadAlbums?: () => AlbumRoster[] } = {}) {
  return openLibrarySession({
    libraryPath,
    supportDir,
    cacheRoot,
    adapters: {
      photosLibrary,
      photosWriter: {
        setLocation: () => undefined,
        setDateTime: () => undefined,
        setTimezone: () => undefined,
        quitPhotosApp: () => undefined
      },
      buildFreshItems: () => [item('a'), item('b')],
      loadAlbums: overrides.loadAlbums ?? (() => roster),
      resolveActiveLibrary: () => ({ ok: true, path: libraryPath })
    }
  });
}

/** Let the session's own `rebuildComplete` handlers run before asserting. */
async function settle(session: LibrarySession) {
  await session.rebuildComplete;
  await Promise.resolve();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'karttapallo-session-'));
  libraryPath = join(root, 'Fake.photoslibrary');
  cacheRoot = join(root, 'derived');
  supportDir = join(root, 'support');
  bundleDir = join(libraryPath, 'karttapallo');
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(supportDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('cache root', () => {
  test('claims a root owned by another library, wiping what it held', async () => {
    mkdirSync(join(cacheRoot, 'cache', 'full'), { recursive: true });
    writeFileSync(join(cacheRoot, 'cache', 'full', 'stale.jpg'), 'x');
    writeFileSync(
      join(cacheRoot, 'owner.json'),
      JSON.stringify({ path: '/somewhere/Other.photoslibrary' })
    );

    const session = open();
    await settle(session);

    expect(existsSync(join(cacheRoot, 'cache', 'full', 'stale.jpg'))).toBe(
      false
    );
    const owner = JSON.parse(
      readFileSync(join(cacheRoot, 'owner.json'), 'utf-8')
    ) as { path: string };
    expect(owner.path).toBe(libraryPath);
  });

  test('claims before the image cache builds, so its directories survive', async () => {
    mkdirSync(cacheRoot, { recursive: true });
    writeFileSync(
      join(cacheRoot, 'owner.json'),
      JSON.stringify({ path: '/somewhere/Other.photoslibrary' })
    );

    const session = open();
    await settle(session);

    // A claim that ran *after* createImageCache would have taken these with it,
    // leaving the cache pointing at a tree that no longer exists.
    expect(existsSync(join(cacheRoot, 'cache', 'full'))).toBe(true);
    expect(existsSync(join(cacheRoot, 'cache', 'thumb'))).toBe(true);
  });
});

describe('album pruning', () => {
  test('drops orphaned subtrees once the rebuild has run', async () => {
    mkdirSync(join(bundleDir, 'albums', LIVE), { recursive: true });
    mkdirSync(join(bundleDir, 'albums', ORPHAN), { recursive: true });

    const session = open();
    await settle(session);

    expect(existsSync(join(bundleDir, 'albums', LIVE))).toBe(true);
    expect(existsSync(join(bundleDir, 'albums', ORPHAN))).toBe(false);
  });

  test('keeps every subtree when the rebuild throws', async () => {
    mkdirSync(join(bundleDir, 'albums', ORPHAN), { recursive: true });

    const session = openLibrarySession({
      libraryPath,
      supportDir,
      cacheRoot,
      adapters: {
        photosLibrary,
        buildFreshItems: () => {
          throw new Error('library unreadable');
        },
        loadAlbums: () => roster,
        resolveActiveLibrary: () => ({ ok: true, path: libraryPath })
      }
    });
    await session.rebuildComplete.catch(() => undefined);
    await Promise.resolve();

    // A failed rebuild says nothing about which albums are live.
    expect(existsSync(join(bundleDir, 'albums', ORPHAN))).toBe(true);
  });
});

describe('saved view', () => {
  test('round-trips through the Bundle store, not the support dir', async () => {
    const session = open();
    await settle(session);

    const res = await session.routeApiRequest(
      new Request('http://localhost/api/view-state', {
        method: 'PUT',
        body: JSON.stringify({ zoom: '7', style: 'Topo' })
      }),
      '/api/view-state'
    );
    expect(res?.status).toBe(204);

    expect(session.savedView()).toEqual({ zoom: '7', style: 'Topo' });
    // The `view` key belongs to the library it describes (ADR-0015), so it must
    // land inside the bundle and nowhere near the machine-scoped settings.
    expect(existsSync(join(bundleDir, 'state.json'))).toBe(true);
    expect(existsSync(join(supportDir, 'state.json'))).toBe(false);
  });

  test('reads as empty when nothing was saved', async () => {
    const session = open();
    await settle(session);
    expect(session.savedView()).toEqual({});
  });

  test('reads as empty when the saved value is malformed', async () => {
    writeFileSync(
      join(bundleDir, 'state.json'),
      JSON.stringify({ view: 'not json' })
    );
    const session = open();
    await settle(session);
    expect(session.savedView()).toEqual({});
  });
});
