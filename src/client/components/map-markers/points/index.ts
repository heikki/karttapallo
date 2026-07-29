import type { FeatureCollection, Point } from 'geojson';
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapGL
} from 'maplibre-gl';

import * as edits from '@common/edits';
import type { MarkerLayer, Photo } from '@common/types';

import { BloomLayer } from './bloom';

const hitAreaPaint: CircleLayerSpecification['paint'] = {
  'circle-color': 'transparent',
  'circle-radius': [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    4,
    6,
    8,
    10,
    12,
    16,
    16,
    22,
    20,
    30
  ],
  'circle-opacity': 0,
  'circle-pitch-alignment': 'map'
};

const dotPaint: CircleLayerSpecification['paint'] = {
  'circle-color': '#ffffff',
  'circle-radius': [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    4,
    1,
    8,
    2,
    12,
    3,
    16,
    5,
    20,
    7
  ],
  'circle-opacity': 1,
  'circle-blur': 0.4,
  'circle-pitch-alignment': 'map'
};

const sortKey = [
  '-',
  ['*', -1000000, ['get', 'lat']],
  ['get', 'index']
] as ExpressionSpecification;

const LAYERS: LayerSpecification[] = [
  {
    id: 'points-markers',
    type: 'circle',
    source: 'points-source',
    layout: { 'circle-sort-key': sortKey },
    paint: hitAreaPaint
  },
  {
    id: 'points-dot',
    type: 'circle',
    source: 'points-source',
    layout: { 'circle-sort-key': sortKey },
    paint: dotPaint
  },
  {
    id: 'points-selected',
    type: 'circle',
    source: 'points-source',
    paint: hitAreaPaint,
    filter: ['==', ['get', 'uuid'], '']
  }
];

const LAYER_IDS = LAYERS.map((l) => l.id);

export class PointsLayer implements MarkerLayer {
  readonly id = 'points-markers';
  private readonly bloom = new BloomLayer();
  private map: MapGL | null = null;

  install(map: MapGL, before: string) {
    this.map = map;
    map.addLayer(this.bloom, before);
    map.addSource('points-source', {
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
    if (this.map.getLayer(this.bloom.id) !== undefined) {
      this.map.removeLayer(this.bloom.id);
    }
    if (this.map.getSource('points-source') !== undefined) {
      this.map.removeSource('points-source');
    }
    this.map = null;
  }

  setView(view: {
    photos: Photo[];
    selectedPhoto: Photo | null;
    hidden: boolean;
  }) {
    if (this.map === null) return;
    this.applyPhotos(this.map, view.photos);
    this.applyVisibility(this.map, view.hidden);
    this.applySelection(this.map, view.selectedPhoto);
  }

  private applyPhotos(map: MapGL, photos: Photo[]) {
    const features: FeatureCollection<Point>['features'] = [];
    const positions: Array<{ lng: number; lat: number; uuid: string }> = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]!;
      const { lon, lat } = edits.getEffectiveCoords(photo);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          index: i,
          uuid: photo.uuid,
          lat,
          gps: photo.gps ?? 'none'
        }
      });
      positions.push({ lng: lon, lat, uuid: photo.uuid });
    }

    const source = map.getSource<GeoJSONSource>('points-source');
    if (source !== undefined) {
      source.setData({ type: 'FeatureCollection', features });
    }
    this.bloom.updateData(positions);
  }

  private applyVisibility(map: MapGL, hidden: boolean) {
    const v = hidden ? 'none' : 'visible';
    for (const id of LAYER_IDS) {
      if (map.getLayer(id) !== undefined) {
        map.setLayoutProperty(id, 'visibility', v);
      }
    }
    if (map.getLayer(this.bloom.id) !== undefined) {
      map.setLayoutProperty(this.bloom.id, 'visibility', v);
    }
  }

  private applySelection(map: MapGL, photo: Photo | null) {
    const filter: FilterSpecification =
      photo === null
        ? ['==', ['get', 'uuid'], '']
        : ['==', ['get', 'uuid'], photo.uuid];
    if (map.getLayer('points-selected') !== undefined) {
      map.setFilter('points-selected', filter);
    }
    if (photo === null) {
      this.bloom.setTime('', null);
    } else {
      this.bloom.setTime(photo.date, photo.tz ?? null);
    }
  }

  markerRadius = pointsMarkerRadius;
}

function pointsMarkerRadius(zoom: number) {
  // Matches dotPaint circle-radius: exponential 1.5 interpolation
  const base = 1.5;
  const stops = [4, 1, 8, 2, 12, 3, 16, 5, 20, 7];
  if (zoom <= stops[0]!) return stops[1]!;
  for (let i = 0; i < stops.length - 2; i += 2) {
    const z0 = stops[i]!;
    const v0 = stops[i + 1]!;
    const z1 = stops[i + 2]!;
    const v1 = stops[i + 3]!;
    if (zoom <= z1) {
      const t = (zoom - z0) / (z1 - z0);
      const factor = (base ** t - 1) / (base - 1);
      return v0 + (v1 - v0) * factor;
    }
  }
  return stops[stops.length - 1]!;
}
