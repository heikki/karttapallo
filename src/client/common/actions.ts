import { showAlbumFiles } from '@components/files-modal';
import { refreshMetadata, showMetadata } from '@components/metadata-modal';
import { showLightbox } from '@components/photo-lightbox';

import { saveEdits as saveEditsImpl } from '../save';

export { refreshMetadata, showAlbumFiles, showLightbox, showMetadata };

function getMapView(): HTMLElementTagNameMap['map-view'] | null {
  return document.querySelector('map-view');
}

export function fitToPhotos(animate = false, selectFirst = false): void {
  getMapView()?.fitToPhotos(animate, selectFirst);
}

export function openExternalMap(provider: 'apple' | 'google'): void {
  getMapView()?.openExternal(provider);
}

export function reloadAlbumGpx(): void {
  getMapView()?.reloadGpx();
}

export function saveEdits(): void {
  void saveEditsImpl();
}
