import { expect, test } from './_fixtures';

// Fixture has 3 photos, all gps='exif', no videos. Toggling Photos off, or
// soloing Videos, drops the visible count to zero — surfaced in the panel
// header as "No results" instead of "N photos".

test('Filter by media type and location precision', async ({ page }) => {
  await page.goto('/');

  const stats = page.getByRole('status', { name: 'Photo stats' });
  await expect(stats).toHaveText('3 photos');

  const photosBtn = page.getByRole('button', { name: 'Photos' });
  const videosBtn = page.getByRole('button', { name: 'Videos' });
  const exifBtn = page.getByRole('button', { name: 'Exif' });
  const noneBtn = page.getByRole('button', { name: 'None' });

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

test('Reset beats a toggle still inside its click delay', async ({ page }) => {
  await page.goto('/');

  const stats = page.getByRole('status', { name: 'Photo stats' });
  const photosBtn = page.getByRole('button', { name: 'Photos' });

  // Clicking Reset before the 250ms debounce elapses used to leave the toggle
  // queued: Reset cleared the filters, then the timer fired and hid the photos
  // again. Nothing is awaited between the two clicks, so Reset lands inside the
  // window the way an impatient user's would.
  await photosBtn.click();
  await page.getByRole('button', { name: 'Reset' }).click();

  // Waiting out the 250ms deadline is the assertion: a surviving timer would
  // fire in this window, and only after it can the count be called restored.
  await page.waitForTimeout(500);
  await expect(stats).toHaveText('3 photos');
  await expect(photosBtn).toHaveClass(/active/);
});
