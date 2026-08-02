/**
 * In-memory store for the items list, with snapshot persistence.
 *
 * On open, reads `items.json` into memory so the API can serve immediately.
 * In a microtask, rebuilds from Photos.sqlite + geo-tz; on change, swaps the
 * in-memory list, evicts orphaned cache files, and rewrites the snapshot.
 *
 * Edits go through `applyEdits` which writes Photos.app, mutates in-memory
 * state, and rewrites the snapshot. `quitPhotosApp` is called at the end so
 * the user can't accidentally undo edits in an open Photos.app window.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  applyHourOffset,
  dateToUtc,
  localEpochFromExif,
  systemTzOffsetHours,
  tzOffsetHours,
  tzOffsetToSeconds
} from './date-utils';
import { defaultPhotosWriter, type PhotosWriter } from './photos-edit';
import {
  defaultLibraryPath,
  openPhotosDb,
  queryNotInAlbumUuid,
  queryPhotos,
  queryVideos,
  readSearchTerms,
  resolveLibrary,
  termsFor,
  type ImageCache,
  type LibraryResolution,
  type PhotoRecord,
  type SearchTerms
} from './photos-library';
import {
  localizeInstant,
  tzNameFromCoords,
  tzOffsetFromTzName,
  type LocalTime
} from './timezone';

export interface ItemEntry {
  uuid: string;
  type: 'photo' | 'video';
  full: string;
  thumb: string;
  lat: number | null;
  lon: number | null;
  date: string;
  tz: string | null;
  camera: string | null;
  duration?: string | null;
  gps: 'user' | 'exif' | 'inferred' | null;
  gps_accuracy: number | null;
  albums: string[];
  /**
   * The search corpus, all three read from `psi.sqlite` (ADR-0014). Each is a
   * list because that index attaches terms, not a single value: a photo sits in
   * a point of interest AND a street AND a city, and Photos indexes every one.
   * Empty where the index has nothing — the normal case for `labels` on a
   * library Photos hasn't analyzed.
   */
  place: string[];
  description: string[];
  labels: string[];
  photos_url: string;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds === 0) return null;
  const s = Math.trunc(seconds);
  if (s < 3600) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function sortedAlbums(record: PhotoRecord): {
  albums: string[];
  albumUuids: string[];
} {
  const pairs = record.albums.map((name, i) => ({
    name: name.normalize('NFC'),
    uuid: record.albumUuids[i] ?? ''
  }));
  pairs.sort((a, b) => a.name.localeCompare(b.name));
  return {
    albums: pairs.map((p) => p.name),
    albumUuids: pairs.map((p) => p.uuid)
  };
}

/**
 * Wall clock and timezone, always DERIVED from the durable pair — the UTC
 * instant and the coordinates — never from the stored ZTIMEZONEOFFSET, which a
 * restore can silently lose (see docs/adr/0013). Coordinates are the ground
 * truth for an asset's timezone, unconditionally: a photo's tz label must
 * reflect where it was taken, so a UK photo/video reads +01:00 (BST), not the
 * camera's +03:00 (Helsinki), regardless of how its date was set.
 *
 * We do NOT gate on date source. If an asset's instant was manually shifted
 * (a compensating shift, or a video whose date was typed by hand because .mov
 * files carry no EXIF date), deriving the coords offset can produce a wrong
 * wall clock — that is a data problem the user fixes by editing the time, not a
 * reason to fall back to a geographically-wrong stored offset. The stored
 * offset is only the fallback when there are no coordinates.
 */
function deriveLocalTime(record: PhotoRecord): {
  date: string;
  tz: string | null;
} {
  let date = record.date;
  let tz = record.tz;
  if (record.instant !== null && record.lat !== null && record.lon !== null) {
    const local = localizeInstant(record.lat, record.lon, record.instant);
    if (local !== null) {
      date = local.date;
      tz = local.tz;
    }
  }
  if (tz === null && date !== '') {
    tz = tzOffsetFromTzName('Europe/Helsinki', date);
  }
  return { date, tz };
}

