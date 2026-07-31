/**
 * Public surface of the photos-library module.
 *
 * Hides: AssetRecord, asset-index lookup, bundle-layout helpers, the
 * Photos.sqlite db handle's lifecycle. Callers see the live library handle,
 * the image cache, and the ad-hoc query primitives item-store needs for
 * rebuild.
 */

export {
  defaultLibraryPath,
  openPhotosDb,
  queryNotInAlbumUuid,
  queryPhotos,
  queryVideos
} from './db';
export type { PhotoRecord } from './db';
export { createImageCache } from './image-cache';
export type { ImageCache } from './image-cache';
export { openPhotosLibrary } from './library';
export type { PhotosLibrary } from './library';
export { readSceneLabels } from './search-index';
export {
  resolveLibrary,
  libraryDataDir,
  markLibraryDir,
  volumeOf
} from './resolve-library';
export type { LibraryResolution } from './resolve-library';
