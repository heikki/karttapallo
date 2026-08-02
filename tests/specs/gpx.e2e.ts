import { expect, test } from '@playwright/test';

import { sourceFeatureCount } from './_helpers';

// Tampere is seeded with a small GPX track (tests/fixtures/track.gpx). When
// the user picks the album, `<map-gpx>` fetches /api/albums/Tampere/files,
// then the GPX file itself, parses tracks + waypoints, and pushes them into
// the `gpx-tracks` / `gpx-waypoints` MapLibre sources.

test('View GPX tracks for an album', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );
  await expect(page.locator('map-fit')).toBeAttached();

  // Selecting Tampere triggers the GPX fetch.
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/api/albums/Tampere/files/track.gpx') && r.ok()
  );
  await page.getByLabel('Album').selectOption('Tampere');
  await responsePromise;

  // Waypoints land in `gpx-waypoints`, tracks in `gpx-tracks`.
  await expect.poll(() => sourceFeatureCount(page, 'gpx-waypoints')).toBe(2);
  await expect.poll(() => sourceFeatureCount(page, 'gpx-tracks')).toBe(1);
});
