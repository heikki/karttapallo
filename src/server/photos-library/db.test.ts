import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { discoverKeywordJoin } from './db';

/**
 * A keyword join table as Core Data names it: the digits are entity numbers,
 * and they are what moves between schema versions.
 */
function libraryWithKeywords(assetEntity: number, keywordEntity: number) {
  const db = new Database(':memory:');
  db.run(
    `CREATE TABLE Z_${assetEntity}KEYWORDS (
       Z_${assetEntity}ASSETATTRIBUTES INTEGER,
       Z_${keywordEntity}KEYWORDS INTEGER)`
  );
  return db;
}

describe('discoverKeywordJoin', () => {
  // macOS 27 renumbered keywords from 52 to 53, and the hardcoded column name
  // turned every info panel into a 500.
  test('finds the columns whatever entity numbers the schema uses', () => {
    for (const keywordEntity of [52, 53, 999]) {
      const db = libraryWithKeywords(1, keywordEntity);

      expect(discoverKeywordJoin(db)).toEqual({
        tableName: 'Z_1KEYWORDS',
        keywordColumn: `Z_${keywordEntity}KEYWORDS`,
        attributesColumn: 'Z_1ASSETATTRIBUTES'
      });
      db.close();
    }
  });

  test('follows the table name renumbering too', () => {
    const db = libraryWithKeywords(4, 53);

    expect(discoverKeywordJoin(db)?.tableName).toBe('Z_4KEYWORDS');
  });

  // Keywords are then a row the panel doesn't show, not a failed read.
  test('yields null when the library has no keyword join table', () => {
    const db = new Database(':memory:');
    db.run('CREATE TABLE ZASSET (Z_PK INTEGER)');

    expect(discoverKeywordJoin(db)).toBeNull();
  });
});
