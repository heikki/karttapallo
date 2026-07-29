/**
 * Restore ZDATECREATED to the EXIF instant for assets whose stored instant is
 * off by an exact, known amount.
 *
 * Only assets whose drift matches --delta EXACTLY are touched. That precision
 * is the whole safety mechanism: a uniform drift across a trip is a systematic
 * error with one cause, while ragged per-asset drift is a camera clock or a
 * bogus EXIF block, where the EXIF instant is not authoritative and rewriting
 * it would corrupt good data. Never widen this to a range or a rounding.
 *
 * The write goes through AppleScript, never SQLite. Photos journals the
 * instant, so an AppleScript write is durable; a direct write to ZDATECREATED
 * is not, and would be silently reverted the next time photolibraryd
 * coalesces the journal. See docs/adr/0013 and docs/gotchas.md.
 *
 * This does NOT touch timezone columns, and is not the inverse of
 * fix-timezones.ts. That script holds the instant fixed and corrects the
 * offset; this one holds the offset fixed and corrects the instant, back to
 * what the camera recorded. Do not merge them — the "compensating shift" that
 * moves both together to hold a wall clock steady is exactly the damage
 * ADR-0013 documents.
 *
 * Videos are skipped unless --include-videos is passed. A camera that writes
 * EXIF for stills may write none at all for video — the one behind the album
 * this was written for does exactly that, and its clips carry no make, model,
 * ISO or focal length either. ZEXTENDEDATTRIBUTES.ZDATECREATED is then not a
 * capture time but whatever Photos could infer from the file, so the premise
 * this script rests on does not hold and its drift is meaningless: in that
 * album it ranged over 600 hours, with three dozen clips sharing one import
 * timestamp. Same device, same trip, still not comparable. Videos by hand.
 *
 * Usage:
 *   bun scripts/fix-shifted-dates.ts --delta=-6 --album="2015 Dominica"
 *   bun scripts/fix-shifted-dates.ts --delta=-6 --album="2015 Dominica" --fix
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { quitPhotosApp, setDateTime } from '@server/photos-edit';
import { resolveLibrary } from '@server/photos-library';
import { Database } from 'bun:sqlite';

const CORE_DATA_EPOCH = 978307200; // 2001-01-01 00:00:00 UTC in Unix seconds
const KIND_PHOTO = 0; // ZASSET.ZKIND: 0 photo, 1 video

const FIX = process.argv.includes('--fix');
const INCLUDE_VIDEOS = process.argv.includes('--include-videos');
const ALBUM = process.argv.find((a) => a.startsWith('--album='))?.slice(8);
const DELTA_ARG = process.argv.find((a) => a.startsWith('--delta='))?.slice(8);

if (DELTA_ARG === undefined || ALBUM === undefined) {
  console.error(
    'Both --delta=<hours> and --album=<title> are required.\n' +
      'Example: bun scripts/fix-shifted-dates.ts --delta=-6 --album="2015 Dominica"'
  );
  process.exit(1);
}

const deltaHours = Number(DELTA_ARG);
if (!Number.isFinite(deltaHours) || deltaHours === 0) {
  console.error(
    `--delta must be a non-zero number of hours, got "${DELTA_ARG}"`
  );
  process.exit(1);
}
const deltaSeconds = Math.round(deltaHours * 3600);

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

// ---------- album join table (dynamic name, see fix-timezones.ts) ----------

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
  date_created: number;
  exif_date: number;
  tz_offset: number | null;
  kind: number;
}

const rows = db
  .query<Row, [string]>(
    `SELECT a.ZUUID AS uuid,
            aa.ZORIGINALFILENAME AS filename,
            a.ZDATECREATED AS date_created,
            e.ZDATECREATED AS exif_date,
            aa.ZTIMEZONEOFFSET AS tz_offset,
            a.ZKIND AS kind
       FROM ZASSET a
       JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
       JOIN ZEXTENDEDATTRIBUTES e ON a.Z_PK = e.ZASSET
       JOIN ${joinTable} ja ON a.Z_PK = ja.${assetCol}
       JOIN ZGENERICALBUM al ON ja.${albumCol} = al.Z_PK
      WHERE a.ZTRASHEDSTATE = 0
        AND e.ZDATECREATED IS NOT NULL
        AND al.ZTITLE = ?
      GROUP BY a.Z_PK
      ORDER BY e.ZDATECREATED`
  )
  .all(ALBUM);

const drifted = rows.filter(
  (r) => r.date_created - r.exif_date === deltaSeconds
);
const targets = INCLUDE_VIDEOS
  ? drifted
  : drifted.filter((r) => r.kind === KIND_PHOTO);
const videosHeld = drifted.length - targets.length;

// ---------- rendering ----------

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Render a UTC instant as the wall clock in the PHOTO's timezone. Display only.
 */
