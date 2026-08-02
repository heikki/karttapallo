/**
 * Reads the whole search corpus out of the Photos search index (ADR-0014).
 *
 * `psi.sqlite` sits beside `Photos.sqlite` and backs Photos.app's own search
 * field. Its `groups` table holds one row per searchable term, tagged with a
 * category saying what kind of thing the term is, already localized — so
 * reading it gives Finnish place names and scene labels for free rather than
 * reverse-geocoding or classifying anything ourselves.
 *
 * This is the only source for what Karttapallo searches, deliberately: reading
 * the same index Photos.app searches makes "Photos finds it" and "Karttapallo
 * finds it" one condition rather than two. The previous split — places from
 * `ZMOMENT.ZTITLE`, labels from here — could and did go half-empty, when a
 * Photos database migration regenerated every moment without a title while
 * `psi.sqlite` stayed rich.
 *
 * Coverage varies by category, and empty is a normal result. Categories derived
 * from metadata (place, description) are populated for any library Photos has
 * indexed; scene labels need Apple's image analysis, which only runs on a
 * library Photos has been given reason to analyze.
 *
 * Internal to photos-library/.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

/** Terms attached to one asset, each field ordered most specific first. */
export interface SearchTerms {
  /** Reverse-geocoded place names, from the point of interest out to the city. */
  place: string[];
  /** Caption the user typed in Photos. */
  description: string[];
  /** Apple's scene labels; empty for assets Photos hasn't analyzed. */
  labels: string[];
}

export type SearchField = keyof SearchTerms;

/**
 * Which `groups.category` values feed which field.
 *
 * Place stops at the city and its immediate surroundings. Photos also indexes
 * region (7), state (10, 11) and country (12, 13), which are true of a photo
 * but useless to search by here — `Suomi` matches 2817 of 4841 items, so it
 * would head every suggestion list while narrowing nothing. Categories are
 * listed specific-first; `readSearchTerms` orders terms by that.
 *
 * Deliberately absent: camera (2300), year (1101) and media type (1900) have
 * dedicated filters, and folding them in would make a hit ambiguous about why
 * it matched (ADR-0014). Keywords (1200) and persons (1300) reach a handful of
 * assets each.
 */
const CATEGORIES: Record<SearchField, number[]> = {
  place: [
    1, // point of interest — Siida, Urho Kekkosen kansallispuisto
    2, // street — Halmekankaantie
    3, // neighborhood — Lontoon City
    6, // district — North End
    8, // borough — Hammersmith and Fulham
    9, // park or island — Isle of Skye
    4, // waterway — River Thames
    14, // water body — Lokan tekojärvi
    5 // city — Inari, Kuhmo
  ],
  description: [1202],
  labels: [1500]
};

/** Category → field, and category → how specific it is within that field. */
const FIELD_OF = new Map<number, { field: SearchField; rank: number }>(
  Object.entries(CATEGORIES).flatMap(([field, cats]) =>
    cats.map(
      (cat, rank) => [cat, { field: field as SearchField, rank }] as const
    )
  )
);

interface TermRow {
  uuid_0: bigint;
  uuid_1: bigint;
  category: bigint;
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

function emptyTerms(): SearchTerms {
  return { place: [], description: [], labels: [] };
}

/** One term as collected, before ordering and deduplication. */
interface Collected {
  term: string;
  rank: number;
}

/**
 * Every searchable term in the library, keyed by asset UUID.
 *
 * Returns an empty map when the library has no search index — one Photos has
 * never indexed may not have the file — or when the index can't be read. The
 * corpus is a bonus; failing to read it must never fail a rebuild.
 */
export function readSearchTerms(libraryPath: string): Map<string, SearchTerms> {
  const path = join(libraryPath, 'database/search/psi.sqlite');
  if (!existsSync(path)) return new Map();

  const collected = new Map<string, Record<SearchField, Collected[]>>();
  const categories = [...FIELD_OF.keys()];

  try {
    // safeIntegers keeps the UUID halves as bigint — see uuidFromHalves.
    const db = new Database(path, { readonly: true, safeIntegers: true });
    try {
      const query = db.query<TermRow, []>(
        `SELECT a.uuid_0, a.uuid_1, g.category, g.content_string
         FROM ga
         JOIN groups g ON g.rowid = ga.groupid
         JOIN assets a ON a.rowid = ga.assetid
         WHERE g.category IN (${categories.join(',')})`
      );
      for (const row of query.all()) {
        const slot = FIELD_OF.get(Number(row.category));
        if (slot === undefined) continue;
        // Stored NUL-terminated, and decomposed for accented terms. Typed
        // input is composed, so an un-normalized value would never match.
        const term = row.content_string
          .replace(/\0/g, '')
          .trim()
          .normalize('NFC');
        if (term === '') continue;
        const uuid = uuidFromHalves(row.uuid_0, row.uuid_1);
        let fields = collected.get(uuid);
        if (fields === undefined) {
          fields = { place: [], description: [], labels: [] };
          collected.set(uuid, fields);
        }
        fields[slot.field].push({ term, rank: slot.rank });
      }
    } finally {
      db.close();
    }
  } catch {
    return new Map();
  }

  return new Map(
    [...collected].map(([uuid, fields]) => [uuid, orderTerms(fields)])
  );
}

/**
 * Order each field specific-first and drop repeats.
 *
 * Ranking by category before name is what makes a place read outward —
 * `Siida, Inarintie, Inari` rather than alphabetical soup — and it decides
 * which duplicate survives when Photos files one name under two categories:
 * the more specific one, so a city sharing its name with its own district
 * still sorts where the district would.
 */
function orderTerms(fields: Record<SearchField, Collected[]>): SearchTerms {
  const out = emptyTerms();
  for (const field of Object.keys(fields) as SearchField[]) {
    const sorted = [...fields[field]].sort((a, b) =>
      a.rank === b.rank ? a.term.localeCompare(b.term) : a.rank - b.rank
    );
    const seen = new Set<string>();
    for (const { term } of sorted) {
      if (seen.has(term)) continue;
      seen.add(term);
      out[field].push(term);
    }
  }
  return out;
}

/** Terms for one asset, or empty when the index has nothing for it. */
export function termsFor(
  index: Map<string, SearchTerms> | undefined,
  uuid: string
): SearchTerms {
  return index?.get(uuid) ?? emptyTerms();
}
