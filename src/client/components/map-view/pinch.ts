import type { Map as MapGL } from 'maplibre-gl';

import { centerPxForZoom, type Point } from './zoom-math';

// Safari-family engines report a trackpad pinch as gesture* events whose
// `scale` is cumulative since gesturestart, and not as wheel events.
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

// Engines that report pinch as ctrl+wheel send small deltaY values.
const CTRL_WHEEL_ZOOM_RATE = 1 / 100;

// Release speed only counts if the fingers were still moving when they
// lifted, averaged over the last stretch of the gesture.
const VELOCITY_WINDOW_MS = 100;
const STALE_MS = 50;
const MIN_VELOCITY = 0.0004; // zoom levels per ms
// How far past the release point the glide carries, in ms of release speed.
const GLIDE_MS = 250;
const GLIDE_DURATION_MS = 500;

/**
 * Trackpad pinch zooms the map around the cursor, then glides on after the
 * fingers lift the way scroll zoom does. Listens on the map container, so
 * the canvas and the popup both count.
 */
export default function installPinchZoom(map: MapGL) {
  const container = map.getContainer();
  let cursor: Point = { x: 0, y: 0 };
  let lastScale = 1;
  let samples: Array<{ t: number; dz: number }> = [];
  let glideFrame = 0;
  let stepping = false;

  function toCanvas(clientX: number, clientY: number): Point {
    const rect = map.getCanvas().getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function zoomBy(dz: number, anchor: Point) {
    const oldZoom = map.getZoom();
    const newZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), oldZoom + dz)
    );
    if (newZoom === oldZoom) return;
    const canvas = map.getCanvas();
    const centerPx = centerPxForZoom(
      anchor,
      { w: canvas.clientWidth, h: canvas.clientHeight },
      oldZoom,
      newZoom
    );
    stepping = true;
    map.jumpTo({ center: map.unproject(centerPx), zoom: newZoom });
    stepping = false;
  }

  // Stepped with the same jumps as the pinch itself: on the globe an
  // easeTo `around` a point wobbles the map by several pixels a frame.
  function glide(total: number, anchor: Point) {
    const start = performance.now();
    let applied = 0;
    function step() {
      const t = Math.min(1, (performance.now() - start) / GLIDE_DURATION_MS);
      const target = total * (1 - (1 - t) ** 3);
      zoomBy(target - applied, anchor);
      applied = target;
      glideFrame = t < 1 ? requestAnimationFrame(step) : 0;
    }
    glideFrame = requestAnimationFrame(step);
  }

  function stopGlide() {
    cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  }

  // Any camera move that isn't the glide's own step takes over from it.
  map.on('movestart', () => {
    if (!stepping) stopGlide();
  });

  container.addEventListener('mousemove', (e) => {
    cursor = toCanvas(e.clientX, e.clientY);
  });

  function onGestureStart(e: Event) {
    e.preventDefault();
    map.stop();
    lastScale = 1;
    samples = [];
  }

  function onGestureChange(e: Event) {
    e.preventDefault();
    const { scale, clientX, clientY } = e as GestureEvent;
    const anchor = Number.isFinite(clientX)
      ? toCanvas(clientX, clientY)
      : cursor;
    cursor = anchor;
    const dz = Math.log2(scale / lastScale);
    lastScale = scale;
    samples.push({ t: performance.now(), dz });
    zoomBy(dz, anchor);
  }

  function onGestureEnd(e: Event) {
    e.preventDefault();
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
    samples = [];
    const last = recent.at(-1);
    const first = recent[0];
    if (last === undefined || first === undefined) return;
    if (now - last.t > STALE_MS) return;
    const span = Math.max(last.t - first.t, 16);
    const velocity = recent.reduce((sum, s) => sum + s.dz, 0) / span;
    if (Math.abs(velocity) < MIN_VELOCITY) return;

    glide(velocity * GLIDE_MS, cursor);
  }

  container.addEventListener('gesturestart', onGestureStart);
  container.addEventListener('gesturechange', onGestureChange);
  container.addEventListener('gestureend', onGestureEnd);

  // Capture phase and stopPropagation so the popup's marker-anchored
  // scroll zoom never sees a pinch.
  container.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      map.stop();
      zoomBy(-e.deltaY * CTRL_WHEEL_ZOOM_RATE, toCanvas(e.clientX, e.clientY));
    },
    { capture: true, passive: false }
  );
}
