import { customElement } from 'lit/decorators.js';
import type { MapLayerMouseEvent, PointLike } from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import * as interactionMode from '@common/interaction-mode';
import selection from '@common/selection';
import { effect } from '@common/signals';
import { MapFeatureElement } from '@components/map-view/api';

import { ClassicLayer } from './classic';

@customElement('map-markers')
export class MapMarkers extends MapFeatureElement {
  private readonly layer = new ClassicLayer();

  override firstUpdated() {
    this.layer.install(this.api.map);
    this.bindInteractions();
    this.refreshView();

    effect(() => {
      data.filteredPhotos.get();
      edits.pendingCoords.get();
      selection.selectedPhotoUuid.get();
      interactionMode.current.get();
      this.refreshView();
    });
  }

  getRadius(zoom: number) {
    return this.layer.markerRadius(zoom);
  }

  /**
   * Is a marker under this screen point? `<map-popup>` asks before treating a
   * click as a click on the map, rather than reading `defaultPrevented` from
   * the layer handler below: MapLibre's listener order decides which of the
   * two runs first, and that is not something another feature should depend
   * on.
   */
  hitTest(point: PointLike) {
    const map = this.api.map;
    if (map.getLayer(this.layer.id) === undefined) return false;
    return (
      map.queryRenderedFeatures(point, { layers: [this.layer.id] }).length > 0
    );
  }

  private refreshView() {
    const mode = interactionMode.current.get();
    this.layer.setView({
      photos: data.filteredPhotos.get(),
      coords: edits.pendingCoords.get(),
      selectedPhoto: selection.isPopupOpen()
        ? (selection.getPhoto() ?? null)
        : null,
      hidden: mode === 'placement'
    });
  }

  private bindInteractions() {
    const layerId = this.layer.id;
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
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-markers': MapMarkers;
  }
}
