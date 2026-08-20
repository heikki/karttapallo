/**
 * Everything the app holds open for one Library: the item store, the album
 * store, the image cache, the ORS client, and the API routes over them. Opened
 * once per launch and bound to the Library resolved at startup, which is why
 * nothing in here survives a library switch (ADR-0012).
 *
 * Owns construction *and* startup order, both of which have real constraints:
 * the cache root is claimed before the image cache exists (a claim wipes a root
 * it doesn't own, and the image cache creates its subdirectories at
 * construction), and orphaned album subtrees are pruned only after a rebuild
 * has proved the library readable.
 *
 * Deliberately outside: resolving the Library and reporting a failed
 * resolution, serving HTTP, and where the cache root and support dir live. Each
 * of the three entries answers those differently — see docs/app.md.
 */

import { join } from 'node:path';

import { createAlbumStore } from './album-store';
import { createApiHandler, type EditResultEvent } from './api-routes';
import { claimCacheRoot } from './cache-root';
import { openItemStore, type ItemEntry } from './item-store';
import { createOrsClient } from './ors-client';
import { createPhotosWriter, type PhotosWriter } from './photos-edit';
import {
  createImageCache,
  openPhotosLibrary,
  readAlbums,
  resolveLibrary,
  type AlbumRoster,
  type LibraryResolution,
  type PhotosLibrary
} from './photos-library';
import { getSetting, setSetting } from './state';

/**
 * The slots the E2E entry substitutes so a run touches no Apple Photos library.
 * Every one of them is a seam the module below already exposes; the session
 * forwards them rather than inventing its own.
 */
export interface LibraryAdapters {
  /** Image and video bytes, and the metadata behind the Info panel. */
  photosLibrary?: PhotosLibrary;
  /** Where location and date edits are written. */
  photosWriter?: PhotosWriter;
  /** The item snapshot's source; defaults to reading Photos.sqlite. */
  buildFreshItems?: () => ItemEntry[];
  /** The Roster album directories are keyed against. */
  loadAlbums?: () => AlbumRoster[];
  /** Write-time active-library guard; defaults to the real resolver. */
  resolveActiveLibrary?: () => LibraryResolution;
}

export interface OpenLibrarySessionOptions {
  /** Already resolved — the entry owns how a failed resolution is surfaced. */
  libraryPath: string;
  /** Machine-scoped settings root, for the ORS API key. */
  supportDir: string;
  /** Derived-data root. Its *location* is the entry's choice; its contents are not. */
  cacheRoot: string;
  adapters?: LibraryAdapters;
  /** Per-edit callback fired during save-edits — the dev entry logs them. */
  onEditResult?: (event: EditResultEvent) => void;
}

export interface LibrarySession {
  /** Route an API request; null if the path matches no API route. */
  routeApiRequest: (
    req: Request,
    pathname: string
  ) => Promise<Response | null> | Response | null;
  /** True once the post-startup rebuild swapped in items that differ. */
  rebuildComplete: Promise<boolean>;
  /** Rebuild the snapshot from the library ("Sync Photos"). */
  rebuild: () => Promise<boolean>;
  /** Drop every converted image; they are re-made on demand (ADR-0010). */
  clearImageCache: () => void;
  /** The view params saved against this Library, or none. */
  savedView: () => Record<string, string>;
}

export function openLibrarySession(
  options: OpenLibrarySessionOptions
): LibrarySession {
  const { libraryPath, supportDir, cacheRoot, onEditResult } = options;
  const adapters = options.adapters ?? {};

  // The Bundle store: the Library's own data, inside the bundle so it travels
  // with it (ADR-0015). Derived here rather than passed in — which directory
  // holds a Library's data is a fact about Libraries, not about this entry.
  const bundleDir = join(libraryPath, 'karttapallo');
  console.log(`[session] Library data: ${bundleDir}`);

  const cache = claimCacheRoot(cacheRoot, libraryPath);

  const imageCache = createImageCache({
    cacheDir: cache.imagesDir,
    libraryPath
  });
  const photosLibrary =
    adapters.photosLibrary ?? openPhotosLibrary({ imageCache, libraryPath });
  const itemStore = openItemStore({
    snapshotPath: cache.snapshotPath,
    imageCache,
    libraryPath,
    photosWriter: adapters.photosWriter ?? createPhotosWriter(libraryPath),
    buildFreshItems: adapters.buildFreshItems,
    resolveActiveLibrary: adapters.resolveActiveLibrary ?? resolveLibrary
  });
  const albumStore = createAlbumStore(
    bundleDir,
    adapters.loadAlbums ?? (() => readAlbums(libraryPath))
  );
  const orsClient = createOrsClient(supportDir);

  function savedView(): Record<string, string> {
    try {
      const raw = getSetting(bundleDir, 'view');
      if (raw === null) return {};
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  // Prune after the rebuild rather than at startup: a rebuild that finished is
  // the one moment we know the library was readable, which is what makes a
  // missing album mean the user deleted it.
  itemStore.rebuildComplete
    .then(() => {
      albumStore.pruneOrphans();
    })
    .catch(() => {
      /* a failed rebuild says nothing about which albums are live */
    });

  const { routeApiRequest } = createApiHandler({
    saveView: (params) => {
      setSetting(bundleDir, 'view', JSON.stringify(params));
    },
    itemStore,
    photosLibrary,
    albumStore,
    orsClient,
    onEditResult
  });

  return {
    routeApiRequest,
    rebuildComplete: itemStore.rebuildComplete,
    rebuild: itemStore.rebuild,
    clearImageCache: imageCache.clear,
    savedView
  };
}
