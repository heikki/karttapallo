/**
 * Claims the derived-data root for one Photos library.
 *
 * Everything under this root — the item snapshot and the converted-image cache
 * — is derived from the library, so it is kept in a single slot rather than
 * namespaced per library. `owner.json` records which library the slot holds;
 * opening a different one empties it.
 *
 * One slot is affordable because losing it costs almost nothing: the snapshot
 * is rebuilt on every startup regardless, and the image cache is lazy and
 * mtime-validated per entry, so it refills as photos are viewed rather than in
 * a bulk pass. That is also why comparing paths is enough — a false mismatch
 * buys a rebuild, and two libraries cannot occupy one path at once. The schemes
 * that would survive a move (bookmarks, inodes, volume UUIDs) buy nothing here,
 * because a moved library's derived data is not worth keeping.
 *
 * Nothing the user authored lives here. Handmade data goes inside the library
 * bundle, which is what makes wiping this root a safe thing to do.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OWNER_NAME = 'owner.json';

function readOwner(cacheRoot: string): string | null {
  try {
    const raw = readFileSync(join(cacheRoot, OWNER_NAME), 'utf-8');
    return (JSON.parse(raw) as { path?: string }).path ?? null;
  } catch {
    // Missing, unreadable or malformed all mean the same thing: nothing here
    // can be trusted to belong to this library.
    return null;
  }
}

/**
 * Empties the root unless it already belongs to `libraryPath`, then stamps it.
 * Must run before anything else opens a directory underneath it — the image
 * cache creates its subdirectories at construction, and would be left pointing
 * at a tree this had since removed.
 *
 * @returns the root, now owned by `libraryPath`.
 */
export function claimCacheRoot(cacheRoot: string, libraryPath: string): string {
  if (readOwner(cacheRoot) !== libraryPath) {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(
    join(cacheRoot, OWNER_NAME),
    `${JSON.stringify({ path: libraryPath }, null, 2)}\n`
  );
  return cacheRoot;
}
