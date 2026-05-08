import { expect, test } from '@playwright/test';

// URL keys (see src/client/common/view-state.ts):
//   mapStyle    → ?style=…    (omitted when default 'satellite')
//   markerStyle → ?markers=…  (omitted when default 'classic')

test('Switch map and marker styles', async ({ page }) => {
  await page.goto('/');

  const mapBtn = (label: string) =>
    page
      .locator('filter-panel >> button.map-type-btn')
      .filter({ hasText: label });

  // 1) Defaults: Aerial + Classic active, URL clean.
  await expect(mapBtn('Aerial')).toHaveClass(/active/);
  await expect(mapBtn('Classic')).toHaveClass(/active/);
  await expect(page).not.toHaveURL(/style=/);
  await expect(page).not.toHaveURL(/markers=/);

  // 2) Click Topo → URL gains ?style=topo, Aerial loses .active.
  await mapBtn('Topo').click();
  await expect(page).toHaveURL(/style=topo/);
  await expect(mapBtn('Topo')).toHaveClass(/active/);
  await expect(mapBtn('Aerial')).not.toHaveClass(/active/);

  // 3) Click Aerial → URL drops style param (encoder omits the default).
  await mapBtn('Aerial').click();
  await expect(page).not.toHaveURL(/style=/);
  await expect(mapBtn('Aerial')).toHaveClass(/active/);

  // 4) Click Points marker → URL gains ?markers=points.
  await mapBtn('Points').click();
  await expect(page).toHaveURL(/markers=points/);
  await expect(mapBtn('Points')).toHaveClass(/active/);
  await expect(mapBtn('Classic')).not.toHaveClass(/active/);

  // 5) Reload → marker style is restored from the URL.
  await page.reload();
  await expect(mapBtn('Points')).toHaveClass(/active/);

  // 6) Click Classic → URL drops markers param.
  await mapBtn('Classic').click();
  await expect(page).not.toHaveURL(/markers=/);
  await expect(mapBtn('Classic')).toHaveClass(/active/);
});
