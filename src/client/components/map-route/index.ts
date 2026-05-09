import { computed } from '@lit-labs/signals';
import type { FeatureCollection } from 'geojson';
import { customElement } from 'lit/decorators.js';
import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MapGL
} from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import * as interactionMode from '@common/interaction-mode';
import { effect } from '@common/signals';
import { viewState } from '@common/view-state';
import {
  MapFeatureElement,
  setLayersVisibility
} from '@components/map-view/api';

import { initRouteEdit } from './edit';
import { reconcileRouteWithAlbum } from './reconcile';
import { buildDefaultRoute, buildRouteLineFeatures } from './route-data';
import type { RouteData } from './route-data';
import {
  clearRoute,
  getRoute,
  getRouteAlbum,
  loadFromServer,
  notifyChanged,
  saveToServer,
  setRoute
} from './route-store';

const lineLayout = {
  'visibility': 'none' as const,
  'line-cap': 'round' as const,
  'line-join': 'round' as const
};

const LAYERS: LayerSpecification[] = [
  {
    id: 'photo-route-outline',
    type: 'line',
    source: 'photo-route',
    paint: { 'line-color': 'rgba(0, 0, 0, 0.3)', 'line-width': 4 },
    layout: lineLayout
  },
  {
    id: 'photo-route-line',
    type: 'line',
    source: 'photo-route',
    paint: { 'line-color': '#60a5fa', 'line-width': 2 },
    layout: lineLayout
  }
];

const LAYER_IDS = LAYERS.map((l) => l.id);

// Album to load a saved route for, or null when route is hidden / 'all albums'.
const loadAlbum = computed<string | null>(() => {
  if (!viewState.routeVisible.get()) return null;
  const album = data.filters.get().album;
  if (album === 'all') return null;
  return album;
});

function applyDisplaySource(map: MapGL, route: RouteData | null): void {
  const src = map.getSource<GeoJSONSource>('photo-route');
  if (src === undefined) return;
  src.setData({
    type: 'FeatureCollection',
    features: route === null ? [] : buildRouteLineFeatures(route)
  });
}

function albumPhotosFor(album: string) {
  return data.photos.get().filter((p) => p.albums.includes(album));
}

function addDisplayLayers(map: MapGL): void {
  const empty: FeatureCollection = {
    type: 'FeatureCollection',
    features: []
  };
  map.addSource('photo-route', { type: 'geojson', data: empty });
  for (const spec of LAYERS) map.addLayer(spec);
}

@customElement('map-route')
export class MapRoute extends MapFeatureElement {
  override firstUpdated(): void {
    const map = this.api.map;
    addDisplayLayers(map);
    initRouteEdit(map);

    // Load + initial reconcile when album changes (or visibility flips on).
    // Token guards against stale fetches resolving after a later album switch.
    // Route is cleared synchronously so the reconcile effect doesn't mutate
    // the previous album's route against the new album's photos. The clear
    // is unconditional — reading getRoute() here would subscribe this effect
    // to the revision signal and create a load → setRoute → reload loop.
    let loadToken = 0;
    effect(() => {
      const album = loadAlbum.get();
      clearRoute();
      if (album === null) return;
      const myToken = ++loadToken;
      void (async () => {
        const saved = await loadFromServer(album);
        if (myToken !== loadToken) return;
        const route: RouteData | null = saved ?? buildDefaultRoute();
        if (route === null) return;
        const changed = reconcileRouteWithAlbum(route, albumPhotosFor(album));
        if ((saved === null || changed) && edits.editCount.get() === 0) {
          void saveToServer(album, route);
        }
        setRoute(album, route);
      })();
    });

    // Keep the route in sync with photo / pending-edit changes within the
    // current album. Skipped during edit mode (the edit module owns mutations)
    // and when the route belongs to a different album (mid-album-switch race
    // — the load effect is about to replace the route).
    effect(() => {
      data.filteredPhotos.get();
      edits.pendingCoords.get();
      edits.pendingTimeOffsets.get();
      if (interactionMode.current.get() === 'route-edit') return;
      const album = loadAlbum.get();
      if (album === null) return;

      const route = getRoute();
      if (route === null) return;
      if (getRouteAlbum() !== album) return;
      const changed = reconcileRouteWithAlbum(route, albumPhotosFor(album));
      if (!changed) return;
      notifyChanged();
      if (edits.editCount.get() === 0) {
        void saveToServer(album, route);
      }
    });

    // Display: layer visibility + source data.
    effect(() => {
      const route = getRoute();
      const visible = viewState.routeVisible.get();
      const editing = interactionMode.current.get() === 'route-edit';
      const show = visible && !editing;
      setLayersVisibility(map, LAYER_IDS, show);
      if (show) applyDisplaySource(map, route);
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-route': MapRoute;
  }
}
