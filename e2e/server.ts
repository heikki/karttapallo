/**
 * E2E test server.
 *
 * Boots the same API handler and routing the production server uses, but
 * against a tempdir-backed app.db pre-seeded with one fake item so the
 * sync-on-empty branch is skipped. No Apple Photos library access required.
 */

import { mkdirSync } from 'node:fs';
import { serve } from 'bun';

import indexHtml from '../src/client/index.html';
import { createApiHandler } from '../src/server/api-routes';
import { openAppDb, upsertItems } from '../src/server/app-db';
import { createImageCache } from '../src/server/image-cache';
import type { ItemEntry } from '../src/server/items';

const port = Number(process.env.E2E_PORT ?? 4757);
const dataDir = process.env.E2E_DATA_DIR ?? 'e2e/.data';

mkdirSync(dataDir, { recursive: true });
mkdirSync(`${dataDir}/cache`, { recursive: true });
openAppDb(dataDir);

const seed: ItemEntry = {
  uuid: 'e2e-fixture-1',
  type: 'photo',
  full: 'full/e2e-fixture-1.jpg',
  thumb: 'thumb/e2e-fixture-1.jpg',
  lat: 60.17,
  lon: 24.94,
  date: '2024-06-01T12:00:00',
  tz: '+03:00',
  camera: 'E2E',
  gps: 'exif',
  gps_accuracy: 5,
  albums: ['E2E'],
  photos_url: ''
};
upsertItems([seed]);

const imageCache = createImageCache({ cacheDir: `${dataDir}/cache` });
const { routeApiRequest } = createApiHandler(dataDir, { imageCache });

serve({
  port,
  routes: { '/': indexHtml },
  development: false,
  async fetch(req) {
    const url = new URL(req.url);
    const apiResponse = routeApiRequest(req, url.pathname);
    if (apiResponse !== null) {
      const resolved = await apiResponse;
      if (resolved !== null) return resolved;
    }
    const decodedPath = decodeURIComponent(url.pathname);
    let file = Bun.file(`${dataDir}${decodedPath}`);
    if (file.size > 0) return new Response(file);
    file = Bun.file(`src/client${decodedPath}`);
    if (file.size > 0) return new Response(file);
    return new Response('Not Found', { status: 404 });
  }
});

console.log(`E2E server listening on http://127.0.0.1:${port}`);
