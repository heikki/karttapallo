import { customElement } from 'lit/decorators.js';
import type { MapLayerMouseEvent } from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import * as interactionMode from '@common/interaction-mode';
import selection from '@common/selection';
import { effect } from '@common/signals';
import type { MarkerLayer } from '@common/types';
import { viewState } from '@common/view-state';
import { MapFeatureElement } from '@components/map-view/api';

import { ClassicLayer } from './classic';
import { PointsLayer } from './points';

const markerStyles: Record<string, () => MarkerLayer> = {
  points: () => new PointsLayer(),
  classic: () => new ClassicLayer()
};

// Persistent invisible symbol layer that markers' own layers stack
// just below — preserves marker z-position across classic↔points swaps,
// since the implementation layers come and go but the anchor never does.
const ANCHOR = 'markers-anchor';

@customElement('map-markers')
export class MapMarkers extends MapFeatureElement {
  private currentStyle = 'classic';
  private currentLayer: MarkerLayer | null = null;
  private interactionCleanup: (() => void) | null = null;

  override firstUpdated() {
    const map = this.api.map;

    if (map.getSource(ANCHOR) === undefined) {
      map.addSource(ANCHOR, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    if (map.getLayer(ANCHOR) === undefined) {
      map.addLayer({ id: ANCHOR, type: 'symbol', source: ANCHOR });
    }

    this.install();
    this.bindInteractions();
    this.refreshView();

    effect(() => {
      const style = viewState.markerStyle.get();
      if (!(style in markerStyles)) return;
      if (style === this.currentStyle) return;
      this.currentStyle = style;
      if (this.currentLayer === null) return;
      this.install();
      this.bindInteractions();
      this.refreshView();
    });

    effect(() => {
      data.filteredPhotos.get();
      edits.pendingCoords.get();
      selection.selectedPhotoUuid.get();
      interactionMode.current.get();
      this.refreshView();
    });
  }

  getRadius(zoom: number) {
    return this.currentLayer?.markerRadius(zoom) ?? 0;
  }

  private refreshView() {
    if (this.currentLayer === null) return;
    const mode = interactionMode.current.get();
    this.currentLayer.setView({
      photos: data.filteredPhotos.get(),
      selectedPhoto: selection.isPopupOpen()
        ? (selection.getPhoto() ?? null)
        : null,
      hidden: mode === 'placement'
    });
  }

  private install() {
    this.currentLayer?.uninstall();
    this.currentLayer = markerStyles[this.currentStyle]!();
    this.currentLayer.install(this.api.map, ANCHOR);
  }

  private bindInteractions() {
    this.interactionCleanup?.();

    const layerId = this.currentLayer?.id;
    if (layerId === undefined) return;

    const map = this.api.map;
    const canvas = map.getCanvas();

    function onLayerClick(e: MapLayerMouseEvent) {
      if (interactionMode.current.get() === 'placement') return;
      e.preventDefault();
      e.originalEvent.stopPropagation();
      if (e.features === undefined || e.features.length === 0) return;
      const feature = e.features[0]!;
      const clickedIndex = feature.properties.index as number | undefined;
      if (clickedIndex === undefined) return;
      const photo = data.filteredPhotos.get()[clickedIndex];
      if (photo === undefined) return;
      selection.selectPhoto(photo.uuid);
    }

    function onMouseEnter() {
      if (interactionMode.current.get() !== 'placement') {
        canvas.style.cursor = 'pointer';
      }
    }
    function onMouseLeave() {
      if (interactionMode.current.get() !== 'placement') {
        canvas.style.cursor = '';
      }
    }

    map.on('click', layerId, onLayerClick);
    map.on('mouseenter', layerId, onMouseEnter);
    map.on('mouseleave', layerId, onMouseLeave);

    this.interactionCleanup = () => {
      map.off('click', layerId, onLayerClick);
      map.off('mouseenter', layerId, onMouseEnter);
      map.off('mouseleave', layerId, onMouseLeave);
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-markers': MapMarkers;
  }
}
