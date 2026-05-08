import { expect, test } from '@playwright/test';

// Fixture (sorted by date, +03:00):
//   e2e-2 — 2023:08:15 (oldest)
//   e2e-1 — 2024:06:01
//   e2e-3 — 2024:09:20 (newest)

test('Find a specific photo on the map', async ({ page }) => {
  // Land on a known photo via URL — clicking a MapLibre marker is a canvas /
  // WebGL hit-test that's flaky in headless WebKit.
  await page.goto('/?id=e2e-1');

  // Filter panel reflects the seeded count: app booted, /api/items resolved.
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );

  // Popup mounts at the URL-selected photo with a real <img> served by the
  // fake PhotosLibrary (the fixture JPEG).
  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  const popupImg = popup.locator('.popup-image-wrap img');
  await expect(popupImg).toBeVisible();
  await expect
    .poll(() => popupImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // ArrowRight steps to the next photo by date sort (e2e-3).
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);

  // Click the popup image → full-size lightbox opens.
  await popupImg.click();
  const lightbox = page.locator('photo-lightbox[active]');
  await expect(lightbox).toBeVisible();

  const lightboxImg = lightbox.locator('img');
  await expect(lightboxImg).toBeVisible();
  await expect
    .poll(() => lightboxImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // Escape closes the lightbox; popup remains open underneath.
  await page.keyboard.press('Escape');
  await expect(page.locator('photo-lightbox[active]')).toHaveCount(0);
  await expect(popup).toBeVisible();

  // Escape again dismisses the popup itself.
  await page.keyboard.press('Escape');
  await expect(page.locator('photo-popup')).toHaveCount(0);
});
