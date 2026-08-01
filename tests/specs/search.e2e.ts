import { expect, test } from '@playwright/test';

import { mapCenter } from './_helpers';

// Fixture:
//   e2e-1 — 2024, Helsinki, iPhone, place Kuhmo
//   e2e-2 — 2023, Tampere,  Sony,   place Kuusamo
//   e2e-3 — 2024, Tampere,  iPhone, place Näätämö, description Käki
//
// Kuhmo and Kuusamo share a "ku" prefix; Näätämö exercises diacritic folding.

test('Search by place, applied as a token', async ({ page }) => {
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search' });
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });

  // Let the opening fit-to-all-photos settle first. Searching before the map
  // has loaded lets <map-fit>'s own startup fit run against the already-filtered
  // set, which lands on the right coordinates for the wrong reason.
  await expect
    .poll(async () => (await mapCenter(page))?.lat)
    .toBeCloseTo(60.86, 1);

  // Typing offers both "ku" places, alphabetical at equal counts.
  await search.fill('ku');
  await expect(suggestions.getByRole('option')).toHaveCount(2);
  await expect(suggestions.getByRole('option').first()).toContainText('Kuhmo');

  // Picking one applies it as a token and narrows the map to that photo.
  await suggestions.getByRole('option', { name: /Kuhmo/ }).click();
  await expect(page.getByLabel('Photo stats')).toHaveText('1 photos');
  await expect(page).toHaveURL(/q=Kuhmo/);

  // ...and flies there, so a place you haven't visited in years is on screen
  // rather than filtered-but-off-camera. e2e-1 sits at 60.17, 24.94.
  await expect
    .poll(async () => (await mapCenter(page))?.lat)
    .toBeCloseTo(60.17, 1);
  await expect
    .poll(async () => (await mapCenter(page))?.lon)
    .toBeCloseTo(24.94, 1);

  // ...and opens the oldest match once the flight lands, exactly as the Fit
  // button does — a search leaves you on a photo, not just near one.
  await expect(page).toHaveURL(/id=e2e-1/);
  await expect(page.locator('photo-popup')).toBeVisible();

  // The input gives way to the token, so there is nothing left to type into.
  await expect(search).toBeHidden();

  // Reload — the term survives via the URL codec, like every other filter.
  await page.reload();
  await expect(page.getByLabel('Photo stats')).toHaveText('1 photos');

  // Clearing restores the full set and drops the param.
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByLabel('Photo stats')).toHaveText('3 photos');
  await expect(page).not.toHaveURL(/q=/);
});

test('Search folds diacritics and matches descriptions', async ({ page }) => {
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search' });
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });

  // Typed without umlauts, as Photos allows.
  await search.fill('naatamo');
  await expect(suggestions.getByRole('option')).toHaveCount(1);
  await suggestions.getByRole('option').first().click();
  await expect(page.getByLabel('Photo stats')).toHaveText('1 photos');

  await page.getByRole('button', { name: 'Clear search' }).click();

  // Descriptions are searchable too, and grouped separately from places.
  await search.fill('kak');
  await expect(suggestions).toContainText('Descriptions');
  await expect(suggestions.getByRole('option')).toHaveCount(1);
  await expect(suggestions.getByRole('option').first()).toContainText('Käki');
});

test("Search finds Apple's scene labels", async ({ page }) => {
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search' });
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });

  // `Lintu` is a scene label from psi.sqlite, not a place or a description —
  // the corpus Photos' own search matches and ours previously missed.
  await search.fill('lintu');
  await expect(suggestions).toContainText('Categories');
  await expect(suggestions.getByRole('option')).toHaveCount(1);

  await suggestions.getByRole('option', { name: /Lintu/ }).click();
  await expect(page.getByLabel('Photo stats')).toHaveText('1 photos');
  await expect(page).toHaveURL(/q=Lintu/);
});

test('Search runs over the library, whatever the selects are set to', async ({
  page
}) => {
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search' });
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });

  // Kuusamo is the 2023 photo. Narrowing to 2024 must not hide it: a term you
  // can see in Photos is findable here whatever the selects say.
  await page.getByLabel('Year').selectOption('2024');
  await search.fill('ku');
  await expect(suggestions.getByRole('option')).toHaveCount(2);
  await expect(suggestions.getByRole('option', { name: /Kuusamo/ })).toHaveText(
    /1/
  );

  // Picking it drops the year rather than intersecting with it, so the map
  // shows the photo that was just counted instead of none of it.
  await suggestions.getByRole('option', { name: /Kuusamo/ }).click();
  await expect(page).not.toHaveURL(/year=/);
  await expect(page).toHaveURL(/q=Kuusamo/);
  await expect(page.getByLabel('Photo stats')).toHaveText('1 photos');

  // Media and Location stay outside the cascade — they decide what the map can
  // plot at all, so over-constraining through them still shows an honest empty
  // map rather than silently widening the search.
  await page.getByRole('button', { name: 'Photos' }).click();
  await expect(page.getByLabel('Photo stats')).toHaveText('No results');
  await expect(page).toHaveURL(/q=Kuusamo/);
  await page.getByRole('button', { name: 'Photos' }).click();

  // Reset clears the search along with everything else.
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByLabel('Photo stats')).toHaveText('3 photos');
  await expect(page).not.toHaveURL(/q=/);
});

test('An applied term narrows the selects below it', async ({ page }) => {
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search' });
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });
  const year = page.getByLabel('Year');
  const album = page.getByLabel('Album');
  const camera = page.getByLabel('Camera');

  await expect(year.locator('option')).toHaveText(['All', '2023', '2024']);
  await expect(album.locator('option')).toHaveText([
    'All',
    'Helsinki',
    'Tampere'
  ]);

  // Kuusamo is the 2023 / Tampere / Sony photo alone, so the selects below the
  // box stop offering choices that would empty the map, and start describing
  // where the term appears.
  await search.fill('kuusamo');
  await suggestions.getByRole('option').first().click();
  await expect(year.locator('option')).toHaveText(['All', '2023']);
  await expect(album.locator('option')).toHaveText(['All', 'Tampere']);
  await expect(camera.locator('option')).toHaveText(['All', 'Sony']);

  // Clearing restores them — narrowing hides options, it never drops them.
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(year.locator('option')).toHaveText(['All', '2023', '2024']);
  await expect(camera.locator('option')).toHaveText(['All', 'Sony', 'iPhone']);
});

test('Keyboard drives the suggestion list, and Cmd+F focuses it', async ({
  page
}) => {
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search' });
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });

  await search.fill('ku');

  // Arrow down moves the highlight off the first item; Enter applies it.
  await search.press('ArrowDown');
  await expect(
    suggestions.getByRole('option', { name: /Kuusamo/ })
  ).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=Kuusamo/);

  // Cmd+F clears the applied term and puts the cursor back in the input,
  // so a new search starts without reaching for the mouse.
  await page.keyboard.press('Meta+f');
  await expect(search).toBeFocused();
  await expect(page).not.toHaveURL(/q=/);

  // Escape abandons a half-typed query without applying anything.
  await search.fill('ku');
  await expect(suggestions).toBeVisible();
  await search.press('Escape');
  await expect(suggestions).toBeHidden();
  await expect(page).not.toHaveURL(/q=/);
});
