import { expect, test } from './_fixtures';

// Tampere is seeded with track.gpx by tests/server.ts. The Files button on
// `<album-controls>` is disabled until an album is picked.

test('Manage album files', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );

  // Filter to Tampere → Files button enables.
  await page.getByLabel('Album').selectOption('Tampere');

  const filesBtn = page.getByRole('button', { name: 'Files' });
  await expect(filesBtn).toBeEnabled();

  // Open modal → row for track.gpx.
  await filesBtn.click();
  const modal = page.locator('files-modal[active]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.header')).toContainText('Tampere');

  const fileRow = modal.locator('.file-row');
  await expect(fileRow).toHaveCount(1);
  await expect(fileRow.locator('.file-name')).toHaveText('track.gpx');

  // Toggle visibility → file-name picks up the .hidden class.
  await fileRow.locator('button.vis-btn').click();
  await expect(fileRow.locator('.file-name')).toHaveClass(/hidden/);

  // Toggle back → .hidden is removed.
  await fileRow.locator('button.vis-btn').click();
  await expect(fileRow.locator('.file-name')).not.toHaveClass(/hidden/);

  // Close modal via the × button.
  await modal.locator('.close').click();
  await expect(page.locator('files-modal[active]')).toHaveCount(0);
});
