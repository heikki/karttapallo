/**
 * Restore ZDATECREATED for assets whose stored instant was derived from a
 * timezone offset that fix-timezones.ts has since corrected.
 *
 * The damage this repairs is not a camera clock. At import Photos derives an
 * offset for ZADDITIONALASSETATTRIBUTES and stores the instant as
 * (camera wall clock − that offset). When the derived offset is junk, the
 * instant is wrong by exactly the same amount, and the two cancel: Photos still
 * displays the right wall clock. fix-timezones.ts then rewrites the offset to
 * the true zone while deliberately holding the instant (ADR-0013), which is
 * correct for the offset column but uncancels the pair — converting a harmless
 * offset error into a real instant error, ragged by construction.
 *
 * Two observed sources of the junk, both from Photos guessing at import:
 *
 *   - Differencing the EXIF local clock against GPSTimeStamp, for files that
 *     carry one but no GPSDateStamp. Where the GPS fix lags the shutter (an
 *     iPhone 3GS lags 0–96 min, jittering) the derived offset lands on values
 *     like GMT-0429 or GMT-0536. This is what "2011 Boston" is full of.
 *   - Falling back to the library's home zone when there is nothing to
 *     difference — no GPS block at all, or a GPS time that wrapped past UTC
 *     midnight. That yields a clean but wrong whole-hour offset.
 *
 * Do not read the first as "GPSTimeStamp is UTC". It is not dependable: the
 * same iPhone 3GS wrote genuine UTC in "2011 Boston" and local time in
 * "2010 Pietari". See WHAT THIS SCRIPT CANNOT DECIDE below.
 *
 * WHY THIS IS NOT fix-shifted-dates.ts --delta
 *
 * That script gates on a uniform drift shared by every asset, and refuses
 * ragged per-asset drift on the grounds that raggedness means a camera clock or
 * a bogus EXIF block, where the EXIF instant is not authoritative. That
 * reasoning is sound and must not be widened. This script does not widen it —
 * it replaces it with a different, narrower premise that can be checked per
 * asset, and only then treats the EXIF instant as authoritative:
 *
 *   1. delta == old_offset − exif_offset, exactly. The old offset comes from
 *      the tz-backup fix-timezones.ts wrote BEFORE overwriting the column, so
 *      this is a measurement, not an inference. It holding means both stored
 *      instants encode the same camera wall clock and differ only because the
 *      two tables were stamped with different offsets — i.e. the disagreement
 *      is bookkeeping, and no date edit ever touched the asset.
 *
 *      On its own this is NOT a signature of damage. Both tables agreeing on
 *      the camera wall clock is the healthy, normal case; it is equally true of
 *      assets nothing ever went wrong with. Hence condition 1b.
 *
 *   1b. old_offset != the offset the column holds now. The damage requires
 *      fix-timezones.ts to have actually rewritten the offset value while
 *      holding the instant — that rewrite is what uncancels the pair. Where the
 *      value is unchanged (only the zone NAME was rewritten, GMT+0200 to an
 *      IANA name) nothing was uncancelled and there is nothing to repair. Eight
 *      assets in this library sat in the condition-2 bucket for exactly this
 *      reason, reported as pending work while being perfectly correct.
 *
 *   2. exif_offset equals the offset derived from the asset's coordinates.
 *      Condition 1 proves the wall clock is recoverable; it says nothing about
 *      which zone that wall clock was in. This corroborates the EXIF row's own
 *      stamp against the coordinates, independently.
 *
 *      This does NOT establish that the camera's clock was set to local time,
 *      and the script cannot establish it from EXIF alone — see the warning
 *      below. It only rules out the EXIF row carrying an obvious fallback.
 *
 * Assets passing 1/1b but failing 2 are reported, never written: their EXIF row
 * holds a fallback guess (typically the home zone, for shots whose GPS time was
 * missing or wrapped past UTC midnight), so it is not a valid target, and where
 * the camera clock stood needs outside evidence.
 *
 * Note these are all genuinely broken — their instant really is wrong. The
 * other way to fail condition 2 is to have nothing wrong at all beyond a junk
 * zone label on the Original date row, and condition 1b already catches that:
 * given condition 1, the gap between the displayed wall clock and the camera's
 * reduces to old_offset − current_offset, which 1b requires to be non-zero.
 *
 * WHAT THIS SCRIPT CANNOT DECIDE
 *
 * Whether the camera's clock was set to local time at the coordinates. Both
 * conditions can hold while the clock was on some other zone entirely, and then
 * the EXIF instant is not the capture instant. This is not hypothetical: in
 * "2010 Pietari" the clock was on Finnish time for the whole trip while the
 * coordinates were Russian, and the gate offered 9 assets whose EXIF instant
 * was an hour early. GPSTimeStamp does not settle it either — the same iPhone
 * 3GS wrote genuine UTC in one album and local time in another, so differencing
 * it silently reproduces Photos' own error.
 *
 * What did settle it was sun altitude against measured exposure, checked by
 * hand on one photograph. The report prints both per proposed change so they can
 * be scanned, but it is advisory only and deliberately not a gate: a scene can
 * always be darker than the sun allows (indoors, shade) and never brighter, so
 * the test is one-sided, and both errors found so far erred toward darker. Read
 * the album before running --fix on it.
 *
 * Writes go through AppleScript, never SQLite — Photos journals the instant, so
 * an AppleScript write is durable. See docs/gotchas.md.
 *
 * `--fix` REQUIRES `--uuid=`. Because the gate cannot decide the camera-clock
 * question above, a whole-album --fix would rewrite assets it has no business
 * touching; naming the UUIDs forces whoever runs it to have read the dry run
 * for that album first. `--uuid=` only restricts the candidate set — conditions
 * 1, 1b and 2 all still have to pass, so it cannot force through an asset the
 * gate rejects, and a UUID matching no asset is a hard error, not a no-op.
 *
 * The dry run prints a ready-made `--uuid=` line listing every candidate. Cut it
 * down to the ones that should actually move; do not paste it back wholesale.
 *
 * Usage:
 *   bun scripts/fix-offset-derived-dates.ts
 *   bun scripts/fix-offset-derived-dates.ts --album="2011 Boston"
 *   bun scripts/fix-offset-derived-dates.ts --uuid=7A3D912A-…,B400D93D-… --fix
 */

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { quitPhotosApp, setDateTime } from '@server/photos-edit';
import { resolveLibrary } from '@server/photos-library';
import { Database } from 'bun:sqlite';

