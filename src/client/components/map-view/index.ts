import { ContextProvider } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { Map as MapGL } from 'maplibre-gl';

import * as edits from '@common/edits';
import selection from '@common/selection';
import type { MapFit } from '@components/map-fit';
import type { MapGpx } from '@components/map-gpx';
import type { MapMarkers } from '@components/map-markers';
import type { MapPopup } from '@components/map-popup';

import { mapContext, type MapApi } from './api';
import setupMap from './setup';

@customElement('map-view')
export class MapView extends LitElement implements MapApi {
  static override styles = css`
    :host {
      display: block;
      height: calc(100vh - 28px);
      width: 100%;
      position: relative;
    }
    :host(:focus) {
      outline: none;
    }
    #container {
      width: 100%;
      height: 100%;
      position: relative;
    }
    .maplibregl-canvas {
      background: transparent;
    }
    .maplibregl-canvas:focus {
      outline: none;
    }
    .maplibregl-popup-content {
      padding: 0 !important;
      border-radius: 12px !important;
      overflow: hidden;
      box-shadow:
        0 4px 24px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.12);
    }
    canvas.crosshair {
      cursor: crosshair !important;
    }
    canvas.cursor-pointer {
      cursor: pointer !important;
    }
    canvas.cursor-grabbing {
      cursor: grabbing !important;
    }
    #globe-bg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      pointer-events: none;
    }
  `;

  @state() private _map?: MapGL;

  // Self-reference handed to features via context. The element instance is
  // stable, so initialValue is fine — internal state changes (this._map flips
  // from undefined to the map) are exposed lazily through the getter/methods.
  private readonly _ctx = new ContextProvider(this, {
    context: mapContext,
    initialValue: this
  });

  // Cached references to feature children. @query with cache: true does the
  // shadow-root querySelector once on first read (after the children mount),
  // then returns the cached element on subsequent reads — removes the per-call
  // DOM scan from popup `popupOffset`, fit `computeTopPadding`, etc.
  @query('map-fit', true) private readonly _fit!: MapFit | null;
  @query('map-gpx', true) private readonly _gpx!: MapGpx | null;
  @query('map-markers', true) private readonly _markers!: MapMarkers | null;
  @query('map-popup', true) private readonly _popup!: MapPopup | null;

  override firstUpdated() {
    const container =
      this.renderRoot.querySelector<HTMLDivElement>('#container')!;
    const map = setupMap(container, this);
    void map.once('load', () => {
      this._map = map;
    });
  }

  // ---- MapApi ----

  /** The MapLibre map instance. Non-null after `load`; features only mount
   * post-load via the conditional template, so they can read it directly. */
  get map(): MapGL {
    return this._map!;
  }

  fitToPhotos(animate = false, selectFirst = false): void {
    this._fit?.toPhotos(animate, selectFirst);
  }

  reloadGpx(): void {
    this._gpx?.reloadTracks();
  }

  forceRemountPopup(): void {
    this._popup?.forceRemount();
  }

  popupElement(): HTMLElement | undefined {
    return this._popup?.get()?.getElement();
  }

  markerRadius(zoom: number): number {
    return this._markers?.getRadius(zoom) ?? 0;
  }

  openExternal(target: 'apple' | 'google'): void {
    if (this._map === undefined) return;
    const c = this._map.getCenter();
    const z = Math.round(this._map.getZoom());
    const photo = selection.getPhoto();
    const loc =
      photo === undefined
        ? undefined
        : (edits.getEffectiveLocation(photo) ?? undefined);

    if (target === 'apple') {
      const url =
        loc === undefined
          ? `maps://?ll=${c.lat},${c.lng}&z=${z}&t=k`
          : `maps://?ll=${loc.lat},${loc.lon}&q=${loc.lat},${loc.lon}&z=${z}&t=k`;
      window.open(url, '_blank');
    } else {
      const url =
        loc === undefined
          ? `https://www.google.com/maps/@${c.lat},${c.lng},${z}z`
          : `https://www.google.com/maps?q=${loc.lat},${loc.lon}&z=${z}`;
      window.open(url, '_blank');
    }
  }

  override render() {
    // Feature children mount only after the map's load event so they can
    // assume mapContext (a MapApi handle) resolves to a valid map. Order
    // is z-order, bottom to top.
    return html`
      <link rel="stylesheet" href="./maplibre-gl.css" />
      <div id="container"></div>
      ${this._map === undefined
        ? nothing
        : html`
            <map-gpx></map-gpx>
            <map-route></map-route>
            <map-markers></map-markers>
            <map-measure></map-measure>
            <map-popup></map-popup>
            <map-fit></map-fit>
            <map-placement></map-placement>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-view': MapView;
  }
}
