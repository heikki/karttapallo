import { randomBytes, timingSafeEqual } from 'node:crypto';

// The app's server answers its own window and nothing else: not a browser
// on this Mac, not another machine. Each launch makes a fresh key; the window
// opens on enterUrl, which trades the key for a cookie and moves on to the
// view it was opened for, so the key never sits in a URL the page can hand on.

const ENTER_PATH = '/enter';
const COOKIE = 'karttapallo-window';

export function newWindowKey() {
  return randomBytes(32).toString('base64url');
}

// `view` is the app URL the window should land on, query and all.
export function enterUrl(view: string, key: string) {
  const target = new URL(view);
  const url = new URL(ENTER_PATH, target);
  url.searchParams.set('key', key);
  url.searchParams.set('next', target.pathname + target.search);
  return url.toString();
}

function matches(given: string | null, key: string) {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieOf(req: Request) {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return null;
}

// Only somewhere on this server: `next` comes from a URL.
function nextOf(url: URL) {
  const next = new URL(url.searchParams.get('next') ?? '/', url);
  return next.origin === url.origin ? next.pathname + next.search : '/';
}

function forbidden() {
  return new Response(null, { status: 403 });
}

export function windowOnly(
  key: string,
  fetch: (req: Request) => Promise<Response>
) {
  return async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname === ENTER_PATH) {
      if (!matches(url.searchParams.get('key'), key)) return forbidden();
      return new Response(null, {
        status: 303,
        headers: {
          'Location': nextOf(url),
          'Set-Cookie': `${COOKIE}=${key}; Path=/; HttpOnly; SameSite=Strict`
        }
      });
    }
    if (!matches(cookieOf(req), key)) return forbidden();
    return await fetch(req);
  };
}
