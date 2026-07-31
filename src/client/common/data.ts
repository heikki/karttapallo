import { computed, signal } from '@lit-labs/signals';

import { matchesTerm } from './search';
import { effect } from './signals';
import type { Photo } from './types';
import { updateUrl } from './url-state';
import { getYear, sortByDate } from './utils';

export interface Filters {
  year: string;
  gps: string[];
  media: string[];
  album: string;
  camera: string;
  /** Applied search term, verbatim from a suggestion; '' when unset. */
  search: string;
}

const ALL_GPS = ['exif', 'inferred', 'user', 'none'];
const ALL_MEDIA = ['photo', 'video'];
// 'none' is excluded by default — photos without GPS are hidden until the
// user activates that toggle.
const DEFAULT_GPS = ['exif', 'inferred', 'user'];
const DEFAULT_MEDIA: string[] = [...ALL_MEDIA];

// Synthetic option for photos not in any user album, mirrors '(unknown)' in
// the camera filter. Photos with empty `albums` are matched by this label.
const NO_ALBUM = '(no album)';

function albumsOf(p: Photo): string[] {
  return p.albums.length === 0 ? [NO_ALBUM] : p.albums;
}

const FILTER_KEYS = ['year', 'album', 'camera', 'gps', 'media', 'q'] as const;

const DEFAULTS: Filters = {
  year: 'all',
  gps: [...DEFAULT_GPS],
  media: [...DEFAULT_MEDIA],
  album: 'all',
  camera: 'all',
  search: ''
};

// --- URL codec --------------------------------------------------------

