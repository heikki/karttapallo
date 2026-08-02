/**
 * Generic key-value settings backed by `state.json`, keyed by which directory
 * the caller passes: machine-scoped keys (`window`, `ors_api_key`) use the
 * Application Support dir; the `view` key belongs to one library and is written
 * inside that library's bundle, so map center, filters and the selected photo
 * restore against the right library — and on whichever Mac it is opened on
 * (ADR-0012, ADR-0015).
 *
 * Re-reads the file on each call — the data is tiny and call frequency is
 * debounced (~once per second at peak), so caching would buy nothing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'state.json';

type SettingsMap = Record<string, string>;

function load(dir: string): SettingsMap {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SettingsMap;
  } catch {
    return {};
  }
}

export function getSetting(dir: string, key: string): string | null {
  return load(dir)[key] ?? null;
}

export function setSetting(dir: string, key: string, value: string) {
  const store = load(dir);
  store[key] = value;
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(store));
}
