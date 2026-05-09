import { rmSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { layerVisibility, sourceFeatureCount } from './_helpers';

// The autosave-and-load tests below mutate `_route.json` on disk. Without a
// reset, state leaks between tests: a previous run's waypoint sits at the
// canvas centre, and the next click would hit and remove it.
test.beforeEach(() => {
  const dataDir = process.env.E2E_DATA_DIR ?? 'tests/output/data';
  rmSync(`${dataDir}/albums/Tampere/_route.json`, { force: true });
});

// Route polyline lives in the `photo-route` MapLibre source, rendered by the
// `photo-route-line` layer. Clicking the Route button on `<filter-panel>`
// toggles `viewState.routeVisible`: on-flip the source picks up features
// built from filtered photos (or loaded from disk if a saved route exists);
// off-flip flips the layer's visibility property to "none".
//
// Edit mode populates a separate `route-edit-points` source — one feature
// per photo + waypoint — driven by `<map-route>`'s edit module.

async function selectAlbum(page: Page, album: string): Promise<void> {
  await page
    .locator('filter-panel >> .panel-body select')
    .nth(1)
    .selectOption(album);
}

async function clickViewBtn(page: Page, label: string): Promise<void> {
  await page
    .locator('filter-panel >> button.view-btn')
    .filter({ hasText: label })
    .click();
}

async function canvasBox(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page
    .locator('map-view >> canvas.maplibregl-canvas')
    .boundingBox();
  if (box === null) throw new Error('canvas not laid out');
  return box;
}

test('Toggle photo route on the map', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );
  await expect(page.locator('map-fit')).toBeAttached();

  // Filter to Tampere → enables the Route button.
  await selectAlbum(page, 'Tampere');

  const routeBtn = page
    .locator('filter-panel >> button.view-btn')
    .filter({ hasText: 'Route' });
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
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );
  await selectAlbum(page, 'Tampere');
  await clickViewBtn(page, 'Route');
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);

  // Enter edit mode → the edit-points source is populated.
  await clickViewBtn(page, 'Edit');
  await expect(
    page.locator('filter-panel >> button.view-btn').filter({ hasText: 'Edit' })
  ).toHaveClass(/active/);
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBeGreaterThanOrEqual(2);
  const before = await sourceFeatureCount(page, 'route-edit-points');

  // A click on the canvas adds a waypoint at the nearest segment, so the
  // edit-points source grows by exactly one feature.
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(() => sourceFeatureCount(page, 'route-edit-points'))
    .toBe(before + 1);
});

test('Route edits persist across a page reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );
  await selectAlbum(page, 'Tampere');
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
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
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
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );
  await selectAlbum(page, 'Tampere');
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
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
