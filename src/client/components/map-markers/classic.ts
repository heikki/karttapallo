import type { FeatureCollection, Point } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapGL
} from 'maplibre-gl';

import * as edits from '@common/edits';
import type { Photo } from '@common/types';

const gpsColor = [
  'match',
  ['get', 'gps'],
  'exif',
  '#3b82f6',
  'user',
  '#22c55e',
  'inferred',
  '#f59e0b',
  '#9ca3af'
] as unknown as string;

const radius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  3,
  8,
  6,
  14,
  10
];

// radius + stroke for the outline layer (pre-computed)
const outlineRadius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  4,
  8,
  7.5,
  14,
  12
];

// radius + stroke*3 for the selection ring (pre-computed)
const selectedRadius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  6,
  8,
  10.5,
  14,
  16
];

const selectedStroke: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  1,
  8,
  1.5,
  14,
  2
];

const hitAreaRadius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  6,
  8,
  10,
  14,
  16
];

const LAYERS: LayerSpecification[] = [
  // Transparent hit area — larger than visible markers for easier clicking.
  {
    id: 'classic-hit-area',
    type: 'circle',
    source: 'classic-source',
    paint: {
      'circle-color': 'transparent',
      'circle-radius': hitAreaRadius,
      'circle-opacity': 0,
      'circle-pitch-alignment': 'map'
    }
  },
  // Outline layer — white rings behind all fills.
  {
    id: 'classic-outlines',
    type: 'circle',
    source: 'classic-source',
    paint: {
      'circle-color': '#fff',
      'circle-radius': outlineRadius,
      'circle-pitch-alignment': 'map'
    }
  },
  // Fill layer on top — colored dots, no stroke.
  {
    id: 'classic-markers',
    type: 'circle',
    source: 'classic-source',
    paint: {
      'circle-color': gpsColor,
      'circle-radius': radius,
      'circle-pitch-alignment': 'map'
    }
  },
  // Selected marker — semi-transparent fill with white stroke.
  {
    id: 'classic-selected-highlight',
    type: 'circle',
    source: 'classic-source',
    paint: {
      'circle-color': 'rgba(0, 0, 0, 0.5)',
      'circle-radius': selectedRadius,
      'circle-stroke-width': selectedStroke,
      'circle-stroke-color': '#fff',
      'circle-pitch-alignment': 'map'
    },
    filter: ['==', ['get', 'uuid'], '']
  },
  // Selected marker — colored dot with white outline on top of highlight.
  {
    id: 'classic-selected',
    type: 'circle',
    source: 'classic-source',
    paint: {
      'circle-color': gpsColor,
      'circle-radius': radius,
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        2,
        1,
        8,
        1.5,
        14,
        2
      ] as ExpressionSpecification,
      'circle-stroke-color': '#fff',
      'circle-pitch-alignment': 'map'
    },
    filter: ['==', ['get', 'uuid'], '']
  }
];

const LAYER_IDS = LAYERS.map((l) => l.id);

// Named off the signal rather than exported from `@common/edits`, which keeps
// the pending-edit shape that module's own business.
type PendingCoords = ReturnType<typeof edits.pendingCoords.get>;

export class ClassicLayer {
  readonly id = 'classic-hit-area';
  private map: MapGL | null = null;
  // What the source currently holds. Identity is enough to compare: a
  // `computed` hands back the same array until its inputs change, and an edit
  // replaces the pending map wholesale rather than mutating it.
  private builtFrom: { photos: Photo[]; coords: PendingCoords } | null = null;

  // No `before`: the layers land on top of whatever `<map-view>`'s earlier
  // feature children added, which is what puts markers above them (ADR-0008).
  install(map: MapGL) {
    this.map = map;

    map.addSource('classic-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: 22
    });

    for (const spec of LAYERS) map.addLayer(spec);
  }

  setView(view: {
    photos: Photo[];
    coords: PendingCoords;
    selectedPhoto: Photo | null;
    hidden: boolean;
  }) {
    if (this.map === null) return;

    this.refeed(view.photos, view.coords);

    const v = view.hidden ? 'none' : 'visible';
    for (const id of LAYER_IDS) {
      if (this.map.getLayer(id) !== undefined) {
        this.map.setLayoutProperty(id, 'visibility', v);
      }
    }

    const filter: FilterSpecification =
      view.selectedPhoto === null
        ? ['==', ['get', 'uuid'], '']
        : ['==', ['get', 'uuid'], view.selectedPhoto.uuid];
    for (const id of ['classic-selected-highlight', 'classic-selected']) {
      if (this.map.getLayer(id) !== undefined) {
        this.map.setFilter(id, filter);
      }
    }
  }

  /**
   * Hand the source its features, but only when they are not the ones it
   * already holds.
   *
   * Only the photos and their pending coords are in there; which one is
   * selected, and whether the markers show at all, are a filter and a
   * visibility away. Worth telling apart — re-feeding the source costs tens of
   * milliseconds at a real library's marker count, and moving the selection is
   * what the arrow keys do continuously.
   */
  private refeed(photos: Photo[], coords: PendingCoords) {
    const built = this.builtFrom;
    if (built !== null && built.photos === photos && built.coords === coords) {
      return;
    }
    const source = this.map?.getSource<GeoJSONSource>('classic-source');
    if (source === undefined) return;
    void source.setData(buildGeoJSON(photos));
    this.builtFrom = { photos, coords };
  }

  markerRadius = classicMarkerRadius;
}

function classicMarkerRadius(zoom: number) {
  // Matches hitAreaRadius stops
  const stops = [2, 6, 8, 10, 14, 16];
  return lerpStops(zoom, stops);
}

function lerpStops(zoom: number, stops: number[]) {
  if (zoom <= stops[0]!) return stops[1]!;
  for (let i = 0; i < stops.length - 2; i += 2) {
    const z0 = stops[i]!;
    const v0 = stops[i + 1]!;
    const z1 = stops[i + 2]!;
    const v1 = stops[i + 3]!;
    if (zoom <= z1) {
      const t = (zoom - z0) / (z1 - z0);
      return v0 + t * (v1 - v0);
    }
  }
  return stops[stops.length - 1]!;
}

/**
 * Northernmost marker first, so the ones below overlap the ones above — the
 * painter's order a field of pins wants.
 *
 * Carried by the array rather than `circle-sort-key`, which expresses the same
 * order but costs per frame: a key that differs per feature puts every marker
 * in its own segment, and MapLibre then rebuilds, re-sorts and re-issues that
 * whole list on every frame it draws — 4.8k draw calls a layer, three layers,
 * enough to drop frames on a spin of the globe. Ordering the features instead
 * is free: MapLibre draws a bucket in the order it was given.
 *
 * `index` stays the position in `photos`, which is what the click handler
 * looks up — it is the features that are reordered, not what they point at.
 */
function buildGeoJSON(photos: Photo[]): FeatureCollection<Point> {
  const placed = photos.map((photo, index) => ({
    index,
    uuid: photo.uuid,
    gps: photo.gps ?? 'none',
    ...edits.getEffectiveCoords(photo)
  }));
  // Ties break on the later photo first, as the retired sort key had them.
  placed.sort((a, b) => (a.lat === b.lat ? b.index - a.index : b.lat - a.lat));
  return {
    type: 'FeatureCollection',
    features: placed.map(({ index, uuid, gps, lon, lat }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { index, uuid, gps }
    }))
  };
}
