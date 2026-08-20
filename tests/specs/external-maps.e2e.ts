import { expect, test } from '@playwright/test';

// Apple/Google Maps buttons call `window.open(url, '_blank')` (see
// `MapView.openExternal` in src/client/components/map-view/index.ts). Stub
// `window.open` per page so we can capture the URL and assert against it.

test('Open in Apple Maps and Google Maps', async ({ page }) => {
  // 1) No selection → Apple/Google Maps URLs come from the current map
  // center + zoom. A selection is now automatic whenever anything is filtered
  // in (ADR-0016), so the only way to have none is to filter everything out —
  // every fixture item is gps='exif', so soloing "None" empties the map.
  await page.goto('/?gps=none');
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    'No results'
  );
  // Wait for the map to be loaded — `<map-fit>` only mounts after
  // `map.once('load')` fires, so its presence proves `<map-view>._map` is
  // set. Without this `MapView.openExternal` early-returns silently.
  await expect(page.locator('map-fit')).toBeAttached();
  // Override window.open after load so we don't race the page setting it,
  // and so we know the page (and therefore <map-view>'s _map) is ready.
  await page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });

  await page.getByRole('button', { name: 'Apple Maps' }).click();
  await page.getByRole('button', { name: 'Google Maps' }).click();

  let opened = await page.evaluate(
    () => (window as unknown as { __opened: string[] }).__opened
  );
  expect(opened).toHaveLength(2);
  expect(opened[0]).toMatch(/^maps:\/\/\?ll=[\d.-]+,[\d.-]+&z=\d+&t=k$/);
  expect(opened[1]).toMatch(
    /^https:\/\/www\.google\.com\/maps\/@[\d.-]+,[\d.-]+,\d+z$/
  );

  // 2) With a selected photo → URLs include that photo's coordinates.
  // e2e-1 seed: lat 60.17, lon 24.94.
  await page.goto('/?id=e2e-1');
  await expect(page.locator('photo-popup')).toBeVisible();
  // Re-install the stub: navigation reset the window.open override.
  await page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });

  await page.getByRole('button', { name: 'Apple Maps' }).click();
  await page.getByRole('button', { name: 'Google Maps' }).click();

  opened = await page.evaluate(
    () => (window as unknown as { __opened: string[] }).__opened
  );
  expect(opened).toHaveLength(2);
  expect(opened[0]).toContain('ll=60.17,24.94');
  expect(opened[0]).toContain('q=60.17,24.94');
  expect(opened[1]).toContain('?q=60.17,24.94');
});
