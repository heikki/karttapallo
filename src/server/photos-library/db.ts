/* eslint-disable max-lines -- Single-DB-module: queries + formatters are tightly coupled */
/**
 * Read-only access to Apple Photos SQLite database using bun:sqlite.
 *
 * Replaces osxphotos query calls with direct SQL queries.
 * Run standalone: bun src/server/photos-library/db.ts [--library PATH] [--uuid UUID]
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

import { exifFromLocalEpoch, secondsToTzOffset } from '../date-utils';
import { tzNameFromCoords, tzOffsetSecondsAtInstant } from '../timezone';

// Core Data epoch: 2001-01-01 00:00:00 UTC
const CORE_DATA_EPOCH = 978307200;

export interface PhotoRecord {
  uuid: string;
  type: 'photo' | 'video';
  instant: number | null; // UTC seconds since Unix epoch (durable truth, ADR-0013)
  date: string; // "YYYY:MM:DD HH:MM:SS" local time, from the STORED offset (fallback)
  tz: string | null; // "+HH:MM", from the STORED offset (fallback)
  lat: number | null;
  lon: number | null;
  duration: number | null; // seconds (videos only)
  camera: string | null;
  gps: 'user' | 'exif' | 'inferred' | null;
  gps_accuracy: number | null;
  albums: string[];
  albumUuids: string[];
  directory: string | null;
  filename: string | null;
  originalFilename: string | null;
  hasEdits: boolean;
}

interface RawRow {
  ZUUID: string;
  ZKIND: number;
  ZDATECREATED: number | null;
  ZLATITUDE: number | null;
  ZLONGITUDE: number | null;
  ZDURATION: number | null;
  ZHIDDEN: number;
  ZTRASHEDSTATE: number;
  ZADJUSTMENTSSTATE: number;
  ZDIRECTORY: string | null;
  ZFILENAME: string | null;
  ZORIGINALFILENAME: string | null;
  ZTIMEZONEOFFSET: number | null;
  ZTIMEZONENAME: string | null;
  ZGPSHORIZONTALACCURACY: number | null;
  ZCAMERAMAKE: string | null;
  ZCAMERAMODEL: string | null;
  Z_PK: number;
}

interface AlbumRow {
  assetPk: number;
  albumTitle: string;
  albumUuid: string;
}

interface JoinTableInfo {
  tableName: string;
  albumColumn: string;
  assetColumn: string;
}

interface AlbumEntry {
  albumTitle: string;
  albumUuid: string;
}

// ---------- Database lifecycle ----------

export function defaultLibraryPath() {
  return join(homedir(), 'Pictures/Photos Library.photoslibrary');
}

export function openPhotosDb(libraryPath?: string): Database {
  const dbPath = join(
    libraryPath ?? defaultLibraryPath(),
    'database/Photos.sqlite'
  );

  if (!existsSync(dbPath)) {
    throw new Error(`Photos database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });
  validateSchema(db);
  return db;
}

function validateSchema(db: Database) {
  const required: Record<string, string[]> = {
    ZASSET: [
      'Z_PK',
      'ZUUID',
      'ZDATECREATED',
      'ZLATITUDE',
      'ZLONGITUDE',
      'ZDURATION',
      'ZKIND',
      'ZHIDDEN',
      'ZTRASHEDSTATE',
      'ZADJUSTMENTSSTATE',
      'ZDIRECTORY',
      'ZFILENAME'
    ],
    ZADDITIONALASSETATTRIBUTES: [
      'ZASSET',
      'ZGPSHORIZONTALACCURACY',
      'ZTIMEZONEOFFSET',
      'ZTIMEZONENAME',
      'ZORIGINALFILENAME'
    ],
    ZEXTENDEDATTRIBUTES: ['ZASSET', 'ZCAMERAMAKE', 'ZCAMERAMODEL'],
    ZGENERICALBUM: ['Z_PK', 'ZUUID', 'ZTITLE', 'ZKIND'],
    // Read by queryMetadata for the info panel's Description row, not by the
    // rebuild — the searchable copy comes from psi.sqlite (ADR-0014).
    ZASSETDESCRIPTION: ['ZASSETATTRIBUTES', 'ZLONGDESCRIPTION']
  };

  for (const [table, columns] of Object.entries(required)) {
    const info = db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all();
    if (info.length === 0) {
      throw new Error(`Missing table: ${table}`);
    }
    const existing = new Set(info.map((r) => r.name));
    for (const col of columns) {
      if (!existing.has(col)) {
        throw new Error(`Missing column ${table}.${col}`);
      }
    }
  }
}

// ---------- Join table discovery ----------

const joinTableCache = new WeakMap<Database, JoinTableInfo>();

function discoverJoinTable(db: Database): JoinTableInfo {
  const cached = joinTableCache.get(db);
  if (cached !== undefined) return cached;

  const tables = db
    .query<
      { name: string },
      []
    >("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z_%ASSETS' AND name GLOB 'Z_[0-9]*ASSETS' ORDER BY name")
    .all();

  for (const { name } of tables) {
    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(${name})`)
      .all()
      .map((r) => r.name);

    const albumCol = cols.find((c) => /^Z_\d+ALBUMS$/.exec(c) !== null);
    const assetCol = cols.find((c) => /^Z_\d+ASSETS$/.exec(c) !== null);

    if (albumCol !== undefined && assetCol !== undefined) {
      const info = {
        tableName: name,
        albumColumn: albumCol,
        assetColumn: assetCol
      };
      joinTableCache.set(db, info);
      return info;
    }
  }

  throw new Error('Could not find album-asset join table (Z_nnASSETS)');
}

// ---------- Formatting helpers ----------

/** UTC seconds since the Unix epoch from a Core Data timestamp. */
function instantFromCoreData(coreDataTimestamp: number | null): number | null {
  return coreDataTimestamp === null
    ? null
    : coreDataTimestamp + CORE_DATA_EPOCH;
}

