import { expect, test } from '@playwright/test';

// The measure overlay (`<map-measure>` → `.overlay`) cycles through three
// messages depending on point count:
//   0 points → "Click map to add points"
//   1 point  → "Click to add more points"
//   2+       → formatted distance, e.g. "1.23 km" or "456 m"

test('Measure distances on the map', async ({ page }) => {
  await page.goto('/');

  // Wait for /api/items to land so the map has finished its initial load
  // before we send canvas clicks.
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );

  // Hide all markers so measure's `if (e.defaultPrevented) return` guard
  // can't be tripped by an accidental marker hit (map-markers preventDefaults
  // its own click event when a feature is hit). Toggle "Photos" off; the
  // fixture has no videos, so the map ends up empty.
  await page
    .locator('filter-panel >> button.filter-btn')
    .filter({ hasText: 'Photos' })
    .click();
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    'No results'
  );

  const measureBtn = page
    .locator('filter-panel >> button.view-btn')
    .filter({ hasText: 'Measure' });
  const overlay = page.locator('map-measure >> .overlay');
  // Resolve canvas position once so we can drive the mouse at absolute
  // viewport coordinates (more reliable for MapLibre than locator.click()).
  const canvas = page.locator('map-view >> canvas.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('canvas not laid out');
  const clickAt = async (offsetX: number, offsetY: number) => {
    await page.mouse.click(box.x + offsetX, box.y + offsetY);
  };

  // Initially no overlay (measure mode inactive).
  await expect(overlay).toHaveCount(0);

  // 1) Click Measure → mode active, overlay prompts for first point.
  await measureBtn.click();
  await expect(measureBtn).toHaveClass(/active/);
  await expect(overlay).toHaveText('Click map to add points');

  // 2) First point → prompt updates.
  await clickAt(200, 200);
  await expect(overlay).toHaveText('Click to add more points');

  // 3) Second point → overlay shows a formatted distance (km or m).
  await clickAt(400, 400);
  await expect(overlay).toHaveText(/\d[\d.]*\s(?:km|m)/);

  // 4) Click Measure again → mode exits, overlay unmounts.
  await measureBtn.click();
  await expect(measureBtn).not.toHaveClass(/active/);
  await expect(overlay).toHaveCount(0);
});
