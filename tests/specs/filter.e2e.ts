import { expect, test } from './_fixtures';

// Fixture:
//   e2e-1 — 2024, Helsinki, iPhone
//   e2e-2 — 2023, Tampere,  Sony
//   e2e-3 — 2024, Tampere,  iPhone
//
// Helsinki exists only in 2024 — used to exercise the cascade fallback
// when the user pivots year while album is set.

test('Filter by year and album', async ({ page }) => {
  await page.goto('/');

  const yearSelect = page.getByLabel('Year');
  const albumSelect = page.getByLabel('Album');
  const cameraSelect = page.getByLabel('Camera');

  // Drill: year=2024 + album=Helsinki.
  await yearSelect.selectOption('2024');
  await albumSelect.selectOption('Helsinki');

  // Cascade narrows cameras to iPhone alone (Helsinki has no Sony shots).
  await expect(cameraSelect.locator('option')).toHaveCount(2);

  // URL captures both filters once the 100ms debounce flushes.
  await expect(page).toHaveURL(/year=2024/);
  await expect(page).toHaveURL(/album=Helsinki/);

  // Reload — filters survive via the URL codec.
  await page.reload();
  await expect(page.getByLabel('Year')).toHaveValue('2024');
  await expect(page.getByLabel('Album')).toHaveValue('Helsinki');

  // Pivot year=2023. Helsinki doesn't exist that year, so the cascade falls
  // album back to 'all' rather than orphaning the filter.
  await page.getByLabel('Year').selectOption('2023');
  await expect(page.getByLabel('Album')).toHaveValue('all');

  // URL drops the album param (writeFiltersToUrl omits defaults).
  await expect(page).toHaveURL(/year=2023/);
  await expect(page).not.toHaveURL(/album=/);

  // Reset wipes every filter and clears the URL.
  await page.getByRole('button', { name: 'Reset' }).click();

  await expect(page.getByLabel('Year')).toHaveValue('all');
  await expect(page.getByLabel('Album')).toHaveValue('all');
  await expect(page.getByLabel('Camera')).toHaveValue('all');
  await expect(page).not.toHaveURL(/year=/);
  await expect(page).not.toHaveURL(/album=/);
});