function formatDate(
  coreDataTimestamp: number | null,
  timezoneOffsetSeconds: number | null
) {
  const unixSeconds = instantFromCoreData(coreDataTimestamp);
  if (unixSeconds === null) return '';
  return exifFromLocalEpoch(unixSeconds + (timezoneOffsetSeconds ?? 0));
}

function formatTzOffset(seconds: number | null): string | null {
  return seconds === null ? null : secondsToTzOffset(seconds);
}

function formatCameraBrand(m: string, mod: string): string | null {
  let cleanMake = m;
  let cleanModel = mod;

  if (m.toUpperCase().includes('OLYMPUS')) {
    cleanMake = 'Olympus';
    cleanModel = mod.replace(',', '/');
  }
  if (m.toUpperCase().includes('NIKON')) {
    cleanMake = 'Nikon';
  }
  if (m.toUpperCase().includes('SAMSUNG')) {
    cleanMake = 'Samsung';
  }

  if (cleanModel === '') {
    return cleanMake;
  }
  return `${cleanMake} ${cleanModel}`;
}

// eslint-disable-next-line complexity -- straightforward branching on make/model variants
function formatCamera(
  make: string | null,
  model: string | null
): string | null {
  const m = (make ?? '').trim();
  const mod = (model ?? '').trim();
  if (m === '' && mod === '') {
    return null;
  }
  if (
    m.toLowerCase() === 'unknown' &&
    (mod.toLowerCase() === 'unknown' || mod === '')
  ) {
    return null;
  }
  if (m === 'Apple') {
    return mod === '' ? null : mod;
  }
  if (mod.toLowerCase().startsWith(m.toLowerCase())) {
    return mod;
  }
  return formatCameraBrand(m, mod);
}

