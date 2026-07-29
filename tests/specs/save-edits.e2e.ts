import { expect, test } from '@playwright/test';

// tests/server.ts injects a no-op PhotosWriter so /api/save-edits round-trips
// without touching Photos.app. The client-visible flow is:
// pending → Save → reload → pending section gone.

test('Save edits', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  // Create a pending time edit (cheaper than placement: no canvas click).
  await popup
    .locator('.action-buttons')
    .first()
    .locator('button.action-btn')
    .filter({ hasText: 'edit' })
    .click();
  await popup.locator('button.action-btn').filter({ hasText: '+1h' }).click();

  const editSection = page.locator('filter-panel >> .edit-section');
  await expect(editSection).toBeVisible();
  await expect(editSection.locator('.count')).toHaveText('1');

  // Click Save → server returns { ok: true }, client clears edits.
  await editSection
    .locator('button')
    .filter({ hasText: /Save to Photos|Saving/ })
    .click();

  // Section disappears once edits.clear() runs after the successful POST.
  await expect(page.locator('filter-panel >> .edit-section')).toHaveCount(0);

  // The popup stayed open across the save; its date edit row must not, since
  // the edit it was showing has been flushed.
  await expect(popup).toBeVisible();
  await expect(popup.locator('.date-edit-row')).toHaveCount(0);
});
