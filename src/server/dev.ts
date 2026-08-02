import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import indexHtml from '@client/index.html';
import { serve } from 'bun';

import { createAlbumStore } from './album-store';
import { createApiHandler, type EditResultEvent } from './api-routes';
import { claimCacheRoot } from './cache-root';
import { openItemStore } from './item-store';
import { createOrsClient } from './ors-client';
import { createPhotosWriter } from './photos-edit';
import {
  createImageCache,
  openPhotosLibrary,
  readAlbums,
  resolveLibrary
} from './photos-library';
import { createRequestHandler } from './request-handler';

const supportDir = '.data';

// Resolve the active Photos library, failing loud (ADR 0012) — the dev server
// has no UI to recover, so a clear message + non-zero exit is the right move.
const resolved = resolveLibrary();
if (!resolved.ok) {
  if (resolved.error === 'fda') {
    console.error(
      `[main] Cannot read Photos library: ${resolved.message}\n` +
        '       Grant Full Disk Access to your terminal and retry.'
    );
  } else {
    const where = resolved.volume ?? 'an unavailable location';
    console.error(
      `[main] Photos library not available — it lives on ${where}.\n` +
        `       (${resolved.libraryPath})\n` +
        '       Connect the drive and retry.'
    );
  }
  process.exit(1);
}
const libraryPath = resolved.path;
mkdirSync(supportDir, { recursive: true });

// Handmade data inside the library, derived data beside the dev support dir —
// the same split the desktop entry makes, just without ~/Library.
const bundleDir = join(libraryPath, 'karttapallo');
const cacheRoot = claimCacheRoot(join(supportDir, 'derived'), libraryPath);
console.log(`[main] Library: ${libraryPath}`);
console.log(`[main] Library data: ${bundleDir}`);
console.log(`[main] Derived data: ${cacheRoot}`);

const imageCache = createImageCache({
  cacheDir: join(cacheRoot, 'cache'),
  libraryPath
});
const photosLibrary = openPhotosLibrary({ imageCache, libraryPath });
const itemStore = openItemStore({
  cacheRoot,
  imageCache,
  libraryPath,
  photosWriter: createPhotosWriter(libraryPath)
});
const albumStore = createAlbumStore(bundleDir, () => readAlbums(libraryPath));
const orsClient = createOrsClient(supportDir);

function logEditResult(event: EditResultEvent) {
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const label = event.kind === 'location' ? '📍' : '⏰';
  if (event.ok) {
    console.log(`    ${label} ${dim}${event.uuid}${reset}`);
  } else {
    console.log(
      `    ${label} \x1b[31m✗${reset} ${dim}${event.uuid}${reset}\n         ${dim}${event.error ?? ''}${reset}`
    );
  }
}
itemStore.rebuildComplete
  .then((changed) => {
    console.log(
      changed
        ? '[item-store] Rebuilt: items changed'
        : '[item-store] Rebuilt: no changes'
    );
    // A finished rebuild is the one moment we know the library was readable,
    // which is what makes a missing album mean the user deleted it.
    albumStore.pruneOrphans();
  })
  .catch((err: unknown) => {
    console.error('[item-store] Rebuild failed:', err);
  });

const { routeApiRequest } = createApiHandler(bundleDir, {
  itemStore,
  photosLibrary,
  albumStore,
  orsClient,
  onEditResult: logEditResult
});

const methodColors: Record<string, string> = {
  GET: '\x1b[36m',
  POST: '\x1b[33m',
  PUT: '\x1b[35m',
  DELETE: '\x1b[31m'
};

function logRequest(
  method: string,
  pathname: string,
  status: number,
  ms: number
) {
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const methodColor = methodColors[method] ?? '\x1b[37m';
  const statusColor =
    status < 300 ? '\x1b[32m' : status < 400 ? '\x1b[33m' : '\x1b[31m';
  const timing = `${dim}${ms.toFixed(0)}ms${reset}`;
  console.log(
    `  ${methodColor}${method.padEnd(4)}${reset} ${pathname} ${statusColor}${status}${reset} ${timing}`
  );
}

const fetch = createRequestHandler({
  routeApi: routeApiRequest,
  staticRoots: ['src/client'],
  vendorFiles: {
    '/maplibre-gl.css': 'node_modules/maplibre-gl/dist/maplibre-gl.css'
  },
  onResponse: (req, res, pathname, ms) => {
    const isImage = /\.(?:jpe?g|png|gif|webp|avif|svg|ico)$/i.test(pathname);
    if (!isImage || res.status >= 400) {
      logRequest(req.method, pathname, res.status, ms);
    }
  }
});

// Keep `development: false` even in the dev server. Bun's `development: true`
// mode changes internal threading and error handling in ways that break the
// app — only the production setting is supported here.
const server = serve({
  routes: { '/': indexHtml },
  development: false,
  fetch
});

console.log(`🚀 Server running on ${server.url.toString()}\n`);
