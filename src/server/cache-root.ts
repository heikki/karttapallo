/**
 * Claims the derived-data root — item snapshot and image cache — for one
 * Photos library. A single slot, stamped with its owner; opening a different
 * library empties it (ADR-0015).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OWNER_NAME = 'owner.json';

function readOwner(cacheRoot: string): string | null {
  try {
    const raw = readFileSync(join(cacheRoot, OWNER_NAME), 'utf-8');
    return (JSON.parse(raw) as { path?: string }).path ?? null;
  } catch {
    // Missing, unreadable and malformed all mean the same thing: unowned.
    return null;
  }
}

export interface CacheRoot {
  /** The item snapshot (ADR-0006). */
  snapshotPath: string;
  /**
   * Root of the converted-image tree. What the tree looks like inside is the
   * image cache's business, not this module's — it only says where it starts.
   */
  imagesDir: string;
}

/**
 * Must run before anything opens a directory underneath it: the image cache
 * creates its subdirectories at construction, and a wipe after that would
 * leave it pointing at a tree that no longer exists.
 */
export function claimCacheRoot(
  cacheRoot: string,
  libraryPath: string
): CacheRoot {
  if (readOwner(cacheRoot) !== libraryPath) {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(
    join(cacheRoot, OWNER_NAME),
    `${JSON.stringify({ path: libraryPath }, null, 2)}\n`
  );
  return {
    snapshotPath: join(cacheRoot, 'items.json'),
    imagesDir: join(cacheRoot, 'cache')
  };
}
