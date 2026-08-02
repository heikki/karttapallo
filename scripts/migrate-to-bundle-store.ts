/**
 * Move album data out of the old per-library hash directories and into the
 * library bundles they belong to.
 *
 * Until recently a library's routes, GPX files and notes lived under
 * `Application Support/Karttapallo/libraries/<hash of its path>/`, which bound
 * them to where the library was rather than to which library it is. They now
 * live at `<library>.photoslibrary/karttapallo/`, so they travel with it.
 *
 * This runs once, by hand, and is not part of the app: it reads a layout the
 * app no longer creates, and shipping it would mean carrying that reader
 * forever. Each hash directory names its library in `library.json`, so one run
 * covers every library regardless of which one Photos currently has open —
 * album UUIDs come from each library's own Photos.sqlite.
 *
 * Only album data moves. The item snapshot and the image cache are derived and
 * are discarded, because the app rebuilds them.
 *
 * Safe to re-run: a library with nothing left to move is reported and skipped.
 *
 * Usage:
 *   bun scripts/migrate-to-bundle-store.ts --dry-run
 *   bun scripts/migrate-to-bundle-store.ts
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readAlbums } from '@server/photos-library';

const dryRun = process.argv.includes('--dry-run');

const supportDir =
  process.env.KARTTAPALLO_DATA_DIR !== undefined &&
  process.env.KARTTAPALLO_DATA_DIR !== ''
    ? resolve(process.env.KARTTAPALLO_DATA_DIR)
    : join(homedir(), 'Library/Application Support/Karttapallo');

const librariesDir = join(supportDir, 'libraries');

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson(path: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Whether a directory can be created and written inside `bundle`. */
function isWritable(bundle: string) {
  const probe = join(bundle, '.karttapallo-write-probe');
  try {
    mkdirSync(bundle, { recursive: true });
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy one album's files, verifying each by checksum before the source is
 * removed. Returns false if anything failed to arrive intact, in which case the
 * source is left exactly as it was.
 */
function copyAlbum(from: string, to: string): boolean {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    writeFileSync(dst, readFileSync(src));
    if (sha256(src) !== sha256(dst)) {
      console.error(`      ✗ ${entry.name} did not verify — leaving source`);
      return false;
    }
  }
  return true;
}

/** Carry the saved map view across, without overwriting a newer one. */
function migrateView(libDir: string, bundleDir: string) {
  const view = readJson(join(libDir, 'state.json')).view;
  if (view === undefined) return false;

  const target = join(bundleDir, 'state.json');
  const existing = readJson(target);
  if (existing.view !== undefined) return false;

  if (!dryRun) {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(target, `${JSON.stringify({ ...existing, view })}\n`);
  }
  return true;
}

function albumNames(albumsDir: string) {
  if (!existsSync(albumsDir)) return [];
  return readdirSync(albumsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function migrateAlbums(libDir: string, bundleDir: string, libraryPath: string) {
  const albumsDir = join(libDir, 'albums');

  // Titles are NFC-normalised on both sides. Photos stores them decomposed,
  // and the directory names were written from the normalised form the client
  // was shown — match them raw and every accented album misses.
  const roster = new Map(
    readAlbums(libraryPath).map((a) => [a.title.normalize('NFC'), a.uuid])
  );

  let moved = 0;
  let stuck = 0;
  for (const name of albumNames(albumsDir)) {
    const uuid = roster.get(name.normalize('NFC'));
    if (uuid === undefined) {
      console.log(`   ? ${name} — no such album here, left in place`);
      stuck++;
    } else if (dryRun) {
      console.log(`   → ${name} → ${uuid}`);
      moved++;
    } else if (
      copyAlbum(join(albumsDir, name), join(bundleDir, 'albums', uuid))
    ) {
      rmSync(join(albumsDir, name), { recursive: true, force: true });
      console.log(`   ✓ ${name} → ${uuid}`);
      moved++;
    } else {
      stuck++;
    }
  }
  return { moved, stuck };
}

/** The library this hash directory belongs to, or null if it can't be used. */
function targetLibrary(hash: string, libDir: string): string | null {
  const libraryPath = readJson(join(libDir, 'library.json')).path;
  if (libraryPath === undefined) {
    console.log(`${hash}: no library.json — skipped`);
    return null;
  }
  console.log(`${hash}: ${libraryPath}`);

  if (!existsSync(join(libraryPath, 'database', 'Photos.sqlite'))) {
    console.log('   unreachable (drive not mounted?) — skipped, nothing moved');
    return null;
  }
  if (!dryRun && !isWritable(join(libraryPath, 'karttapallo'))) {
    console.log('   library is not writable — skipped, nothing moved');
    return null;
  }
  return libraryPath;
}

function migrateLibrary(hash: string): void {
  const libDir = join(librariesDir, hash);
  const libraryPath = targetLibrary(hash, libDir);
  if (libraryPath === null) return;

  const bundleDir = join(libraryPath, 'karttapallo');
  const { moved, stuck } = migrateAlbums(libDir, bundleDir, libraryPath);

  const viewMoved = migrateView(libDir, bundleDir);
  if (viewMoved) console.log('   ✓ saved map view');

  if (stuck > 0) {
    console.log(
      `   ${stuck} album(s) left behind — ${libDir} kept for inspection`
    );
    return;
  }

  // Everything that mattered is across. What remains is the item snapshot and
  // the image cache, both rebuilt on demand.
  if (!dryRun) rmSync(libDir, { recursive: true, force: true });
  console.log(
    moved === 0 && !viewMoved
      ? '   nothing to move — derived data discarded'
      : `   ${moved} album(s) moved — derived data discarded`
  );
}

if (!existsSync(librariesDir)) {
  console.log(`No ${librariesDir} — nothing to migrate.`);
  process.exit(0);
}

const hashes = readdirSync(librariesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

if (hashes.length === 0) {
  console.log('No library directories left — nothing to migrate.');
  process.exit(0);
}

if (dryRun) console.log('Dry run — nothing will be written or removed.\n');

for (const hash of hashes) migrateLibrary(hash);
