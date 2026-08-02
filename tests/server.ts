/**
 * E2E test server.
 *
 * Boots the same API handler and routing the production server uses, but
 * against a tempdir-backed item store pre-seeded with fake items and a
 * stub PhotosLibrary that points every UUID at a checked-in fixture JPEG —
 * so popup and lightbox <img> tags load real bytes without any Apple Photos
 * library access.
 */

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import indexHtml from '@client/index.html';
import { createAlbumStore } from '@server/album-store';
import { createApiHandler } from '@server/api-routes';
import { openItemStore, type ItemEntry } from '@server/item-store';
import { createOrsClient } from '@server/ors-client';
import type { PhotosLibrary } from '@server/photos-library';
import { createRequestHandler } from '@server/request-handler';
import { serve } from 'bun';

const port = Number(process.env.E2E_PORT ?? 4757);
const dataDir = process.env.E2E_DATA_DIR ?? 'tests/output/data';
const fixtureJpeg = 'tests/fixtures/sample.jpg';

// The two roots the production entries build: handmade data inside the library
// bundle, derived data outside it. There is no real bundle here — the stub
// PhotosLibrary stands in for one — so both are directories under the test data
// dir, wired the same way round as in `src/server/index.ts`.
const bundleDir = join(dataDir, 'library.photoslibrary', 'karttapallo');
const cacheRoot = join(dataDir, 'derived');

mkdirSync(bundleDir, { recursive: true });
mkdirSync(cacheRoot, { recursive: true });

interface SeedSpec {
  uuid: string;
  date: string;
  albums: string[];
  camera: string;
  lat: number;
  lon: number;
  place?: string;
  description?: string;
  labels?: string[];
}

function seed(s: SeedSpec): ItemEntry {
  return {
    uuid: s.uuid,
    type: 'photo',
    full: `full/${s.uuid}.jpg`,
    thumb: `thumb/${s.uuid}.jpg`,
    lat: s.lat,
    lon: s.lon,
    date: s.date,
    tz: '+03:00',
    camera: s.camera,
    gps: 'exif',
    gps_accuracy: 5,
    albums: s.albums,
    // Specs seed at most one of each; the real index attaches a list.
    place: s.place === undefined ? [] : [s.place],
    description: s.description === undefined ? [] : [s.description],
    labels: s.labels ?? [],
    // Shaped like the real thing so the info panel's "Open in Photos" link
    // has an href to assert. Never followed in a spec — it would hand the
    // browser off to Photos.app.
    photos_url: `photos:albums?albumUuid=E2E&assetUuid=${s.uuid}`
  };
}

// Mixed years/albums/cameras so cascade tests have something to narrow.
// Each photo gets unique coords so the popup's copy/paste-location button
// shows up between any pair (it only renders when copied ≠ current).
// Date format matches photos-db output ("YYYY:MM:DD HH:MM:SS") so the
// client's getYear() can split on the first colon.
const items: ItemEntry[] = [
  seed({
    uuid: 'e2e-1',
    date: '2024:06:01 12:00:00',
    albums: ['Helsinki'],
    camera: 'iPhone',
    lat: 60.17,
    lon: 24.94,
    place: 'Kuhmo'
  }),
  seed({
    uuid: 'e2e-2',
    date: '2023:08:15 10:00:00',
    albums: ['Tampere'],
    camera: 'Sony',
    lat: 61.5,
    lon: 23.78,
    place: 'Kuusamo'
  }),
  seed({
    uuid: 'e2e-3',
    date: '2024:09:20 14:00:00',
    albums: ['Tampere'],
    camera: 'iPhone',
    lat: 61.51,
    lon: 23.79,
    place: 'Näätämö',
    description: 'Käki',
    // Long enough to wrap the Categories row over several lines, which is the
    // shape a real analyzed photo has — the working library averages ten scene
    // labels each. None share a prefix with a query the search specs type.
    labels: [
      'Lintu',
      'Ulkoilma',
      'Vesistö',
      'Maisema',
      'Ranta',
      'Metsä',
      'Taivas',
      'Pilvi',
      'Auringonlasku',
      'Niitty',
      'Polku',
      'Silta'
    ]
  })
];

// Pre-seed the snapshot so /api/items returns immediately. The buildFreshItems
// override returns the same list so rebuild detects no changes — no Apple
// Photos library is touched.
writeFileSync(join(cacheRoot, 'items.json'), JSON.stringify(items));

// Album directories are keyed by UUID, so the stub roster is what maps the
// names the specs drive the UI with onto directories on disk.
const albums = [
  { uuid: 'E2E00001-0000-4000-8000-000000000001', title: 'Tampere' },
  { uuid: 'E2E00002-0000-4000-8000-000000000002', title: 'Helsinki' }
];

// Seed the Tampere album with a small GPX track so map-gpx has a route to
// load + parse + render. Visibility defaults to true (no _files.json sidecar).
const tampereDir = join(bundleDir, 'albums', albums[0]!.uuid);
mkdirSync(tampereDir, { recursive: true });
copyFileSync('tests/fixtures/track.gpx', join(tampereDir, 'track.gpx'));

// No-op PhotosWriter so /api/save-edits succeeds in E2E without touching the
// real Photos.app via AppleScript.
const itemStore = openItemStore({
  cacheRoot,
  buildFreshItems: () => items,
  photosWriter: {
    setLocation: () => undefined,
    setDateTime: () => undefined,
    setTimezone: () => undefined,
    quitPhotosApp: () => undefined
  }
});
itemStore.rebuildComplete.catch(() => {
  /* ignored — E2E doesn't depend on rebuild */
});

// Fake Photos library: every UUID resolves to the same fixture JPEG so popup /
// lightbox <img> tags load real bytes. Metadata returns a small canned record
// so the info panel renders rows; video stays unimplemented.
const photosLibrary: PhotosLibrary = {
  resolveImagePath: () => fixtureJpeg,
  resolveVideoPath: () => null,
  getMetadata: (uuid) => ({
    uuid,
    filename: `${uuid}.jpg`,
    camera: 'iPhone',
    dimensions: '4032x3024',
    // e2e-3 carries extra rows so a spec can navigate between two photos whose
    // tables differ in height.
    ...(uuid === 'e2e-3'
      ? {
          lens: 'Wide',
          aperture: 'f/1.8',
          iso: 100,
          focal_length: '26mm',
          title: 'Tampere rooftops'
        }
      : {})
  })
};

const albumStore = createAlbumStore(bundleDir, () => albums);
const orsClient = createOrsClient(dataDir);
const { routeApiRequest } = createApiHandler(bundleDir, {
  itemStore,
  photosLibrary,
  albumStore,
  orsClient
});

const fetch = createRequestHandler({
  routeApi: routeApiRequest,
  // Client assets only. Album files go through the API, same as production —
  // once album directories are named by UUID, a request path can't name one.
  staticRoots: ['src/client'],
  vendorFiles: {
    '/maplibre-gl.css': 'node_modules/maplibre-gl/dist/maplibre-gl.css'
  }
});

serve({
  port,
  routes: { '/': indexHtml },
  development: false,
  fetch
});

console.log(`E2E server listening on http://127.0.0.1:${port}`);
