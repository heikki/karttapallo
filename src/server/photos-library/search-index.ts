/**
 * Reads Apple's scene labels out of the Photos search index (ADR-0014).
 *
 * `psi.sqlite` sits beside `Photos.sqlite` and backs Photos.app's own search
 * field. Category 1500 holds the canonical label for each classified asset —
 * `Lintu`, `Perhonen`, `Metsä`, `Auto` — already localized, so reading it gives
 * Finnish labels for free rather than running a classifier ourselves.
 *
 * Only populated for assets Photos has analyzed. Analysis runs when the Mac is
 * idle, plugged in, and the library open, so a library on an intermittently
 * mounted volume can sit at nearly zero indefinitely. An empty result is the
 * normal case, not a failure.
 *
 * Internal to photos-library/.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

/** Canonical scene/object label. Category 1501 holds inflected and synonym
 * forms pointing back at these, which we don't expand — see ADR-0014. */
const SCENE_LABEL_CATEGORY = 1500;

interface LabelRow {
  uuid_0: bigint;
  uuid_1: bigint;
  content_string: string;
}

/**
 * Rebuild a Photos UUID from the index's `uuid_0`/`uuid_1` pair — the 16 UUID
 * bytes as two **signed** little-endian int64s.
 *
 * The handle must be opened with `safeIntegers`. Bun's SQLite driver otherwise
 * returns integers as float64, which silently rounds values of this magnitude
 * and produces well-formed UUIDs that match no asset at all.
 */
function uuidFromHalves(low: bigint, high: bigint): string {
  const bytes = Buffer.alloc(16);
  bytes.writeBigInt64LE(low, 0);
  bytes.writeBigInt64LE(high, 8);
  const h = bytes.toString('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Scene labels per asset UUID, deduplicated and sorted.
 *
 * Returns an empty map when the library has no search index — one that has
 * never been searched may not have the file — or when the index can't be read.
 * Labels are a bonus corpus; failing to read them must never fail a rebuild.
 */
export function readSceneLabels(libraryPath: string): Map<string, string[]> {
  const path = join(libraryPath, 'database/search/psi.sqlite');
  const labels = new Map<string, Set<string>>();
  if (!existsSync(path)) return new Map();

  try {
    // safeIntegers keeps the UUID halves as bigint — see uuidFromHalves.
    const db = new Database(path, { readonly: true, safeIntegers: true });
    try {
      const query = db.query<LabelRow, [number]>(
        `SELECT a.uuid_0, a.uuid_1, g.content_string
         FROM ga
         JOIN groups g ON g.rowid = ga.groupid
         JOIN assets a ON a.rowid = ga.assetid
         WHERE g.category = ?`
      );
      for (const row of query.all(SCENE_LABEL_CATEGORY)) {
        // Stored NUL-terminated, and decomposed for accented labels.
        const term = row.content_string
          .replace(/\0/g, '')
          .trim()
          .normalize('NFC');
        if (term === '') continue;
        const uuid = uuidFromHalves(row.uuid_0, row.uuid_1);
        const existing = labels.get(uuid);
        if (existing === undefined) labels.set(uuid, new Set([term]));
        else existing.add(term);
      }
    } finally {
      db.close();
    }
  } catch {
    return new Map();
  }

  return new Map(
    [...labels].map(([uuid, set]) => [
      uuid,
      [...set].sort((a, b) => a.localeCompare(b))
    ])
  );
}
