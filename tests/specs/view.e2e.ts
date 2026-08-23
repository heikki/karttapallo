import { expect, test } from './_fixtures';
import { cameraSettled, mapCenter } from './_helpers';

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
  await cameraSettled(page);
  const center = await mapCenter(page);

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

test('Clicking the map hides the card', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  await expect(page.getByRole('status', { name: 'Photo stats' })).toHaveText(
    '3 photos'
  );
  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  // Absolute mouse coordinates rather than locator.click(), which MapLibre's
  // canvas handles more reliably. The left edge is bare map: the filter panel
  // sits top right, and the fixture's three photos share a narrow band of
  // longitude in the middle.
  const box = await page
    .locator('map-view >> canvas.maplibregl-canvas')
    .boundingBox();
  if (box === null) throw new Error('canvas not laid out');
  const bareX = box.x + 60;
  const bareY = box.y + box.height / 2;

  // Panning is not clicking: the card you drag the map under stays up.
  await page.mouse.move(bareX, bareY);
  await page.mouse.down();
  await page.mouse.move(bareX + 120, bareY, { steps: 8 });
  await page.mouse.up();
  await expect(popup).toBeVisible();

  // A click on bare map is Escape's bottom rung by mouse — the card hides,
  // the selection stands, and clicking again brings it back.
  await page.mouse.click(bareX, bareY);
  await expect(popup).toHaveCount(0);
  await expect(page).toHaveURL(/id=e2e-1/);

  await page.mouse.click(bareX, bareY);
  await expect(popup).toBeVisible();

  // The two rungs are the same one: Escape hides what the click revealed.
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await page.mouse.click(bareX, bareY);
  await expect(popup).toBeVisible();
});
