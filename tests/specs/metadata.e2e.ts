import { setTimeout as sleep } from 'node:timers/promises';
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

  // Place and Categories come from the client's photo record rather than the
  // metadata payload, which knows nothing about either — the fake getMetadata
  // above never mentions Kuhmo.
  await expect(body.getByText('Place', { exact: true })).toBeVisible();
  await expect(body.getByText('Kuhmo', { exact: true })).toBeVisible();

  // Rows are grouped by where the value came from. The fixture carries nothing
  // from the Location group, so that heading stays away rather than standing
  // over an empty run.
  await expect(body.locator('tr.section td')).toHaveText([
    'Photos',
    'File',
    'Capture'
  ]);

  // Escape closes the modal; the popup remains open underneath.
  await page.keyboard.press('Escape');
  await expect(page.locator('metadata-modal[active]')).toHaveCount(0);
  await expect(popup).toBeVisible();
});

test('Clicking an album name filters the map to it', async ({ page }) => {
  // e2e-3 is in Tampere, alongside e2e-2; e2e-1 is the lone Helsinki photo.
  await page.goto('/?id=e2e-3');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const body = page.locator('metadata-modal[active] .body');
  await body.getByRole('button', { name: 'Tampere' }).click();

  await expect(page.getByLabel('Album')).toHaveValue('Tampere');
  await expect(page.getByLabel('Photo stats')).toHaveText('2 photos');
  await expect(page).toHaveURL(/album=Tampere/);

  // The photo is in the album it just filtered to, so it stays selected and
  // the panel stays open on it rather than closing under the click.
  await expect(popup).toBeVisible();
  await expect(body.getByText('e2e-3.jpg', { exact: true })).toBeVisible();
});

test('Every scene label shows, wrapped rather than scrolled', async ({
  page
}) => {
  await page.goto('/?id=e2e-3');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const body = page.locator('metadata-modal[active] .body');
  await expect(body.getByText('Categories', { exact: true })).toBeVisible();

  // All twelve, first to last — the row is not truncated to fit. Scoped to its
  // own row: Albums wraps too, so `td.wrap` alone matches both.
  const value = body
    .locator('tr')
    .filter({ hasText: 'Categories' })
    .locator('td.wrap');
  await expect(value).toContainText('Lintu');
  await expect(value).toContainText('Silta');

  // It wraps: the row runs to more than the one line every other row takes.
  const wrapped = await value.boundingBox();
  const oneLine = await body
    .getByText('e2e-3.jpg', { exact: true })
    .boundingBox();
  if (wrapped === null || oneLine === null) throw new Error('no layout');
  expect(wrapped.height).toBeGreaterThan(oneLine.height);

  // And it wraps instead of dragging every other row sideways with it.
  const overflow = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Deselecting the photo takes its metadata away', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const modal = page.locator('metadata-modal[active]');
  await expect(modal).toBeVisible();

  // Click empty map, well clear of the panel. That the popup closes at all
  // proves the click reached the canvas instead of being swallowed — the panel
  // no longer blocks the map — and the panel must go with it rather than
  // describing a photo that is no longer selected.
  const box = await modal.locator('.content').boundingBox();
  if (box === null) throw new Error('panel not laid out');
  await page.mouse.click(box.x + 60, box.y + box.height + 120);

  await expect(popup).toHaveCount(0);
  await expect(modal).toHaveCount(0);
});

