import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActiveLibraryResult } from '@native/native-bridge';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { resolveLibrary, volumeOf } from './resolve-library';

let tmp = '';

/** Build a fake .photoslibrary bundle with a Photos.sqlite inside. */
function makeLibrary(): string {
  const lib = join(tmp, 'Fake.photoslibrary');
  mkdirSync(join(lib, 'database'), { recursive: true });
  writeFileSync(join(lib, 'database', 'Photos.sqlite'), '');
  return lib;
}

const native = (r: ActiveLibraryResult) => (): ActiveLibraryResult => r;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'karttapallo-resolve-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('resolveLibrary', () => {
  test('ok when the active library exists', () => {
    const path = makeLibrary();
    const res = resolveLibrary(native({ status: 'ok', path }));
    expect(res).toEqual({ ok: true, path });
  });

  test('fda error when prefs are unreadable', () => {
    const res = resolveLibrary(native({ status: 'denied', message: 'nope' }));
    expect(res).toEqual({ ok: false, error: 'fda', message: 'nope' });
  });

  test('unavailable (never silent fallback) when active library has no db', () => {
    const path = '/Volumes/No Such Drive 7f3a/Photos Library.photoslibrary';
    const res = resolveLibrary(native({ status: 'ok', path }));
    expect(res).toEqual({
      ok: false,
      error: 'unavailable',
      libraryPath: path,
      volume: 'No Such Drive 7f3a'
    });
  });

  test('no-bookmark falls back to the system library only when present', () => {
    // System default almost certainly lacks a db in CI/tmp, so this asserts the
    // fail-loud branch rather than a silent system-library read.
    const res = resolveLibrary(native({ status: 'no-bookmark' }));
    if (res.ok) {
      expect(res.path).toContain('Pictures');
    } else {
      expect(res.error).toBe('unavailable');
    }
  });
});

describe('volumeOf', () => {
  test('extracts the volume name from an external path', () => {
    expect(volumeOf('/Volumes/Crucial X10/Photos Library.photoslibrary')).toBe(
      'Crucial X10'
    );
  });

  test('null for an internal-disk path', () => {
    expect(volumeOf('/Users/x/Pictures/Photos Library.photoslibrary')).toBe(
      null
    );
  });
});