function photoLocal(instant: number, offsetSeconds: number | null): string {
  const d = new Date((instant + (offsetSeconds ?? 0)) * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Render a UTC instant as the wall clock in the SYSTEM timezone — the form
 * setDateTime expects, because AppleScript builds dates in the system zone and
 * Photos converts them back to UTC on the way in. Using the system zone rather
 * than the photo's keeps the round trip exact with no offset arithmetic here.
 */
function systemLocalParts(instant: number): { date: string; time: string } {
  const d = new Date(instant * 1000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}

// ---------- report ----------

console.log(
  `${FIX ? 'FIXING' : 'DRY RUN'} — album "${ALBUM}": ${rows.length} assets, ` +
    `${drifted.length} drift by exactly ${deltaHours > 0 ? '+' : ''}${deltaHours}h\n`
);

const untouched = rows.length - drifted.length;
if (untouched > 0) {
  console.log(
    `Leaving ${untouched} asset(s) alone (aligned already, or drifting by some other amount).`
  );
}
if (videosHeld > 0) {
  console.log(
    `Holding back ${videosHeld} video(s) — pass --include-videos to rewrite them too.`
  );
}
console.log();

if (targets.length === 0) {
  db.close();
  process.exit(0);
}

for (const row of targets) {
  const from = row.date_created + CORE_DATA_EPOCH;
  const to = row.exif_date + CORE_DATA_EPOCH;
  console.log(
    `  ${row.filename.padEnd(28)} ${photoLocal(from, row.tz_offset)} → ${photoLocal(to, row.tz_offset)}`
  );
}

if (!FIX) {
  console.log(`\nWould rewrite ${targets.length} capture date(s).`);
  db.close();
  process.exit(0);
}

// ---------- backup ----------

const stamp = new Date().toISOString().slice(0, 10);
const backupPath = join(
  homedir(),
  'Library/Application Support/Karttapallo',
  `date-backup-${stamp}.json`
);
await Bun.write(
  backupPath,
  JSON.stringify(
    targets.map((r) => ({
      uuid: r.uuid,
      filename: r.filename,
      date_created: r.date_created,
      exif_date: r.exif_date
    })),
    null,
    2
  )
);
console.log(`\nBacked up ${targets.length} capture date(s) to ${backupPath}`);

// ---------- write ----------

const failures: Array<{ filename: string; reason: string }> = [];
let written = 0;

for (const row of targets) {
  const target = row.exif_date + CORE_DATA_EPOCH;
  const { date, time } = systemLocalParts(target);
  try {
    setDateTime(row.uuid, date, time);
    written++;
    if (written % 50 === 0) {
      console.log(`  … ${written}/${targets.length}`);
    }
  } catch (err) {
    failures.push({
      filename: row.filename,
      reason: err instanceof Error ? err.message : String(err)
    });
  }
}
console.log(`Wrote ${written} of ${targets.length} via AppleScript.`);

db.close();

// Quitting flushes Photos' journal, so the verification below reads settled
// state rather than whatever is still buffered in the running app.
try {
  quitPhotosApp();
} catch (err) {
  console.log(
    `Could not quit Photos (${err instanceof Error ? err.message : String(err)}) — ` +
      'verification may read stale values.'
  );
}

// ---------- verify ----------

// AppleScript resolves the wall clock we hand it in the system zone, which is
// ambiguous during a DST fall-back hour. Rather than reason about which side it
// picks, read every value back and report anything that did not land exactly.
const verifyDb = new Database(photosDbPath, { readonly: true });
const check = verifyDb.prepare<{ dc: number }, [string]>(
  'SELECT ZDATECREATED AS dc FROM ZASSET WHERE ZUUID = ?'
);
let exact = 0;
const wrong: string[] = [];
for (const row of targets) {
  const got = check.get(row.uuid)?.dc;
  if (got === undefined) continue;
  if (got === row.exif_date) exact++;
  else {
    wrong.push(
      `${row.filename}: off by ${(got - row.exif_date) / 3600}h from the EXIF instant`
    );
  }
}
verifyDb.close();

console.log(
  `\nVerified: ${exact}/${targets.length} now match the EXIF instant exactly.`
);
for (const w of wrong.slice(0, 20)) console.log(`  ${w}`);
if (wrong.length > 20) console.log(`  … ${wrong.length - 20} more`);
for (const f of failures) console.log(`  FAILED ${f.filename}: ${f.reason}`);
