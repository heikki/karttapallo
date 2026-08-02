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

const POI = 1;
const STREET = 2;
const CITY = 5;
const DESCRIPTION = 1202;
const LABEL = 1500;
const COUNTRY = 12;
const COUNTRY_CODE = 13;
const STATE_CODE = 11;

let libraryDir = '';

/** Build a psi.sqlite with the shape Photos uses, seeded with rows. */
function seedIndex(
  rows: Array<{ uuid: string; category: number; term: string }>
) {
  const dir = join(libraryDir, 'database/search');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'psi.sqlite'), {
    create: true,
    safeIntegers: true
  });
  db.run(
    'CREATE TABLE assets (uuid_0 INT, uuid_1 INT, creationDate REAL);' +
      'CREATE TABLE groups (category INT, owning_groupid INT, content_string TEXT, normalized_string TEXT);' +
      'CREATE TABLE ga (groupid INT, assetid INT);'
  );

  const assetRow = new Map<string, number>();
  const groupRow = new Map<string, number>();
  for (const { uuid, category, term } of rows) {
    if (!assetRow.has(uuid)) {
      const bytes = Buffer.from(uuid.replace(/-/g, ''), 'hex');
      db.query('INSERT INTO assets VALUES (?, ?, 0)').run(
        bytes.readBigInt64LE(0),
        bytes.readBigInt64LE(8)
      );
      assetRow.set(uuid, assetRow.size + 1);
    }
    const groupKey = `${category} ${term}`;
    if (!groupRow.has(groupKey)) {
      // Photos stores these NUL-terminated.
      db.query('INSERT INTO groups VALUES (?, 0, ?, ?)').run(
        category,
        `${term}\0`,
        term.toLowerCase()
      );
      groupRow.set(groupKey, groupRow.size + 1);
    }
    db.query('INSERT INTO ga VALUES (?, ?)').run(
      groupRow.get(groupKey)!,
      assetRow.get(uuid)!
    );
  }
  db.close();
}

beforeEach(() => {
  libraryDir = mkdtempSync(join(tmpdir(), 'karttapallo-psi-'));
});

afterEach(() => {
  rmSync(libraryDir, { recursive: true, force: true });
});

