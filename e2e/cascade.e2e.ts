import { expect, test } from '@playwright/test';

// Fixture (e2e/server.ts):
//   e2e-1 — 2024, Helsinki, iPhone
//   e2e-2 — 2023, Tampere,  Sony
//   e2e-3 — 2024, Tampere,  iPhone

test('changing year narrows album and camera options', async ({ page }) => {
  await page.goto('/');

  const selects = page.locator('filter-panel >> .panel-body select');
  await expect(selects).toHaveCount(3);

  const [yearSelect, albumSelect, cameraSelect] = [
    selects.nth(0),
    selects.nth(1),
    selects.nth(2)
  ];

  // year=all: 2 albums, 2 cameras (each + the "All" option).
  await expect(albumSelect.locator('option')).toHaveCount(3);
  await expect(cameraSelect.locator('option')).toHaveCount(3);

  // 2024 has both albums but only iPhone.
  await yearSelect.selectOption('2024');
  await expect(albumSelect.locator('option')).toHaveCount(3);
  await expect(cameraSelect.locator('option')).toHaveCount(2);

  // 2023 has only Tampere + Sony.
  await yearSelect.selectOption('2023');
  await expect(albumSelect.locator('option')).toHaveCount(2);
  await expect(cameraSelect.locator('option')).toHaveCount(2);

  // year=all restores the full set.
  await yearSelect.selectOption('all');
  await expect(albumSelect.locator('option')).toHaveCount(3);
  await expect(cameraSelect.locator('option')).toHaveCount(3);
});

test('changing album narrows camera options', async ({ page }) => {
  await page.goto('/');

  const selects = page.locator('filter-panel >> .panel-body select');
  await expect(selects).toHaveCount(3);
  const albumSelect = selects.nth(1);
  const cameraSelect = selects.nth(2);

  // Helsinki has only iPhone.
  await albumSelect.selectOption('Helsinki');
  await expect(cameraSelect.locator('option')).toHaveCount(2);

  // Tampere has both iPhone (e2e-3) and Sony (e2e-2).
  await albumSelect.selectOption('Tampere');
  await expect(cameraSelect.locator('option')).toHaveCount(3);
});
