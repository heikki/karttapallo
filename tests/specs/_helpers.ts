import type { Page } from '@playwright/test';

interface GeoJSONLike {
  serialize: () => { data?: { features?: unknown[] } };
}

interface MapLike {
  getSource: (id: string) => GeoJSONLike | undefined;
  getLayoutProperty: (layerId: string, prop: string) => string | undefined;
  getCenter: () => { lat: number; lng: number };
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
