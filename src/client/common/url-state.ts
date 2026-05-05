import { signal, type Signal } from '@lit-labs/signals';

import { effect } from './signals';

// Restore saved view state into URL before any module reads it.
// This block must run before any caller dereferences `location.search`
// — that ordering is provided by ESM: every module that reads URL state
// imports something from this file, which evaluates this top-level
// block first.
if (location.search === '') {
  const saved = localStorage.getItem('viewState');
  if (saved !== null && saved !== '') {
    history.replaceState(null, '', `?${saved}`);
  }
}

const ALL_GPS = ['exif', 'inferred', 'user', 'none'];
const ALL_MEDIA = ['photo', 'video'];

interface SavedFilters {
  year: string;
  album: string;
  camera: string;
  gps: string[];
  media: string[];
}

interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

// --- Coalesced URL writes --------------------------------------------------
//
// Every URL-write entry point — urlSignal effects, updateUrl(),
// resetUrl() — funnels into pendingUrlParams. A 100ms debounce keeps
// us under the browser replaceState rate limit (~100 updates per 10s).
// A second 1s debounce mirrors the URL to localStorage and the server.

let pendingUrlParams: URLSearchParams | null = null;
let urlFlushTimer: ReturnType<typeof setTimeout> | null = null;
let viewSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function updateUrl(applier: (params: URLSearchParams) => void): void {
  pendingUrlParams ??= new URLSearchParams(location.search);
  applier(pendingUrlParams);
  urlFlushTimer ??= setTimeout(() => {
    flushPending(false);
  }, 100);
}

export function flushUrl(): void {
  if (urlFlushTimer !== null) {
    clearTimeout(urlFlushTimer);
    urlFlushTimer = null;
  }
  flushPending(true);
}

export function resetUrl(): void {
  updateUrl((params) => {
    for (const k of [...params.keys()]) params.delete(k);
  });
  flushUrl();
}

function flushPending(immediate: boolean): void {
  if (pendingUrlParams === null) return;
  const params = pendingUrlParams;
  pendingUrlParams = null;
  urlFlushTimer = null;
  const qs = params.toString();
  try {
    history.replaceState(null, '', qs === '' ? location.pathname : `?${qs}`);
  } catch {
    // SecurityError: replaceState rate limit exceeded; drop quietly.
  }
  scheduleViewSave(params, immediate);
}

function scheduleViewSave(params: URLSearchParams, immediate: boolean): void {
  if (viewSaveTimer !== null) clearTimeout(viewSaveTimer);
  const doSave = (): void => {
    viewSaveTimer = null;
    const obj = Object.fromEntries(params);
    const qs = new URLSearchParams(obj).toString();
    localStorage.setItem('viewState', qs);
    void fetch('/api/view-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
  };
  if (immediate) doSave();
  else viewSaveTimer = setTimeout(doSave, 1000);
}

// --- Signal primitive ------------------------------------------------------

/**
 * Create a signal whose value is seeded from `location.search` at
 * module load and pushed back to URL on every change. `encode` returns
 * `null` to omit the param from the URL — use this for the default
 * value so the URL stays minimal.
 *
 * The first effect run is a no-op: the seed already matches the URL,
 * so there's nothing to write back.
 */
export function urlSignal<T>(
  key: string,
  decode: (raw: string | null) => T,
  encode: (value: T) => string | null
): Signal.State<T> {
  const initial = decode(new URLSearchParams(location.search).get(key));
  const sig = signal(initial);
  let firstRun = true;
  effect(() => {
    const value = sig.get();
    if (firstRun) {
      firstRun = false;
      return;
    }
    updateUrl((params) => {
      const enc = encode(value);
      if (enc === null) params.delete(key);
      else params.set(key, enc);
    });
  });
  return sig;
}

// --- Filter codec ----------------------------------------------------------

const FILTER_KEYS = ['year', 'album', 'camera', 'gps', 'media'] as const;

export function filtersToUrl(filters: SavedFilters): void {
  updateUrl((params) => {
    for (const key of FILTER_KEYS) params.delete(key);
    if (filters.year !== 'all') params.set('year', filters.year);
    if (filters.album !== 'all') params.set('album', filters.album);
    if (filters.camera !== 'all') params.set('camera', filters.camera);
    if (
      filters.gps.length !== ALL_GPS.length ||
      !ALL_GPS.every((v) => filters.gps.includes(v))
    ) {
      params.set('gps', filters.gps.join(','));
    }
    if (
      filters.media.length !== ALL_MEDIA.length ||
      !ALL_MEDIA.every((v) => filters.media.includes(v))
    ) {
      params.set('media', filters.media.join(','));
    }
  });
}

export function filtersFromUrl(): Partial<SavedFilters> | null {
  const params = new URLSearchParams(location.search);
  const hasFilters = FILTER_KEYS.some((k) => params.has(k));
  if (!hasFilters) return null;
  const result: Partial<SavedFilters> = {};
  const year = params.get('year');
  if (year !== null) result.year = year;
  const album = params.get('album');
  if (album !== null) result.album = album;
  const camera = params.get('camera');
  if (camera !== null) result.camera = camera;
  const gps = params.get('gps');
  if (gps !== null) {
    result.gps = gps.split(',').filter((v) => ALL_GPS.includes(v));
  }
  const media = params.get('media');
  if (media !== null) {
    result.media = media.split(',').filter((v) => ALL_MEDIA.includes(v));
  }
  return result;
}

// --- Map view codec --------------------------------------------------------

export function mapViewToUrl(view: MapView): void {
  updateUrl((params) => {
    params.set('lat', view.lat.toFixed(5));
    params.set('lon', view.lon.toFixed(5));
    params.set('z', view.zoom.toFixed(2));
  });
}

export function mapViewFromUrl(): MapView | null {
  const params = new URLSearchParams(location.search);
  const lat = params.get('lat');
  const lon = params.get('lon');
  const z = params.get('z');
  if (lat === null || lon === null || z === null) return null;
  const parsed = {
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    zoom: parseFloat(z)
  };
  if (isNaN(parsed.lat) || isNaN(parsed.lon) || isNaN(parsed.zoom)) {
    return null;
  }
  return parsed;
}