function determineGpsSource(
  accuracy: number | null
): 'user' | 'exif' | 'inferred' | null {
  if (accuracy === null) return null;
  if (accuracy === 10.0 || accuracy === 1.0) return 'user';
  if (accuracy === -1.0) return 'inferred';
  if (accuracy > 0) return 'exif';
  return null;
}

function roundAccuracy(val: number | null): number | null {
  if (val === null) return null;
  const r = Math.round(val * 10) / 10;
  return r === Math.floor(r) ? Math.floor(r) : r;
}

// ---------- Core query ----------

const BASE_SQL = `
  SELECT
    a.Z_PK,
    a.ZUUID,
    a.ZKIND,
    a.ZDATECREATED,
    a.ZLATITUDE,
    a.ZLONGITUDE,
    a.ZDURATION,
    a.ZHIDDEN,
    a.ZTRASHEDSTATE,
    a.ZADJUSTMENTSSTATE,
    a.ZDIRECTORY,
    a.ZFILENAME,
    aa.ZORIGINALFILENAME,
    aa.ZTIMEZONEOFFSET,
    aa.ZTIMEZONENAME,
    aa.ZGPSHORIZONTALACCURACY,
    e.ZCAMERAMAKE,
    e.ZCAMERAMODEL
  FROM ZASSET a
  LEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
  LEFT JOIN ZEXTENDEDATTRIBUTES e ON a.Z_PK = e.ZASSET
`;

function parseCoord(val: number | null): number | null {
  if (val === null || val === -180.0) {
    return null;
  }
  return val;
}

function parseDuration(kind: number, duration: number | null): number | null {
  if (kind !== 1 || duration === null || duration === 0) {
    return null;
  }
  return duration;
}

function rowToRecord(row: RawRow, albums: AlbumEntry[]): PhotoRecord {
  const lat = parseCoord(row.ZLATITUDE);
  const lon = parseCoord(row.ZLONGITUDE);
  const hasGps = lat !== null && lon !== null;

  return {
    uuid: row.ZUUID,
    type: row.ZKIND === 1 ? 'video' : 'photo',
    instant: instantFromCoreData(row.ZDATECREATED),
    date: formatDate(row.ZDATECREATED, row.ZTIMEZONEOFFSET),
    tz: formatTzOffset(row.ZTIMEZONEOFFSET),
    lat,
    lon,
    duration: parseDuration(row.ZKIND, row.ZDURATION),
    camera: formatCamera(row.ZCAMERAMAKE, row.ZCAMERAMODEL),
    gps: hasGps ? determineGpsSource(row.ZGPSHORIZONTALACCURACY) : null,
    gps_accuracy: hasGps ? roundAccuracy(row.ZGPSHORIZONTALACCURACY) : null,
    albums: albums.map((a) => a.albumTitle),
    albumUuids: albums.map((a) => a.albumUuid),
    directory: row.ZDIRECTORY,
    filename: row.ZFILENAME,
    originalFilename: row.ZORIGINALFILENAME,
    hasEdits: row.ZADJUSTMENTSSTATE > 0
  };
}

function buildRecords(
  db: Database,
  rows: RawRow[],
  joinTable: JoinTableInfo
): PhotoRecord[] {
  if (rows.length === 0) return [];

  const pks = rows.map((r) => r.Z_PK);
  const albumMap = loadAlbums(db, pks, joinTable);

  return rows.map((row) => rowToRecord(row, albumMap.get(row.Z_PK) ?? []));
}

