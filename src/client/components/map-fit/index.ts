import { customElement } from 'lit/decorators.js';
import { LngLatBounds } from 'maplibre-gl';

import * as data from '@common/data';
import selection from '@common/selection';
import { mapViewFromUrl } from '@common/url-state';
import { MapFeatureElement } from '@components/map-view/api';

function computePhotoBounds(): LngLatBounds {
  const bounds = new LngLatBounds();
  data.filteredPhotos
    .get()
    .forEach((p) => bounds.extend([p.lon ?? 0, p.lat ?? 0]));
  return bounds;
}

function isSinglePointBounds(bounds: LngLatBounds): boolean {
  return (
    bounds.getSouthWest().lng === bounds.getNorthEast().lng &&
    bounds.getSouthWest().lat === bounds.getNorthEast().lat
  );
}

@customElement('map-fit')
export class MapFit extends MapFeatureElement {
  override firstUpdated() {
    if (mapViewFromUrl() === null && data.filteredPhotos.get().length > 0) {
      this.toPhotos();
    }
  }

  toPhotos(animate = false, selectFirst = false): void {
    if (data.filteredPhotos.get().length === 0) return;
    const bounds = computePhotoBounds();
    const duration = animate ? 500 : 0;
    const map = this.api.map;

    if (isSinglePointBounds(bounds)) {
      const center = bounds.getCenter();
      map.flyTo({ center: [center.lng, center.lat], zoom: 14, duration });
      this.triggerPostFitActions(animate, selectFirst);
      return;
    }

    map.fitBounds(bounds, {
      padding: {
        top: this.computeTopPadding(),
        bottom: 40,
        left: 50,
        right: 270
      },
      maxZoom: 18,
      duration
    });
    this.triggerPostFitActions(animate, selectFirst);
  }

  private triggerPostFitActions(animate: boolean, selectFirst: boolean): void {
    if (!selectFirst) return;
    if (animate) {
      void this.api.map.once('moveend', () => {
        selection.toggleOldestNewest();
      });
    } else {
      selection.toggleOldestNewest();
    }
  }

  private computeTopPadding(): number {
    if (this.api.map.getProjection().type !== 'globe') return 350;
    const popupEl = this.api.popupElement();
    if (popupEl === undefined) return 50;
    return Math.max(50, popupEl.getBoundingClientRect().height + 60);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-fit': MapFit;
  }
}
