/**
 * The `test` every spec imports: Playwright's, with the page held offline.
 *
 * The basemaps are the only thing the client fetches from outside, and the
 * map's `load` event — what mounts every feature child, and so what every
 * spec's first assertion ends up waiting on — doesn't fire until the first
 * frame is drawn, tiles included. A CI runner that can't reach
 * mt0.google.com doesn't fail those requests, it leaves them hanging: the map
 * sits at the world view and `<photo-popup>`, `<map-fit>` and `<map-measure>`
 * never appear. See docs/gotchas.md.
 *
 * So the tile hosts answer from a checked-in PNG here, and anything else
 * off-origin is aborted rather than quietly served — a new external
 * dependency should fail loudly in the spec that added it, not hang the
 * suite. Specs register their own routes after this one, so `/api` stubs
 * still win.
 */

import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';

const tile = readFileSync('tests/fixtures/tile.png');

const tileHosts = new Set([
  'mt0.google.com',
  'mt1.google.com',
  'mt2.google.com',
  'mt3.google.com',
  'avoin-karttakuva.maanmittauslaitos.fi'
]);

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const local = new URL(baseURL!).host;
    await page.route('**/*', async (route, request) => {
      const { host } = new URL(request.url());
      if (host === local) {
        await route.fallback();
      } else if (tileHosts.has(host)) {
        await route.fulfill({ contentType: 'image/png', body: tile });
      } else {
        await route.abort();
      }
    });
    await use(page);
  }
});

export { expect };
