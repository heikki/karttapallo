import { showAlbumFiles } from '@components/files-modal';
import { refreshInfo } from '@components/info-panel';
import { showLightbox } from '@components/photo-lightbox';

import { saveEdits as saveEditsImpl } from '../save';

export { refreshInfo, showAlbumFiles, showLightbox };

function getMapView(): HTMLElementTagNameMap['map-view'] | null {
  return document.querySelector('map-view');
}

export function fitToPhotos(animate = false, selectFirst = false) {
  getMapView()?.fitToPhotos(animate, selectFirst);
}

export function openExternalMap(provider: 'apple' | 'google') {
  getMapView()?.openExternal(provider);
}

export function reloadAlbumGpx() {
  getMapView()?.reloadGpx();
}

export function saveEdits() {
  void saveEditsImpl();
}
