import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { enterUrl, newWindowKey, windowOnly } from './window-only';

const base = 'http://127.0.0.1:4000';
const key = newWindowKey();
const fetch = windowOnly(
  key,
  async () => await Promise.resolve(new Response('app'))
);

// The preloaded happy-dom swaps in a Request and Response that drop Cookie and
// Set-Cookie, the very headers this is about, so it runs on Bun's own.
beforeAll(async () => {
  await GlobalRegistrator.unregister();
});
afterAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost/' });
});

describe('windowOnly', () => {
  test('lets the window in with its key, on the view it was opened for', async () => {
    const entered = await fetch(
      new Request(enterUrl(`${base}?id=abc&focus=1`, key))
    );
    expect(entered.status).toBe(303);
    expect(entered.headers.get('location')).toBe('/?id=abc&focus=1');
    const cookie = entered.headers.get('set-cookie')!.split(';')[0]!;

    const page = await fetch(
      new Request(`${base}/?id=abc`, { headers: { cookie } })
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('app');
  });

  test('sends the window nowhere but this server', async () => {
    const away = new URL(enterUrl(base, key));
    away.searchParams.set('next', '//example.com/x');
    const entered = await fetch(new Request(away));
    expect(entered.headers.get('location')).toBe('/');
  });

  test('turns away a request without the cookie, or with another key', async () => {
    expect((await fetch(new Request(`${base}/`))).status).toBe(403);
    expect(
      (await fetch(new Request(enterUrl(base, newWindowKey())))).status
    ).toBe(403);
    const stale = `karttapallo-window=${newWindowKey()}`;
    const req = new Request(`${base}/`, { headers: { cookie: stale } });
    expect((await fetch(req)).status).toBe(403);
  });
});
