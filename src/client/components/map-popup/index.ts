import { customElement } from 'lit/decorators.js';
import { Popup } from 'maplibre-gl';

import * as actions from '@common/actions';
import * as edits from '@common/edits';
import * as interactionMode from '@common/interaction-mode';
import selection from '@common/selection';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';
import { getThumbUrl } from '@common/utils';
import { viewState } from '@common/view-state';
import { MapFeatureElement } from '@components/map-view/api';
import type { PhotoPopup } from '@components/photo-popup';

import * as gestures from './gestures';
import * as globeMask from './globe-mask';
import { flyToPopupTo, panToFitPopup } from './pan';

// Decode the new thumb before we swap it onto the popup, so the
// browser paints the image and the popup move in the same frame —
// no intermediate jitter from a half-loaded image resizing it.
async function preloadThumb(photo: Photo) {
  const img = new Image();
  img.src = getThumbUrl(photo);
  try {
    await img.decode();
  } catch {
    /* fall through; caller proceeds with whatever the browser shows */
  }
}

// The card shows only when the selection has one to show and the user hasn't
// hidden it. Kept out of `isPopupOpen` so the markers layer goes on
// highlighting the selected photo while the card is away.
function shouldShowPopup() {
  return selection.isPopupOpen() && selection.popupRevealed.get();
}

@customElement('map-popup')
export class MapPopup extends MapFeatureElement {
  // The three move in lockstep: set together when the popup opens, cleared
  // together on close. Bundling them makes the invariant explicit.
  private mounted: {
    popup: Popup;
    el: PhotoPopup;
    uuid: string;
  } | null = null;
  // Set during forceRemount so the 'close' handler skips its
  // external-teardown remount.
  private suppressCloseRemount = false;
  private navSeq = 0;

