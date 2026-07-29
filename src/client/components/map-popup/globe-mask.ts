import type { Map as MapGL, Popup } from 'maplibre-gl';

/**
 * While the popup is open in globe projection, hide the part of it
 * that's visually behind the globe with a radial-gradient mask. The
 * mask is recomputed every render frame (projection transitions fire
 * `render` continuously) and skipped via a cache key when nothing
 * observable changed. Self-cleans on the popup's `'close'` event.
 */
export function attach(map: MapGL, popup: Popup) {
  let lastKey = '';
  function update() {
    lastKey = applyMask(map, popup, lastKey);
  }
  map.on('render', update);
  popup.on('close', () => {
    map.off('render', update);
  });
}

function applyMask(map: MapGL, popup: Popup, lastKey: string) {
  const el = popup.getElement() as HTMLElement | undefined;
  if (el === undefined) return lastKey;

  if (map.getProjection().type !== 'globe') {
    if (lastKey !== 'none') el.style.maskImage = '';
    return 'none';
  }

  const occluded = map.transform.isLocationOccluded(popup.getLngLat());
  if (!occluded) {
    if (lastKey !== 'visible') el.style.maskImage = '';
    return 'visible';
  }

  const container = map.getContainer();
  const globeCx = container.clientWidth / 2;
  const globeCy = container.clientHeight / 2;

  // Screen-space globe silhouette radius.
  // For sphere of radius R at camera distance D and focal length f (pixels):
  //   silhouette radius = f * R / sqrt(D² - R²)
  const t = map.transform as {
    worldSize: number;
    cameraToCenterDistance: number;
  };
  const R: number =
    t.worldSize /
    (2.0 * Math.PI) /
    Math.cos((map.getCenter().lat * Math.PI) / 180);
  const f: number = t.cameraToCenterDistance;
  const D = f + R;
  const r = (f * R) / Math.sqrt(D * D - R * R);

  // The mask gradient is positioned in the popup's box; compensate for the
  // popup's CSS-transform offset relative to the map container.
  const mapRect = container.getBoundingClientRect();
  const popupRect = el.getBoundingClientRect();
  const cx = globeCx - (popupRect.left - mapRect.left);
  const cy = globeCy - (popupRect.top - mapRect.top);
  const maskSize = Math.max(container.clientWidth, container.clientHeight) * 3;

  const key = `${r.toFixed(1)}:${cx.toFixed(0)}:${cy.toFixed(0)}:${maskSize}`;
  if (key === lastKey) return key;

  const half = maskSize / 2;
  el.style.maskImage = `radial-gradient(circle ${r}px at center, transparent ${r}px, black ${r}px)`;
  el.style.maskSize = `${maskSize}px ${maskSize}px`;
  el.style.maskPosition = `${cx - half}px ${cy - half}px`;
  el.style.maskRepeat = 'no-repeat';
  return key;
}
