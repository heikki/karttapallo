import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  createAlbumStore,
  InvalidNameError,
  UnknownAlbumError,
  type AlbumRoster,
  type AlbumStore
} from './album-store';

const HELSINKI = '11111111-1111-4111-8111-111111111111';
const LAPLAND = '22222222-2222-4222-8222-222222222222';
const SPACES = '33333333-3333-4333-8333-333333333333';
const KONGAS = '44444444-4444-4444-8444-444444444444';

let dataDir = '';
let roster: AlbumRoster[] = [];
let store: AlbumStore = createAlbumStore('', () => []);

/** Where an album's subtree actually lands, for tests asserting on layout. */
function dirFor(uuid: string) {
  return join(dataDir, 'albums', uuid);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'karttapallo-albumstore-'));
  roster = [
    { uuid: HELSINKI, title: 'Helsinki' },
    { uuid: LAPLAND, title: 'Lapland' },
    { uuid: SPACES, title: 'My Trip 2024.summer' },
    { uuid: KONGAS, title: 'Lappi-Köngäs' }
  ];
  store = createAlbumStore(dataDir, () => roster);
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

async function expectRejection(
  promise: Promise<unknown>,
  ctor: new (...args: never[]) => Error
) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ctor);
    return;
  }
  throw new Error(`expected ${ctor.name} but no rejection occurred`);
}

async function expectInvalidName(promise: Promise<unknown>) {
  await expectRejection(promise, InvalidNameError);
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

  test('writes file bytes to disk under the album UUID, not its name', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'route.gpx', body: '<gpx>hi</gpx>' }])
    );
    expect(readFileSync(join(dirFor(HELSINKI), 'route.gpx'), 'utf-8')).toBe(
      '<gpx>hi</gpx>'
    );
    expect(existsSync(join(dataDir, 'albums', 'Helsinki'))).toBe(false);
  });
});

describe('getFileBytes', () => {
  test('returns the bytes of an uploaded file', async () => {
    await store.uploadFiles(
      'Helsinki',
      makeFormData([{ name: 'a.gpx', body: '<gpx>x</gpx>' }])
    );
    expect(await store.getFileBytes('Helsinki', 'a.gpx')).toBe('<gpx>x</gpx>');
  });

  test('null for a file that was never uploaded', async () => {
    expect(await store.getFileBytes('Helsinki', 'nope.gpx')).toBeNull();
  });

  // These bytes are served over HTTP, so the allowlist has to hold on read too.
  test('null for a disallowed extension even when the file exists', async () => {
    mkdirSync(dirFor(HELSINKI), { recursive: true });
    await Bun.write(join(dirFor(HELSINKI), 'secrets.txt'), 'sensitive');
    expect(await store.getFileBytes('Helsinki', 'secrets.txt')).toBeNull();
  });

  test('rejects a traversing filename', async () => {
    await expectInvalidName(store.getFileBytes('Helsinki', '../escape.gpx'));
  });
});

describe('album name to UUID', () => {
  test('a renamed album keeps the route filed under its UUID', async () => {
    await store.putRouteBytes('Helsinki', 'route-bytes');

    // The user renames the album in Photos: same UUID, new title.
    roster = [{ uuid: HELSINKI, title: 'Helsinki 2024' }];

    expect(await store.getRouteBytes('Helsinki 2024')).toBe('route-bytes');
  });

  test('an album added while running resolves without a restart', async () => {
    expect(await store.getRouteBytes('Oulu')).toBeNull();

    roster = [...roster, { uuid: LAPLAND, title: 'Oulu' }];

    await store.putRouteBytes('Oulu', 'x');
    expect(await store.getRouteBytes('Oulu')).toBe('x');
  });

  test('matches an NFD roster title against the NFC name the API carries', async () => {
    roster = [{ uuid: KONGAS, title: 'Vätsäri' }];

    await store.putRouteBytes('Vätsäri'.normalize('NFC'), 'nfc');

    expect(await store.getRouteBytes('Vätsäri'.normalize('NFC'))).toBe('nfc');
    expect(existsSync(dirFor(KONGAS))).toBe(true);
  });

  test('two albums sharing a title resolve to one directory, deterministically', async () => {
    roster = [
      { uuid: LAPLAND, title: 'Duplicate' },
      { uuid: HELSINKI, title: 'Duplicate' }
    ];
    await store.putRouteBytes('Duplicate', 'x');

    // Lower UUID wins, whatever order the library reports them in.
    expect(existsSync(dirFor(HELSINKI))).toBe(true);
    expect(existsSync(dirFor(LAPLAND))).toBe(false);
  });
});

describe('unknown albums', () => {
  test('reads come back empty rather than failing', async () => {
    expect(await store.listFiles('Ghost')).toEqual([]);
    expect(await store.getRouteBytes('Ghost')).toBeNull();
    expect(await store.getFileBytes('Ghost', 'a.gpx')).toBeNull();
  });

  test('writes refuse, so no directory is invented from the name', async () => {
    await expectRejection(
      store.putRouteBytes('Ghost', '{}'),
      UnknownAlbumError
    );
    await expectRejection(
      store.uploadFiles('Ghost', makeFormData([{ name: 'a.gpx', body: 'x' }])),
      UnknownAlbumError
    );
    expect(() => {
      store.setFileVisibility('Ghost', 'a.gpx', false);
    }).toThrow(UnknownAlbumError);

    expect(existsSync(join(dataDir, 'albums'))).toBe(false);
  });

  // The end state a delete asks for already holds, so it is not an error.
  test('deletes are no-ops', async () => {
    await store.deleteRoute('Ghost');
    await store.deleteFile('Ghost', 'a.gpx');
  });
});

describe('pruneOrphans', () => {
  test('removes the subtree of an album the library no longer has', async () => {
    await store.putRouteBytes('Helsinki', 'h');
    await store.putRouteBytes('Lapland', 'l');

    roster = [{ uuid: HELSINKI, title: 'Helsinki' }];
    store.pruneOrphans();

    expect(existsSync(dirFor(HELSINKI))).toBe(true);
    expect(existsSync(dirFor(LAPLAND))).toBe(false);
  });

  // An empty roster means the library could not be read, which is
  // indistinguishable from every album having been deleted.
  test('removes nothing when the roster is empty', async () => {
    await store.putRouteBytes('Helsinki', 'h');

    roster = [];
    store.pruneOrphans();

    expect(existsSync(dirFor(HELSINKI))).toBe(true);
  });

  test('leaves directories that are not album UUIDs alone', async () => {
    await store.putRouteBytes('Helsinki', 'h');
    mkdirSync(join(dataDir, 'albums', 'not-a-uuid'), { recursive: true });

    roster = [{ uuid: HELSINKI, title: 'Helsinki' }];
    store.pruneOrphans();

    expect(existsSync(join(dataDir, 'albums', 'not-a-uuid'))).toBe(true);
  });

  test('survives an albums directory that does not exist yet', () => {
    expect(() => {
      store.pruneOrphans();
    }).not.toThrow();
  });

  test('a renamed album is not an orphan', async () => {
    await store.putRouteBytes('Helsinki', 'h');

    roster = [{ uuid: HELSINKI, title: 'Helsinki 2024' }];
    store.pruneOrphans();

    expect(await store.getRouteBytes('Helsinki 2024')).toBe('h');
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