import { exposureValue, sunAltitude } from './solar';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports -- geo-tz CJS interop required for Bun bundler
const { find: geoTzFind } = require('geo-tz/all') as typeof import('geo-tz');

const CORE_DATA_EPOCH = 978307200; // 2001-01-01 00:00:00 UTC in Unix seconds
const KIND_PHOTO = 0;

const FIX = process.argv.includes('--fix');
const INCLUDE_VIDEOS = process.argv.includes('--include-videos');
const ALBUM = process.argv.find((a) => a.startsWith('--album='))?.slice(8);
const BACKUP_ARG = process.argv
  .find((a) => a.startsWith('--backup='))
  ?.slice(9);
const ONLY_UUIDS = new Set(
  process.argv
    .find((a) => a.startsWith('--uuid='))
    ?.slice(7)
    .split(',')
    .map((u) => u.trim().toUpperCase())
    .filter((u) => u !== '')
);

// --fix demands an explicit UUID list. The gate cannot tell whether the camera's
// clock was on local time (see WHAT THIS SCRIPT CANNOT DECIDE), so a whole-album
// --fix would happily rewrite assets it has no business touching — in
// "2010 Pietari" it offers 9 that are already correct. Naming the UUIDs forces
// whoever runs it to have read the dry run for that album.
if (FIX && ONLY_UUIDS.size === 0) {
  console.error(
    '--fix requires --uuid=. Run without --fix to see the candidates and their\n' +
      'UUIDs, check them against the album, then name the ones that should move.'
  );
  process.exit(1);
}

const SUPPORT_DIR = join(homedir(), 'Library/Application Support/Karttapallo');

// ---------- the pre-fix offsets ----------