/** Exported for unit testing the date/tz derivation gate (ADR-0013). */
export function buildItemEntry(
  record: PhotoRecord,
  notInAlbumUuid: string,
  searchIndex?: Map<string, SearchTerms>
): ItemEntry {
  const sorted = sortedAlbums(record);
  const albumUuid = sorted.albumUuids.find(Boolean) ?? notInAlbumUuid;
  const photosUrl = `photos:albums?albumUuid=${albumUuid}&assetUuid=${record.uuid}`;

  const { date, tz } = deriveLocalTime(record);
  const terms = termsFor(searchIndex, record.uuid);

  const base = {
    uuid: record.uuid,
    type: record.type,
    full: `full/${record.uuid}.jpg`,
    thumb: `thumb/${record.uuid}.jpg`,
    lat: record.lat,
    lon: record.lon,
    date,
    tz,
    camera: record.camera
  };

  const tail = {
    gps: record.gps,
    gps_accuracy: record.gps_accuracy,
    albums: sorted.albums,
    place: terms.place,
    description: terms.description,
    labels: terms.labels,
    photos_url: photosUrl
  };

  if (record.type === 'video') {
    return { ...base, duration: formatDuration(record.duration), ...tail };
  }
  return { ...base, ...tail };
}

function sortEntries(entries: ItemEntry[]) {
  entries.sort((a, b) => {
    const d = dateToUtc(a.date, a.tz).localeCompare(dateToUtc(b.date, b.tz));
    return d === 0 ? a.uuid.localeCompare(b.uuid) : d;
  });
}

export interface LocationEdit {
  uuid: string;
  lat: number;
  lon: number;
}

export interface TimeEdit {
  uuid: string;
  hours: number;
}

export interface EditResult {
  uuid: string;
  ok: boolean;
  error?: string;
}

export interface EditResults {
  locationResults: EditResult[];
  timeResults: EditResult[];
}

export interface ItemStore {
  getAll: () => ItemEntry[];
  applyEdits: (edits: {
    locationEdits: LocationEdit[];
    timeEdits: TimeEdit[];
  }) => EditResults;
  /**
   * Resolves to true when the post-startup rebuild swaps in items that differ
   * from the snapshot, false when the snapshot already matched fresh data.
   * Change detection lets the launcher skip the webview reload when nothing
   * changed — see docs/app.md "Data layout".
   */
  rebuildComplete: Promise<boolean>;
  /** Trigger a manual rebuild (e.g. "Sync Photos" menu action). */
  rebuild: () => Promise<boolean>;
}

interface OpenItemStoreOptions {
  cacheRoot: string;
  imageCache?: ImageCache;
  photosWriter?: PhotosWriter;
  /** Library to read items from; defaults to the resolver in openPhotosDb. */
  libraryPath?: string;
  /** Override for tests — defaults to reading Photos.sqlite. */
  buildFreshItems?: () => ItemEntry[];
  /** Write-time active-library guard seam; defaults to the real resolver. */
  resolveActiveLibrary?: () => LibraryResolution;
}

const SNAPSHOT_NAME = 'items.json';

function loadSnapshot(snapshotPath: string): {
  items: ItemEntry[];
  json: string;
} {
  if (!existsSync(snapshotPath)) return { items: [], json: '[]' };
  try {
    const json = readFileSync(snapshotPath, 'utf-8');
    return { items: JSON.parse(json) as ItemEntry[], json };
  } catch {
    return { items: [], json: '[]' };
  }
}

function buildFromPhotosDb(libraryPath?: string): ItemEntry[] {
  const resolved = libraryPath ?? defaultLibraryPath();
  const db = openPhotosDb(resolved);
  try {
    const notInAlbumUuid = queryNotInAlbumUuid(db);
    // The search corpus lives in a second database, and is empty for any
    // library Photos hasn't indexed — an ordinary case, not a failure
    // (ADR-0014).
    const searchIndex = readSearchTerms(resolved);
    const records = [...queryPhotos(db), ...queryVideos(db)];
    return records.map((r) => buildItemEntry(r, notInAlbumUuid, searchIndex));
  } finally {
    db.close();
  }
}

