import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

interface GeoJSONLike {
  serialize: () => { data?: { features?: unknown[] } };
}

interface MapLike {
  getSource: (id: string) => GeoJSONLike | undefined;
  getLayoutProperty: (layerId: string, prop: string) => string | undefined;
  getCenter: () => { lat: number; lng: number };
  isMoving: () => boolean;
}

type MapViewElement = HTMLElement & { _map?: MapLike };

/** Count the features currently in a MapLibre GeoJSON source. */
export async function sourceFeatureCount(page: Page, sourceId: string) {
  return await page.evaluate((id) => {
    const view = document.querySelector('map-view') as MapViewElement | null;
    return view?._map?.getSource(id)?.serialize().data?.features?.length ?? 0;
  }, sourceId);
}

/** Current map centre, for asserting the camera actually moved. */
export async function mapCenter(page: Page) {
  return await page.evaluate(() => {
    const view = document.querySelector('map-view') as MapViewElement | null;
    const c = view?._map?.getCenter();
    return c === undefined ? null : { lat: c.lat, lon: c.lng };
  });
}

/** Read a layer's `visibility` layout property; defaults to 'visible'. */
export async function layerVisibility(page: Page, layerId: string) {
  return await page.evaluate((id) => {
    const view = document.querySelector('map-view') as MapViewElement | null;
    return view?._map?.getLayoutProperty(id, 'visibility') ?? 'visible';
  }, layerId);
}

/**
 * Wait until the camera stops moving.
 *
 * Startup moves it twice: `<map-fit>` snaps to the whole set as it mounts,
 * then the auto-selected photo flies it to a fit with room reserved for the
 * card. An assertion about where the map ended up that doesn't wait for the
 * second move is really asserting whichever frame it sampled.
 *
 * Asks MapLibre rather than watching the centre stop changing: an ease is
 * asymptotic, so two reads can agree to well past the precision a later
 * assertion cares about and still creep afterwards. Two negative reads a beat
 * apart, so a flight that hasn't started yet — the auto-select fit waits two
 * frames for the card to lay out — can't read as one already finished.
 */
export async function cameraSettled(page: Page) {
  async function moving() {
    return await page.evaluate(() => {
      const view = document.querySelector('map-view') as MapViewElement | null;
      return view?._map?.isMoving() ?? true;
    });
  }

  let stillLastTime = false;
  await expect
    .poll(
      async () => {
        const still = !(await moving());
        const settled = still && stillLastTime;
        stillLastTime = still;
        return settled;
      },
      { intervals: [300] }
    )
    .toBe(true);
}
