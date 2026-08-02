import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActiveLibraryResult } from '@native/native-bridge';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { libraryTitle, resolveLibrary, volumeOf } from './resolve-library';

let tmp = '';

/** Build a fake .photoslibrary bundle with a Photos.sqlite inside. */
function makeLibrary() {
  const lib = join(tmp, 'Fake.photoslibrary');
  mkdirSync(join(lib, 'database'), { recursive: true });
  writeFileSync(join(lib, 'database', 'Photos.sqlite'), '');
  return lib;
}

function native(r: ActiveLibraryResult) {
  return (): ActiveLibraryResult => r;
}

/** FDA seam. Always injected so tests don't depend on the host's grant state. */
function withFda() {
  return true;
}
function withoutFda() {
  return false;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'karttapallo-resolve-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('resolveLibrary', () => {
  test('ok when the active library exists', () => {
    const path = makeLibrary();
    const res = resolveLibrary(native({ status: 'ok', path }), withFda);
    expect(res).toEqual({ ok: true, path });
  });

  test('fda error without probing the container when FDA is missing', () => {
    // The native resolver must not run: reading the Photos container is what
    // triggers the per-launch macOS consent prompt this gate exists to avoid.
    let probed = false;
    const res = resolveLibrary(() => {
      probed = true;
      return { status: 'ok', path: makeLibrary() };
    }, withoutFda);

    expect(probed).toBe(false);
    expect(res).toMatchObject({ ok: false, error: 'fda' });
  });

  test('fda error when prefs are unreadable', () => {
    const res = resolveLibrary(
      native({ status: 'denied', message: 'nope' }),
      withFda
    );
    expect(res).toEqual({ ok: false, error: 'fda', message: 'nope' });
  });

  test('unavailable (never silent fallback) when active library has no db', () => {
    const path = '/Volumes/No Such Drive 7f3a/Photos Library.photoslibrary';
    const res = resolveLibrary(native({ status: 'ok', path }), withFda);
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
    const res = resolveLibrary(native({ status: 'no-bookmark' }), withFda);
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

describe('libraryTitle', () => {
  const home = homedir();

  test('names the volume for a library on an external disk', () => {
    expect(
      libraryTitle('/Volumes/Crucial X10/Rebuild Test.photoslibrary')
    ).toBe('Rebuild Test (Crucial X10)');
  });

  // A library filed inside a backup needs every level to be located, and the
  // volume name alone would point at the wrong copy.
  test('keeps the nested path under a volume', () => {
    expect(
      libraryTitle(
        '/Volumes/Crucial X10/Backups/2018-08-02/Pictures/Photos Library.photoslibrary'
      )
    ).toBe('Photos Library (Crucial X10/Backups/2018-08-02/Pictures)');
  });

  test('bare name in the default Photos directory, where a location adds nothing', () => {
    expect(
      libraryTitle(join(home, 'Pictures/Photos Library.photoslibrary'))
    ).toBe('Photos Library');
  });

  // Copies get made here, and two of them can share a name — the folder is the
  // only thing that tells them apart.
  test('names the folder elsewhere on the internal disk, home written as ~', () => {
    expect(libraryTitle(join(home, 'Desktop/Rebuild Test.photoslibrary'))).toBe(
      'Rebuild Test (~/Desktop)'
    );
    expect(
      libraryTitle(join(home, 'tmp/scratch/Rebuild Test.photoslibrary'))
    ).toBe('Rebuild Test (~/tmp/scratch)');
  });

  test('distinguishes same-named libraries in different local folders', () => {
    const a = libraryTitle(join(home, 'Desktop/Rebuild Test.photoslibrary'));
    const b = libraryTitle(join(home, 'tmp/Rebuild Test.photoslibrary'));

    expect(a).not.toBe(b);
  });

  test('bare ~ for a library sitting directly in the home directory', () => {
    expect(libraryTitle(join(home, 'Archive.photoslibrary'))).toBe(
      'Archive (~)'
    );
  });

  test('leaves a directory outside home alone', () => {
    expect(libraryTitle('/opt/photos/Archive.photoslibrary')).toBe(
      'Archive (/opt/photos)'
    );
  });
});
