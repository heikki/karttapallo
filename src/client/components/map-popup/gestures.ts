import type { Map as MapGL, Popup } from 'maplibre-gl';

import * as edits from '@common/edits';
import selection from '@common/selection';

// One full wheel notch (deltaY ≈ 100) ≈ 1/3 of a zoom level.
const WHEEL_ZOOM_RATE = 1 / 300;

/**
 * While the popup is open, treat its chrome as part of the map for
 * input purposes:
 *
 * - Scroll-zoom on either the popup or the canvas anchors at the
 *   selected marker (instead of the cursor) so the marker stays under
 *   the mouse.
 * - Mouse drags on the popup are forwarded to the canvas so the user
 *   can pan through it.
 * - MapLibre's default scroll-zoom is disabled while these overrides
 *   are active.
 *
 * Self-cleans when the popup fires `'close'`. Caller just calls
 * `attach` once and forgets.
 */
export function attach(map: MapGL, popup: Popup) {
  const popupEl = popup.getElement();
  const canvas = map.getCanvas();

  function zoomAroundPopup(e: WheelEvent) {
    const coords = getSelectedMarkerCoords();
    if (coords === null) return;
    e.preventDefault();
    e.stopPropagation();
    const oldZoom = map.getZoom();
    const delta = -e.deltaY * WHEEL_ZOOM_RATE;
    const newZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), oldZoom + delta)
    );
    if (newZoom === oldZoom) return;
    const anchorPx = map.project(coords);
    const { clientWidth: w, clientHeight: h } = canvas;

    // If the marker is off-screen, zoom around cursor position instead.
    const markerOnScreen =
      anchorPx.x >= 0 && anchorPx.x <= w && anchorPx.y >= 0 && anchorPx.y <= h;
    const rect = canvas.getBoundingClientRect();
    const zoomAnchor = markerOnScreen
      ? anchorPx
      : { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const scale = 2 ** (newZoom - oldZoom);
    const newCenterPx = [
      zoomAnchor.x + (w / 2 - zoomAnchor.x) / scale,
      zoomAnchor.y + (h / 2 - zoomAnchor.y) / scale
    ] as [number, number];
    map.jumpTo({ center: map.unproject(newCenterPx), zoom: newZoom });
  }

  popupEl.addEventListener('wheel', zoomAroundPopup);

  const mouseHandlers: Array<{
    type: 'mousedown' | 'mousemove' | 'mouseup';
    handler: (e: MouseEvent) => void;
  }> = [];
  for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
    function handler(e: MouseEvent) {
      e.preventDefault();
      canvas.dispatchEvent(new MouseEvent(type, e));
    }
    popupEl.addEventListener(type, handler);
    mouseHandlers.push({ type, handler });
  }

  map.scrollZoom.disable();
  canvas.addEventListener('wheel', zoomAroundPopup);

  popup.on('close', () => {
    popupEl.removeEventListener('wheel', zoomAroundPopup);
    for (const { type, handler } of mouseHandlers) {
      popupEl.removeEventListener(type, handler);
    }
    canvas.removeEventListener('wheel', zoomAroundPopup);
    map.scrollZoom.enable();
  });
}

function getSelectedMarkerCoords(): [number, number] | null {
  const photo = selection.getPhoto();
  if (photo === undefined) return null;
  const { lon, lat } = edits.getEffectiveCoords(photo);
  return [lon, lat];
}
