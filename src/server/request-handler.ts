/**
 * Shared HTTP request handler used by both `src/server/dev.ts` (browser
 * development) and `src/server/index.ts` (Electrobun launcher). Their configs
 * differ only in which static root serves the client, vendor-file overrides,
 * and the post-response hook (logging vs. Full Disk Access detection).
 */

import { resolve as resolvePath, sep } from 'node:path';

type ApiRouter = (
  req: Request,
  pathname: string
) => Promise<Response | null> | Response | null;

export interface RequestHandlerConfig {
  routeApi: ApiRouter;
  /** Filesystem roots tried in order for static files. */
  staticRoots: string[];
  /** Path → filesystem location for vendor / aliased files. */
  vendorFiles?: Record<string, string>;
  /** Called after every response. Receives the URL's raw pathname. */
  onResponse?: (
    req: Request,
    res: Response,
    pathname: string,
    elapsedMs: number
  ) => Promise<void> | void;
}

export function createRequestHandler(
  config: RequestHandlerConfig
): (req: Request) => Promise<Response> {
  return async (req) => {
    const start = performance.now();
    const url = new URL(req.url);
    const response = await resolve(req, url, config);
    if (config.onResponse !== undefined) {
      await config.onResponse(
        req,
        response,
        url.pathname,
        performance.now() - start
      );
    }
    return response;
  };
}

/**
 * Null for a path no correct client would send. A null byte reads as
 * end-of-string to some filesystem APIs, so `/index.html%00.png` and
 * `/index.html` could name one file to two layers.
 */
function decodePath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

/**
 * Absolute path under a static root, or null if it escapes.
 *
 * The URL parser strips a literal `../` from the pathname but leaves
 * `%2e%2e%2f` alone, and that survives decoding as a real one — which is how
 * `/%2e%2e%2f%2e%2e%2fpackage.json` used to read outside the root. Resolving
 * before checking containment closes both spellings, and does not depend on
 * the caller's roots being absolute.
 */
function fileUnderRoot(root: string, path: string): string | null {
  const base = resolvePath(root);
  const target = resolvePath(base + path);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

async function resolve(
  req: Request,
  url: URL,
  config: RequestHandlerConfig
): Promise<Response> {
  const api = config.routeApi(req, url.pathname);
  if (api !== null) {
    const resolved = await api;
    if (resolved !== null) return resolved;
  }

  const decoded = decodePath(url.pathname);
  if (decoded === null) return new Response('Bad Request', { status: 400 });
  const path = decoded === '/' ? '/index.html' : decoded;

  const vendor = config.vendorFiles?.[path];
  if (vendor !== undefined) {
    return new Response(Bun.file(vendor));
  }

  for (const root of config.staticRoots) {
    const filePath = fileUnderRoot(root, path);
    if (filePath === null) continue;
    const file = Bun.file(filePath);
    if (file.size > 0) return new Response(file);
  }

  return new Response('Not Found', { status: 404 });
}
