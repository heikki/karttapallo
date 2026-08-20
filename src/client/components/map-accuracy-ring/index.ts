import { customElement } from 'lit/decorators.js';
import type { GeoJSONSource, LayerSpecification } from 'maplibre-gl';

import * as edits from '@common/edits';
import { infoPanelOpen } from '@common/panels';
import selection from '@common/selection';
import { effect } from '@common/signals';
import { MapFeatureElement } from '@components/map-view/api';

import { accuracyRing, ringFeature, type AccuracyRing } from './geometry';

const SOURCE = 'accuracy-ring';

const LAYER: LayerSpecification = {
  id: 'accuracy-ring',
  type: 'line',
  source: SOURCE,
  paint: {
    // The Exif marker color, since an Exif photo is the only kind that can
    // have a ring. Dashed so it stays distinct from the solid selection ring,
    // which it sits almost on top of around zoom 18. No fill: the ground
    // inside the circle is exactly what the user is reading to find the
    // real spot.
    'line-color': '#3b82f6',
    'line-width': 1.5,
    'line-opacity': 0.9,
    'line-dasharray': [3, 3]
  },
  layout: { 'visibility': 'visible', 'line-cap': 'round', 'line-join': 'round' }
};

@customElement('map-accuracy-ring')
export class MapAccuracyRing extends MapFeatureElement {
  override firstUpdated() {
    const map = this.api.map;
    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer(LAYER);

    effect(() => {
      // Every dependency read before anything can return early — see the
      // tracking caveat on `effect`.
      const panelOpen = infoPanelOpen.get();
      const photo = selection.getPhoto() ?? null;
      const pending = edits.pendingCoords.get();
      this.draw(
        accuracyRing(photo, {
          panelOpen,
          edited: photo !== null && pending.has(photo.uuid)
        })
      );
    });
  }

  private draw(ring: AccuracyRing | null) {
    const source = this.api.map.getSource<GeoJSONSource>(SOURCE);
    if (source === undefined) return;
    source.setData({
      type: 'FeatureCollection',
      features: ring === null ? [] : [ringFeature(ring)]
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-accuracy-ring': MapAccuracyRing;
  }
}
