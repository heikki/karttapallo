/**
 * Resolves which Apple Photos library the app should operate on.
 *
 * The app always tracks the *active* library — the one Photos.app currently has
 * open — decoded from the container bookmark by the native bridge (ADR 0012).
 * Resolution fails loud: it never silently falls back to a *different* existing
 * library to mask a problem, because that would show the user the wrong photos
 * and could write edits into the wrong library.
 *
 * The literal `~/Pictures` system library is used only when there is genuinely
 * no bookmark at all (a machine that has only ever used the system library).
 */

import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveActiveLibraryPath,
  type ActiveLibraryResult
} from '@native/native-bridge';

import { defaultLibraryPath } from './db';

export type LibraryResolution =
  | { ok: true; path: string }
  | { ok: false; error: 'fda'; message: string }
  | {
      ok: false;
      error: 'unavailable';
      libraryPath: string;
      volume: string | null;
    };

/**
 * Per-library data subtree. UUIDs and album names aren't stable across
 * libraries, so each library's cache, item snapshot, and album sidecars live
 * under their own hashed dir; only truly global state (`state.json`) stays at
 * the top level of `dataDir`.
 */
export function libraryDataDir(dataDir: string, libraryPath: string): string {
  const hash = createHash('sha256')
    .update(libraryPath)
    .digest('hex')
    .slice(0, 8);
  return join(dataDir, 'libraries', hash);
}

/**
 * Drops a `library.json` marker inside a hashed library dir so the otherwise
 * opaque hash is traceable back to its library path — read the `library.json`
 * files under `data/libraries/` to see the mapping. Best-effort, never fatal.
 */
export function markLibraryDir(libDir: string, libraryPath: string): void {
  try {
    writeFileSync(
      join(libDir, 'library.json'),
      `${JSON.stringify({ path: libraryPath }, null, 2)}\n`
    );
  } catch {
    /* marker is a convenience, not load-bearing */
  }
}

/** Volume name for a `/Volumes/<name>/…` path, else null (internal disk). */
export function volumeOf(libraryPath: string): string | null {
  const m = /^\/Volumes\/(?<volume>[^/]+)\//.exec(libraryPath);
  return m?.groups?.volume ?? null;
}

function hasDatabase(libraryPath: string): boolean {
  return existsSync(join(libraryPath, 'database', 'Photos.sqlite'));
}

/**
 * @param resolve native resolver seam — overridable in tests.
 */
export function resolveLibrary(
  resolve: () => ActiveLibraryResult = resolveActiveLibraryPath
): LibraryResolution {
  const active = resolve();

  if (active.status === 'denied') {
    return { ok: false, error: 'fda', message: active.message };
  }

  const path = active.status === 'ok' ? active.path : defaultLibraryPath();

  if (!hasDatabase(path)) {
    return {
      ok: false,
      error: 'unavailable',
      libraryPath: path,
      volume: volumeOf(path)
    };
  }

  return { ok: true, path };
}