/**
 * Newest tz-backup, unless one is named. This file is the whole basis of
 * condition 1: it is the only record of what the offset column held before
 * fix-timezones.ts overwrote it. Without it the script cannot run at all —
 * guessing the old offset from the delta would make condition 1 circular.
 */
function resolveBackupPath(): string | null {
  if (BACKUP_ARG !== undefined) return BACKUP_ARG;
  try {
    const names = readdirSync(SUPPORT_DIR)
      .filter((n) => n.startsWith('tz-backup-') && n.endsWith('.json'))
      .sort();
    const newest = names.at(-1);
    return newest === undefined ? null : join(SUPPORT_DIR, newest);
  } catch {
    return null;
  }
}

const backupPath = resolveBackupPath();
if (backupPath === null) {
  console.error(
    `No tz-backup-*.json found in ${SUPPORT_DIR}.\n` +
      'This script needs the offsets fix-timezones.ts recorded before it\n' +
      'overwrote them; there is no way to reconstruct them after the fact.'
  );
  process.exit(1);
}

interface TzBackupEntry {
  uuid: string;
  off: number | null;
  name: string | null;
}
const oldOffsets = new Map<string, number>();
for (const e of (await Bun.file(backupPath).json()) as TzBackupEntry[]) {
  if (e.off !== null) oldOffsets.set(e.uuid, e.off);
}
console.log(
  `Pre-fix offsets: ${oldOffsets.size} from ${backupPath.replace(homedir(), '~')}`
);

// ---------- library ----------

const resolved = resolveLibrary();
if (!resolved.ok) {
  console.error(
    resolved.error === 'fda'
      ? `Cannot read Photos library (Full Disk Access): ${resolved.message}`
      : `Photos library not available: ${resolved.libraryPath}`
  );
  process.exit(1);
}
const photosDbPath = join(resolved.path, 'database/Photos.sqlite');
const db = new Database(photosDbPath, { readonly: true });

const tables = db
  .query<
    { name: string },
    []
  >("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'Z_[0-9]*ASSETS'")
  .all();
let joinTable = '';
let albumCol = '';
let assetCol = '';
for (const { name } of tables) {
  const cols = db
    .query<{ name: string }, []>(`PRAGMA table_info(${name})`)
    .all()
    .map((c) => c.name);
  const ac = cols.find((c) => /^Z_\d+ALBUMS$/.exec(c) !== null);
  const sc = cols.find((c) => /^Z_\d+ASSETS$/.exec(c) !== null);
  if (ac !== undefined && sc !== undefined) {
    joinTable = name;
    albumCol = ac;
    assetCol = sc;
    break;
  }
}
if (joinTable === '') {
  console.error('Could not find the album join table in Photos.sqlite');
  process.exit(1);
}

interface Row {
  uuid: string;
  filename: string;
  kind: number;
  date_created: number;
  exif_date: number;
  exif_off: number | null;
  aa_off: number | null;
  lat: number | null;
  lon: number | null;
  camera_make: string | null;
  camera_model: string | null;
  lens_model: string | null;
  iso: number | null;
  aperture: number | null;
  shutter_speed: number | null;
  focal_length: number | null;
  albums: string | null;
}

const rows = db
  .query<Row, []>(
    `SELECT a.ZUUID AS uuid,
            aa.ZORIGINALFILENAME AS filename,
            a.ZKIND AS kind,
            a.ZDATECREATED AS date_created,
            e.ZDATECREATED AS exif_date,
            e.ZTIMEZONEOFFSET AS exif_off,
            aa.ZTIMEZONEOFFSET AS aa_off,
            a.ZLATITUDE AS lat,
            a.ZLONGITUDE AS lon,
            e.ZCAMERAMAKE AS camera_make,
            e.ZCAMERAMODEL AS camera_model,
            e.ZLENSMODEL AS lens_model,
            e.ZISO AS iso,
            e.ZAPERTURE AS aperture,
            e.ZSHUTTERSPEED AS shutter_speed,
            e.ZFOCALLENGTH AS focal_length,
            GROUP_CONCAT(al.ZTITLE, ', ') AS albums
       FROM ZASSET a
       JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
       JOIN ZEXTENDEDATTRIBUTES e ON a.Z_PK = e.ZASSET
       LEFT JOIN ${joinTable} ja ON a.Z_PK = ja.${assetCol}
       LEFT JOIN ZGENERICALBUM al ON ja.${albumCol} = al.Z_PK AND al.ZKIND = 2
      WHERE a.ZTRASHEDSTATE = 0
        AND e.ZDATECREATED IS NOT NULL
        AND a.ZDATECREATED IS NOT NULL
      GROUP BY a.Z_PK`
  )
  .all();

