/**
 * Fix photos where the stored timezone doesn't match the GPS location.
 *
 * Only the timezone columns are written. The UTC instant (ZDATECREATED) is
 * authoritative and is never touched, so the local time Photos.app shows will
 * SHIFT to the true zone at the photo's coordinates — that shift is the point,
 * not a side effect. This brings Photos.app in line with what Karttapallo
 * already displays, which derives from the instant plus coordinates (ADR-0013).
 *
 * Do NOT reintroduce a "compensating shift" that moves ZDATECREATED to hold the
 * old wall clock steady. That inverts the fix: it drags the instant to match a
 * wrong offset, and because Photos journals the instant, the damage is durable
 * and unrecoverable. It is what produced the ~252 shifted assets in ADR-0013.
 *
 * Usage:
 *   bun scripts/fix-timezones.ts          # dry run
 *   bun scripts/fix-timezones.ts --fix    # write to Photos.sqlite
 */

import { join } from 'node:path';
import { resolveLibrary } from '@server/photos-library';
import { Database } from 'bun:sqlite';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports -- geo-tz CJS interop required for Bun bundler
const { find: geoTzFind } = require('geo-tz/all') as typeof import('geo-tz');

const CORE_DATA_EPOCH = 978307200; // 2001-01-01 00:00:00 UTC in Unix seconds
const FIX = process.argv.includes('--fix');
const ALBUM_FILTER =
  process.argv.find((a) => a.startsWith('--album='))?.slice(8) ?? null;

// Operate on the active Photos library (ADR 0012), not a hardcoded path.
const resolved = resolveLibrary();
if (!resolved.ok) {
  console.error(
    resolved.error === 'fda'
      ? `Cannot read Photos library (Full Disk Access): ${resolved.message}`
      : `Photos library not available: ${resolved.libraryPath}`
  );
  process.exit(1);
}
const libraryPath = resolved.path;
const photosDbPath = join(libraryPath, 'database/Photos.sqlite');

const photosDb = new Database(
  photosDbPath,
  FIX ? { readwrite: true } : { readonly: true }
);

// Discover dynamic join table
const tables = photosDb
  .query<
    { name: string },
    []
  >("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z_%ASSETS' AND name GLOB 'Z_[0-9]*ASSETS' ORDER BY name")
  .all();

let joinTable = '';
let albumCol = '';
let assetCol = '';
for (const { name } of tables) {
  const cols = photosDb
    .query<{ name: string }, []>(`PRAGMA table_info(${name})`)
    .all()
    .map((r) => r.name);
  const ac = cols.find((c) => /^Z_\d+ALBUMS$/.exec(c) !== null);
  const sc = cols.find((c) => /^Z_\d+ASSETS$/.exec(c) !== null);
  if (ac !== undefined && sc !== undefined) {
    joinTable = name;
    albumCol = ac;
    assetCol = sc;
    break;
  }
}

const albumJoin =
  joinTable === ''
    ? ''
    : `LEFT JOIN ${joinTable} ja ON a.Z_PK = ja.${assetCol}
       LEFT JOIN ZGENERICALBUM al ON ja.${albumCol} = al.Z_PK`;

interface Row {
  uuid: string;
  pk: number;
  lat: number;
  lon: number;
  date_created: number;
  tz_name: string | null;
  tz_offset: number | null;
  filename: string;
  albums: string | null;
}

const rows = photosDb
  .query<Row, []>(
    `SELECT
      a.ZUUID AS uuid,
      aa.Z_PK AS pk,
      a.ZLATITUDE AS lat,
      a.ZLONGITUDE AS lon,
      a.ZDATECREATED AS date_created,
      aa.ZTIMEZONENAME AS tz_name,
      aa.ZTIMEZONEOFFSET AS tz_offset,
      a.ZFILENAME AS filename,
      GROUP_CONCAT(al.ZTITLE, ', ') AS albums
    FROM ZASSET a
    LEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
    ${albumJoin}
    WHERE a.ZLATITUDE IS NOT NULL
      AND a.ZLATITUDE != -180.0
      AND a.ZLONGITUDE IS NOT NULL
      AND a.ZLONGITUDE != -180.0
      AND a.ZTRASHEDSTATE = 0
    GROUP BY a.ZUUID`
  )
  .all();

const GMT_RE = /^GMT(?:(?<sign>[+-])(?<h>\d{2}):(?<m>\d{2}))?$/;

function parseGmtOffset(s: string): number | null {
  const match = GMT_RE.exec(s);
  if (match === null) return null;
  if (match.groups?.sign === undefined) return 0;
  const sign = match.groups.sign === '+' ? 1 : -1;
  return (
    sign * (parseInt(match.groups.h!, 10) * 60 + parseInt(match.groups.m!, 10))
  );
}

function tzOffsetMinutes(tzName: string, refDate: Date): number | null {
  const rawResult = parseGmtOffset(tzName);
  if (rawResult !== null) return rawResult;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      timeZoneName: 'longOffset'
    });
    const part = fmt
      .formatToParts(refDate)
      .find((p) => p.type === 'timeZoneName');
    if (part === undefined) return null;
    return parseGmtOffset(part.value);
  } catch {
    return null;
  }
}

