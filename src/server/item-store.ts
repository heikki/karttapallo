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
  systemTzOffsetHours,
  tzOffsetHours,
  tzOffsetToSeconds
} from './date-utils';
import { defaultPhotosWriter, type PhotosWriter } from './photos-edit';
import {
  openPhotosDb,
  queryNotInAlbumUuid,
  queryPhotos,
  queryVideos,
  type ImageCache,
  type PhotoRecord
} from './photos-library';
import {
  tzNameFromCoords,
  tzOffsetFromCoords,
  tzOffsetFromTzName
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

function buildItemEntry(
  record: PhotoRecord,
  notInAlbumUuid: string
): ItemEntry {
  const sorted = sortedAlbums(record);
  const albumUuid = sorted.albumUuids.find(Boolean) ?? notInAlbumUuid;
  const photosUrl = `photos:albums?albumUuid=${albumUuid}&assetUuid=${record.uuid}`;

  // The Photos.sqlite ZTIMEZONEOFFSET column stores raw GPS-derived offsets
  // that aren't proper IANA timezone offsets, so always recompute from coords
  // when available; fall back to Europe/Helsinki for items without coordinates.
  let tz: string | null = null;
  if (record.date !== '') {
    if (record.lat !== null && record.lon !== null) {
      tz = tzOffsetFromCoords(record.lat, record.lon, record.date);
    }
    tz ??= tzOffsetFromTzName('Europe/Helsinki', record.date);
  }

  const base = {
    uuid: record.uuid,
    type: record.type,
    full: `full/${record.uuid}.jpg`,
    thumb: `thumb/${record.uuid}.jpg`,
    lat: record.lat,
    lon: record.lon,
    date: record.date,
    tz,
    camera: record.camera
  };

  const tail = {
    gps: record.gps,
    gps_accuracy: record.gps_accuracy,
    albums: sorted.albums,
    photos_url: photosUrl
  };

  if (record.type === 'video') {
    return { ...base, duration: formatDuration(record.duration), ...tail };
  }
  return { ...base, ...tail };
}

function sortEntries(entries: ItemEntry[]): void {
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
   * changed — see docs/app.md "Data Storage".
   */
  rebuildComplete: Promise<boolean>;
  /** Trigger a manual rebuild (e.g. "Sync Photos" menu action). */
  rebuild: () => Promise<boolean>;
}

interface OpenItemStoreOptions {
  dataDir: string;
  imageCache?: ImageCache;
  photosWriter?: PhotosWriter;
  /** Override for tests — defaults to reading Photos.sqlite. */
  buildFreshItems?: () => ItemEntry[];
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

function buildFromPhotosDb(): ItemEntry[] {
  const db = openPhotosDb();
  try {
    const notInAlbumUuid = queryNotInAlbumUuid(db);
    const records = [...queryPhotos(db), ...queryVideos(db)];
    return records.map((r) => buildItemEntry(r, notInAlbumUuid));
  } finally {
    db.close();
  }
}

function evictOrphanedCacheFiles(
  cacheDir: string,
  liveUuids: Set<string>
): void {
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
  const { dataDir, imageCache } = options;
  const writer = options.photosWriter ?? defaultPhotosWriter;
  const buildFresh = options.buildFreshItems ?? buildFromPhotosDb;
  const snapshotPath = join(dataDir, SNAPSHOT_NAME);
  const cacheDir = join(dataDir, 'cache');

  let { items, json: snapshotJson } = loadSnapshot(snapshotPath);

  function writeSnapshot(): void {
    snapshotJson = JSON.stringify(items);
    writeFileSync(snapshotPath, snapshotJson);
  }

  async function rebuild(): Promise<boolean> {
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
    const tzResults = new Map<string, string | null>();
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

    mutateLocations(items, edits.locationEdits, tzResults);
    mutateTimes(items, edits.timeEdits);

    if (edits.locationEdits.length > 0 || edits.timeEdits.length > 0) {
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

// eslint-disable-next-line complexity -- sequential edits with tz lookup
function writeLocationEdits(
  edits: LocationEdit[],
  items: ItemEntry[],
  writer: PhotosWriter,
  tzResults: Map<string, string | null>
): EditResult[] {
  const results: EditResult[] = [];
  for (const edit of edits) {
    try {
      writer.setLocation(edit.uuid, edit.lat, edit.lon);
      const item = items.find((i) => i.uuid === edit.uuid);
      const dateStr = item?.date ?? '';
      const oldTz = item?.tz ?? null;
      const tzName = tzNameFromCoords(edit.lat, edit.lon);
      const newTz = tzOffsetFromCoords(edit.lat, edit.lon, dateStr);
      if (tzName !== null && newTz !== null && newTz !== oldTz) {
        writer.setTimezone(edit.uuid, tzName, tzOffsetToSeconds(newTz));
      }
      tzResults.set(edit.uuid, newTz);
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
  tzResults: Map<string, string | null>
): void {
  for (const edit of edits) {
    const item = items.find((i) => i.uuid === edit.uuid);
    if (item === undefined) continue;
    item.lat = edit.lat;
    item.lon = edit.lon;
    item.gps = 'user';
    item.gps_accuracy = 1;
    const newTz = tzResults.get(edit.uuid);
    if (newTz !== undefined && newTz !== null && newTz !== item.tz) {
      const oldOffset = tzOffsetHours(item.tz);
      const newOffset = tzOffsetHours(newTz);
      item.date = applyHourOffset(item.date, newOffset - oldOffset);
      item.tz = newTz;
    }
  }
}

function mutateTimes(items: ItemEntry[], edits: TimeEdit[]): void {
  for (const edit of edits) {
    const item = items.find((i) => i.uuid === edit.uuid);
    if (item !== undefined) {
      item.date = applyHourOffset(item.date, edit.hours);
    }
  }
}
