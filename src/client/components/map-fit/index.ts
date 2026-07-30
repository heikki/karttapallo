import { customElement } from 'lit/decorators.js';
import { LngLatBounds } from 'maplibre-gl';

import * as data from '@common/data';
import * as deepLink from '@common/deep-link';
import * as edits from '@common/edits';
import selection from '@common/selection';
import { effect } from '@common/signals';
import { mapViewFromUrl } from '@common/url-state';
import { MapFeatureElement } from '@components/map-view/api';

// Close enough to read the surroundings, wide enough to place a photo by
// eye. Shared by the single-photo fit and by deep links so both land the
// same way.
const SINGLE_PHOTO_ZOOM = 14;

function computePhotoBounds(): LngLatBounds {
  const bounds = new LngLatBounds();
  data.filteredPhotos.get().forEach((p) => {
    bounds.extend([p.lon ?? 0, p.lat ?? 0]);
  });
  return bounds;
}

function isSinglePointBounds(bounds: LngLatBounds) {
  return (
    bounds.getSouthWest().lng === bounds.getNorthEast().lng &&
    bounds.getSouthWest().lat === bounds.getNorthEast().lat
  );
}

@customElement('map-fit')
export class MapFit extends MapFeatureElement {
  override firstUpdated() {
    // A deep link owns the opening camera position outright — including over
    // a lat/lon in the URL, which for a deep link is only whatever the saved
    // view happened to carry.
    if (deepLink.pending()) {
      this.focusDeepLink();
      return;
    }
    if (mapViewFromUrl() === null && data.filteredPhotos.get().length > 0) {
      this.toPhotos();
    }
  }

  // Photos may not have arrived by the time the map finishes loading, so
  // wait for them instead of racing. A deep link that quietly did nothing
  // because it lost that race is worse than a camera move a beat late.
  private focusDeepLink() {
    let done = false;
    effect(() => {
      const photos = data.photos.get();
      if (done || photos.length === 0) return;
      done = true;

      const photo = deepLink.resolve(photos);
      if (photo === null) {
        this.toPhotos();
        return;
      }
      const loc = edits.getEffectiveLocation(photo);
      // No coordinates is an ordinary case here — supplying them is what the
      // link is usually for. The popup opens regardless and pans itself into
      // view; flying to null island first would only be noise.
      if (loc === null) return;
      this.api.map.flyTo({
        center: [loc.lon, loc.lat],
        zoom: SINGLE_PHOTO_ZOOM,
        duration: 0
      });
    });
  }

  toPhotos(animate = false, selectFirst = false) {
    if (data.filteredPhotos.get().length === 0) return;
    const bounds = computePhotoBounds();
    const duration = animate ? 500 : 0;
    const map = this.api.map;

    if (isSinglePointBounds(bounds)) {
      const center = bounds.getCenter();
      map.flyTo({
        center: [center.lng, center.lat],
        zoom: SINGLE_PHOTO_ZOOM,
        duration
      });
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

  private triggerPostFitActions(animate: boolean, selectFirst: boolean) {
    if (!selectFirst) return;
    if (animate) {
      void this.api.map.once('moveend', () => {
        selection.toggleOldestNewest();
      });
    } else {
      selection.toggleOldestNewest();
    }
  }

  private computeTopPadding() {
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
