import { expect, test, type Locator } from '@playwright/test';

// Popup renders the date row first (`.action-buttons.first()`) and the
// location row second; this matches `_renderDateLine()` then
// `_renderLocationLine()` in photo-popup/index.ts.
function dateActions(popup: Locator): Locator {
  return popup.locator('.action-buttons').first();
}

test("Adjust a photo's date and copy/paste between photos", async ({
  page
}) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  // 1) Enter edit mode → click +1h → date is offset, pending count = 1.
  await dateActions(popup)
    .locator('button.action-btn')
    .filter({ hasText: 'edit' })
    .click();
  await popup.locator('button.action-btn').filter({ hasText: '+1h' }).click();

  const editSection = page.locator('filter-panel >> .edit-section');
  await expect(editSection).toBeVisible();
  await expect(editSection.locator('.count')).toHaveText('1');

  // 2) Done → exit edit mode → copy the (now-offset) date.
  await dateActions(popup)
    .locator('button.action-btn')
    .filter({ hasText: 'done' })
    .click();
  await dateActions(popup)
    .locator('button.action-btn')
    .filter({ hasText: 'copy' })
    .click();

  // 3) Arrow-navigate to e2e-3 (next by date) and paste the copied date.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);
  await dateActions(popup)
    .locator('button.action-btn')
    .filter({ hasText: 'paste' })
    .click();

  // Pending count is now 2 (offset on e2e-1 + paste on e2e-3).
  await expect(editSection.locator('.count')).toHaveText('2');

  // 4) Discard wipes both pending edits.
  await page
    .locator('filter-panel >> .edit-section button.secondary')
    .filter({ hasText: 'Discard' })
    .click();
  await expect(page.locator('filter-panel >> .edit-section')).toHaveCount(0);
});
