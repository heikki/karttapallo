/**
 * Long-lived handle to the Apple Photos library used by HTTP request handlers.
 *
 * Hides:
 * - the long-lived Photos.sqlite read connection (lazy-opened so startup
 *   doesn't fail when Full Disk Access hasn't been granted yet — the metadata
 *   500 triggers the FDA dialog flow in src/server/index.ts)
 * - the asset index (uuid → AssetRecord) cache
 * - bundle-layout knowledge (originals vs. edited renditions)
 * - the on-demand image cache
 *
 * Item-store rebuild keeps its own short-lived db connection — different
 * lifetime, different concern.
 */

import type { Database } from 'bun:sqlite';

import {
  type AssetRecord,
  defaultLibraryPath,
  openPhotosDb,
  queryAssetIndex,
  queryMetadata
} from './db';
import type { ImageCache } from './image-cache';
import {
  resolveEditedPath,
  resolveOriginalPath,
  VIDEO_EDIT_EXT
} from './paths';

export interface PhotosLibrary {
  /** Cached image path; null if asset is missing or source unavailable. */
  resolveImagePath: (uuid: string, size: 'full' | 'thumb') => string | null;
  /** Original (or edited) video path; null if not a video or unavailable. */
  resolveVideoPath: (uuid: string) => string | null;
  /** Detailed metadata for the modal. */
  getMetadata: (uuid: string) => Record<string, unknown> | null;
}

interface OpenPhotosLibraryOptions {
  imageCache: ImageCache;
  libraryPath?: string;
}

export function openPhotosLibrary(
  options: OpenPhotosLibraryOptions
): PhotosLibrary {
  const { imageCache } = options;
  const resolvedPath = options.libraryPath ?? defaultLibraryPath();
  let db: Database | null = null;
  let assetIndex: Map<string, AssetRecord> | null = null;

  function getDb(): Database {
    db ??= openPhotosDb(resolvedPath);
    return db;
  }

  function getAssetIndex(): Map<string, AssetRecord> {
    if (assetIndex === null) {
      assetIndex = queryAssetIndex(getDb());
      console.log(
        `[image-cache] Loaded ${assetIndex.size} assets from Photos.sqlite`
      );
    }
    return assetIndex;
  }

  function resolveImagePath(
    uuid: string,
    size: 'full' | 'thumb'
  ): string | null {
    const asset = getAssetIndex().get(uuid);
    if (asset === undefined) return null;
    return imageCache.resolve(uuid, size, asset);
  }

  function resolveVideoPath(uuid: string): string | null {
    const asset = getAssetIndex().get(uuid);
    if (asset?.type !== 'video') return null;
    const edited = asset.hasEdits
      ? resolveEditedPath(
          resolvedPath,
          asset.directory,
          asset.filename,
          VIDEO_EDIT_EXT
        )
      : null;
    return (
      edited ??
      resolveOriginalPath(resolvedPath, asset.directory, asset.filename)
    );
  }

  return {
    resolveImagePath,
    resolveVideoPath,
    getMetadata: (uuid) => queryMetadata(getDb(), uuid)
  };
}
