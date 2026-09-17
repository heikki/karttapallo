import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { readSearchTerms, termsFor } from './search-index';

// Built from explicit combining marks rather than pasted literals, so the
// assertion cannot be silently defeated by an editor normalizing the source.
const COMBINING_DIAERESIS = '̈';
const COMBINING_ACUTE = '́';

const POI = 2060;
const STREET = 2050;
const CITY = 2090;
const COUNTRY = 2160;
const COUNTRY_CODE = 2170;
const TITLE = 7000;
const CAPTION = 8080;
const LABEL = 4000;

const CANONICAL = 1;
const INFLECTION = 2;

const UUID = 'D592800C-7F25-4D50-8277-4082E19B568F';

interface SeedRow {
  uuid: string;
  category: number;
  term: string;
  /** Defaults to the canonical form; type 2 is an inflection or synonym. */
  type?: number;
  /** Set to share one lexeme between a canonical term and its inflections. */
  lexeme?: number;
}

/** Build a leo.sqlite with the shape Photos uses, seeded with rows. */
function seedIndex(rows: SeedRow[]) {
  const dir = join(libraryDir, 'database/search');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'leo.sqlite'), { create: true });
  db.run(
    'CREATE TABLE items (identifier TEXT, lexeme_ids BLOB);' +
      'CREATE TABLE lexicon (lexeme_id INT, type INT, category INT, content TEXT)'
  );

  const lexemeOf = new Map<string, number>();
  const itemLexemes = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.category} ${row.term}`;
    const lexeme =
      row.lexeme ?? lexemeOf.get(key) ?? lexemeOf.size + itemLexemes.size + 1;
    if (!lexemeOf.has(key)) {
      lexemeOf.set(key, lexeme);
      db.query('INSERT INTO lexicon VALUES (?, ?, ?, ?)').run(
        lexeme,
        row.type ?? CANONICAL,
        row.category,
        row.term
      );
    }
    const ids = itemLexemes.get(row.uuid) ?? [];
    ids.push(lexeme);
    itemLexemes.set(row.uuid, ids);
  }

  for (const [uuid, ids] of itemLexemes) {
    // How Photos packs them: a little-endian uint32 per lexeme.
    const blob = Buffer.alloc(ids.length * 4);
    for (const [i, id] of ids.entries()) blob.writeUInt32LE(id, i * 4);
    db.query('INSERT INTO items VALUES (?, ?)').run(uuid, blob);
  }
  db.close();
}

let libraryDir = '';

beforeEach(() => {
  libraryDir = mkdtempSync(join(tmpdir(), 'karttapallo-leo-'));
});

afterEach(() => {
  rmSync(libraryDir, { recursive: true, force: true });
});

describe('readSearchTerms', () => {
  test('keys terms by the asset UUID the index stores', () => {
    seedIndex([{ uuid: UUID, category: LABEL, term: 'Lintu' }]);

    expect([...readSearchTerms(libraryDir).keys()]).toEqual([UUID]);
  });

  test('sorts each field into its own bucket', () => {
    seedIndex([
      { uuid: UUID, category: CITY, term: 'Inari' },
      { uuid: UUID, category: TITLE, term: 'Sudenkorentoja' },
      { uuid: UUID, category: LABEL, term: 'Lintu' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)).toEqual({
      place: ['Inari'],
      description: ['Sudenkorentoja'],
      labels: ['Lintu']
    });
  });

  // Reading a place outward is what makes the row legible; alphabetical order
  // would interleave the city with the street it contains.
  test('orders places most specific first, not alphabetically', () => {
    seedIndex([
      { uuid: UUID, category: COUNTRY, term: 'Suomi' },
      { uuid: UUID, category: CITY, term: 'Inari' },
      { uuid: UUID, category: POI, term: 'Siida' },
      { uuid: UUID, category: STREET, term: 'Inarintie' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.place).toEqual([
      'Siida',
      'Inarintie',
      'Inari',
      'Suomi'
    ]);
  });

  // Photos matches every inflection of a term, and files them on the term's own
  // lexeme. Surfacing them would offer `Suomea` and `Suomen` as their own hits.
  test('takes the canonical form of a term, not its inflections', () => {
    seedIndex([
      { uuid: UUID, category: CITY, term: 'Kuhmo', lexeme: 7 },
      {
        uuid: UUID,
        category: CITY,
        term: 'Kuhmoon',
        type: INFLECTION,
        lexeme: 7
      },
      {
        uuid: UUID,
        category: CITY,
        term: 'Kuhmossa',
        type: INFLECTION,
        lexeme: 7
      }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.place).toEqual(['Kuhmo']);
  });

  // It duplicates the country name at an identical count under a worse label,
  // so a query for `fi` would offer `FI` above `Suomi`.
  test('ignores the two-letter country code', () => {
    seedIndex([
      { uuid: UUID, category: COUNTRY, term: 'Suomi' },
      { uuid: UUID, category: COUNTRY_CODE, term: 'FI' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.place).toEqual(['Suomi']);
  });

  // Photos stores a title and a caption under different categories, and the
  // search field finds both, so the corpus carries both.
  test('takes the title and the caption an asset carries', () => {
    seedIndex([
      { uuid: UUID, category: CAPTION, term: 'Sumuinen aamu' },
      { uuid: UUID, category: TITLE, term: 'Puolukkaselästä?' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.description).toEqual([
      'Puolukkaselästä?',
      'Sumuinen aamu'
    ]);
  });

  test('collects every label for an asset, sorted', () => {
    seedIndex([
      { uuid: UUID, category: LABEL, term: 'Ulkoilma' },
      { uuid: UUID, category: LABEL, term: 'Lintu' },
      { uuid: UUID, category: LABEL, term: 'Kasvi' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.labels).toEqual([
      'Kasvi',
      'Lintu',
      'Ulkoilma'
    ]);
  });

  test('deduplicates a term repeated for one asset', () => {
    seedIndex([
      { uuid: UUID, category: LABEL, term: 'Auto' },
      { uuid: UUID, category: LABEL, term: 'Auto' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.labels).toEqual(['Auto']);
  });

  // Photos files some names under two categories — a city and the island
  // sharing its name. The more specific one wins so the row still reads outward.
  test('keeps the most specific copy of a name in two categories', () => {
    seedIndex([
      { uuid: UUID, category: CITY, term: 'Kuhmo' },
      { uuid: UUID, category: POI, term: 'Kuhmo' },
      { uuid: UUID, category: CITY, term: 'Sotkamo' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.place).toEqual([
      'Kuhmo',
      'Sotkamo'
    ]);
  });

  // Typed input is composed, so an un-normalized value would never match.
  test('composes decomposed Nordic place names to NFC', () => {
    const d = COMBINING_DIAERESIS;
    const decomposed = `Na${d}a${d}ta${d}mo${d}`;
    expect(decomposed).not.toBe('Näätämö');

    seedIndex([{ uuid: UUID, category: CITY, term: decomposed }]);

    expect(readSearchTerms(libraryDir).get(UUID)?.place).toEqual(['Näätämö']);
  });

  test('composes a mix of diaeresis and acute', () => {
    const decomposed = `Blo${COMBINING_DIAERESIS}nduo${COMBINING_ACUTE}s`;
    expect(decomposed).not.toBe('Blönduós');

    seedIndex([{ uuid: UUID, category: CITY, term: decomposed }]);

    expect(readSearchTerms(libraryDir).get(UUID)?.place).toEqual(['Blönduós']);
  });

  test('drops blank terms', () => {
    seedIndex([
      { uuid: UUID, category: CITY, term: '   ' },
      { uuid: UUID, category: CITY, term: 'Kuhmo' }
    ]);

    expect(readSearchTerms(libraryDir).get(UUID)?.place).toEqual(['Kuhmo']);
  });

  test('skips an asset whose every term is one we ignore', () => {
    seedIndex([{ uuid: UUID, category: COUNTRY_CODE, term: 'FI' }]);

    expect(readSearchTerms(libraryDir).size).toBe(0);
  });

  // A library Photos has never searched has no index, and one it is still
  // reindexing has an empty one. Neither is a failure worth breaking a rebuild.
  test('returns an empty map when the library has no search index', () => {
    expect(readSearchTerms(libraryDir).size).toBe(0);
  });

  test('returns an empty map for an index with no items yet', () => {
    seedIndex([]);

    expect(readSearchTerms(libraryDir).size).toBe(0);
  });

  test('returns an empty map rather than throwing on an unreadable index', () => {
    const dir = join(libraryDir, 'database/search');
    mkdirSync(dir, { recursive: true });
    void Bun.write(join(dir, 'leo.sqlite'), 'not a database');

    expect(readSearchTerms(libraryDir).size).toBe(0);
  });
});

describe('termsFor', () => {
  test('yields empty fields for an asset the index has nothing for', () => {
    expect(termsFor(new Map(), UUID)).toEqual({
      place: [],
      description: [],
      labels: []
    });
  });

  // The rebuild passes no index in tests that don't care about search.
  test('yields empty fields when there is no index at all', () => {
    expect(termsFor(undefined, UUID)).toEqual({
      place: [],
      description: [],
      labels: []
    });
  });
});