// ---------- classification ----------

/** See db.ts hasExifProvenance — any surviving shooting field is enough. */
function hasExifProvenance(r: Row) {
  function present(v: unknown) {
    return typeof v === 'number' || (typeof v === 'string' && v !== '');
  }
  return (
    present(r.camera_make) ||
    present(r.camera_model) ||
    present(r.lens_model) ||
    present(r.iso) ||
    present(r.aperture) ||
    present(r.shutter_speed) ||
    present(r.focal_length)
  );
}

const GMT_RE = /^GMT(?:(?<sign>[+-])(?<h>\d{2}):(?<m>\d{2}))?$/;

function parseGmtOffsetMinutes(s: string): number | null {
  const match = GMT_RE.exec(s);
  if (match === null) return null;
  if (match.groups?.sign === undefined) return 0;
  const sign = match.groups.sign === '+' ? 1 : -1;
  return (
    sign * (parseInt(match.groups.h!, 10) * 60 + parseInt(match.groups.m!, 10))
  );
}

/** True offset in seconds at these coordinates, at this instant (DST-aware). */
function coordOffsetSeconds(
  lat: number,
  lon: number,
  instantUnix: number
): number | null {
  const zones = geoTzFind(lat, lon);
  const zone = zones[0];
  if (zone === undefined) return null;
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset'
    })
      .formatToParts(new Date(instantUnix * 1000))
      .find((p) => p.type === 'timeZoneName');
    if (part === undefined) return null;
    const mins = parseGmtOffsetMinutes(part.value);
    return mins === null ? null : mins * 60;
  } catch {
    return null;
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Render an offset the way Photos labels it, e.g. -16140 -> "GMT-0429". */
function formatOffset(seconds: number) {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  return `GMT${sign}${pad(Math.floor(abs / 3600))}${pad(Math.round((abs % 3600) / 60))}`;
}

/** Render an instant as the wall clock at a given offset. Display only. */
function wallClock(instantUnix: number, offsetSeconds: number) {
  const d = new Date((instantUnix + offsetSeconds) * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Wall clock in the SYSTEM zone — the form setDateTime expects, because
 * AppleScript builds dates in the system zone and Photos converts them back to
 * UTC on the way in. Keeps the round trip exact with no offset arithmetic.
 */
function systemLocalParts(instantUnix: number) {
  const d = new Date(instantUnix * 1000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}

interface Target {
  row: Row;
  oldOff: number;
  exifOff: number;
  trueOff: number;
  delta: number;
}

const targets: Target[] = [];
const zoneUncorroborated: Target[] = [];
const skipped = new Map<string, number>();
function skip(reason: string) {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
}

function inAlbum(r: Row) {
  if (ALBUM === undefined) return true;
  return r.albums?.toLowerCase().includes(ALBUM.toLowerCase()) === true;
}

function inScope(r: Row) {
  if (ONLY_UUIDS.size > 0 && !ONLY_UUIDS.has(r.uuid.toUpperCase())) {
    return false;
  }
  return inAlbum(r);
}

let considered = 0;
for (const row of rows) {
  if (!inScope(row)) continue;
  considered++;

  const delta = Math.round(row.exif_date - row.date_created);
  if (delta === 0) {
    skip('already aligned');
    continue;
  }
  if (!hasExifProvenance(row)) {
    skip('no EXIF provenance (EXIF instant not a capture time)');
    continue;
  }
  if (!INCLUDE_VIDEOS && row.kind !== KIND_PHOTO) {
    skip('video (pass --include-videos)');
    continue;
  }
  if (row.exif_off === null) {
    skip('no EXIF timezone offset to compare');
    continue;
  }
  const oldOff = oldOffsets.get(row.uuid);
  if (oldOff === undefined) {
    skip('not in tz-backup (offset never rewritten)');
    continue;
  }

  // Condition 1 — the disagreement is offset bookkeeping, exactly.
  if (oldOff - row.exif_off !== delta) {
    skip('condition 1 fails: delta not explained by the offsets');
    continue;
  }

  // Condition 1b — the offset VALUE was actually rewritten. Without this, the
  // healthy case (both tables agreeing on the wall clock, offset never touched)
  // satisfies condition 1 and gets reported as pending work.
  if (row.aa_off === null || row.aa_off === oldOff) {
    skip(
      'condition 1b fails: offset value never rewritten, nothing uncancelled'
    );
    continue;
  }

  if (
    row.lat === null ||
    row.lon === null ||
    row.lat === -180.0 ||
    row.lon === -180.0
  ) {
    skip('condition 2 unverifiable: no coordinates');
    continue;
  }
  const trueOff = coordOffsetSeconds(
    row.lat,
    row.lon,
    row.exif_date + CORE_DATA_EPOCH
  );
  if (trueOff === null) {
    skip('condition 2 unverifiable: no zone for coordinates');
    continue;
  }

  const entry = { row, oldOff, exifOff: row.exif_off, trueOff, delta };
  // Condition 2 — the EXIF row's own stamp is corroborated by the coordinates.
  if (trueOff === row.exif_off) {
    targets.push(entry);
    continue;
  }
  // Anything reaching here displays something other than the camera's own wall
  // clock, so its instant really is wrong. (The "only the zone label is junk"
  // case cannot arrive: given condition 1, cameraClock − displayed reduces to
  // old_offset − current_offset, which condition 1b requires to be non-zero.)
  zoneUncorroborated.push(entry);
}

// A UUID that matched nothing means a typo or the wrong library. Fail rather
// than quietly write a subset of what was asked for.
if (ONLY_UUIDS.size > 0) {
  const seen = new Set(rows.filter(inScope).map((r) => r.uuid.toUpperCase()));
  const missing = [...ONLY_UUIDS].filter((u) => !seen.has(u));
  if (missing.length > 0) {
    const list = missing.map((u) => `  ${u}`).join('\n');
    console.error(
      `These --uuid values matched no asset in this library:\n${list}`
    );
    process.exit(1);
  }
}

// ---------- report ----------

console.log(
  `${FIX ? 'FIXING' : 'DRY RUN'}${ALBUM === undefined ? '' : ` — album "${ALBUM}"`}: ` +
    `${considered} assets considered, ${targets.length} repairable\n`
);

if (skipped.size > 0) {
  console.log('Left alone:');
  for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${reason}`);
  }
  console.log();
}

if (zoneUncorroborated.length > 0) {
  console.log(
    `${zoneUncorroborated.length} asset(s) fail condition 2 AND display something other than the ` +
      "camera's\nwall clock, so the instant really is wrong — but the EXIF row holds a fallback " +
      'zone\nand is not a valid target. NOT written; these need outside evidence:'
  );
  for (const t of zoneUncorroborated.slice(0, 20)) {
    const shown = wallClock(
      t.row.date_created + CORE_DATA_EPOCH,
      t.row.aa_off ?? 0
    );
    const camera = wallClock(t.row.exif_date + CORE_DATA_EPOCH, t.exifOff);
    console.log(
      `  ${t.row.filename.padEnd(28)} shows ${shown}, camera clock read ${camera} ` +
        `(${formatOffset(t.exifOff)} vs coords ${formatOffset(t.trueOff)})`
    );
  }
  if (zoneUncorroborated.length > 20) {
    console.log(`  … ${zoneUncorroborated.length - 20} more`);
  }
  console.log();
}

if (targets.length === 0) {
  db.close();
  process.exit(0);
}

// The sun/EV columns are advisory. A scene can be darker than the sun allows
// but never brighter, so only "much brighter than possible" is a hard tell —
// scan for a proposal that moves a bright frame into the dark, or vice versa.
console.log(
  'Proposed changes. sun = altitude at that instant, EV = measured light ' +
    '(15 full sun, 9 sunset, 3 night):'
);
for (const t of targets) {
  const from = t.row.date_created + CORE_DATA_EPOCH;
  const to = t.row.exif_date + CORE_DATA_EPOCH;
  const mins = Math.round(t.delta / 60);
  const ev = exposureValue(t.row.aperture, t.row.shutter_speed, t.row.iso);
  let advisory = '';
  if (t.row.lat !== null && t.row.lon !== null) {
    const sunFrom = sunAltitude(from, t.row.lat, t.row.lon).toFixed(0);
    const sunTo = sunAltitude(to, t.row.lat, t.row.lon).toFixed(0);
    const evPart = ev === null ? '' : `, EV ${ev.toFixed(1)}`;
    advisory = `   sun ${sunFrom.padStart(3)}° → ${sunTo.padStart(3)}°${evPart}`;
  }
  console.log(
    `  ${t.row.filename.padEnd(28)} ${wallClock(from, t.trueOff)} → ` +
      `${wallClock(to, t.trueOff)}  (${mins > 0 ? '+' : ''}${mins} min, ` +
      `was ${formatOffset(t.oldOff)})${advisory}`
  );
}

if (!FIX) {
  console.log(`\nWould rewrite ${targets.length} capture date(s).`);
  // --fix takes UUIDs and nothing else, so emit them as data. Whittle the list
  // down to the assets that should actually move before passing it back in.
  console.log(`\n--uuid=${targets.map((t) => t.row.uuid).join(',')}`);
  db.close();
  process.exit(0);
}

// ---------- backup ----------

// Second-resolution stamp, not just the date: two runs on one day are normal
// (a whole album, then a UUID-scoped follow-up) and a date-only name silently
// overwrites the earlier run's backup.
const stamp = new Date()
  .toISOString()
  .slice(0, 19)
  .replace('T', '-')
  .replaceAll(':', '');
const outPath = join(SUPPORT_DIR, `date-backup-offset-derived-${stamp}.json`);
await Bun.write(
  outPath,
  JSON.stringify(
    targets.map((t) => ({
      uuid: t.row.uuid,
      filename: t.row.filename,
      date_created: t.row.date_created,
      exif_date: t.row.exif_date,
      old_offset: t.oldOff,
      exif_offset: t.exifOff
    })),
    null,
    2
  )
);
console.log(`\nBacked up ${targets.length} capture date(s) to ${outPath}`);

// ---------- write ----------

const failures: string[] = [];
let written = 0;
for (const t of targets) {
  const { date, time } = systemLocalParts(t.row.exif_date + CORE_DATA_EPOCH);
  try {
    setDateTime(t.row.uuid, date, time);
    written++;
    if (written % 50 === 0) console.log(`  … ${written}/${targets.length}`);
  } catch (err) {
    failures.push(
      `${t.row.filename}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
console.log(`Wrote ${written} of ${targets.length} via AppleScript.`);
db.close();

// Quitting flushes Photos' journal, so verification reads settled state.
try {
  quitPhotosApp();
} catch (err) {
  console.log(
    `Could not quit Photos (${err instanceof Error ? err.message : String(err)}) — ` +
      'verification may read stale values.'
  );
}

// ---------- verify ----------

const verifyDb = new Database(photosDbPath, { readonly: true });
const check = verifyDb.prepare<{ dc: number }, [string]>(
  'SELECT ZDATECREATED AS dc FROM ZASSET WHERE ZUUID = ?'
);
let exact = 0;
const wrong: string[] = [];
for (const t of targets) {
  const got = check.get(t.row.uuid)?.dc;
  if (got === undefined) continue;
  if (got === t.row.exif_date) exact++;
  else {
    wrong.push(
      `${t.row.filename}: off by ${(got - t.row.exif_date) / 3600}h from the EXIF instant`
    );
  }
}
verifyDb.close();

console.log(
  `\nVerified: ${exact}/${targets.length} now match the EXIF instant exactly.`
);
for (const w of wrong.slice(0, 20)) console.log(`  ${w}`);
if (wrong.length > 20) console.log(`  … ${wrong.length - 20} more`);
for (const f of failures) console.log(`  FAILED ${f}`);
