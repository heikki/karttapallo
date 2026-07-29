/**
 * On-demand image conversion with disk cache.
 *
 * Converts photos/videos from Apple Photos library to JPEG on first access
 * and caches the result. Validates cache by comparing source file mtime.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  utimesSync
} from 'node:fs';
import { extname, join } from 'node:path';
import {
  convertToJpeg,
  extractVideoFrame,
  resizeToJpeg
} from '@native/native-bridge';

import { defaultLibraryPath, type AssetRecord } from './db';
import {
  PHOTO_EDIT_EXT,
  resolveEditedPath,
  resolveOriginalPath,
  VIDEO_EDIT_EXT
} from './paths';

interface ImageCacheConfig {
  cacheDir: string;
  libraryPath?: string;
}

export interface ImageCache {
  resolve: (
    uuid: string,
    size: 'full' | 'thumb',
    asset: AssetRecord
  ) => string | null;
  invalidate: (uuid: string) => void;
}

// ---------- Image helpers ----------

function createThumbnail(fullPath: string, thumbPath: string) {
  return resizeToJpeg(fullPath, thumbPath, 400);
}

// ---------- Source mtime ----------

function getSourceMtime(
  libraryPath: string,
  asset: AssetRecord
): number | null {
  // For edited assets, check the rendered version first
  if (asset.hasEdits) {
    const pattern = asset.type === 'video' ? VIDEO_EDIT_EXT : PHOTO_EDIT_EXT;
    const editedPath = resolveEditedPath(
      libraryPath,
      asset.directory,
      asset.filename,
      pattern
    );
    if (editedPath !== null) {
      try {
        return statSync(editedPath).mtimeMs;
      } catch {
        // fall through
      }
    }
  }
  const originalPath = resolveOriginalPath(
    libraryPath,
    asset.directory,
    asset.filename
  );
  if (originalPath === null) return null;
  try {
    return statSync(originalPath).mtimeMs;
  } catch {
    return null;
  }
}

// ---------- Conversion ----------

function convertEditedPhoto(
  libraryPath: string,
  directory: string | null,
  filename: string | null,
  outputPath: string
) {
  const renderedPath = resolveEditedPath(
    libraryPath,
    directory,
    filename,
    PHOTO_EDIT_EXT
  );
  if (renderedPath !== null) {
    const ext = extname(renderedPath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
      copyFileSync(renderedPath, outputPath);
      return true;
    }
    if (convertToJpeg(renderedPath, outputPath)) return true;
  }
  const originalPath = resolveOriginalPath(libraryPath, directory, filename);
  if (originalPath === null) return false;
  return convertToJpeg(originalPath, outputPath);
}

function convertOriginalPhoto(originalPath: string, outputPath: string) {
  const ext = extname(originalPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    copyFileSync(originalPath, outputPath);
    return true;
  }
  return convertToJpeg(originalPath, outputPath);
}

function convertFull(
  libraryPath: string,
  asset: AssetRecord,
  outputPath: string
) {
  const { directory, filename } = asset;

  if (asset.type === 'video') {
    const sourcePath =
      (asset.hasEdits
        ? resolveEditedPath(libraryPath, directory, filename, VIDEO_EDIT_EXT)
        : null) ?? resolveOriginalPath(libraryPath, directory, filename);
    if (sourcePath === null) return false;
    return extractVideoFrame(sourcePath, outputPath);
  }

  if (asset.hasEdits) {
    return convertEditedPhoto(libraryPath, directory, filename, outputPath);
  }

  const originalPath = resolveOriginalPath(libraryPath, directory, filename);
  if (originalPath === null) return false;
  return convertOriginalPhoto(originalPath, outputPath);
}

// ---------- Cache ----------

export function createImageCache(config: ImageCacheConfig): ImageCache {
  const { cacheDir } = config;
  const libraryPath = config.libraryPath ?? defaultLibraryPath();

  const fullDir = join(cacheDir, 'full');
  const thumbDir = join(cacheDir, 'thumb');
  mkdirSync(fullDir, { recursive: true });
  mkdirSync(thumbDir, { recursive: true });

  function isCacheValid(cachedPath: string, sourceMtime: number) {
    try {
      const cachedMtime = statSync(cachedPath).mtimeMs;
      return cachedMtime >= sourceMtime;
    } catch {
      return false;
    }
  }

  function resolve(
    uuid: string,
    size: 'full' | 'thumb',
    asset: AssetRecord
  ): string | null {
    const cachedFull = join(fullDir, `${uuid}.jpg`);
    const cachedThumb = join(thumbDir, `${uuid}.jpg`);
    const cachedPath = size === 'full' ? cachedFull : cachedThumb;

    // Check source mtime for cache validation
    const sourceMtime = getSourceMtime(libraryPath, asset);
    if (sourceMtime === null) return null; // source not available (iCloud-only)

    // Cache hit with valid mtime
    if (isCacheValid(cachedPath, sourceMtime)) {
      return cachedPath;
    }

    // Need to convert full-size first (thumb depends on it)
    if (!isCacheValid(cachedFull, sourceMtime)) {
      const ok = convertFull(libraryPath, asset, cachedFull);
      if (!ok) return null;
      // Stamp cached file mtime to match source
      const now = new Date();
      utimesSync(cachedFull, now, new Date(sourceMtime));
      // Invalidate thumb when full is reconverted
      try {
        unlinkSync(cachedThumb);
      } catch {
        /* ignore */
      }
    }

    // Generate thumbnail if needed
    if (size === 'thumb' && !existsSync(cachedThumb)) {
      const ok = createThumbnail(cachedFull, cachedThumb);
      if (!ok) return null;
      const now = new Date();
      utimesSync(cachedThumb, now, new Date(sourceMtime));
    }

    return cachedPath;
  }

  function invalidate(uuid: string) {
    try {
      unlinkSync(join(fullDir, `${uuid}.jpg`));
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(join(thumbDir, `${uuid}.jpg`));
    } catch {
      /* ignore */
    }
  }

  return { resolve, invalidate };
}
