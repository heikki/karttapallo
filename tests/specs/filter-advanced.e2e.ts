import { expect, test } from '@playwright/test';

// Fixture has 3 photos, all gps='exif', no videos. Toggling Photos off, or
// soloing Videos, drops the visible count to zero — surfaced in the panel
// header as "No results" instead of "N photos".

test('Filter by media type and location precision', async ({ page }) => {
  await page.goto('/');

  const stats = page.locator('filter-panel >> .panel-header p');
  await expect(stats).toHaveText('3 photos');

  const photosBtn = page
    .locator('filter-panel >> button.filter-btn')
    .filter({ hasText: 'Photos' });
  const videosBtn = page
    .locator('filter-panel >> button.filter-btn')
    .filter({ hasText: 'Videos' });
  const exifBtn = page
    .locator('filter-panel >> button.filter-btn')
    .filter({ hasText: 'Exif' });
  const noneBtn = page
    .locator('filter-panel >> button.filter-btn')
    .filter({ hasText: 'None' });

  // Single-click "Photos" toggles photos off → no items left.
  // Click handler debounces 250ms before firing the toggle (see
  // _onMediaClick in filter-panel/index.ts).
  await photosBtn.click();
  await expect(stats).toHaveText('No results');
  await expect(photosBtn).not.toHaveClass(/active/);

  // Click again restores photos.
  await photosBtn.click();
  await expect(stats).toHaveText('3 photos');

  // Double-click "Videos" solos videos → photos hidden, no videos in fixture.
  await videosBtn.dblclick();
  await expect(stats).toHaveText('No results');
  await expect(photosBtn).not.toHaveClass(/active/);
  await expect(videosBtn).toHaveClass(/active/);

  // Double-clicking the soloed value restores the default media set.
  await videosBtn.dblclick();
  await expect(stats).toHaveText('3 photos');

  // Single-click "Exif" toggles it off → all fixture items are gps='exif',
  // so the count drops to zero.
  await exifBtn.click();
  await expect(stats).toHaveText('No results');

  // Click again restores it.
  await exifBtn.click();
  await expect(stats).toHaveText('3 photos');

  // Double-click "None" solos the (default-off) None bucket → no items
  // have gps='none', so count drops to zero.
  await noneBtn.dblclick();
  await expect(stats).toHaveText('No results');

  // Double-click again restores defaults (Exif/Inferred/User on, None off).
  await noneBtn.dblclick();
  await expect(stats).toHaveText('3 photos');
});