function loadAlbums(
  db: Database,
  assetPks: number[],
  joinTable: JoinTableInfo
): Map<number, AlbumEntry[]> {
  if (assetPks.length === 0) return new Map();

  const placeholders = assetPks.map(() => '?').join(',');
  const sql = `
    SELECT
      j.${joinTable.assetColumn} as assetPk,
      g.ZTITLE as albumTitle,
      g.ZUUID as albumUuid
    FROM ${joinTable.tableName} j
    JOIN ZGENERICALBUM g ON j.${joinTable.albumColumn} = g.Z_PK
    WHERE j.${joinTable.assetColumn} IN (${placeholders})
      AND g.ZKIND = 2
      AND g.ZTITLE IS NOT NULL
  `;

  const rows = db.query<AlbumRow, number[]>(sql).all(...assetPks);

  const map = new Map<number, AlbumEntry[]>();
  for (const row of rows) {
    let list = map.get(row.assetPk);
    if (list === undefined) {
      list = [];
      map.set(row.assetPk, list);
    }
    list.push({
      albumTitle: row.albumTitle,
      albumUuid: row.albumUuid
    });
  }
  return map;
}

// ---------- Public query functions ----------

export function queryPhotos(db: Database): PhotoRecord[] {
  const joinTable = discoverJoinTable(db);
  const rows = db
    .query<
      RawRow,
      []
    >(`${BASE_SQL} WHERE a.ZKIND = 0 AND a.ZHIDDEN = 0 AND a.ZTRASHEDSTATE = 0`)
    .all();
  return buildRecords(db, rows, joinTable);
}

export function queryVideos(db: Database): PhotoRecord[] {
  const joinTable = discoverJoinTable(db);
  const rows = db
    .query<
      RawRow,
      []
    >(`${BASE_SQL} WHERE a.ZKIND = 1 AND a.ZHIDDEN = 0 AND a.ZTRASHEDSTATE = 0`)
    .all();
  return buildRecords(db, rows, joinTable);
}

/**
 * UUID of Photos.app's built-in "Not in album" smart album, used as the
 * deep-link target for assets the user hasn't filed into any album. The UUID
 * is library-local — every Photos library generates a fresh one — so we
 * resolve it dynamically rather than hardcoding.
 */
export function queryNotInAlbumUuid(db: Database) {
  const row = db
    .query<
      { ZUUID: string },
      []
    >(`SELECT ZUUID FROM ZGENERICALBUM WHERE ZKIND = 1507 AND ZTITLE = 'Not in album' LIMIT 1`)
    .get();
  return row?.ZUUID ?? '';
}

/** One user album: the title Photos shows, and the id it keeps it under. */
export interface AlbumRoster {
  uuid: string;
  title: string;
}

/**
 * Every album the user made, by title and UUID.
 *
 * `ZKIND = 2` is the user-created album. The other kinds in this table are
 * Photos' own: smart albums like "Not in album" (1507), folders that group
 * albums (4000), and a long tail of internal kinds with no title at all. None
 * of them is something the user can attach a route to.
 *
 * Titles come back NFC-normalised. Photos stores them decomposed — `ä` as
 * `a` + U+0308 — while every title the app has already shown went through the
 * same normalisation on its way to the client, so a raw comparison misses
 * exactly the albums with accented names (docs/gotchas.md).
 */
export function queryAlbums(db: Database): AlbumRoster[] {
  return db
    .query<{ ZUUID: string | null; ZTITLE: string | null }, []>(
      `SELECT ZUUID, ZTITLE FROM ZGENERICALBUM WHERE ZKIND = 2`
    )
    .all()
    .filter(
      (r): r is { ZUUID: string; ZTITLE: string } =>
        r.ZUUID !== null && r.ZTITLE !== null && r.ZTITLE !== ''
    )
    .map((r) => ({ uuid: r.ZUUID, title: r.ZTITLE.normalize('NFC') }));
}

/** `queryAlbums` against a library path, opening and closing the db around it. */
export function readAlbums(libraryPath?: string): AlbumRoster[] {
  const db = openPhotosDb(libraryPath ?? defaultLibraryPath());
  try {
    return queryAlbums(db);
  } finally {
    db.close();
  }
}

/** Lightweight asset record for image cache — no album/camera overhead. */
export interface AssetRecord {
  uuid: string;
  type: 'photo' | 'video';
  directory: string | null;
  filename: string | null;
  hasEdits: boolean;
}

