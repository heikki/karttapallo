import { expect, test } from './_fixtures';

test("Adjust a photo's date and copy/paste between photos", async ({
  page
}) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  const dateActions = popup.getByRole('group', { name: 'Date actions' });
  const editRegion = page.getByRole('region', { name: 'Pending edits' });
  const editCount = editRegion.getByLabel('Pending edit count');

  // 1) Enter edit mode → click +1h → date is offset, pending count = 1.
  await dateActions.getByRole('button', { name: 'edit' }).click();
  await dateActions.getByRole('button', { name: '+1h' }).click();

  await expect(editRegion).toBeVisible();
  await expect(editCount).toHaveText('1');

  // 2) Done → exit edit mode → copy the (now-offset) date.
  await dateActions.getByRole('button', { name: 'done' }).click();
  await dateActions.getByRole('button', { name: 'copy' }).click();

  // 3) Arrow-navigate to e2e-3 (next by date) and paste the copied date.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);
  await dateActions.getByRole('button', { name: 'paste' }).click();

  // Pending count is now 2 (offset on e2e-1 + paste on e2e-3).
  await expect(editCount).toHaveText('2');

  // 4) Discard wipes both pending edits.
  await editRegion.getByRole('button', { name: 'Discard' }).click();
  await expect(editRegion).toHaveCount(0);
});
