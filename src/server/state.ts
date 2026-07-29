/**
 * Generic key-value settings backed by `state.json` inside the data dir.
 *
 * Replaces the SQLite `settings` table. Keyed by which dir is passed in:
 * global keys (`window`, `ors_api_key`) use the top-level data dir; the `view`
 * key is per-library and uses `data/libraries/{key}/` so map center, filters,
 * and the selected photo UUID restore against the right library (ADR 0012).
 * Re-reads the file on each call — the data is tiny and call frequency is
 * debounced (~once per second at peak), so caching would buy nothing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'state.json';

type SettingsMap = Record<string, string>;

function load(dataDir: string): SettingsMap {
  const path = join(dataDir, STATE_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SettingsMap;
  } catch {
    return {};
  }
}

export function getSetting(dataDir: string, key: string): string | null {
  return load(dataDir)[key] ?? null;
}

export function setSetting(dataDir: string, key: string, value: string) {
  const store = load(dataDir);
  store[key] = value;
  writeFileSync(join(dataDir, STATE_FILE), JSON.stringify(store));
}