describe('readSearchTerms', () => {
  // The UUID halves are signed int64s. Read as float64 they round into
  // well-formed but wrong UUIDs, so every term would attach to no asset.
  test('reconstructs asset UUIDs from the int64 halves', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([{ uuid, category: LABEL, term: 'Lintu' }]);

    expect([...readSearchTerms(libraryDir).keys()]).toEqual([uuid]);
  });

  test('survives UUIDs whose halves are negative', () => {
    // Leading byte >= 0x80 makes the low half negative once read as int64.
    const uuid = 'FF000000-0000-0000-FF00-000000000000';
    seedIndex([{ uuid, category: LABEL, term: 'Auto' }]);

    expect([...readSearchTerms(libraryDir).keys()]).toEqual([uuid]);
  });

  test('sorts each field into its own bucket', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, category: CITY, term: 'Inari' },
      { uuid, category: DESCRIPTION, term: 'Sudenkorentoja' },
      { uuid, category: LABEL, term: 'Lintu' }
    ]);

    expect(readSearchTerms(libraryDir).get(uuid)).toEqual({
      place: ['Inari'],
      description: ['Sudenkorentoja'],
      labels: ['Lintu']
    });
  });

  // Reading a place outward is what makes the row legible; alphabetical order
  // would interleave the city with the street it contains.
  test('orders places most specific first, not alphabetically', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, category: COUNTRY, term: 'Suomi' },
      { uuid, category: CITY, term: 'Inari' },
      { uuid, category: POI, term: 'Siida' },
      { uuid, category: STREET, term: 'Inarintie' }
    ]);

    expect(readSearchTerms(libraryDir).get(uuid)?.place).toEqual([
      'Siida',
      'Inarintie',
      'Inari',
      'Suomi'
    ]);
  });

  // They duplicate the country and state names at identical counts, so a query
  // for `fi` would offer `FI` above `Suomi`.
  test('ignores the two-letter country and state codes', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, category: COUNTRY, term: 'Suomi' },
      { uuid, category: COUNTRY_CODE, term: 'FI' },
      { uuid, category: STATE_CODE, term: 'MA' }
    ]);

    expect(readSearchTerms(libraryDir).get(uuid)?.place).toEqual(['Suomi']);
  });

  test('collects every label for an asset, sorted and NUL-stripped', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, category: LABEL, term: 'Ulkoilma' },
      { uuid, category: LABEL, term: 'Lintu' },
      { uuid, category: LABEL, term: 'Kasvi' }
    ]);

    expect(readSearchTerms(libraryDir).get(uuid)?.labels).toEqual([
      'Kasvi',
      'Lintu',
      'Ulkoilma'
    ]);
  });

  test('deduplicates a term repeated for one asset', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, category: LABEL, term: 'Auto' },
      { uuid, category: LABEL, term: 'Auto' }
    ]);

    expect(readSearchTerms(libraryDir).get(uuid)?.labels).toEqual(['Auto']);
  });

  // Photos files some names under two categories — a city and the district
  // sharing its name. The more specific one wins so the row still reads outward.
  test('keeps the most specific copy of a name in two categories', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, category: CITY, term: 'Kuhmo' },
      { uuid, category: POI, term: 'Kuhmo' },
      { uuid, category: CITY, term: 'Sotkamo' }
    ]);

    expect(readSearchTerms(libraryDir).get(uuid)?.place).toEqual([
      'Kuhmo',
      'Sotkamo'
    ]);
  });

  // How Photos stores them: base letter + combining mark. Typed input is
  // composed, so an un-normalized value would never match (ADR-0014).
  test('composes decomposed Nordic place names to NFC', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    const d = COMBINING_DIAERESIS;
    const decomposed = `Na${d}a${d}ta${d}mo${d}`;
    expect(decomposed).not.toBe('Näätämö');
    expect(decomposed.length).toBe(11);

    seedIndex([{ uuid, category: CITY, term: decomposed }]);

    expect(readSearchTerms(libraryDir).get(uuid)?.place).toEqual(['Näätämö']);
  });

  test('composes a mix of diaeresis and acute', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    const decomposed = `Blo${COMBINING_DIAERESIS}nduo${COMBINING_ACUTE}s`;
    expect(decomposed).not.toBe('Blönduós');

    seedIndex([{ uuid, category: CITY, term: decomposed }]);

    expect(readSearchTerms(libraryDir).get(uuid)?.place).toEqual(['Blönduós']);
  });

  test('drops terms that are blank once the NUL is stripped', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, category: CITY, term: '   ' },
      { uuid, category: CITY, term: 'Kuhmo' }
    ]);

    expect(readSearchTerms(libraryDir).get(uuid)?.place).toEqual(['Kuhmo']);
  });

  // A library Photos has never searched has no index, and one it has never
  // analyzed has an empty one. Neither is a failure worth breaking a rebuild.
  test('returns an empty map when the library has no search index', () => {
    expect(readSearchTerms(libraryDir).size).toBe(0);
  });

  test('returns an empty map rather than throwing on an unreadable index', () => {
    const dir = join(libraryDir, 'database/search');
    mkdirSync(dir, { recursive: true });
    void Bun.write(join(dir, 'psi.sqlite'), 'not a database');

    expect(readSearchTerms(libraryDir).size).toBe(0);
  });
});

describe('termsFor', () => {
  test('yields empty fields for an asset the index has nothing for', () => {
    expect(termsFor(new Map(), 'D592800C-7F25-4D50-8277-4082E19B568F')).toEqual(
      {
        place: [],
        description: [],
        labels: []
      }
    );
  });

  // The rebuild passes no index in tests that don't care about search.
  test('yields empty fields when there is no index at all', () => {
    expect(termsFor(undefined, 'D592800C-7F25-4D50-8277-4082E19B568F')).toEqual(
      {
        place: [],
        description: [],
        labels: []
      }
    );
  });
});