/** Load all visible assets as lightweight records for image cache lookup. */
export function queryAssetIndex(db: Database): Map<string, AssetRecord> {
  const rows = db
    .query<
      {
        ZUUID: string;
        ZKIND: number;
        ZDIRECTORY: string | null;
        ZFILENAME: string | null;
        ZADJUSTMENTSSTATE: number;
      },
      []
    >(
      `SELECT ZUUID, ZKIND, ZDIRECTORY, ZFILENAME, ZADJUSTMENTSSTATE
       FROM ZASSET
       WHERE ZHIDDEN = 0 AND ZTRASHEDSTATE = 0`
    )
    .all();

  const map = new Map<string, AssetRecord>();
  for (const row of rows) {
    map.set(row.ZUUID, {
      uuid: row.ZUUID,
      type: row.ZKIND === 1 ? 'video' : 'photo',
      directory: row.ZDIRECTORY,
      filename: row.ZFILENAME,
      hasEdits: row.ZADJUSTMENTSSTATE > 0
    });
  }
  return map;
}

// ---------- Metadata helpers ----------

type MetaRow = Record<string, unknown>;
type SetFn = (key: string, val: unknown) => void;

function metaSet(result: Record<string, unknown>, key: string, val: unknown) {
  if (val !== null && val !== undefined && val !== '' && val !== -180.0) {
    result[key] = val; // eslint-disable-line no-param-reassign -- intentional accumulator mutation
  }
}

function formatDimPair(w: unknown, h: unknown): string | null {
  if (typeof w !== 'number' || typeof h !== 'number') return null;
  if (w <= 0 || h <= 0) return null;
  return `${w}×${h}`;
}

function formatMetaDimensions(row: MetaRow, set: SetFn) {
  const cur = formatDimPair(row.width, row.height);
  const orig = formatDimPair(row.original_width, row.original_height);
  const dimensions =
    cur !== null && orig !== null && cur !== orig
      ? `${cur} (original ${orig})`
      : (cur ?? orig);
  if (dimensions !== null) set('dimensions', dimensions);
  if (typeof row.original_filesize === 'number' && row.original_filesize > 0) {
    const mb = row.original_filesize / 1024 / 1024;
    set('original_filesize', `${mb.toFixed(1)} MB`);
  }
}

function formatMetaDuration(row: MetaRow, set: SetFn) {
  if (typeof row.duration === 'number' && row.duration > 0) {
    const mins = Math.floor(row.duration / 60);
    const secs = Math.floor(row.duration % 60);
    set('duration', `${mins}:${secs.toString().padStart(2, '0')}`);
  }
}

function formatMetaFlags(row: MetaRow, set: SetFn) {
  set('favorite', row.favorite === 1 ? 'Yes' : null);
  set('hidden', row.hidden === 1 ? 'Yes' : null);
  set('ismovie', row.kind === 1 ? 'Yes' : null);
  set('screenshot', row.screenshot === 1 ? 'Yes' : null);
  set('hdr', typeof row.hdr === 'number' && row.hdr > 0 ? 'Yes' : null);
}

function formatMetaCamera(row: MetaRow, set: SetFn) {
  const make = typeof row.camera_make === 'string' ? row.camera_make : null;
  const model = typeof row.camera_model === 'string' ? row.camera_model : null;
  if (make !== null || model !== null) {
    const camera =
      model !== null && make !== null && !model.startsWith(make)
        ? `${make} ${model}`
        : (model ?? make);
    set('camera', camera);
  }
  set('lens', row.lens_model);
}

