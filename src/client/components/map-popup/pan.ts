import type { Map as MapGL, Popup } from 'maplibre-gl';

// The filter panel is fixed at 220px wide and pinned 10px from the
// viewport's right edge, so the popup needs 240px of right padding to
// stay clear of it (220 + 10 offset + 10 breathing room).
const PADDING = { top: 10, bottom: 10, left: 10, right: 240 };

function getPopupRect(
  map: MapGL,
  popup: Popup
): { mapRect: DOMRect; popupRect: DOMRect } | null {
  const mapContainer = map.getContainer();
  if (mapContainer.clientWidth === 0 || mapContainer.clientHeight === 0) {
    return null;
  }
  const popupEl = popup.getElement() as HTMLElement | undefined;
  if (popupEl === undefined) return null;
  return {
    mapRect: mapContainer.getBoundingClientRect(),
    popupRect: popupEl.getBoundingClientRect()
  };
}

function calculatePanOffset(
  mapRect: DOMRect,
  popupRect: DOMRect
): { panX: number; panY: number } {
  let panX = 0;
  let panY = 0;

  if (popupRect.top < mapRect.top + PADDING.top) {
    panY = popupRect.top - mapRect.top - PADDING.top;
  } else if (popupRect.bottom > mapRect.bottom - PADDING.bottom) {
    panY = popupRect.bottom - mapRect.bottom + PADDING.bottom;
  }

  if (popupRect.left < mapRect.left + PADDING.left) {
    panX = popupRect.left - mapRect.left - PADDING.left;
  } else if (popupRect.right > mapRect.right - PADDING.right) {
    panX = popupRect.right - mapRect.right + PADDING.right;
  }

  return { panX, panY };
}

/** Run fn once the browser has painted, so measured rects are final. */
function afterPaint(fn: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}

/**
 * Wait for popup layout — and for the camera — to settle, then call fn.
 *
 * Both matter. The paint wait ensures the popup is at its final position; the
 * camera wait ensures that position is the one it will keep. A rect measured
 * mid-flight describes where the popup happens to be a frame or two into a
 * `fitBounds`, so acting on it both pans to the wrong place and cuts the
 * animation short.
 */
function afterPopupLayout(map: MapGL, fn: () => void) {
  afterPaint(() => {
    if (!map.isMoving()) {
      fn();
      return;
    }
    void map.once('moveend', () => {
      afterPaint(fn);
    });
  });
}

function panBy(map: MapGL, panX: number, panY: number, duration: number) {
  if (panX === 0 && panY === 0) return;
  try {
    map.panBy([panX, panY], { duration });
  } catch {
    // Silently ignore MapLibre internal errors
  }
}

/**
 * Pan the map to fit the popup after opening it on the current view.
 * Used for initial popup show (click on marker).
 */
export function panToFitPopup(map: MapGL, popup: Popup) {
  afterPopupLayout(map, () => {
    const rects = getPopupRect(map, popup);
    if (rects === null) return;
    const { panX, panY } = calculatePanOffset(rects.mapRect, rects.popupRect);
    panBy(map, panX, panY, 300);
  });
}

/**
 * Navigate to coordinates, fitting the popup into view.
 * If the popup is already fully visible, does nothing.
 * If it's partially off-screen, pans minimally.
 * If it's completely off-screen, eases to center first.
 * Used for arrow-key navigation between photos.
 */
export function flyToPopupTo(
  map: MapGL,
  popup: Popup,
  coords: [number, number]
) {
  afterPopupLayout(map, () => {
    const rects = getPopupRect(map, popup);
    if (rects === null) return;
    const { panX, panY } = calculatePanOffset(rects.mapRect, rects.popupRect);

    if (panX === 0 && panY === 0) return;

    const offScreen =
      rects.popupRect.bottom < rects.mapRect.top ||
      rects.popupRect.top > rects.mapRect.bottom ||
      rects.popupRect.right < rects.mapRect.left ||
      rects.popupRect.left > rects.mapRect.right;

    if (offScreen) {
      try {
        map.stop();
        map.easeTo({ center: coords, duration: 300 });
      } catch {
        return;
      }
      function onMoveEnd() {
        map.off('moveend', onMoveEnd);
        afterPopupLayout(map, () => {
          const r = getPopupRect(map, popup);
          if (r === null) return;
          const adj = calculatePanOffset(r.mapRect, r.popupRect);
          panBy(map, adj.panX, adj.panY, 200);
        });
      }
      map.on('moveend', onMoveEnd);
    } else {
      panBy(map, panX, panY, 300);
    }
  });
}
