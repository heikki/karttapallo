import { expect, test } from './_fixtures';

// Fixture (sorted by date, +03:00):
//   e2e-2 — 2023:08:15 (oldest)
//   e2e-1 — 2024:06:01
//   e2e-3 — 2024:09:20 (newest)
//
// All three start at the same coords (60.17, 24.94) — the seed gives every
// item a real location, so popup location rows always render the copy/set
// buttons.

test("Set a photo's location", async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  const locationActions = popup.getByRole('group', {
    name: 'Location actions'
  });
  const editRegion = page.getByRole('region', { name: 'Pending edits' });
  const editCount = editRegion.getByLabel('Pending edit count');

  // 1) Set: click "set" → popup closes, crosshair mode → click map → pending edit.
  await locationActions.getByRole('button', { name: 'set' }).click();
  await expect(popup).toHaveCount(0);

  await page
    .locator('map-view >> canvas.maplibregl-canvas')
    .click({ position: { x: 250, y: 250 } });

  await expect(editRegion).toBeVisible();
  await expect(editCount).toHaveText('1');
  await expect(popup).toBeVisible();

  // 2) Arrow-navigate to e2e-3 (next by date) and copy its location.
  // Using arrow keys (not page.goto) so the in-memory `copiedLocation`
  // signal survives the photo change — a real user behavior.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);
  await locationActions.getByRole('button', { name: 'copy' }).click();

  // 3) Navigate back across e2e-1 to e2e-2 (oldest), then paste.
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/id=e2e-1/);
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/id=e2e-2/);

  await locationActions.getByRole('button', { name: 'paste' }).click();

  // Pending count is now 2 (set on e2e-1 + paste on e2e-2).
  await expect(editCount).toHaveText('2');

  // 4) Discard wipes both pending edits; the edit section disappears.
  await editRegion.getByRole('button', { name: 'Discard' }).click();
  await expect(editRegion).toHaveCount(0);
});
