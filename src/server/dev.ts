import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import indexHtml from '@client/index.html';
import { serve } from 'bun';

import { createAlbumStore } from './album-store';
import { createApiHandler, type EditResultEvent } from './api-routes';
import { openItemStore } from './item-store';
import { createOrsClient } from './ors-client';
import { createPhotosWriter } from './photos-edit';
import {
  createImageCache,
  libraryDataDir,
  markLibraryDir,
  openPhotosLibrary,
  resolveLibrary
} from './photos-library';
import { createRequestHandler } from './request-handler';

const dataDir = '.data';

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
const libDir = libraryDataDir(dataDir, libraryPath);
mkdirSync(libDir, { recursive: true });
markLibraryDir(libDir, libraryPath);
console.log(`[main] Library: ${libraryPath}`);
console.log(`[main] Library data: ${libDir}`);

const imageCache = createImageCache({
  cacheDir: join(libDir, 'cache'),
  libraryPath
});
const photosLibrary = openPhotosLibrary({ imageCache, libraryPath });
const itemStore = openItemStore({
  dataDir: libDir,
  imageCache,
  libraryPath,
  photosWriter: createPhotosWriter(libraryPath)
});
const albumStore = createAlbumStore(libDir);
const orsClient = createOrsClient(dataDir);

function logEditResult(event: EditResultEvent): void {
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
  })
  .catch((err: unknown) => {
    console.error('[item-store] Rebuild failed:', err);
  });

const { routeApiRequest } = createApiHandler(libDir, {
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
): void {
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
  staticRoots: [libDir, 'src/client'],
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
