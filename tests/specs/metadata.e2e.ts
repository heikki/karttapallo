import { expect, test } from '@playwright/test';

test('View photo metadata', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  // Click the info button overlay on the popup image.
  await popup.locator('.overlay-btn.info-btn').click();

  // Modal becomes active and renders rows from the fake getMetadata payload.
  const modal = page.locator('metadata-modal[active]');
  await expect(modal).toBeVisible();

  // Rows render in METADATA_FIELDS order; assert the labels we seeded.
  const body = modal.locator('.body');
  await expect(body.getByText('Filename', { exact: true })).toBeVisible();
  await expect(body.getByText('e2e-1.jpg', { exact: true })).toBeVisible();
  await expect(body.getByText('Camera', { exact: true })).toBeVisible();
  await expect(body.getByText('iPhone', { exact: true })).toBeVisible();

  // Escape closes the modal; the popup remains open underneath.
  await page.keyboard.press('Escape');
  await expect(page.locator('metadata-modal[active]')).toHaveCount(0);
  await expect(popup).toBeVisible();
});
