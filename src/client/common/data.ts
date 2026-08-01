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

function cameraOf(p: Photo): string {
  return p.camera ?? '(unknown)';
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

/**
 * The single-choice filters form a cascade, search → year → album → camera,
 * in the order the panel stacks them. Each one's options are drawn from the
 * photos the ones above it allow, and a selection the ones above it invalidate
 * falls back to 'all'.
 *
 * It runs one way only. The rungs below search never limit what search can
 * find, and applying a term clears them outright — see `setSearch`.
 *
 * The multi-select filters (gps, media) sit outside it: they narrow the map but
 * not each other's options, and not the selects above them.
 */
function bySearch(ps: Photo[], search: string): Photo[] {
  return search === '' ? ps : ps.filter((p) => matchesTerm(p, search));
}

function byYear(ps: Photo[], year: string): Photo[] {
  return year === 'all' ? ps : ps.filter((p) => getYear(p) === year);
}

function byAlbum(ps: Photo[], album: string): Photo[] {
  return album === 'all' ? ps : ps.filter((p) => albumsOf(p).includes(album));
}

function byCamera(ps: Photo[], camera: string): Photo[] {
  return camera === 'all' ? ps : ps.filter((p) => cameraOf(p) === camera);
}

/** Options for one rung, sorted and deduped; year drops its nulls. */
function sortedUnique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))].sort();
}

function keepIfValid(value: string, valid: Set<string | null>): string {
  return value !== 'all' && !valid.has(value) ? 'all' : value;
}

function applyCascade(f: Filters, ps: Photo[]): Filters {
  // Search is the top rung, so it is validated against the whole library rather
  // than a narrowed set: a term the multi-select filters merely hide is kept,
  // and legitimately shows an empty map. Only a term no photo carries at all —
  // a URL from a different library — is dropped.
  const search =
    f.search !== '' && !ps.some((p) => matchesTerm(p, f.search))
      ? ''
      : f.search;
  const searchPs = bySearch(ps, search);
  const year = keepIfValid(f.year, new Set(searchPs.map(getYear)));
  const yearPs = byYear(searchPs, year);
  const album = keepIfValid(f.album, new Set(yearPs.flatMap(albumsOf)));
  const albumPs = byAlbum(yearPs, album);
  const camera = keepIfValid(f.camera, new Set(albumPs.map(cameraOf)));
  return { ...f, year, album, camera, search };
}

export const yearOptions = computed(() => {
  const f = _filters.get();
  return sortedUnique(bySearch(photos.get(), f.search).map(getYear));
});

export const albumOptions = computed(() => {
  const f = _filters.get();
  const yearPs = byYear(bySearch(photos.get(), f.search), f.year);
  return sortedUnique(yearPs.flatMap(albumsOf));
});

export const cameraOptions = computed(() => {
  const f = _filters.get();
  const albumPs = byAlbum(
    byYear(bySearch(photos.get(), f.search), f.year),
    f.album
  );
  return sortedUnique(albumPs.map(cameraOf));
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
 * What search searches: the whole library, less only the two toggles that sit
 * outside the cascade. Searching a slice of the library is the one thing a
 * search box must never do — a term you can see in Photos has to be findable
 * here whatever the selects happen to be set to, and applying it clears them
 * anyway, so drawing suggestions from their slice would hide terms for the sake
 * of filters that are about to be discarded.
 *
 * Gps and media are excluded rather than searched through because they decide
 * what the map can plot at all: a photo carrying no location is not a pin, and
 * counting it would promise markers that cannot appear. That keeps a
 * suggestion's count exactly what picking it puts on the map.
 */
export const photosForSearch = computed(() => {
  const f = _filters.get();
  return photos
    .get()
    .filter((p) => matchesGps(p, f.gps) && matchesMedia(p, f.media));
});

export const filteredPhotos = computed(() => {
  const f = _filters.get();
  const searchPs = bySearch(photosForSearch.get(), f.search);
  return byCamera(byAlbum(byYear(searchPs, f.year), f.album), f.camera);
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

/**
 * Apply a suggestion's term, or '' to clear.
 *
 * Applying clears the three selects below it rather than intersecting with
 * them. A search runs over the whole library, so its suggestion counted every
 * match in the library; keeping a leftover album would land you on a fraction
 * of the number you just clicked. Clearing the term leaves them alone — there
 * is nothing above them to have contradicted.
 */
export function setSearch(search: string) {
  const cur = _filters.get();
  if (search === '') {
    set({ ...cur, search });
    return;
  }
  set({ ...cur, search, year: 'all', album: 'all', camera: 'all' });
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
    camera: widen(cur.camera, cameraOf(p) === cur.camera),
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