test('A filter that excludes the photo takes its metadata away', async ({
  page
}) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();
  const modal = page.locator('metadata-modal[active]');
  await expect(modal).toBeVisible();

  // e2e-1 is the only Helsinki photo; switching to Tampere drops it from the
  // filtered set, which clears the selection underneath the panel.
  await page.getByLabel('Album').selectOption('Tampere');

  await expect(popup).toHaveCount(0);
  await expect(modal).toHaveCount(0);
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

test('The metadata panel holds its height while the next photo loads', async ({
  page
}) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const content = page.locator('metadata-modal[active] .content');
  const body = content.locator('.body');
  await expect(body.getByText('e2e-1.jpg', { exact: true })).toBeVisible();
  const before = await content.boundingBox();
  if (before === null) throw new Error('panel not laid out');

  // Stall the next read long enough to observe the in-flight state, which a
  // local metadata read is far too quick for.
  await page.route('**/api/metadata/e2e-3', async (route) => {
    await sleep(800);
    await route.continue();
  });

  await page.keyboard.press('ArrowRight');
  await expect(body.getByText('Loading...')).toBeVisible();

  // Same height as the table it replaced, header included.
  const during = await content.boundingBox();
  if (during === null) throw new Error('panel vanished while loading');
  expect(during.height).toBeCloseTo(before.height, 0);

  // Then the new table lands and the panel sizes to it.
  await expect(body.getByText('Wide', { exact: true })).toBeVisible();
  const after = await content.boundingBox();
  if (after === null) throw new Error('panel vanished after loading');
  expect(after.height).toBeGreaterThan(before.height);
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

  // Drag-select the value, overshooting the panel on the way out: the
  // selection must survive leaving the box, and so must the panel.
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

  // Down and to the right: the panel parks at the top-left corner, so there is
  // only the 10px inset of room above it.
  const grabX = grab.x + grab.width / 2;
  const grabY = grab.y + grab.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 120, grabY + 80, { steps: 8 });
  await page.mouse.up();

  const after = await content.boundingBox();
  if (after === null) throw new Error('modal vanished mid-drag');
  expect(after.x - before.x).toBeCloseTo(120, 0);
  expect(after.y - before.y).toBeCloseTo(80, 0);
  // Releasing the drag outside the box doesn't dismiss the panel.
  await expect(content).toBeVisible();

  // Dragging far past the top edge stops at it instead of leaving the viewport.
  await page.mouse.move(grabX + 120, grabY + 80);
  await page.mouse.down();
  await page.mouse.move(grabX + 120, grabY - 400, { steps: 8 });
  await page.mouse.up();
  const clamped = await content.boundingBox();
  if (clamped === null) throw new Error('modal vanished mid-drag');
  expect(clamped.y).toBeCloseTo(0, 0);

  // The moved modal still tracks arrow-key navigation.
  await page.keyboard.press('ArrowRight');
  await expect(
    content.locator('.body').getByText('e2e-3.jpg', { exact: true })
  ).toBeVisible();

  // Closing forgets where it was dragged: the next open is back in the corner.
  await page.keyboard.press('Escape');
  await expect(page.locator('metadata-modal[active]')).toHaveCount(0);
  await popup.locator('.overlay-btn.info-btn').click();
  const reopened = await content.boundingBox();
  if (reopened === null) throw new Error('modal did not reopen');
  expect(reopened.x).toBeCloseTo(before.x, 0);
  expect(reopened.y).toBeCloseTo(before.y, 0);
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

  // Same from the lightbox, which Space opens without dismissing the modal.
  await page.keyboard.press('Space');
  await expect(page.locator('photo-lightbox[active]')).toBeVisible();
  await expect(body.getByText('e2e-3.jpg', { exact: true })).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(body.getByText('e2e-1.jpg', { exact: true })).toBeVisible();
});

test('Toggle the lightbox with Space while the modal is open', async ({
  page
}) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.overlay-btn.info-btn').click();

  const modal = page.locator('metadata-modal[active]');
  const lightbox = page.locator('photo-lightbox[active]');
  await expect(modal).toBeVisible();
  await expect(lightbox).toHaveCount(0);

  // Space in: the lightbox opens underneath the modal, which stays put.
  await page.keyboard.press('Space');
  await expect(lightbox).toBeVisible();
  await expect(modal).toBeVisible();

  // Space out: the lightbox closes, the modal is still there on the same photo.
  await page.keyboard.press('Space');
  await expect(lightbox).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(
    modal.locator('.body').getByText('e2e-1.jpg', { exact: true })
  ).toBeVisible();

  // Escape still closes the modal rather than leaking through to the popup.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(popup).toBeVisible();
});
