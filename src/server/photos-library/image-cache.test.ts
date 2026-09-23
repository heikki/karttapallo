/**
 * Tier 2 — the cache's own housekeeping.
 *
 * `clear` and `evictExcept` are the two operations that know the cache's file
 * layout, and neither touches the native bridge: they only add up to which
 * files are left on disk.
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createImageCache, type ImageCache } from './image-cache';

let cacheDir = '';

/** Constructing is what creates full/ and thumb/, so every test opens first. */
function openCache(): ImageCache {
  return createImageCache({ cacheDir, libraryPath: '/nonexistent' });
}

function write(size: 'full' | 'thumb', name: string) {
  writeFileSync(join(cacheDir, size, name), 'jpeg-ish');
}

function listing(size: 'full' | 'thumb') {
  return readdirSync(join(cacheDir, size)).sort();
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'karttapallo-image-cache-'));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('evictExcept', () => {
  test('removes what the library no longer has, in both sizes', () => {
    const cache = openCache();
    write('full', 'live.jpg');
    write('full', 'gone.jpg');
    write('thumb', 'live.jpg');
    write('thumb', 'gone.jpg');

    cache.evictExcept(new Set(['live']));

    expect(listing('full')).toEqual(['live.jpg']);
    expect(listing('thumb')).toEqual(['live.jpg']);
  });

  test('leaves anything that is not a converted image', () => {
    const cache = openCache();
    write('full', 'gone.jpg');
    writeFileSync(join(cacheDir, 'full', 'notes.txt'), 'x');

    cache.evictExcept(new Set());

    expect(listing('full')).toEqual(['notes.txt']);
  });

  test('is a no-op when nothing is cached', () => {
    const cache = openCache();
    expect(() => {
      cache.evictExcept(new Set(['live']));
    }).not.toThrow();
    expect(listing('full')).toEqual([]);
  });

  test('keeps everything when every uuid is still live', () => {
    const cache = openCache();
    write('full', 'a.jpg');
    write('full', 'b.jpg');

    cache.evictExcept(new Set(['a', 'b']));

    expect(listing('full')).toEqual(['a.jpg', 'b.jpg']);
  });
});
