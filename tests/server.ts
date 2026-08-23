/**
 * E2E test server.
 *
 * Boots the same API handler and routing the production server uses, but
 * against a tempdir-backed item store pre-seeded with fake items and a
 * stub PhotosLibrary that points every UUID at a checked-in fixture JPEG —
 * so popup and lightbox <img> tags load real bytes without any Apple Photos
 * library access.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import indexHtml from '@client/index.html';
import type { ItemEntry } from '@server/item-store';
import { openLibrarySession } from '@server/library-session';
import type { PhotosLibrary } from '@server/photos-library';
import { createRequestHandler } from '@server/request-handler';
import { serve } from 'bun';

const port = Number(process.env.E2E_PORT ?? 4757);
const dataDir = process.env.E2E_DATA_DIR ?? 'tests/output/data';
const fixtureJpeg = 'tests/fixtures/sample.jpg';

// A stand-in library bundle: no real one exists here — the stub PhotosLibrary
// below is what serves its bytes — but the session derives the Bundle store
// from it exactly as it does in production, so the album subtrees land where
// the specs look for them. `bundleDir` is spelled out only to seed fixtures
// into; nothing here wires it.
const libraryPath = join(dataDir, 'library.photoslibrary');
const bundleDir = join(libraryPath, 'karttapallo');
const cacheRoot = join(dataDir, 'derived');

mkdirSync(bundleDir, { recursive: true });

interface SeedSpec {
  uuid: string;
  date: string;
  albums: string[];
  camera: string;
  lat: number;
  lon: number;
  /** Metres, as Photos records it for an exif fix. Defaults to a tight one. */
  gpsAccuracy?: number;
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
    gps_accuracy: s.gpsAccuracy ?? 5,
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
    // Two orders of magnitude looser than the others, so a spec can tell the
    // ring is drawn from this photo's own accuracy and not a constant.
    gpsAccuracy: 300,
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

const session = openLibrarySession({
  libraryPath,
  supportDir: dataDir,
  cacheRoot,
  adapters: {
    photosLibrary,
    // No-op writer so /api/save-edits succeeds without reaching AppleScript,
    // and a resolver that agrees with the stand-in bundle so the write-time
    // active-library guard passes instead of comparing against the real
    // library this machine happens to have open.
    photosWriter: {
      setLocation: () => undefined,
      setDateTime: () => undefined,
      setTimezone: () => undefined,
      quitPhotosApp: () => undefined
    },
    buildFreshItems: () => items,
    loadAlbums: () => albums,
    resolveActiveLibrary: () => ({ ok: true, path: libraryPath })
  }
});

// Serve only once the snapshot is in memory. The rebuild is a microtask and
// Playwright's first request is many milliseconds out, but an ordering the
// suite depends on is worth stating rather than winning by default.
await session.rebuildComplete;

const fetch = createRequestHandler({
  routeApi: session.routeApiRequest,
  // Client assets only. Album files go through the API, same as production —
  // once album directories are named by UUID, a request path can't name one.
  staticRoots: ['src/client'],
  vendorFiles: {
    '/maplibre-gl.css': 'node_modules/maplibre-gl/dist/maplibre-gl.css',
    // maplibre 6 loads its worker as a real URL, resolved against the bundle,
    // and the worker imports the shared chunk beside it. Without both served
    // the worker 404s and the map never finishes loading — see docs/gotchas.md.
    '/maplibre-gl-worker.mjs':
      'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
    '/maplibre-gl-shared.mjs':
      'node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs'
  }
});

serve({
  port,
  routes: { '/': indexHtml },
  development: false,
  fetch
});

console.log(`E2E server listening on http://127.0.0.1:${port}`);