function formatMetaExposure(row: MetaRow, set: SetFn) {
  if (typeof row.aperture === 'number') {
    set('aperture', `f/${row.aperture.toFixed(1)}`);
  }
  if (typeof row.shutter_speed === 'number') {
    const ss = row.shutter_speed;
    set('shutter_speed', ss >= 1 ? `${ss}s` : `1/${Math.round(1 / ss)}s`);
  }
  if (typeof row.iso === 'number') {
    set('iso', `ISO ${row.iso}`);
  }
  if (typeof row.focal_length === 'number') {
    let fl = `${row.focal_length.toFixed(0)}mm`;
    if (typeof row.focal_length_35mm === 'number') {
      fl += ` (${row.focal_length_35mm.toFixed(0)}mm eq.)`;
    }
    set('focal_length', fl);
  }
  set('flash', row.flash === 1 ? 'Yes' : row.flash === 0 ? 'No' : null);
}

/** Zone label for display: the IANA name when Photos stored one, else UTC±HH:MM. */
function zoneLabel(name: unknown, offsetSeconds: unknown): string | null {
  if (typeof name === 'string' && name !== '') return name;
  if (typeof offsetSeconds !== 'number') return null;
  return `UTC${secondsToTzOffset(offsetSeconds)}`;
}

/** "2015:02:04 15:11:40 America/Antigua" — wall clock beside its zone. */
function withZone(local: string, zone: string | null): string | null {
  if (local === '') return null;
  return zone === null ? local : `${local} ${zone}`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/**
 * Whether the asset carries EXIF the camera itself wrote. Nothing records where
 * ZEXTENDEDATTRIBUTES.ZDATECREATED came from, so the shooting fields stand in:
 * if any survived, Photos had an EXIF block to read the date from too.
 *
 * Make and model alone are not enough — 21 stills in this library have both
 * stripped while keeping ISO, aperture and a lens model ("iPhone 5 back camera
 * 4.12mm f/2.4"), and testing on those two would have called them provenanceless
 * and blanked a date the camera really did record. Any one field is enough;
 * requiring several would fail assets whose EXIF is merely sparse.
 */
function hasExifProvenance(row: MetaRow) {
  function present(v: unknown) {
    return typeof v === 'number' || (typeof v === 'string' && v !== '');
  }
  return (
    present(row.camera_make) ||
    present(row.camera_model) ||
    present(row.lens_model) ||
    present(row.iso) ||
    present(row.aperture) ||
    present(row.shutter_speed) ||
    present(row.focal_length)
  );
}

/**
 * Wall clock and zone for `date`, derived from the durable pair — the UTC
 * instant and the coordinates — the same way buildItemEntry derives them for
 * the items list (ADR-0013). The stored ZTIMEZONEOFFSET is a fallback, not the
 * source: a restore can lose it, and where it is missing the stored path
 * silently renders the UTC wall clock with no zone beside it to say so.
 *
 * Null when there is nothing to derive from — no instant, no coordinates, or
 * coordinates geo-tz maps to no zone — which is exactly when the stored
 * columns are all we have.
 */
function derivedLocal(row: MetaRow) {
  const instant = instantFromCoreData(num(row.date_created));
  const lat = parseCoord(num(row.latitude));
  const lon = parseCoord(num(row.longitude));
  if (instant === null || lat === null || lon === null) return null;
  const tzName = tzNameFromCoords(lat, lon);
  if (tzName === null) return null;
  const offsetSec = tzOffsetSecondsAtInstant(tzName, instant);
  if (offsetSec === null) return null;
  return { local: exifFromLocalEpoch(instant + offsetSec), offsetSec, tzName };
}

/**
 * Emit `date` and, when it differs, `original_date`.
 *
 * The zone rides along with each time rather than sitting in a row of its own,
 * so the two lines can be read directly against each other:
 *
 *   Date           2025:08:31 10:29:51 Atlantic/Reykjavik
 *   Original date  2025:08:31 17:29:51 Europe/Helsinki
 *
 * `original_date` comes from ZEXTENDEDATTRIBUTES — the value Photos.app labels
 * "Alkuperäinen" in its Adjust Date & Time sheet. Photos writes that row once
 * at import and never saves it again (every row in this library is still at
 * Z_OPT 1 while ZASSET runs into the teens), so no later date edit touches it,
 * ours or Photos' own.
 *
 * It is not an EXIF table, though. ZDATECREATED, ZTIMEZONEOFFSET and
 * ZTIMEZONENAME are the only columns Photos fills for every asset, so a file
 * carrying no EXIF at all — video from a camera that writes none — still gets a
 * date, from whatever Photos could find. That can be an import artifact with no
 * bearing on when the thing was shot, so assets with no EXIF provenance keep
 * the row but leave it empty rather than dress the artifact up as the camera's
 * own record. An empty row says "nothing the camera recorded"; a missing row
 * would read as "not looked at".
 *
 * Given provenance, the row earns a value only when the wall clock or the
 * offset actually differs; matching both means only the label style differs (an
 * IANA name vs Photos' own GMT+nnnn), which is not a real disagreement and
 * would just be noise on most assets. That comparison runs against the DERIVED
 * pair whenever there is one, not the stored pair — the row exists to be read
 * against the Date line above it, so hiding it means agreeing with what that
 * line actually shows.
 */
function formatMetaDates(row: MetaRow, set: SetFn, setAlways: SetFn) {
  const off = num(row.tz_offset);
  const exifOff = num(row.exif_tz_offset);
  const derived = derivedLocal(row);
  const local = derived?.local ?? formatDate(num(row.date_created), off);
  const localOff = derived?.offsetSec ?? off;
  const exifLocal = formatDate(num(row.exif_date), exifOff);

  set('date', withZone(local, derived?.tzName ?? zoneLabel(row.tz_name, off)));

  if (!hasExifProvenance(row)) {
    setAlways('original_date', null);
    return;
  }

  const sameMoment = local === exifLocal && localOff === exifOff;
  set(
    'original_date',
    sameMoment
      ? null
      : withZone(exifLocal, zoneLabel(row.exif_tz_name, exifOff))
  );
}

function formatMetaGpsAccuracy(row: MetaRow, set: SetFn) {
  set(
    'gps_accuracy',
    typeof row.gps_accuracy === 'number' && row.gps_accuracy >= 0
      ? `${row.gps_accuracy.toFixed(1)}m`
      : null
  );
}

function queryMetaRelations(db: Database, uuid: string, set: SetFn) {
  const keywords = db
    .query<{ ZTITLE: string }, [string]>(
      `SELECT k.ZTITLE FROM ZKEYWORD k
       JOIN Z_1KEYWORDS jk ON k.Z_PK = jk.Z_52KEYWORDS
       JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = jk.Z_1ASSETATTRIBUTES
       JOIN ZASSET a ON a.Z_PK = aa.ZASSET
       WHERE a.ZUUID = ?`
    )
    .all(uuid)
    .map((r) => r.ZTITLE);
  if (keywords.length > 0) set('keywords', keywords.join(', '));

  const joinTable = discoverJoinTable(db);
  const albums = db
    .query<{ ZTITLE: string }, [string]>(
      `SELECT g.ZTITLE FROM ZGENERICALBUM g
       JOIN ${joinTable.tableName} j ON g.Z_PK = j.${joinTable.albumColumn}
       JOIN ZASSET a ON a.Z_PK = j.${joinTable.assetColumn}
       WHERE a.ZUUID = ? AND g.ZTITLE IS NOT NULL AND g.ZKIND = 2`
    )
    .all(uuid)
    .map((r) => r.ZTITLE);
  if (albums.length > 0) set('albums', albums.join(', '));

  const persons = db
    .query<{ name: string }, [string]>(
      `SELECT COALESCE(p.ZDISPLAYNAME, p.ZFULLNAME) AS name
       FROM ZPERSON p
       JOIN ZDETECTEDFACE df ON df.ZPERSONFORFACE = p.Z_PK
       JOIN ZASSET a ON a.Z_PK = df.ZASSETFORFACE
       WHERE a.ZUUID = ? AND (p.ZDISPLAYNAME IS NOT NULL OR p.ZFULLNAME IS NOT NULL)`
    )
    .all(uuid)
    .map((r) => r.name);
  if (persons.length > 0) set('persons', [...new Set(persons)].join(', '));
}

/** Rich metadata for a single asset — used by the info panel. */
export function queryMetadata(
  db: Database,
  uuid: string
): Record<string, unknown> | null {
  const row = db
    .query<MetaRow, [string]>(
      `SELECT
        a.ZUUID AS uuid,
        a.ZFILENAME AS filename,
        aa.ZORIGINALFILENAME AS original_filename,
        a.ZKIND AS kind,
        a.ZDATECREATED AS date_created,
        aa.ZTITLE AS title,
        ad.ZLONGDESCRIPTION AS description,
        a.ZWIDTH AS width,
        a.ZHEIGHT AS height,
        aa.ZORIGINALWIDTH AS original_width,
        aa.ZORIGINALHEIGHT AS original_height,
        aa.ZORIGINALFILESIZE AS original_filesize,
        a.ZUNIFORMTYPEIDENTIFIER AS uti,
        a.ZLATITUDE AS latitude,
        a.ZLONGITUDE AS longitude,
        a.ZDURATION AS duration,
        a.ZFAVORITE AS favorite,
        a.ZHIDDEN AS hidden,
        a.ZISDETECTEDSCREENSHOT AS screenshot,
        a.ZHDRTYPE AS hdr,
        e.ZCAMERAMAKE AS camera_make,
        e.ZCAMERAMODEL AS camera_model,
        e.ZLENSMODEL AS lens_model,
        e.ZAPERTURE AS aperture,
        e.ZSHUTTERSPEED AS shutter_speed,
        e.ZISO AS iso,
        e.ZFOCALLENGTH AS focal_length,
        e.ZFOCALLENGTHIN35MM AS focal_length_35mm,
        e.ZFLASHFIRED AS flash,
        aa.ZTIMEZONEOFFSET AS tz_offset,
        aa.ZTIMEZONENAME AS tz_name,
        e.ZDATECREATED AS exif_date,
        e.ZTIMEZONEOFFSET AS exif_tz_offset,
        e.ZTIMEZONENAME AS exif_tz_name,
        aa.ZGPSHORIZONTALACCURACY AS gps_accuracy
      FROM ZASSET a
      LEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
      LEFT JOIN ZEXTENDEDATTRIBUTES e ON a.Z_PK = e.ZASSET
      LEFT JOIN ZASSETDESCRIPTION ad ON aa.Z_PK = ad.ZASSETATTRIBUTES
      WHERE a.ZUUID = ?`
    )
    .get(uuid);

  if (row === null) return null;

  const result: Record<string, unknown> = {};
  const set: SetFn = (key, val) => {
    metaSet(result, key, val);
  };
  // Emits the key even with no value, so the field keeps its row instead of
  // vanishing. Only for fields whose emptiness is itself worth showing.
  const setAlways: SetFn = (key, val) => {
    result[key] = val ?? null;
  };

  set('uuid', row.uuid);
  set('filename', row.filename);
  set('original_filename', row.original_filename);
  formatMetaDates(row, set, setAlways);
  set('title', row.title);
  set('description', row.description);

  formatMetaDimensions(row, set);
  set('uti', row.uti);
  set('latitude', row.latitude);
  set('longitude', row.longitude);
  formatMetaDuration(row, set);
  formatMetaFlags(row, set);
  formatMetaCamera(row, set);
  formatMetaExposure(row, set);
  formatMetaGpsAccuracy(row, set);
  queryMetaRelations(db, uuid, set);

  return result;
}
