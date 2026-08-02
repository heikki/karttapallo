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
import { closeSync, existsSync, openSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
export function libraryDataDir(dataDir: string, libraryPath: string) {
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
export function markLibraryDir(libDir: string, libraryPath: string) {
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

/** Path with the home directory written `~`, the way macOS shows one. */
function withTilde(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * How a library identifies itself in the window title.
 *
 * Two libraries can be indistinguishable once the window is open — a working
 * one and a copy taken to test a rebuild show the same photos, since a copy
 * carries the same asset UUIDs — while edits go to whichever was resolved at
 * startup. This is the only thing on screen that says which.
 *
 * Three cases, by how much it takes to identify the library:
 *
 * - **External disk** — name plus volume. The volume is the half of the
 *   identity that a name on its own is missing, and it is short.
 * - **The default Photos directory** — the bare name. There is only one such
 *   directory, so its path says nothing a reader doesn't already assume.
 * - **Anywhere else on the internal disk** — the whole path. This is where
 *   copies get made, and two of them can share a name in different folders, so
 *   the folder is the only thing that tells them apart. `~` keeps it short.
 */
export function libraryTitle(libraryPath: string): string {
  const name = basename(libraryPath).replace(/\.photoslibrary$/, '');
  const volume = volumeOf(libraryPath);
  if (volume !== null) return `${name} (${volume})`;
  if (dirname(libraryPath) === dirname(defaultLibraryPath())) return name;
  return withTilde(libraryPath);
}

function hasDatabase(libraryPath: string) {
  return existsSync(join(libraryPath, 'database', 'Photos.sqlite'));
}

/**
 * Promptless Full Disk Access probe.
 *
 * Reading the TCC database requires FDA but — unlike an app container — never
 * raises a consent prompt: without the grant the open simply fails with EPERM.
 * That asymmetry is the whole point. It lets us decide whether to attempt the
 * container read at all, rather than letting macOS put its own dialog on screen
 * (see `resolveLibrary`).
 */
export function hasFullDiskAccess() {
  try {
    const fd = openSync(
      join(homedir(), 'Library/Application Support/com.apple.TCC/TCC.db'),
      'r'
    );
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param resolve native resolver seam — overridable in tests.
 * @param hasFda Full Disk Access probe seam — overridable in tests.
 */
export function resolveLibrary(
  resolve: () => ActiveLibraryResult = resolveActiveLibraryPath,
  hasFda: () => boolean = hasFullDiskAccess
): LibraryResolution {
  // Check FDA *before* touching the Photos container. The container read is what
  // makes macOS raise its own "wants to access data from other apps" prompt, and
  // that grant (kTCCServiceSystemPolicyAppData) is session-scoped — it is
  // re-prompted every single launch, however many times the user allows it. Only
  // FDA persists (docs/gotchas.md), and FDA supersedes it, so with the grant in
  // place the read below is silent. Gating here keeps the unwinnable per-launch
  // prompt off screen and points the user at the grant that actually sticks.
  if (!hasFda()) {
    return {
      ok: false,
      error: 'fda',
      message: 'Full Disk Access has not been granted.'
    };
  }

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
