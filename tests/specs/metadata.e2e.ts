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

test('The metadata modal stays put as the table grows', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const content = page.locator('metadata-modal[active] .content');
  const body = content.locator('.body');
  await expect(body.getByText('e2e-1.jpg', { exact: true })).toBeVisible();
  const before = await content.boundingBox();
  if (before === null) throw new Error('modal not laid out');

  // e2e-3's metadata has more rows, so the box gets taller — its top edge must
  // not move, or the modal walks around under the cursor while browsing.
  await page.keyboard.press('ArrowRight');
  await expect(body.getByText('Wide', { exact: true })).toBeVisible();
  const after = await content.boundingBox();
  if (after === null) throw new Error('modal vanished');

  expect(after.height).toBeGreaterThan(before.height);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test('Copy selected text out of the metadata modal', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const modal = page.locator('metadata-modal[active]');
  await expect(modal).toBeVisible();
  const cell = modal.locator('.body td', { hasText: '4032x3024' }).first();
  const box = await cell.boundingBox();
  if (box === null) throw new Error('metadata cell not laid out');

  // Drag-select the value, overshooting the modal on the way out — WebKit
  // fires a click on the host when a drag crosses out of the box, which must
  // not be read as a backdrop dismiss.
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(modal).toBeVisible();

  // Record what lands on the clipboard. WebKit dispatches `copy` with an empty
  // payload for shadow-DOM selections, so this asserts the modal filled it in.
  await page.evaluate(() => {
    const store = window as unknown as { __copied?: string | null };
    store.__copied = null;
    document.addEventListener('copy', (e: ClipboardEvent) => {
      store.__copied = e.clipboardData?.getData('text/plain') ?? '';
    });
  });
  await page.keyboard.press('Meta+c');
  await page.waitForFunction(
    () => (window as unknown as { __copied?: string | null }).__copied !== null
  );
  const copied = await page.evaluate(
    () => (window as unknown as { __copied?: string | null }).__copied
  );
  expect(copied).toContain('4032x3024');
});

test('Move the metadata modal by its header', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const content = page.locator('metadata-modal[active] .content');
  const header = content.locator('.header');
  const before = await content.boundingBox();
  const grab = await header.boundingBox();
  if (before === null || grab === null) throw new Error('modal not laid out');

  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grab.x + grab.width / 2 + 120,
    grab.y + grab.height / 2 - 60,
    { steps: 8 }
  );
  await page.mouse.up();

  const after = await content.boundingBox();
  if (after === null) throw new Error('modal vanished mid-drag');
  expect(after.x - before.x).toBeCloseTo(120, 0);
  expect(after.y - before.y).toBeCloseTo(-60, 0);
  // Releasing the drag is not a backdrop dismiss.
  await expect(content).toBeVisible();

  // The moved modal still tracks arrow-key navigation.
  await page.keyboard.press('ArrowRight');
  await expect(
    content.locator('.body').getByText('e2e-3.jpg', { exact: true })
  ).toBeVisible();
});

test('Browse photos with the metadata modal open', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const body = page.locator('metadata-modal[active] .body');
  await expect(body.getByText('e2e-1.jpg', { exact: true })).toBeVisible();

  // Arrow keys still cycle the selection underneath, and the modal follows.
  // The fake library names every file after its uuid, so the Filename row
  // tracks whichever photo the popup now shows.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);
  await expect(popup).toBeVisible();
  await expect(body.getByText('e2e-3.jpg', { exact: true })).toBeVisible();

  // Same from the lightbox: Space opens it over the modal-driving popup.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  const lightbox = page.locator('photo-lightbox[active]');
  await expect(lightbox).toBeVisible();
  await lightbox.locator('.overlay-btn.info-btn').click();
  await expect(body.getByText('e2e-3.jpg', { exact: true })).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(body.getByText('e2e-1.jpg', { exact: true })).toBeVisible();
});
