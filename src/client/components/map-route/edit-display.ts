import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MapGL
} from 'maplibre-gl';

import * as data from '@common/data';
import type { Photo } from '@common/types';

import { buildLineFeatures } from './route-data';
import type { RouteData } from './route-data';

const EDIT_SOURCES = [
  'route-edit-line',
  'route-edit-points',
  'route-edit-hit',
  'route-edit-hover'
] as const;

const lineLayout = {
  'visibility': 'none' as const,
  'line-cap': 'round' as const,
  'line-join': 'round' as const
};

// Photo points: same size as classic markers (zoom-interpolated).
// Waypoints: half size.
const pointRadius = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  ['match', ['get', 'pointType'], 'photo', 3, 1.5],
  8,
  ['match', ['get', 'pointType'], 'photo', 6, 3],
  14,
  ['match', ['get', 'pointType'], 'photo', 10, 5]
] as unknown as number;

const outlineRadius = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  ['match', ['get', 'pointType'], 'photo', 4, 2],
  8,
  ['match', ['get', 'pointType'], 'photo', 7.5, 4],
  14,
  ['match', ['get', 'pointType'], 'photo', 12, 6.5]
] as unknown as number;

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

const EDIT_LAYERS: LayerSpecification[] = [
  {
    id: 'route-edit-line-outline',
    type: 'line',
    source: 'route-edit-line',
    paint: { 'line-color': 'rgba(0, 0, 0, 0.3)', 'line-width': 4 },
    layout: lineLayout
  },
  {
    id: 'route-edit-line-layer',
    type: 'line',
    source: 'route-edit-line',
    paint: { 'line-color': '#60a5fa', 'line-width': 2 },
    layout: lineLayout
  },
  {
    id: 'route-edit-hit-layer',
    type: 'line',
    source: 'route-edit-hit',
    paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 16 },
    layout: lineLayout
  },
  {
    id: 'route-edit-hover-layer',
    type: 'line',
    source: 'route-edit-hover',
    paint: { 'line-color': 'rgba(255, 255, 255, 0.6)', 'line-width': 6 },
    layout: lineLayout
  },
  // White outline circle behind colored fill (same approach as classic markers).
  {
    id: 'route-edit-points-outline',
    type: 'circle',
    source: 'route-edit-points',
    paint: {
      'circle-color': '#fff',
      'circle-radius': outlineRadius,
      'circle-pitch-alignment': 'map'
    },
    layout: { visibility: 'none' }
  },
  // Colored fill on top — GPS-based color, no stroke.
  {
    id: 'route-edit-points-layer',
    type: 'circle',
    source: 'route-edit-points',
    paint: {
      'circle-color': gpsColor,
      'circle-radius': pointRadius,
      'circle-pitch-alignment': 'map'
    },
    layout: { visibility: 'none' }
  }
];

export const ALL_EDIT_LAYERS = EDIT_LAYERS.map((l) => l.id);

export function createEditLayers(m: MapGL): void {
  const empty = { type: 'FeatureCollection' as const, features: [] };
  for (const id of EDIT_SOURCES) {
    m.addSource(id, { type: 'geojson', data: empty });
  }
  for (const spec of EDIT_LAYERS) m.addLayer(spec);
}

/** Bring edit-mode points on top of marker/photo layers added after our edit layers. */
export function raiseEditPoints(map: MapGL): void {
  if (map.getLayer('route-edit-points-outline') !== undefined) {
    map.moveLayer('route-edit-points-outline');
  }
  if (map.getLayer('route-edit-points-layer') !== undefined) {
    map.moveLayer('route-edit-points-layer');
  }
}

function updateLineSrc(map: MapGL, r: RouteData): void {
  const src = map.getSource<GeoJSONSource>('route-edit-line');
  if (src === undefined) return;
  src.setData({
    type: 'FeatureCollection',
    features: buildLineFeatures(r)
  });
}

export function updateEditSources(map: MapGL, r: RouteData): void {
  const pointsSrc = map.getSource<GeoJSONSource>('route-edit-points');
  if (pointsSrc !== undefined) {
    const photoMap = new Map<string, Photo>();
    for (const p of data.filteredPhotos.get()) photoMap.set(p.uuid, p);
    pointsSrc.setData({
      type: 'FeatureCollection',
      features: r.points.map((p, i) => ({
        type: 'Feature' as const,
        id: i,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: {
          index: i,
          pointType: p.type,
          uuid: p.uuid ?? '',
          gps:
            (p.uuid === undefined ? null : photoMap.get(p.uuid)?.gps) ?? 'none'
        }
      }))
    });
  }

  const hitSrc = map.getSource<GeoJSONSource>('route-edit-hit');
  if (hitSrc !== undefined) {
    hitSrc.setData({
      type: 'FeatureCollection',
      features: r.segments.map((seg, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: seg.geometry },
        properties: { segIndex: i }
      }))
    });
  }

  updateLineSrc(map, r);
}

export function setHoverSource(map: MapGL, geojson: object): void {
  const src = map.getSource<GeoJSONSource>('route-edit-hover');
  src?.setData(geojson as GeoJSON.GeoJSON);
}
