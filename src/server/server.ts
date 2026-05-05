import { serve } from 'bun';

import indexHtml from '../client/index.html';
import { createApiHandler, flushLogBuffer } from './api-routes';
import { getItemCount, openAppDb } from './app-db';
import { createImageCache } from './image-cache';

openAppDb('data');

// Auto-sync when items table is empty
if (getItemCount() === 0) {
  console.log('No items in database — running sync...');
  const proc = Bun.spawnSync(['bun', 'src/server/sync.ts'], {
    stdio: ['inherit', 'inherit', 'inherit']
  });
  if (proc.exitCode !== 0) {
    console.error('Sync failed');
    process.exit(1);
  }
}
const imageCache = createImageCache({ cacheDir: 'data/cache' });
const { routeApiRequest } = createApiHandler('data', { imageCache });

async function routeRequest(req: Request, url: URL): Promise<Response> {
  const apiResponse = routeApiRequest(req, url.pathname);
  if (apiResponse !== null) {
    const resolved = await apiResponse;
    if (resolved !== null) return resolved;
  }

  const decodedPath = decodeURIComponent(url.pathname);

  // Check data directory first
  let file = Bun.file(`data${decodedPath}`);
  if (file.size > 0) {
    return new Response(file);
  }

  // Check src/client directory (for CSS, etc.)
  file = Bun.file(`src/client${decodedPath}`);
  if (file.size > 0) {
    return new Response(file);
  }

  // Vendor CSS that production copies from node_modules (see electrobun.config.ts)
  if (decodedPath === '/maplibre-gl.css') {
    return new Response(
      Bun.file('node_modules/maplibre-gl/dist/maplibre-gl.css')
    );
  }

  return new Response('Not Found', { status: 404 });
}

function logRequest(
  method: string,
  pathname: string,
  status: number,
  ms: number
) {
  const methodColors: Record<string, string> = {
    GET: '\x1b[36m', // cyan
    POST: '\x1b[33m', // yellow
    PUT: '\x1b[35m', // magenta
    DELETE: '\x1b[31m' // red
  };
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const methodColor = methodColors[method] ?? '\x1b[37m';

  const statusColor =
    status < 300
      ? '\x1b[32m' // green
      : status < 400
        ? '\x1b[33m' // yellow
        : '\x1b[31m'; // red

  const pathDisplay = pathname;
  const timing = `${dim}${ms.toFixed(0)}ms${reset}`;

  console.log(
    `  ${methodColor}${method.padEnd(4)}${reset} ${pathDisplay} ${statusColor}${status}${reset} ${timing}`
  );
}

const server = serve({
  routes: {
    '/': indexHtml
  },
  development: false,
  async fetch(req) {
    const start = performance.now();
    const url = new URL(req.url);
    const response = await routeRequest(req, url);

    const isImage = /\.(?:jpe?g|png|gif|webp|avif|svg|ico)$/i.test(
      url.pathname
    );
    if (!isImage || response.status >= 400) {
      logRequest(
        req.method,
        url.pathname,
        response.status,
        performance.now() - start
      );
    }
    for (const line of flushLogBuffer()) {
      console.log(line);
    }
    return response;
  }
});

console.log(`🚀 Server running on ${server.url.toString()}\n`);
