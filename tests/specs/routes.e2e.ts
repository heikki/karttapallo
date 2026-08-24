import { rmSync } from 'node:fs';
import type { Page } from '@playwright/test';

import { expect, test } from './_fixtures';
import {
  cameraSettled,
  layerVisibility,
  screenPoint,
  sourceFeatureCount
} from './_helpers';

// The autosave-and-load tests below mutate `_route.json` on disk. Without a
// reset, state leaks between tests: a previous run's waypoint sits at the
// canvas centre, and the next click would hit and remove it.
//
// Album data lives inside the library bundle under the album's UUID, so this
// must track both the `bundleDir` and the stub roster in `tests/server.ts`.
test.beforeEach(() => {
  const dataDir = process.env.E2E_DATA_DIR ?? 'tests/output/data';
  const tampere = 'E2E00001-0000-4000-8000-000000000001';
  rmSync(
    `${dataDir}/library.photoslibrary/karttapallo/albums/${tampere}/_route.json`,
    { force: true }
  );
});

// Route polyline lives in the `photo-route` MapLibre source, rendered by the
// `photo-route-line` layer. Clicking the Route button on `<filter-panel>`
// toggles `viewState.routeVisible`: on-flip the source picks up features
// built from filtered photos (or loaded from disk if a saved route exists);
// off-flip flips the layer's visibility property to "none".
//
// Edit mode populates a separate `route-edit-points` source — one feature
// per photo + waypoint — driven by `<map-route>`'s edit module.

async function selectAlbum(page: Page, album: string) {
  await page.getByLabel('Album').selectOption(album);
}

async function clickViewBtn(page: Page, label: string) {
  // Scoped to the panel: a popup is always open now (ADR-0016), and its date
  // "edit" button would otherwise tie with the panel's route "Edit".
  await page
    .locator('filter-panel')
    .getByRole('button', { name: label })
    .click();
}

// The card is anchored over the line these specs need to click — Tampere's
// two photos are half a kilometre apart and the card is 320px wide — and a
// click that lands on it opens the lightbox instead of reaching the map.
// Escape hides it and leaves the selection standing (ADR-0016). Before Edit,
// where Escape belongs to the mode.
async function hidePhotoCard(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('photo-popup')).toHaveCount(0);
}

// Midway between Tampere's two photos (61.5,23.78 and 61.51,23.79), which is
// a point on the route line drawn between them — what a click has to land on
// to add a waypoint rather than land on bare map.
async function clickRouteSegment(page: Page) {
  await cameraSettled(page);
  const { x, y } = await screenPoint(page, 23.785, 61.505);
  await page.mouse.click(x, y);
}

test('Toggle photo route on the map', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );
  await expect(page.locator('map-fit')).toBeAttached();

  // Filter to Tampere → enables the Route button.
  await selectAlbum(page, 'Tampere');

  const routeBtn = page.getByRole('button', { name: 'Route' });
  await expect(routeBtn).toBeEnabled();
  await expect(routeBtn).not.toHaveClass(/active/);

  // No route yet → source is empty and layer is hidden.
  expect(await sourceFeatureCount(page, 'photo-route')).toBe(0);
  expect(await layerVisibility(page, 'photo-route-line')).toBe('none');

  // Click Route → source picks up features built from the filtered photos
  // (Tampere has e2e-2 and e2e-3, so buildDefault wires a 2-photo route),
  // and the line layer becomes visible.
  await routeBtn.click();
  await expect(routeBtn).toHaveClass(/active/);
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);
  await expect
    .poll(() => layerVisibility(page, 'photo-route-line'))
    .toBe('visible');

  // Click Route again → layer hides; the user no longer sees the polyline.
  await routeBtn.click();
  await expect(routeBtn).not.toHaveClass(/active/);
  await expect
    .poll(() => layerVisibility(page, 'photo-route-line'))
    .toBe('none');
});

test('Edit mode adds a waypoint via clicking a segment', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );
  await selectAlbum(page, 'Tampere');
  await hidePhotoCard(page);
  await clickViewBtn(page, 'Route');
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);

  // Enter edit mode → the edit-points source is populated.
  await clickViewBtn(page, 'Edit');
  await expect(
    page.locator('filter-panel').getByRole('button', { name: 'Edit' })
  ).toHaveClass(/active/);
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBeGreaterThanOrEqual(2);
  const before = await sourceFeatureCount(page, 'route-edit-points');

  // A click on the canvas adds a waypoint at the nearest segment, so the
  // edit-points source grows by exactly one feature.
  await clickRouteSegment(page);
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBe(before + 1);
});

test('Route edits persist across a page reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );
  await selectAlbum(page, 'Tampere');
  await hidePhotoCard(page);
  await clickViewBtn(page, 'Route');
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);
  await clickViewBtn(page, 'Edit');
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBeGreaterThanOrEqual(2);
  const before = await sourceFeatureCount(page, 'route-edit-points');

  // Add a waypoint.
  await clickRouteSegment(page);
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBe(before + 1);

  // Exit edit mode → the pending autosave is flushed. Wait for the PUT so
  // the next page-load reads the just-saved file.
  const saved = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/albums/Tampere/route') &&
      resp.request().method() === 'PUT'
  );
  await clickViewBtn(page, 'Edit');
  await saved;

  // Reload the page. `viewState.routeVisible` is mirrored to `?route=1` and
  // the album filter is restored from `localStorage`, so the saved route
  // auto-loads from disk without any further clicks. The panel header
  // shows "2 photos" after restore (Tampere's photo count, not "3 photos").
  await page.reload();
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '2 photos'
  );
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);
  await clickViewBtn(page, 'Edit');

  // The waypoint added before the reload is still present.
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBe(before + 1);
});

test('Route edits persist across album switch and back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );
  await selectAlbum(page, 'Tampere');
  await hidePhotoCard(page);
  await clickViewBtn(page, 'Route');
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);
  await clickViewBtn(page, 'Edit');
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBeGreaterThanOrEqual(2);
  const before = await sourceFeatureCount(page, 'route-edit-points');

  // Add a waypoint and exit edit mode (flushes the pending autosave).
  await clickRouteSegment(page);
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBe(before + 1);

  const saved = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/albums/Tampere/route') &&
      resp.request().method() === 'PUT'
  );
  await clickViewBtn(page, 'Edit');
  await saved;

  // Switch to a different album, then back. Helsinki has a single photo
  // (no eligible default route), so this exercises the "load nothing, then
  // reload Tampere" path — the bug the album-aware route store guards.
  await selectAlbum(page, 'Helsinki');
  await selectAlbum(page, 'Tampere');
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);
  await clickViewBtn(page, 'Edit');

  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBe(before + 1);
});
