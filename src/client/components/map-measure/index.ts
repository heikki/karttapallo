import { SignalWatcher } from '@lit-labs/signals';
import turfDistance from '@turf/distance';
import { point } from '@turf/helpers';
import { css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type {
  GeoJSONSource,
  LayerSpecification,
  MapMouseEvent
} from 'maplibre-gl';

import selection from '@common/selection';
import { effect } from '@common/signals';
import {
  MapFeatureElement,
  setLayersVisibility
} from '@components/map-view/api';

const SOURCES = ['measure-points', 'measure-line'] as const;
const LAYERS: LayerSpecification[] = [
  {
    id: 'measure-line-layer',
    type: 'line',
    source: 'measure-line',
    paint: {
      'line-color': '#ff4444',
      'line-width': 2,
      'line-dasharray': [3, 2]
    },
    layout: { visibility: 'none' }
  },
  {
    id: 'measure-points-layer',
    type: 'circle',
    source: 'measure-points',
    paint: {
      'circle-radius': 6,
      'circle-color': '#ff4444',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff'
    },
    layout: { visibility: 'none' }
  }
];
const LAYER_IDS = LAYERS.map((l) => l.id);

function isActive(): boolean {
  return selection.interactionMode.get() === 'measure';
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') selection.interactionMode.set('idle');
}

function computeDistance(coords: ReadonlyArray<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += turfDistance(point(coords[i - 1]!), point(coords[i]!), {
      units: 'kilometers'
    });
  }
  return total;
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

@customElement('map-measure')
export class MapMeasure extends SignalWatcher(MapFeatureElement) {
  static override styles = css`
    .overlay {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(44, 44, 46, 0.92);
      color: #e5e5e7;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      z-index: 1500;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }
  `;

  @state() private coords: Array<[number, number]> = [];
  private readonly onMapClick = (e: MapMouseEvent): void => {
    // Click on existing measure point removes it.
    const features = this.api.map.queryRenderedFeatures(e.point, {
      layers: ['measure-points-layer']
    });
    if (features.length > 0) {
      const idx = features[0]!.properties.index as number;
      this.coords = this.coords.filter((_, i) => i !== idx);
      return;
    }

    if (e.defaultPrevented) return;

    this.coords = [...this.coords, [e.lngLat.lng, e.lngLat.lat]];
  };

  static toggle(): void {
    selection.interactionMode.set(isActive() ? 'idle' : 'measure');
  }

  override firstUpdated() {
    this.addLayers();

    let wasActive = false;
    effect(() => {
      const active = isActive();
      if (active === wasActive) return;
      wasActive = active;
      if (active) this.onEnter();
      else this.onExit();
    });
  }

  private addLayers(): void {
    const map = this.api.map;
    for (const id of SOURCES) {
      map.addSource(id, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    for (const spec of LAYERS) map.addLayer(spec);
    if (isActive()) {
      setLayersVisibility(map, LAYER_IDS, true);
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('coords')) this.updateSources();
  }

  override render() {
    if (!isActive()) return nothing;
    if (this.coords.length === 0) {
      return html`<div class="overlay">Click map to add points</div>`;
    }
    if (this.coords.length === 1) {
      return html`<div class="overlay">Click to add more points</div>`;
    }
    return html`<div class="overlay">
      ${formatDistance(computeDistance(this.coords))}
    </div>`;
  }

  private updateSources(): void {
    const pointSource = this.api.map.getSource<GeoJSONSource>('measure-points');
    if (pointSource !== undefined) {
      pointSource.setData({
        type: 'FeatureCollection',
        features: this.coords.map((c, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: c },
          properties: { index: i }
        }))
      });
    }

    const lineSource = this.api.map.getSource<GeoJSONSource>('measure-line');
    if (lineSource !== undefined) {
      lineSource.setData(
        this.coords.length >= 2
          ? {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: this.coords },
              properties: {}
            }
          : { type: 'FeatureCollection', features: [] }
      );
    }
  }

  private onEnter(): void {
    this.coords = [];
    this.api.map.getCanvas().classList.add('crosshair');
    setLayersVisibility(this.api.map, LAYER_IDS, true);
    this.api.map.on('click', this.onMapClick);
    document.addEventListener('keydown', onKeyDown);
  }

  private onExit(): void {
    this.coords = [];
    this.api.map.getCanvas().classList.remove('crosshair');
    setLayersVisibility(this.api.map, LAYER_IDS, false);
    this.api.map.off('click', this.onMapClick);
    document.removeEventListener('keydown', onKeyDown);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-measure': MapMeasure;
  }
}