function formatLocalDate(utcUnix: number, offsetMinutes: number) {
  const localSec = utcUnix + offsetMinutes * 60;
  const d = new Date(localSec * 1000);
  function pad(n: number) {
    return String(n).padStart(2, '0');
  }
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const filtered =
  ALBUM_FILTER === null
    ? rows
    : rows.filter(
        (r) =>
          r.albums?.toLowerCase().includes(ALBUM_FILTER.toLowerCase()) === true
      );

console.log(
  `${FIX ? 'FIXING' : 'DRY RUN'} — ${filtered.length} photos${ALBUM_FILTER === null ? '' : ` in album "${ALBUM_FILTER}"`}\n`
);

let fixed = 0;

// The only statement: the timezone columns. ZDATECREATED is never written —
// see the header. Photos journals the instant, so a bad write there is durable
// and unrecoverable, unlike the offset.
const updateTzStmt = FIX
  ? photosDb.prepare(
      'UPDATE ZADDITIONALASSETATTRIBUTES SET ZTIMEZONEOFFSET = ?, ZTIMEZONENAME = ? WHERE Z_PK = ?'
    )
  : null;

// Collect changes grouped by album for display
interface Change {
  row: Row;
  expectedTzName: string;
  /** Hours the local time shown in Photos.app will move. Display only. */
  diffMin: number;
  localDate: string;
  newOffsetSec: number;
}
interface NameChange {
  row: Row;
  expectedTzName: string;
  localDate: string;
}
const byAlbum = new Map<string, Change[]>();
const byAlbumName = new Map<string, NameChange[]>();

for (const row of filtered) {
  const expectedTzName = geoTzFind(row.lat, row.lon)[0];
  if (expectedTzName === undefined) continue;

  const utcDate = new Date((row.date_created + CORE_DATA_EPOCH) * 1000);
  const storedOffset =
    row.tz_offset === null ? null : Math.round(row.tz_offset / 60);
  const expectedOffset = tzOffsetMinutes(expectedTzName, utcDate);

  if (storedOffset === null || expectedOffset === null) continue;

  const album = row.albums ?? '—';

  if (storedOffset === expectedOffset) {
    // Offset correct but IANA name wrong (e.g. GMT+0100 → Europe/Paris)
    if (row.tz_name !== expectedTzName) {
      const localDate = formatLocalDate(
        row.date_created + CORE_DATA_EPOCH,
        storedOffset
      );
      if (!byAlbumName.has(album)) byAlbumName.set(album, []);
      byAlbumName.get(album)!.push({ row, expectedTzName, localDate });
    }
  } else {
    const diffMin = storedOffset - expectedOffset;
    const localDate = formatLocalDate(
      row.date_created + CORE_DATA_EPOCH,
      storedOffset
    );
    const newOffsetSec = expectedOffset * 60;
    if (!byAlbum.has(album)) byAlbum.set(album, []);
    byAlbum.get(album)!.push({
      row,
      expectedTzName,
      diffMin,
      localDate,
      newOffsetSec
    });
  }
}

if (FIX) photosDb.run('BEGIN IMMEDIATE');

let fixedName = 0;

for (const [album, changes] of byAlbum) {
  changes.sort((a, b) => a.localDate.localeCompare(b.localDate));
  console.log(
    `\n[${album}] — ${changes.length} photos (offset wrong; shown time moves by the amount at left)`
  );
  for (const {
    row,
    expectedTzName,
    diffMin,
    localDate,
    newOffsetSec
  } of changes) {
    const diffH = diffMin / 60;
    const diffStr = diffH > 0 ? `+${diffH}h` : `${diffH}h`;
    console.log(
      `  ${diffStr.padStart(5)}  ${row.filename.padEnd(40)} ${(row.tz_name ?? 'null').padEnd(25)} → ${expectedTzName.padEnd(25)} local: ${localDate}`
    );
    if (FIX) {
      updateTzStmt!.run(newOffsetSec, expectedTzName, row.pk);
    }
    fixed++;
  }
}

for (const [album, changes] of byAlbumName) {
  changes.sort((a, b) => a.localDate.localeCompare(b.localDate));
  console.log(`\n[${album}] — ${changes.length} photos (name only)`);
  for (const { row, expectedTzName, localDate } of changes) {
    console.log(
      `         ${row.filename.padEnd(40)} ${(row.tz_name ?? 'null').padEnd(25)} → ${expectedTzName.padEnd(25)} local: ${localDate}`
    );
    if (FIX) {
      updateTzStmt!.run(row.tz_offset, expectedTzName, row.pk);
      // ZDATECREATED unchanged — offset is already correct
    }
    fixedName++;
  }
}

if (FIX) photosDb.run('COMMIT');

const skipped = rows.length - fixed - fixedName;
console.log(
  `\n${FIX ? 'Fixed' : 'Would fix'}: ${fixed} offset + ${fixedName} name  |  Unchanged: ${skipped}`
);
if (!FIX) console.log('\nRun with --fix to apply changes.');

photosDb.close();
