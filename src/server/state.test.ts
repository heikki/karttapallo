import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { getSetting, setSetting } from './state';

let dataDir = '';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'karttapallo-state-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('state', () => {
  test('getSetting returns null when state.json does not exist', () => {
    expect(getSetting(dataDir, 'view')).toBe(null);
  });

  test('setSetting then getSetting round-trips', () => {
    setSetting(dataDir, 'view', '{"zoom":7}');
    expect(getSetting(dataDir, 'view')).toBe('{"zoom":7}');
  });

  test('setSetting overwrites existing values', () => {
    setSetting(dataDir, 'window', 'a');
    setSetting(dataDir, 'window', 'b');
    expect(getSetting(dataDir, 'window')).toBe('b');
  });

  test('multiple keys coexist', () => {
    setSetting(dataDir, 'view', '{"zoom":7}');
    setSetting(dataDir, 'window', '{"width":1200}');
    expect(getSetting(dataDir, 'view')).toBe('{"zoom":7}');
    expect(getSetting(dataDir, 'window')).toBe('{"width":1200}');
  });

  test('corrupt state.json falls back to empty', () => {
    writeFileSync(join(dataDir, 'state.json'), 'not json');
    expect(getSetting(dataDir, 'view')).toBe(null);
  });
});
