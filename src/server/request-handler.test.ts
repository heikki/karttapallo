import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createRequestHandler } from './request-handler';

let tmp = '';
let root = '';
let fetch: (req: Request) => Promise<Response> = createRequestHandler({
  routeApi: () => null,
  staticRoots: []
});

/** Request `path` verbatim — no client-side normalisation in the way. */
function get(path: string) {
  return fetch(new Request(`http://127.0.0.1${path}`));
}

// Status is what these assert on, not bodies. `bunfig.toml` preloads happy-dom
// for the Lit tests, which replaces the global Response — and happy-dom's does
// not special-case a BunFile, so a file response reads back as the string
// "[object Blob]". Under a real server the bytes are served correctly; the E2E
// suite covers that. A traversal that got through would answer 200, so the
// status check is the assertion that matters here anyway.

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'karttapallo-request-'));
  root = join(tmp, 'static');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(root, 'sub', 'page.html'), 'page');
  // A sibling of the root, reachable only by climbing out of it.
  writeFileSync(join(tmp, 'secret.txt'), 'SECRET');

  fetch = createRequestHandler({ routeApi: () => null, staticRoots: [root] });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('static files', () => {
  test('serves a file under the root', async () => {
    expect((await get('/sub/page.html')).status).toBe(200);
  });

  test('serves index.html for the root path', async () => {
    expect((await get('/')).status).toBe(200);
  });

  test('404 for a file that is not there', async () => {
    expect((await get('/nope.html')).status).toBe(404);
  });
});

describe('path traversal', () => {
  // The URL parser strips a literal `../`, so this one never reached the disk.
  test('a literal ../ cannot climb out', async () => {
    expect((await get('/../secret.txt')).status).toBe(404);
  });

  // These are the ones that did: the parser leaves the encoding alone and
  // decodeURIComponent turns it back into a real separator.
  test.each([
    '/%2e%2e%2fsecret.txt',
    '/..%2fsecret.txt',
    '/%2E%2E%2Fsecret.txt',
    '/sub/..%2f..%2fsecret.txt',
    '/%2e%2e/secret.txt'
  ])('encoded traversal %p is refused', async (path) => {
    expect((await get(path)).status).toBe(404);
  });

  test('a root-relative path that merely looks like a sibling stays inside', async () => {
    // `/static-other` must not match the `/static` root by string prefix.
    mkdirSync(join(tmp, 'static-other'), { recursive: true });
    writeFileSync(join(tmp, 'static-other', 'x.txt'), 'OUTSIDE');
    expect((await get('/..%2fstatic-other%2fx.txt')).status).toBe(404);
  });

  test('malformed percent-encoding is a bad request, not a crash', async () => {
    expect((await get('/%ZZ')).status).toBe(400);
  });

  test('a null byte is a bad request', async () => {
    expect((await get('/index.html%00.png')).status).toBe(400);
  });
});

describe('api routing', () => {
  test('the api router wins over static files', async () => {
    fetch = createRequestHandler({
      routeApi: (_req, pathname) =>
        pathname === '/index.html' ? new Response('from api') : null,
      staticRoots: [root]
    });
    expect(await (await get('/index.html')).text()).toBe('from api');
  });

  test('falls through to static when the router returns null', async () => {
    expect((await get('/sub/page.html')).status).toBe(200);
  });
});
