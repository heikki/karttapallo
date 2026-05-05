import {
  GlobeControl,
  Map as MapGL,
  NavigationControl,
  ScaleControl
} from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';

import selection from '@common/selection';
import { effect } from '@common/signals';
import { mapViewFromUrl, mapViewToUrl } from '@common/url-state';
import { viewState } from '@common/view-state';

import type { MapApi } from './api';
import background from './background';
import config from './config';

export function showMapError(msg: string, onClick?: () => void): void {
  let banner = document.getElementById('map-error-banner');
  if (banner === null) {
    banner = document.createElement('div');
    banner.id = 'map-error-banner';
    banner.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
      'background:#dc2626;color:#fff;padding:8px 16px;border-radius:8px;' +
      'font:13px/1.4 -apple-system,sans-serif;z-index:99999;cursor:pointer;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)';
    document.body.appendChild(banner);
  }
  banner.textContent = msg;
  banner.onclick = () => {
    void navigator.clipboard.writeText(msg).then(() => {
      banner.textContent = 'Copied!';
      setTimeout(() => {
        banner.remove();
      }, 600);
    });
    if (onClick !== undefined) onClick();
  };
}

function applyGlobeProjection(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    projection: { type: 'globe' },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0 }
  };
}

// Carry app-owned sources and layers across a basemap swap. App-owned =
// anything in previousStyle not declared by any basemap config. The
// next-basemap check guards against duplicate-ID crashes from auto-injected
// layers.
function transformStyle(
  previousStyle: StyleSpecification | undefined,
  nextStyle: StyleSpecification
): StyleSpecification {
  if (previousStyle === undefined) return nextStyle;

  const allBasemaps = Object.values(config.styles());
  const bmLayers = new Set(
    allBasemaps.flatMap((s) => s.layers.map((l) => l.id))
  );
  const bmSources = new Set(allBasemaps.flatMap((s) => Object.keys(s.sources)));
  const nextLayerIds = new Set(nextStyle.layers.map((l) => l.id));
  const nextSourceIds = new Set(Object.keys(nextStyle.sources));

  const appLayers = previousStyle.layers.filter(
    (l) => !bmLayers.has(l.id) && !nextLayerIds.has(l.id)
  );
  const appSources: typeof nextStyle.sources = {};
  for (const [id, src] of Object.entries(previousStyle.sources)) {
    if (!bmSources.has(id) && !nextSourceIds.has(id)) appSources[id] = src;
  }

  return {
    ...nextStyle,
    sources: { ...nextStyle.sources, ...appSources },
    layers: [...nextStyle.layers, ...appLayers]
  };
}

export function createMap(container: HTMLElement): MapGL {
  const savedView = mapViewFromUrl();
  const center: [number, number] | undefined =
    savedView === null ? undefined : [savedView.lon, savedView.lat];
  const zoom = savedView?.zoom;
  const initialStyleKey = viewState.mapStyle.get();
  const initialStyle =
    config.styles()[initialStyleKey] ?? config.styles().satellite!;

  return new MapGL({
    container,
    style: applyGlobeProjection(initialStyle),
    center,
    zoom,
    minZoom: 1,
    boxZoom: false,
    keyboard: false,
    doubleClickZoom: false,
    dragRotate: false,
    canvasContextAttributes: { alpha: true }
  });
}

export function installControls(map: MapGL): void {
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new GlobeControl(), 'bottom-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
}

export function installListeners(map: MapGL, api: MapApi): void {
  map.on('moveend', () => {
    const c = map.getCenter();
    mapViewToUrl({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
  });

  map.on('error', (e) => {
    console.error(
      '[MapGL] error:',
      (e.error as Error | undefined)?.message ?? e
    );
  });

  // Detect WebGL context loss — primary suspect for permanent map freeze
  const mapCanvas = map.getCanvas();
  mapCanvas.addEventListener('webglcontextlost', (e) => {
    console.error('[MapGL] WebGL context LOST', e);
    showMapError('WebGL context lost — map frozen');
  });
  mapCanvas.addEventListener('webglcontextrestored', () => {
    console.warn('[MapGL] WebGL context restored');
  });

  // Empty-map click only closes the popup when no interaction mode is
  // active. During placement/measure/route-edit the click belongs to that
  // mode (place a pin, add a point, edit the route) and should leave the
  // popup alone.
  map.on('click', (e) => {
    if (selection.interactionMode.get() !== 'idle') return;
    if (e.defaultPrevented) return;
    if (selection.isPopupOpen()) selection.closePopup();
  });

  map.on('projectiontransition', () => {
    if (map.getProjection().type === 'globe') {
      background.start();
    } else {
      background.stop();
    }
    if (selection.isPopupOpen()) api.forceRemountPopup();
  });
}

export function installBackground(map: MapGL): void {
  background.init(map.getContainer());
  background.start();

  // Globe radius depends on camera (center, zoom) and canvas size, not on
  // whatever else is being repainted each frame. Update on actual camera
  // changes plus once at start, plus on projection-transition end (the
  // 'move' fired during transitions covers most cases, but the post-flip
  // resting state needs an explicit update).
  const updateRadius = (): void => {
    if (map.getProjection().type !== 'globe') return;
    const { lat, lng } = map.getCenter();
    const centerPx = map.project([lng, lat]);
    const px = map.project([lng + 90, 0]);
    const dx = px.x - centerPx.x;
    const dy = px.y - centerPx.y;
    const canvas = map.getCanvas();
    background.setRadius(
      Math.sqrt(dx * dx + dy * dy),
      Math.min(canvas.clientWidth, canvas.clientHeight)
    );
  };
  map.on('move', updateRadius);
  map.on('projectiontransition', updateRadius);
  void map.once('load', updateRadius);

  map.on('movestart', () => {
    background.setIdle(false);
  });
  map.on('idle', () => {
    background.setIdle(true);
  });
}

export function installDebugDiagnostics(map: MapGL): void {
  let renderFrames = 0;
  let lastRenderTs = 0;
  map.on('render', () => {
    renderFrames++;
    lastRenderTs = performance.now();
  });

  // Press Shift+D when frozen to see diagnostics
  document.addEventListener('keydown', (e) => {
    if (e.key === 'D' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const sinceRender = Math.round(performance.now() - lastRenderTs);
      const debugLog = (window as unknown as Record<string, string[]>)
        .__debugLog;
      const errors = debugLog?.slice(-5).join('\n') ?? '';
      const info = `Frames: ${renderFrames} | Last render: ${sinceRender}ms ago | Tiles loaded: ${String(map.areTilesLoaded())}`;
      showMapError(errors === '' ? info : `${info}\n${errors}`);
    }
  });
}

export function installStyleEffect(map: MapGL): void {
  let lastAppliedStyleKey = viewState.mapStyle.get();
  effect(() => {
    const next = viewState.mapStyle.get();
    if (next === lastAppliedStyleKey) return;
    lastAppliedStyleKey = next;
    const nextStyle = config.styles()[next];
    if (nextStyle === undefined) return;
    // Stop any ongoing animation to prevent MapLibre crash during style change
    map.stop();
    map.setStyle(applyGlobeProjection(nextStyle), { transformStyle });
  });
}
