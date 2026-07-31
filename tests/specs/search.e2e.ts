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

test('Search composes with the other filters', async ({ page }) => {
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search' });
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });

  // Kuusamo is the 2023 photo, so narrowing to 2024 must drop it from the
  // suggestions — they describe what applying a term would actually show.
  await page.getByLabel('Year').selectOption('2024');
  await search.fill('ku');
  await expect(suggestions.getByRole('option')).toHaveCount(1);
  await expect(suggestions.getByRole('option').first()).toContainText('Kuhmo');

  // Applying it composes rather than replacing: both filters stay in the URL.
  await suggestions.getByRole('option').first().click();
  await expect(page).toHaveURL(/year=2024/);
  await expect(page).toHaveURL(/q=Kuhmo/);
  await expect(page.getByLabel('Photo stats')).toHaveText('1 photos');

  // Pivoting to a year the term can't appear in yields an honest empty map
  // rather than silently widening the search.
  await page.getByLabel('Year').selectOption('2023');
  await expect(page.getByLabel('Photo stats')).toHaveText('No results');

  // Reset clears the search along with everything else.
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByLabel('Photo stats')).toHaveText('3 photos');
  await expect(page).not.toHaveURL(/q=/);
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
