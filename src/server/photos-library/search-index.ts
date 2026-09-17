/**
 * Reads the whole search corpus out of the Photos search index (ADR-0014).
 *
 * `leo.sqlite` sits beside `Photos.sqlite` and backs Photos.app's own search
 * field. Its `lexicon` table holds one row per searchable term, tagged with a
 * category saying what kind of thing the term is, already localized — so
 * reading it gives Finnish place names and scene labels for free rather than
 * reverse-geocoding or classifying anything ourselves.
 *
 * This is the only source for what Karttapallo searches, deliberately: reading
 * the same index Photos.app searches makes "Photos finds it" and "Karttapallo
 * finds it" one condition rather than two. The previous split — places from
 * `ZMOMENT.ZTITLE`, labels from here — could and did go half-empty, when a
 * Photos database migration regenerated every moment without a title while the
 * search index stayed rich.
 *
 * Coverage varies by category, and empty is a normal result. Categories derived
 * from metadata (place, description) are populated for any library Photos has
 * indexed; scene labels need Apple's image analysis, which only runs on a
 * library Photos has been given reason to analyze. A library mid-reindex has
 * the file with nothing in it yet.
 *
 * Internal to photos-library/.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

/** Terms attached to one asset, each field ordered most specific first. */
export interface SearchTerms {
  /** Reverse-geocoded place names, from the point of interest out to the country. */
  place: string[];
  /** Title or caption the user typed in Photos. */
  description: string[];
  /** Apple's scene labels; empty for assets Photos hasn't analyzed. */
  labels: string[];
}

export type SearchField = keyof SearchTerms;

/**
 * Which `lexicon.category` values feed which field.
 *
 * Place spans the whole geocoded hierarchy Photos names, point of interest
 * through country. Broad levels earn their place by being how you actually
 * reach a trip — `Islanti` and `Portugali` are the terms for libraries with no
 * album for them. The cost is that they are true of thousands of items at once,
 * so they head the Places group whenever they match; they are last in this
 * list, which is the order terms read in.
 *
 * Deliberately absent: the country code (2170) duplicates the country name at
 * an identical count under a worse label, so a query for `fi` would offer `FI`
 * above `Suomi`; continent and subcontinent (2180, 2190) are broader than any
 * search that means something; `Koti` (2010) and place *types* like `Ravintola`
 * (2030) are concepts rather than names. Camera (6000), dates (1xxx) and media
 * type (5xxx) have dedicated filters, and folding them in would make a hit
 * ambiguous about why it matched (ADR-0014). Albums (7010), filenames (8050),
 * persons (3000) and recognized text (4120) reach few assets or match noise.
 */
const CATEGORIES: Record<SearchField, number[]> = {
  place: [
    2060, // point of interest — Siida, Ison-Palosen ja Maariansärkkien luonnonsuojelualue
    2050, // street — Halmekankaantie
    2070, // neighborhood — Ullanlinna
    2130, // island or cape — Purunpää, Gran Canaria
    2210, // water body — Saaristomeri, Hepojärvi
    2090, // city — Inari, Kuhmo
    2140, // region — Kainuu, Etelä-Savo
    2160 // country — Suomi, Espanja
  ],
  // The two fields Photos gives the user to type in: title, then caption. A
  // caption's text is also in the lexicon under 7000, but as a lexeme no item
  // references — reading 7000 alone finds titles only.
  description: [
    7000, // title — Puolukkaselästä?
    8080 // caption
  ],
  labels: [4000]
};

/**
 * Canonical form of a term. The index also stores every inflection and synonym
 * Photos will match (`Suomi` carries `Suomen`, `Suomea`, `FI`) as type 2 — good
 * for matching, wrong for showing, and we surface what we match.
 */
const CANONICAL = 1;

/** Category → field, and category → how specific it is within that field. */
const FIELD_OF = new Map<number, { field: SearchField; rank: number }>(
  Object.entries(CATEGORIES).flatMap(([field, cats]) =>
    cats.map(
      (cat, rank) => [cat, { field: field as SearchField, rank }] as const
    )
  )
);

interface LexemeRow {
  lexeme_id: number;
  category: number;
  content: string;
}

interface ItemRow {
  identifier: string;
  lexeme_ids: Uint8Array;
}

function emptyTerms(): SearchTerms {
  return { place: [], description: [], labels: [] };
}

/** One term as collected, before ordering and deduplication. */
interface Collected {
  term: string;
  rank: number;
}

type Slot = Collected & { field: SearchField };

/**
 * Every term we care about, by the lexeme id the item rows reference.
 *
 * A name Photos files under two categories — a city and the island sharing its
 * name — arrives as two lexemes, so the specific one wins here only when both
 * happen to share an id; the ordinary case is settled by `orderTerms`.
 */
function readLexicon(db: Database): Map<number, Slot> {
  const categories = [...FIELD_OF.keys()];
  const rows = db
    .query<LexemeRow, []>(
      `SELECT lexeme_id, category, content
       FROM lexicon
       WHERE type = ${CANONICAL} AND category IN (${categories.join(',')})`
    )
    .all();

  const slots = new Map<number, Slot>();
  for (const row of rows) {
    const slot = FIELD_OF.get(row.category);
    if (slot === undefined) continue;
    const term = row.content.trim().normalize('NFC');
    if (term === '') continue;
    const existing = slots.get(row.lexeme_id);
    if (existing !== undefined && existing.rank <= slot.rank) continue;
    slots.set(row.lexeme_id, { term, field: slot.field, rank: slot.rank });
  }
  return slots;
}

/** The lexeme ids of one item: its blob is a packed little-endian uint32 array. */
function* lexemeIds(blob: Uint8Array): Generator<number> {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let offset = 0; offset + 4 <= blob.byteLength; offset += 4) {
    yield view.getUint32(offset, true);
  }
}

/**
 * Every searchable term in the library, keyed by asset UUID.
 *
 * Returns an empty map when the library has no search index — one Photos has
 * never indexed may not have the file — or when the index can't be read. The
 * corpus is a bonus; failing to read it must never fail a rebuild.
 */
export function readSearchTerms(libraryPath: string): Map<string, SearchTerms> {
  const path = join(libraryPath, 'database/search/leo.sqlite');
  if (!existsSync(path)) return new Map();

  try {
    const db = new Database(path, { readonly: true });
    try {
      const slots = readLexicon(db);
      const collected = new Map<string, SearchTerms>();

      for (const item of db
        .query<ItemRow, []>('SELECT identifier, lexeme_ids FROM items')
        .all()) {
        const fields: Record<SearchField, Collected[]> = {
          place: [],
          description: [],
          labels: []
        };
        let found = false;
        for (const id of lexemeIds(item.lexeme_ids)) {
          const slot = slots.get(id);
          if (slot === undefined) continue;
          fields[slot.field].push(slot);
          found = true;
        }
        if (found) collected.set(item.identifier, orderTerms(fields));
      }

      return collected;
    } finally {
      db.close();
    }
  } catch {
    return new Map();
  }
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

/** Terms for one asset, empty when the index has nothing for it. */
export function termsFor(
  index: Map<string, SearchTerms> | undefined,
  uuid: string
): SearchTerms {
  return index?.get(uuid) ?? emptyTerms();
}
