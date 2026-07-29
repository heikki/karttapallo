import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  flushUrl,
  mapViewFromUrl,
  mapViewToUrl,
  resetUrl,
  updateUrl,
  urlSignal
} from './url-state';

function setUrl(qs: string) {
  history.replaceState(null, '', qs === '' ? location.pathname : `?${qs}`);
}

async function flushMicrotasks() {
  await Promise.resolve();
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(null, { status: 204 }))
  ) as unknown as typeof fetch;
  setUrl('');
  localStorage.clear();
});

afterEach(() => {
  flushUrl();
  globalThis.fetch = originalFetch;
});

describe('updateUrl / flushUrl / resetUrl', () => {
  test('updateUrl + flushUrl writes params to location.search', () => {
    updateUrl((p) => {
      p.set('foo', 'bar');
    });
    flushUrl();
    expect(location.search).toBe('?foo=bar');
  });

  test('updateUrl coalesces multiple appliers into one flush', () => {
    updateUrl((p) => {
      p.set('a', '1');
    });
    updateUrl((p) => {
      p.set('b', '2');
    });
    flushUrl();
    const params = new URLSearchParams(location.search);
    expect(params.get('a')).toBe('1');
    expect(params.get('b')).toBe('2');
  });

  test('resetUrl clears every existing param', () => {
    setUrl('foo=bar&baz=qux');
    resetUrl();
    expect(location.search).toBe('');
  });
});

describe('mapView codec', () => {
  test('mapViewToUrl writes lat/lon with 5 decimals and z with 2', () => {
    mapViewToUrl({ lat: 60.123456789, lon: 24.987654321, zoom: 7.5 });
    flushUrl();
    const params = new URLSearchParams(location.search);
    expect(params.get('lat')).toBe('60.12346');
    expect(params.get('lon')).toBe('24.98765');
    expect(params.get('z')).toBe('7.50');
  });

  test('mapViewFromUrl round-trips through mapViewToUrl', () => {
    mapViewToUrl({ lat: 60.17, lon: 24.94, zoom: 12 });
    flushUrl();
    expect(mapViewFromUrl()).toEqual({ lat: 60.17, lon: 24.94, zoom: 12 });
  });

  test('mapViewFromUrl returns null when params are missing', () => {
    expect(mapViewFromUrl()).toBe(null);
  });

  test('mapViewFromUrl returns null when any value is not a number', () => {
    setUrl('lat=foo&lon=24&z=7');
    expect(mapViewFromUrl()).toBe(null);
  });
});

describe('urlSignal', () => {
  test('seeds value from the URL at construction time', () => {
    setUrl('greeting=hello');
    const sig = urlSignal<string | null>(
      'greeting',
      (raw) => raw,
      (v) => v
    );
    expect(sig.get()).toBe('hello');
  });

  test('decode receives null when the param is absent', () => {
    const sig = urlSignal<string>(
      'absent',
      (raw) => raw ?? 'default',
      (v) => (v === 'default' ? null : v)
    );
    expect(sig.get()).toBe('default');
  });

  test('writes to URL when the signal changes', async () => {
    const sig = urlSignal<string | null>(
      'mood',
      (raw) => raw,
      (v) => v
    );
    sig.set('happy');
    await flushMicrotasks();
    flushUrl();
    expect(new URLSearchParams(location.search).get('mood')).toBe('happy');
  });

  test('omits the param when encode returns null', async () => {
    setUrl('mode=fast');
    const sig = urlSignal<string | null>(
      'mode',
      (raw) => raw,
      (v) => v
    );
    expect(sig.get()).toBe('fast');
    sig.set(null);
    await flushMicrotasks();
    flushUrl();
    expect(new URLSearchParams(location.search).has('mode')).toBe(false);
  });

  test('first effect run is a no-op (does not double-write the seed)', async () => {
    setUrl('count=7');
    let writes = 0;
    const sig = urlSignal<string | null>(
      'count',
      (raw) => raw,
      (v) => {
        writes++;
        return v;
      }
    );
    expect(sig.get()).toBe('7');
    await flushMicrotasks();
    flushUrl();
    expect(writes).toBe(0);
  });
});