function evictOrphanedCacheFiles(cacheDir: string, liveUuids: Set<string>) {
  for (const sub of ['full', 'thumb']) {
    const dir = join(cacheDir, sub);
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jpg')) continue;
        const uuid = f.slice(0, -4);
        if (!liveUuids.has(uuid)) {
          try {
            unlinkSync(join(dir, f));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export function openItemStore(options: OpenItemStoreOptions): ItemStore {
  const { cacheRoot, imageCache } = options;
  const writer = options.photosWriter ?? defaultPhotosWriter;
  const loadedLibraryPath = options.libraryPath;
  const resolveActive = options.resolveActiveLibrary ?? resolveLibrary;
  const buildFresh =
    options.buildFreshItems ?? (() => buildFromPhotosDb(options.libraryPath));
  const snapshotPath = join(cacheRoot, SNAPSHOT_NAME);
  const cacheDir = join(cacheRoot, 'cache');

  let { items, json: snapshotJson } = loadSnapshot(snapshotPath);

  function writeSnapshot() {
    snapshotJson = JSON.stringify(items);
    writeFileSync(snapshotPath, snapshotJson);
  }

  async function rebuild() {
    // Yield so callers can finish startup before the build runs synchronously.
    await Promise.resolve();
    const fresh = buildFresh();
    sortEntries(fresh);
    const freshJson = JSON.stringify(fresh);
    if (freshJson === snapshotJson) return false;
    items = fresh;
    snapshotJson = freshJson;
    writeFileSync(snapshotPath, freshJson);
    if (imageCache !== undefined) {
      evictOrphanedCacheFiles(cacheDir, new Set(fresh.map((i) => i.uuid)));
    }
    return true;
  }

  function applyEdits(edits: {
    locationEdits: LocationEdit[];
    timeEdits: TimeEdit[];
  }): EditResults {
    // Guard against a mid-session library switch: AppleScript writes hit
    // whichever library Photos.app currently has open, but our items came from
    // the library resolved at startup. If they no longer match, refuse rather
    // than write edits into the wrong library (ADR 0012). Detection is ~0.1ms,
    // and Save is a human-cadence action, so this is effectively free. Only a
    // confirmed mismatch blocks — if the active library can't be resolved we
    // let the write proceed and let AppleScript surface any failure.
    if (loadedLibraryPath !== undefined) {
      const active = resolveActive();
      if (active.ok && active.path !== loadedLibraryPath) {
        throw new Error(
          'Photos is now showing a different library — relaunch Karttapallo ' +
            `to edit it.\nExpected: ${loadedLibraryPath}\nActive: ${active.path}`
        );
      }
    }

    const tzResults = new Map<string, LocalTime | null>();
    const locationResults = writeLocationEdits(
      edits.locationEdits,
      items,
      writer,
      tzResults
    );
    const timeResults = writeTimeEdits(edits.timeEdits, items, writer);

    if (edits.locationEdits.length > 0 || edits.timeEdits.length > 0) {
      writer.quitPhotosApp();
    }

    // Only reflect edits whose Photos write actually succeeded. A failed write
    // (e.g. Photos automation not authorized) must NOT mutate the in-memory
    // items or the snapshot — otherwise the edit looks applied but silently
    // reverts on the next rebuild from Photos.sqlite.
    const okLoc = new Set(
      locationResults.filter((r) => r.ok).map((r) => r.uuid)
    );
    const okTime = new Set(timeResults.filter((r) => r.ok).map((r) => r.uuid));
    mutateLocations(
      items,
      edits.locationEdits.filter((e) => okLoc.has(e.uuid)),
      tzResults
    );
    mutateTimes(
      items,
      edits.timeEdits.filter((e) => okTime.has(e.uuid))
    );

    if (okLoc.size > 0 || okTime.size > 0) {
      writeSnapshot();
    }
    return { locationResults, timeResults };
  }

  // Kick off the post-startup rebuild — caller awaits via rebuildComplete.
  const rebuildComplete = rebuild();

  return {
    getAll: () => items,
    applyEdits,
    rebuildComplete,
    rebuild
  };
}

// ---------- Edit pipeline helpers ----------

/**
 * Recover the UTC instant behind an item's displayed (date, tz) pair.
 *
 * buildItemEntry produces the two together via localizeInstant, so this is an
 * exact inverse — not a re-derivation. A location edit never touches
 * ZDATECREATED, so the instant it returns stays valid across the edit.
 */
function instantOf(item: ItemEntry): number | null {
  if (item.tz === null) return null;
  const localEpoch = localEpochFromExif(item.date);
  if (localEpoch === null) return null;
  return localEpoch - tzOffsetToSeconds(item.tz);
}

// eslint-disable-next-line complexity -- sequential edits with tz lookup
function writeLocationEdits(
  edits: LocationEdit[],
  items: ItemEntry[],
  writer: PhotosWriter,
  tzResults: Map<string, LocalTime | null>
): EditResult[] {
  const results: EditResult[] = [];
  for (const edit of edits) {
    try {
      writer.setLocation(edit.uuid, edit.lat, edit.lon);
      const item = items.find((i) => i.uuid === edit.uuid);
      const oldTz = item?.tz ?? null;
      const tzName = tzNameFromCoords(edit.lat, edit.lon);
      // Re-localize through the same durable pair the display path uses (UTC
      // instant + coordinates), so the offset is resolved AT THE INSTANT. The
      // old wall-clock-as-UTC lookup disagreed by an hour inside a DST
      // transition window, which fired even for a nudge that never left the
      // zone: it wrote a wrong offset to Photos and shifted the shown time
      // until the next rebuild silently reverted it.
      const instant = item === undefined ? null : instantOf(item);
      const local =
        instant === null ? null : localizeInstant(edit.lat, edit.lon, instant);
      if (tzName !== null && local !== null && local.tz !== oldTz) {
        writer.setTimezone(edit.uuid, tzName, tzOffsetToSeconds(local.tz));
      }
      tzResults.set(edit.uuid, local);
      results.push({ uuid: edit.uuid, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ uuid: edit.uuid, ok: false, error: msg });
    }
  }
  return results;
}

function writeTimeEdits(
  edits: TimeEdit[],
  items: ItemEntry[],
  writer: PhotosWriter
): EditResult[] {
  const results: EditResult[] = [];
  for (const edit of edits) {
    const item = items.find((i) => i.uuid === edit.uuid);
    if (item === undefined) {
      results.push({
        uuid: edit.uuid,
        ok: false,
        error: 'Item not found'
      });
      continue;
    }
    try {
      // target is the desired local time in the photo's timezone.
      const target = applyHourOffset(item.date, edit.hours);
      // AppleScript creates dates in the system's local timezone, but Photos
      // stores them as UTC by subtracting the system offset. To end up with the
      // right UTC value in Photos, adjust by (systemTz - photoTz) so Photos
      // displays the correct local time when it adds back the photo's tz.
      const photoTzHours = tzOffsetHours(item.tz);
      const sysTzHours = systemTzOffsetHours(target);
      const scriptTarget = applyHourOffset(target, sysTzHours - photoTzHours);
      const [datePart, timePart] = scriptTarget.split(' ');
      if (datePart === undefined || timePart === undefined) {
        results.push({
          uuid: edit.uuid,
          ok: false,
          error: 'Invalid date format'
        });
        continue;
      }
      writer.setDateTime(edit.uuid, datePart.replaceAll(':', '-'), timePart);
      results.push({ uuid: edit.uuid, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ uuid: edit.uuid, ok: false, error: msg });
    }
  }
  return results;
}

function mutateLocations(
  items: ItemEntry[],
  edits: LocationEdit[],
  tzResults: Map<string, LocalTime | null>
) {
  for (const edit of edits) {
    const item = items.find((i) => i.uuid === edit.uuid);
    if (item === undefined) continue;
    item.lat = edit.lat;
    item.lon = edit.lon;
    item.gps = 'user';
    item.gps_accuracy = 1;
    // Assign the localized pair wholesale rather than shifting the clock by the
    // offset delta: it is the same value the next rebuild will derive, so the
    // in-memory item and the snapshot already agree with buildItemEntry.
    const local = tzResults.get(edit.uuid);
    if (local !== undefined && local !== null) {
      item.date = local.date;
      item.tz = local.tz;
    }
  }
}

function mutateTimes(items: ItemEntry[], edits: TimeEdit[]) {
  for (const edit of edits) {
    const item = items.find((i) => i.uuid === edit.uuid);
    if (item !== undefined) {
      item.date = applyHourOffset(item.date, edit.hours);
    }
  }
}
