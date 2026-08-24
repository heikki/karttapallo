import { expect, test } from './_fixtures';

// URL keys (see src/client/common/view-state.ts):
//   mapStyle → ?style=…  (omitted when default 'satellite')

test('Switch map styles', async ({ page }) => {
  await page.goto('/');

  function mapBtn(label: string) {
    return page.getByRole('button', { name: label });
  }

  // 1) Default: Aerial active, URL clean.
  await expect(mapBtn('Aerial')).toHaveClass(/active/);
  await expect(page).not.toHaveURL(/style=/);

  // 2) Click Topo → URL gains ?style=topo, Aerial loses .active.
  await mapBtn('Topo').click();
  await expect(page).toHaveURL(/style=topo/);
  await expect(mapBtn('Topo')).toHaveClass(/active/);
  await expect(mapBtn('Aerial')).not.toHaveClass(/active/);

  // 3) Reload → the style is restored from the URL.
  await page.reload();
  await expect(mapBtn('Topo')).toHaveClass(/active/);

  // 4) Click Aerial → URL drops style param (encoder omits the default).
  await mapBtn('Aerial').click();
  await expect(page).not.toHaveURL(/style=/);
  await expect(mapBtn('Aerial')).toHaveClass(/active/);
});
