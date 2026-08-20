import { expect, test } from '@playwright/test';

import { mapCenter } from './_helpers';

// Fixture (sorted by date, +03:00):
//   e2e-2 — 2023:08:15 (oldest)
//   e2e-1 — 2024:06:01
//   e2e-3 — 2024:09:20 (newest)

test('Find a specific photo on the map', async ({ page }) => {
  // Land on a known photo via URL — clicking a MapLibre marker is a canvas /
  // WebGL hit-test that's flaky in headless WebKit.
  await page.goto('/?id=e2e-1');

  // Filter panel reflects the seeded count: app booted, /api/items resolved.
  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
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

  // The lightbox has no cursor of its own: an arrow key steps the selection,
  // and the lightbox follows it, so one press moves one photo.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-2/);
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/id=e2e-3/);

  // Cmd+F stands down while the lightbox is up: the search box is behind it,
  // so focusing it would swallow the Escape that closes the lightbox.
  await page.keyboard.press('Meta+f');
  await expect(
    page.getByRole('combobox', { name: 'Search' })
  ).not.toBeFocused();

  // Escape closes the lightbox; popup remains open underneath.
  await page.keyboard.press('Escape');
  await expect(page.locator('photo-lightbox[active]')).toHaveCount(0);
  await expect(popup).toBeVisible();

  // Let the camera settle after the earlier flights, so "hiding didn't move
  // the map" is a claim about Escape and not about an animation still easing.
  // Compared by distance, not equality: a fly eases asymptotically, so two
  // consecutive reads can agree to the last digit and still creep afterwards.
  let center = await mapCenter(page);
  await expect
    .poll(async () => {
      const now = await mapCenter(page);
      const settled =
        Math.abs((now?.lat ?? 0) - (center?.lat ?? 0)) < 1e-5 &&
        Math.abs((now?.lon ?? 0) - (center?.lon ?? 0)) < 1e-5;
      center = now;
      return settled;
    })
    .toBe(true);

  // A second Escape hides the popup so you can see the map it was covering.
  // The selection outlives it — the URL still names the photo — and the
  // camera holds still, or the view you wanted would slide away with the card.
  // A real fit-pan moves hundreds of metres; 4 decimals is metres.
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(page).toHaveURL(/id=e2e-3/);
  const after = await mapCenter(page);
  expect(after?.lat).toBeCloseTo(center?.lat ?? 0, 4);
  expect(after?.lon).toBeCloseTo(center?.lon ?? 0, 4);

  // Escape again brings it back.
  await page.keyboard.press('Escape');
  await expect(popup).toBeVisible();

  // So does Space, which steps one rung toward the photo rather than past it:
  // from a hidden card it brings the card back, and only from there does it
  // go full-screen.
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(popup).toBeVisible();
  await expect(page.locator('photo-lightbox[active]')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.locator('photo-lightbox[active]')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('photo-lightbox[active]')).toHaveCount(0);
  await expect(popup).toBeVisible();

  // So does moving the selection: hiding is a peek at the photo you're on,
  // not a mode you browse in.
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-2/);
  await expect(popup).toBeVisible();
});
