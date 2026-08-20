import { expect, test, type Page } from '@playwright/test';

import { sourceFeatureCount } from './_helpers';

// Fixture (sorted by date): e2e-2 (oldest), e2e-1, e2e-3 (newest). All three
// are gps='exif'; e2e-1 measures 5 m and e2e-3 measures 300 m.

interface MapLike {
  getSource: (id: string) => {
    serialize: () => {
      data?: { features?: Array<{ geometry: { coordinates: number[][] } }> };
    };
  };
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Metres from the ring's centre to its first point, by haversine. */
async function ringRadius(page: Page, centre: { lat: number; lon: number }) {
  const first = await page.evaluate(() => {
    const view = document.querySelector('map-view') as
      | (HTMLElement & { _map?: MapLike })
      | null;
    const data = view?._map?.getSource('accuracy-ring').serialize().data;
    return data?.features?.[0]?.geometry.coordinates[0] ?? null;
  });
  if (first === null) return null;
  const lat1 = toRad(centre.lat);
  const lat2 = toRad(first[1]!);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(toRad(first[0]! - centre.lon) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

async function ringCount(page: Page) {
  return await sourceFeatureCount(page, 'accuracy-ring');
}

test('See how accurate a photo’s location is', async ({ page }) => {
  await page.goto('/?id=e2e-1');
  await expect(page.locator('photo-popup')).toBeVisible();

  // Selecting a photo is not enough — the ring belongs to the Info panel.
  expect(await ringCount(page)).toBe(0);

  await page.keyboard.press('Meta+i');
  await expect(page.locator('info-panel[active]')).toBeVisible();
  await expect.poll(async () => await ringCount(page)).toBe(1);
  expect(await ringRadius(page, { lat: 60.17, lon: 24.94 })).toBeCloseTo(5, 3);

  // Arrows browse with the panel open, which is how a whole album gets swept.
  // The ring is redrawn from the photo it lands on, not left behind at the
  // last one's size.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);
  await expect
    .poll(async () => await ringRadius(page, { lat: 61.51, lon: 23.79 }))
    .toBeCloseTo(300, 3);

  // Closing the panel takes the ring with it.
  await page.keyboard.press('Meta+i');
  await expect(page.locator('info-panel[active]')).toHaveCount(0);
  await expect.poll(async () => await ringCount(page)).toBe(0);

  // Reopen, then place the pin by hand: the camera's measurement no longer
  // describes where the photo sits, so the ring goes.
  await page.keyboard.press('Meta+i');
  await expect.poll(async () => await ringCount(page)).toBe(1);

  // The panel parks over this photo's popup, so drag it aside first — the
  // whole point of a movable, non-blocking panel is working under it.
  const header = page.locator('info-panel[active] .content .header');
  const grab = await header.boundingBox();
  if (grab === null) throw new Error('panel not laid out');
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + 460, { steps: 8 });
  await page.mouse.up();

  await page
    .locator('photo-popup')
    .getByRole('group', { name: 'Location actions' })
    .getByRole('button', { name: 'set' })
    .click();
  await page
    .locator('map-view >> canvas.maplibregl-canvas')
    .click({ position: { x: 250, y: 250 } });

  await expect(
    page.getByRole('region', { name: 'Pending edits' })
  ).toBeVisible();
  await expect.poll(async () => await ringCount(page)).toBe(0);
});
