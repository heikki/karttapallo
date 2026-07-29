import type { FeatureCollection, Point } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapGL
} from 'maplibre-gl';

import * as edits from '@common/edits';
import type { MarkerLayer, Photo } from '@common/types';

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

const sortKey = [
  '-',
  ['*', -1000000, ['get', 'lat']],
  ['get', 'index']
] as ExpressionSpecification;

const LAYERS: LayerSpecification[] = [
  // Transparent hit area — larger than visible markers for easier clicking.
  {
    id: 'classic-hit-area',
    type: 'circle',
    source: 'classic-source',
    layout: { 'circle-sort-key': sortKey },
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
    layout: { 'circle-sort-key': sortKey },
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
    layout: { 'circle-sort-key': sortKey },
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

export class ClassicLayer implements MarkerLayer {
  readonly id = 'classic-hit-area';
  private map: MapGL | null = null;

  install(map: MapGL, before: string) {
    this.map = map;

    map.addSource('classic-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: 22
    });

    for (const spec of LAYERS) map.addLayer(spec, before);
  }

  uninstall() {
    if (this.map === null) return;
    for (let i = LAYER_IDS.length - 1; i >= 0; i--) {
      const id = LAYER_IDS[i]!;
      if (this.map.getLayer(id) !== undefined) {
        this.map.removeLayer(id);
      }
    }
    if (this.map.getSource('classic-source') !== undefined) {
      this.map.removeSource('classic-source');
    }
    this.map = null;
  }

  setView(view: {
    photos: Photo[];
    selectedPhoto: Photo | null;
    hidden: boolean;
  }) {
    if (this.map === null) return;

    const source = this.map.getSource<GeoJSONSource>('classic-source');
    if (source !== undefined) source.setData(buildGeoJSON(view.photos));

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

function buildGeoJSON(photos: Photo[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: photos.map((photo, index) => {
      const { lon, lat } = edits.getEffectiveCoords(photo);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          index,
          uuid: photo.uuid,
          lat,
          gps: photo.gps ?? 'none'
        }
      };
    })
  };
}
