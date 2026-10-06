/**
 * Get help — the Help panel: opened and closed from the `?` in the filter
 * panel's header, volunteered once on a first run, and out of the keyboard's
 * way while it is up.
 */

import { expect, test } from './_fixtures';
import { cameraSettled } from './_helpers';

test('Get help', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  // Not a first run, so nothing is volunteered.
  const panel = page.locator('help-panel .content');
  await expect(panel).toHaveCount(0);

  const button = page
    .locator('filter-panel')
    .getByRole('button', { name: 'Help' });
  await button.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('h3')).toHaveText([
    'Keyboard',
    'Mouse and trackpad',
    'Marker colours'
  ]);

  // The button sits in the header that collapses the filter panel, and must
  // not collapse it.
  await expect(page.locator('filter-panel >> .panel-body')).toBeVisible();

  // Keys go straight through, so what the panel says can be tried while it is
  // up: Space opens the lightbox and closes it again, Escape hides the card.
  const lightbox = page.locator('photo-lightbox[active]');
  await page.keyboard.press('Space');
  await expect(lightbox).toBeVisible();
  await page.keyboard.press('Space');
  await expect(lightbox).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(panel).toBeVisible();

  // Either the X or the button that opened it closes it.
  await panel.locator('.close').click();
  await expect(panel).toHaveCount(0);
  await button.click();
  await expect(panel).toBeVisible();
  await button.click();
  await expect(panel).toHaveCount(0);
});

test('Opening help moves the map so the photo card stays clear', async ({
  page
}) => {
  // Zoomed in on the photo, where the card opens mid-window — under where the
  // panel is about to be. The default opening view is the whole globe, which
  // has nowhere to pan to.
  await page.goto('/?id=e2e-1&lat=60.17&lon=24.94&z=10');
  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();
  await cameraSettled(page);

  await page
    .locator('filter-panel')
    .getByRole('button', { name: 'Help' })
    .click();
  const panel = page.locator('help-panel .content');
  await expect(panel).toBeVisible();

  await expect
    .poll(async () => {
      const [card, help] = await Promise.all([
        popup.boundingBox(),
        panel.boundingBox()
      ]);
      return card!.x + card!.width <= help!.x;
    })
    .toBe(true);
});

test('The ? stays reachable while the filter panel is collapsed', async ({
  page
}) => {
  await page.goto('/?id=e2e-1');
  await expect(page.locator('photo-popup')).toBeVisible();

  await page.locator('filter-panel >> .panel-header h2').click();
  await expect(page.locator('filter-panel >> .panel-body')).toHaveCount(0);

  await page
    .locator('filter-panel')
    .getByRole('button', { name: 'Help' })
    .click();
  await expect(page.locator('help-panel .content')).toBeVisible();
  await expect(page.locator('filter-panel >> .panel-body')).toHaveCount(0);
});

test('Help opens by itself on a first run, and survives a reload', async ({
  page
}) => {
  // The test server starts with the first run already used up; answer as a
  // fresh install would, once.
  let asked = 0;
  await page.route('**/api/first-run', async (route) => {
    asked += 1;
    await route.fulfill({ json: { firstRun: asked === 1 } });
  });

  await page.goto('/?id=e2e-1');
  const panel = page.locator('help-panel .content');
  await expect(panel).toBeVisible();

  // The desktop app reloads its webview seconds into a first launch, when the
  // startup rebuild lands. The panel the user is reading has to still be there.
  await page.reload();
  await expect(panel).toBeVisible();

  // Closed stays closed across the same reload.
  await panel.locator('.close').click();
  await page.reload();
  await expect(page.locator('photo-popup')).toBeVisible();
  await expect(panel).toHaveCount(0);
});