function readFiltersFromUrl(): Partial<Filters> {
  const params = new URLSearchParams(location.search);
  const result: Partial<Filters> = {};
  const year = params.get('year');
  if (year !== null) result.year = year;
  const album = params.get('album');
  if (album !== null) result.album = album;
  const camera = params.get('camera');
  if (camera !== null) result.camera = camera;
  const search = params.get('q');
  if (search !== null) result.search = search;
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

function writeFiltersToUrl(f: Filters) {
  updateUrl((params) => {
    for (const key of FILTER_KEYS) params.delete(key);
    if (f.year !== 'all') params.set('year', f.year);
    if (f.album !== 'all') params.set('album', f.album);
    if (f.camera !== 'all') params.set('camera', f.camera);
    if (f.search !== '') params.set('q', f.search);
    if (
      f.gps.length !== ALL_GPS.length ||
      !ALL_GPS.every((v) => f.gps.includes(v))
    ) {
      params.set('gps', f.gps.join(','));
    }
    if (
      f.media.length !== ALL_MEDIA.length ||
      !ALL_MEDIA.every((v) => f.media.includes(v))
    ) {
      params.set('media', f.media.join(','));
    }
  });
}

// --- Signals ----------------------------------------------------------

export const photos = signal<Photo[]>([]);

// Seed from URL at module load. Cascade waits for photos to load so we
// can validate album/camera against what actually exists.
const _filters = signal<Filters>({ ...DEFAULTS, ...readFiltersFromUrl() });

/** Read-only view; mutate via verbs below. */
export const filters = computed(() => _filters.get());

// --- Cascade and option lists -----------------------------------------

function applyCascade(f: Filters, ps: Photo[]): Filters {
  const yearPs =
    f.year === 'all' ? ps : ps.filter((p) => getYear(p) === f.year);
  const validAlbums = new Set(yearPs.flatMap(albumsOf));
  const album =
    f.album !== 'all' && !validAlbums.has(f.album) ? 'all' : f.album;
  const albumPs =
    album === 'all'
      ? yearPs
      : yearPs.filter((p) => albumsOf(p).includes(album));
  const validCameras = new Set(albumPs.map((p) => p.camera ?? '(unknown)'));
  const camera =
    f.camera !== 'all' && !validCameras.has(f.camera) ? 'all' : f.camera;
  // Validated against the whole library, not the narrowed set: a term the other
  // filters merely hide is kept, and legitimately shows an empty map. Only a
  // term no photo carries at all — a URL from a different library — is dropped.
  const search =
    f.search !== '' && !ps.some((p) => matchesTerm(p, f.search))
      ? ''
      : f.search;
  return { ...f, album, camera, search };
}

export const albumOptions = computed(() => {
  const ps = photos.get();
  const f = _filters.get();
  const yearPs =
    f.year === 'all' ? ps : ps.filter((p) => getYear(p) === f.year);
  return [...new Set(yearPs.flatMap(albumsOf))].sort();
});

export const cameraOptions = computed(() => {
  const ps = photos.get();
  const f = _filters.get();
  const yearPs =
    f.year === 'all' ? ps : ps.filter((p) => getYear(p) === f.year);
  const albumPs =
    f.album === 'all'
      ? yearPs
      : yearPs.filter((p) => albumsOf(p).includes(f.album));
  return [...new Set(albumPs.map((p) => p.camera ?? '(unknown)'))].sort();
});

// --- Filtered projection ----------------------------------------------

function matchesGps(p: Photo, gps: string[]) {
  if (gps.length === 0) return false;
  if (gps.length === ALL_GPS.length) return true;
  if (p.gps === null) return gps.includes('none');
  return gps.includes(p.gps);
}

function matchesMedia(p: Photo, media: string[]) {
  if (media.length === 0) return false;
  if (media.length === ALL_MEDIA.length) return true;
  return media.includes(p.type);
}

/**
 * Everything the non-search filters allow. Search suggestions are drawn from
 * this set so their counts describe what applying a term would actually show,
 * and so no suggestion can lead to an empty map.
 */
export const photosBeforeSearch = computed(() => {
  const ps = photos.get();
  const f = _filters.get();
  return ps.filter((p) => {
    if (f.year !== 'all' && getYear(p) !== f.year) return false;
    if (!matchesGps(p, f.gps)) return false;
    if (!matchesMedia(p, f.media)) return false;
    if (f.album !== 'all' && !albumsOf(p).includes(f.album)) return false;
    if (f.camera !== 'all') {
      const pc = p.camera ?? '(unknown)';
      if (pc !== f.camera) return false;
    }
    return true;
  });
});

export const filteredPhotos = computed(() => {
  const search = _filters.get().search;
  const ps = photosBeforeSearch.get();
  return search === '' ? ps : ps.filter((p) => matchesTerm(p, search));
});

// --- Verbs ------------------------------------------------------------

function set(next: Filters) {
  _filters.set(applyCascade(next, photos.get()));
}

export function setYear(year: string) {
  set({ ..._filters.get(), year });
}

export function setAlbum(album: string) {
  set({ ..._filters.get(), album });
}

export function setCamera(camera: string) {
  set({ ..._filters.get(), camera });
}

/** Apply a suggestion's term, or '' to clear. */
export function setSearch(search: string) {
  set({ ..._filters.get(), search });
}

export function toggleGps(value: string) {
  const cur = _filters.get();
  const gps = cur.gps.includes(value)
    ? cur.gps.filter((v) => v !== value)
    : [...cur.gps, value];
  set({ ...cur, gps });
}

export function soloGps(value: string) {
  const cur = _filters.get();
  const isSolo = cur.gps.length === 1 && cur.gps[0] === value;
  set({ ...cur, gps: isSolo ? [...DEFAULT_GPS] : [value] });
}

export function toggleMedia(value: string) {
  const cur = _filters.get();
  const media = cur.media.includes(value)
    ? cur.media.filter((v) => v !== value)
    : [...cur.media, value];
  set({ ...cur, media });
}

export function soloMedia(value: string) {
  const cur = _filters.get();
  const isSolo = cur.media.length === 1 && cur.media[0] === value;
  set({ ...cur, media: isSolo ? [...DEFAULT_MEDIA] : [value] });
}

// Single-choice filters can only be widened all the way to 'all'; the
// multi-select ones instead gain the photo's own value and keep the rest.
function widen(current: string, matches: boolean) {
  return current === 'all' || matches ? current : 'all';
}

/**
 * Widen the filters just enough that `p` passes, leaving every dimension it
 * already satisfies alone. For deep links, which have to land on their photo
 * whatever filter state came with them — and the photos most worth linking
 * to (the ones missing a location) are exactly what the default GPS filter
 * hides.
 */
export function revealPhoto(p: Photo) {
  const cur = _filters.get();
  set({
    year: widen(cur.year, getYear(p) === cur.year),
    album: widen(cur.album, albumsOf(p).includes(cur.album)),
    camera: widen(cur.camera, (p.camera ?? '(unknown)') === cur.camera),
    gps: matchesGps(p, cur.gps) ? cur.gps : [...cur.gps, p.gps ?? 'none'],
    media: matchesMedia(p, cur.media) ? cur.media : [...cur.media, p.type],
    search: matchesTerm(p, cur.search) ? cur.search : ''
  });
}

export function resetFilters() {
  _filters.set({
    ...DEFAULTS,
    gps: [...DEFAULT_GPS],
    media: [...DEFAULT_MEDIA],
    search: ''
  });
}

// --- Effects ----------------------------------------------------------

// First photos load: re-cascade so a URL-restored album/camera that no
// longer exists falls back to 'all'. One-shot — later reloads (e.g. after
// save-edits) preserve the user's current filter selection.
let cascadedOnLoad = false;
effect(() => {
  const ps = photos.get();
  if (cascadedOnLoad || ps.length === 0) return;
  cascadedOnLoad = true;
  _filters.set(applyCascade(_filters.get(), ps));
});

// Push filter changes to URL. First run is the URL-derived seed → no-op.
let firstUrlPush = true;
effect(() => {
  const f = _filters.get();
  if (firstUrlPush) {
    firstUrlPush = false;
    return;
  }
  writeFiltersToUrl(f);
});

// --- Loader -----------------------------------------------------------

export async function loadPhotos() {
  try {
    const response = await fetch(`/api/items?t=${Date.now()}`);
    const ps = (await response.json()) as Photo[];
    sortByDate(ps);
    photos.set(ps);
  } catch (error) {
    console.error('Error loading items:', error);
    throw error;
  }
}
