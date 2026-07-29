import { SignalWatcher } from '@lit-labs/signals';
import { css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { MapMouseEvent } from 'maplibre-gl';

import * as edits from '@common/edits';
import * as interactionMode from '@common/interaction-mode';
import selection from '@common/selection';
import { formatDate, getThumbUrl } from '@common/utils';
import { MapFeatureElement } from '@components/map-view/api';

function onPlacementClick(e: MapMouseEvent) {
  const uuid = selection.selectedPhotoUuid.get();
  if (uuid === null) {
    selection.clear();
    return;
  }
  e.preventDefault();
  edits.setCoord(uuid, e.lngLat.lat, e.lngLat.lng);
  // Selecting the same uuid cancels placement (back to popup view).
  selection.selectPhoto(uuid);
}

@customElement('map-placement')
export class MapPlacement extends SignalWatcher(MapFeatureElement) {
  static override styles = css`
    .panel {
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 1500;
      background: #2c2c2e;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
      padding: 8px;
      max-width: 160px;
      text-align: center;
    }
    img {
      width: 144px;
      height: 108px;
      object-fit: cover;
      border-radius: 6px;
      display: block;
    }
    .info {
      font-size: 11px;
      color: #98989d;
      margin-top: 4px;
    }
    .hint {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
  `;

  override firstUpdated() {
    interactionMode.defineMode('placement', {
      canEnter: () => selection.selectedPhotoUuid.get() !== null,
      onEnter: () => {
        this.api.map.on('click', onPlacementClick);
      },
      onExit: () => {
        this.api.map.off('click', onPlacementClick);
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Lit lifecycle
  override render() {
    if (interactionMode.current.get() !== 'placement') return nothing;
    const photo = selection.getPhoto();
    if (photo === undefined) return nothing;
    return html`
      <div class="panel">
        <img src=${getThumbUrl(photo)} alt="" />
        <div class="info">${formatDate(photo.date, photo.tz)}</div>
        <div class="hint">Click map to set location. Esc to cancel.</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-placement': MapPlacement;
  }
}
