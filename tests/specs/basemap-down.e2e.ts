import type { Route } from '@playwright/test';

import { expect, test } from './_fixtures';
import { sourceFeatureCount } from './_helpers';

// A basemap host that is down doesn't refuse the request, it sits on it —
// which is what a CI runner without outbound network looks like, and what a
// laptop on a captive-network hotel wifi looks like. MapLibre's `load` event
// waits for the first frame to be drawn, tiles included, so anything mounted
// on `load` never mounts at all. Everything but the imagery is local: the
// photos, their markers, the card, the panels. Hold the tiles and none of it
// should notice.

test('The app works while the basemap is unreachable', async ({ page }) => {
  // Held rather than aborted: an aborted tile is an answer, and MapLibre
  // gives up on it and draws the frame. These are released at the end so the
  // page can close without a route handler still in flight.
  const held: Route[] = [];
  await page.route(/mt\d\.google\.com/, (route) => {
    held.push(route);
  });

  await page.goto('/?id=e2e-1');

  // The whole app is there: photos loaded, markers drawn, card open on the
  // photo the URL names.
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );
  await expect(page.locator('photo-popup')).toBeVisible();
  await expect.poll(() => sourceFeatureCount(page, 'classic-source')).toBe(3);

  // And it still takes input — arrow keys walk the library.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);

  await Promise.all(
    held.map(async (route) => {
      await route.abort();
    })
  );
});