  override firstUpdated() {
    this.api.map.on('zoomend', () => {
      this.reanchorPopup();
    });

    document.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });

    // Defer so markers' effect swaps the layer first; getRadius() then
    // returns the new style's radius.
    let lastMarkerStyle = viewState.markerStyle.get();
    effect(() => {
      const next = viewState.markerStyle.get();
      if (next === lastMarkerStyle) return;
      lastMarkerStyle = next;
      queueMicrotask(() => {
        this.reanchorPopup();
      });
    });

    effect(() => {
      edits.pendingCoords.get();
      selection.selectedPhotoUuid.get();
      selection.popupRevealed.get();
      interactionMode.current.get();
      this.applySelection();
    });
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.handleEscape(e);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const moved = e.key === 'ArrowLeft' ? selection.prev() : selection.next();
      if (moved) e.preventDefault();
      return;
    }
    if (e.key === ' ') {
      const idx = selection.getPhotoIndex();
      if (idx === null) return;
      e.preventDefault();
      // Space steps one rung toward the photo rather than past it: a hidden
      // card comes back, and only from the card does it go full-screen —
      // otherwise Space is the one key that acts on a photo you cannot see.
      if (selection.popupRevealed.get()) actions.showLightbox(idx);
      else selection.revealPopup();
    }
  }

  // Escape priority: date-edit > interaction mode > popup. Date edit wins so a
  // stray Escape doesn't lose the edit row; exiting a mode outranks hiding, so
  // Escape from placement returns you to the popup rather than past it. The
  // bottom rung hides the card and leaves the selection standing (ADR-0016).
  //
  // Overlays that claim Escape stop it before it reaches this document
  // listener, and each of them registers first: <filter-panel> and
  // <files-modal> on the capture phase, <photo-lightbox> from a
  // connectedCallback during app-root's first render — while map features
  // mount only after the map's `load` event (see map-view/index.ts).
  private handleEscape(e: KeyboardEvent) {
    e.preventDefault();
    if (this.mounted?.el.closeDateEdit() === true) return;
    if (interactionMode.current.get() !== null) {
      interactionMode.exit();
      return;
    }
    selection.togglePopup();
  }

  /** Current MapLibre Popup, if any. */
  get(): Popup | null {
    return this.mounted?.popup ?? null;
  }

  /**
   * Force a full unmount/remount; the same-uuid path otherwise just syncs
   * in place, leaving the popup anchored to the old projection.
   */
  forceRemount() {
    if (this.mounted === null) return;
    this.suppressCloseRemount = true;
    this.mounted.popup.remove();
    this.suppressCloseRemount = false;
    this.applySelection();
  }

  private popupOffset(): [number, number] {
    const z = this.api.map.getZoom();
    const radius = this.api.markerRadius(z);
    return [0, -(radius * 1.3 + 5)];
  }

  private reanchorPopup() {
    if (this.mounted === null) return;
    if (!this.mounted.popup.isOpen()) return;
    // Just update the offset — no remove/addTo cycle.
    // Removing and re-adding the popup during a zoomend handler causes
    // re-entrant rendering (ResizeObserver → redraw → TaskQueue crash).
    this.mounted.popup.setOffset(this.popupOffset());
  }

  private applySelection() {
    const photo = shouldShowPopup() ? selection.getPhoto() : undefined;
    if (photo === undefined) {
      this.mounted?.popup.remove();
    } else if (this.mounted === null) {
      this.openPopup(photo);
    } else if (this.mounted.uuid === photo.uuid) {
      // Pending edit moved this photo; sync in place.
      this.movePopupTo(photo);
    } else {
      // Selection moved to a different photo; animate.
      void this.flyPopupTo(photo);
    }
  }

  private openPopup(photo: Photo) {
    const { lon, lat } = edits.getEffectiveCoords(photo);
    const idx = selection.getPhotoIndex() ?? 0;

    const el = document.createElement('photo-popup') as PhotoPopup;
    el.photo = photo;
    el.index = idx;

    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: '320px',
      anchor: 'bottom',
      offset: this.popupOffset(),
      subpixelPositioning: true
    })
      .setLngLat([lon, lat])
      .setDOMContent(el)
      .addTo(this.api.map);

    gestures.attach(this.api.map, popup);
    globeMask.attach(this.api.map, popup);
    this.mounted = { popup, el, uuid: photo.uuid };

    popup.on('close', () => {
      this.mounted = null;
      if (!this.suppressCloseRemount && shouldShowPopup()) {
        // Closed via MapLibre's own teardown (e.g. setStyle). The selection
        // outlives the popup, so put it back — deferred because we're inside
        // `remove()`, and building a popup there re-enters MapLibre's render.
        queueMicrotask(() => {
          this.applySelection();
        });
      }
    });

    panToFitPopup(this.api.map, popup);
  }

  private movePopupTo(photo: Photo) {
    if (this.mounted === null) return;
    const idx = selection.getPhotoIndex() ?? 0;
    const { lon, lat } = edits.getEffectiveCoords(photo);
    this.setContent(photo, idx);
    this.mounted.popup.setLngLat([lon, lat]);
    flyToPopupTo(this.api.map, this.mounted.popup, [lon, lat]);
  }

  private async flyPopupTo(photo: Photo) {
    const seq = ++this.navSeq;
    await preloadThumb(photo);
    // Selection or popup may have changed during the await; bail if so.
    if (seq !== this.navSeq) return;
    if (this.mounted === null) return;
    if (selection.getPhoto()?.uuid !== photo.uuid) return;

    const idx = selection.getPhotoIndex() ?? 0;
    const loc = edits.getEffectiveLocation(photo);
    const lng = loc?.lon ?? 0;
    const lat = loc?.lat ?? 0;

    this.mounted.uuid = photo.uuid;
    this.setContent(photo, idx);
    this.mounted.popup.setLngLat([lng, lat]);
    flyToPopupTo(this.api.map, this.mounted.popup, [lng, lat]);
  }

  private setContent(photo: Photo, index: number) {
    if (this.mounted === null) return;
    const { el } = this.mounted;
    el.photo = photo;
    el.index = index;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-popup': MapPopup;
  }
}
