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
import { reconcileWithAlbum } from './reconcile';
import * as route from './route';
import { buildDefault, buildLineFeatures } from './route-data';
import type { RouteData } from './route-data';

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

function applyDisplaySource(map: MapGL, r: RouteData | null): void {
  const src = map.getSource<GeoJSONSource>('photo-route');
  if (src === undefined) return;
  src.setData({
    type: 'FeatureCollection',
    features: r === null ? [] : buildLineFeatures(r)
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
    // is unconditional — reading route.current.get() here would subscribe
    // this effect to the signal and create a load → setRoute → reload loop.
    let loadToken = 0;
    effect(() => {
      const album = loadAlbum.get();
      route.clear();
      if (album === null) return;
      const myToken = ++loadToken;
      void (async () => {
        const saved = await route.loadFromServer(album);
        if (myToken !== loadToken) return;
        const initial: RouteData | null =
          saved ?? buildDefault(albumPhotosFor(album));
        if (initial === null) return;
        const { route: reconciled, changed } = reconcileWithAlbum(
          initial,
          albumPhotosFor(album)
        );
        route.setRoute(album, reconciled);
        if ((saved === null || changed) && edits.editCount.get() === 0) {
          void route.saveToServer(album, reconciled);
        }
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

      const cur = route.current.get();
      if (cur?.album !== album) return;
      const { route: reconciled, changed } = reconcileWithAlbum(
        cur.data,
        albumPhotosFor(album)
      );
      if (!changed) return;
      route.setRoute(album, reconciled);
      if (edits.editCount.get() === 0) {
        void route.saveToServer(album, reconciled);
      }
    });

    // Display: layer visibility + source data.
    effect(() => {
      const cur = route.current.get();
      const visible = viewState.routeVisible.get();
      const editing = interactionMode.current.get() === 'route-edit';
      const show = visible && !editing;
      setLayersVisibility(map, LAYER_IDS, show);
      if (show) applyDisplaySource(map, cur?.data ?? null);
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-route': MapRoute;
  }
}
