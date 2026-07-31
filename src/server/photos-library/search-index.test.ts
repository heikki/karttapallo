import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { readSceneLabels } from './search-index';

let libraryDir = '';

/** Build a psi.sqlite with the shape Photos uses, seeded with rows. */
function seedIndex(rows: Array<{ uuid: string; label: string }>) {
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
  for (const { uuid, label } of rows) {
    if (!assetRow.has(uuid)) {
      const bytes = Buffer.from(uuid.replace(/-/g, ''), 'hex');
      db.query('INSERT INTO assets VALUES (?, ?, 0)').run(
        bytes.readBigInt64LE(0),
        bytes.readBigInt64LE(8)
      );
      assetRow.set(uuid, assetRow.size + 1);
    }
    if (!groupRow.has(label)) {
      // Photos stores these NUL-terminated.
      db.query('INSERT INTO groups VALUES (1500, 0, ?, ?)').run(
        `${label}\0`,
        label.toLowerCase()
      );
      groupRow.set(label, groupRow.size + 1);
    }
    db.query('INSERT INTO ga VALUES (?, ?)').run(
      groupRow.get(label)!,
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

describe('readSceneLabels', () => {
  // The UUID halves are signed int64s. Read as float64 they round into
  // well-formed but wrong UUIDs, so every label would attach to no asset.
  test('reconstructs asset UUIDs from the int64 halves', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([{ uuid, label: 'Lintu' }]);

    expect([...readSceneLabels(libraryDir).keys()]).toEqual([uuid]);
  });

  test('survives UUIDs whose halves are negative', () => {
    // Leading byte >= 0x80 makes the low half negative once read as int64.
    const uuid = 'FF000000-0000-0000-FF00-000000000000';
    seedIndex([{ uuid, label: 'Auto' }]);

    expect([...readSceneLabels(libraryDir).keys()]).toEqual([uuid]);
  });

  test('collects every label for an asset, sorted and NUL-stripped', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, label: 'Ulkoilma' },
      { uuid, label: 'Lintu' },
      { uuid, label: 'Kasvi' }
    ]);

    expect(readSceneLabels(libraryDir).get(uuid)).toEqual([
      'Kasvi',
      'Lintu',
      'Ulkoilma'
    ]);
  });

  test('deduplicates a label repeated for one asset', () => {
    const uuid = 'D592800C-7F25-4D50-8277-4082E19B568F';
    seedIndex([
      { uuid, label: 'Auto' },
      { uuid, label: 'Auto' }
    ]);

    expect(readSceneLabels(libraryDir).get(uuid)).toEqual(['Auto']);
  });

  // A library Photos has never searched has no index, and one it has never
  // analyzed has an empty one. Neither is a failure worth breaking a rebuild.
  test('returns an empty map when the library has no search index', () => {
    expect(readSceneLabels(libraryDir).size).toBe(0);
  });

  test('returns an empty map rather than throwing on an unreadable index', () => {
    const dir = join(libraryDir, 'database/search');
    mkdirSync(dir, { recursive: true });
    void Bun.write(join(dir, 'psi.sqlite'), 'not a database');

    expect(readSceneLabels(libraryDir).size).toBe(0);
  });
});
