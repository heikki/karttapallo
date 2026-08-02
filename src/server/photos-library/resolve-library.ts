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

/**
 * Where a library lives, written the shortest way that still locates it.
 *
 * On an external disk the leading `/Volumes/` is dropped, because every such
 * path carries it and the volume name is the part that means something —
 * leaving `Crucial X10`, or `Crucial X10/Backups/2018-08-02/Pictures` for one
 * filed away inside a backup. On the internal disk the home directory becomes
 * `~` for the same reason.
 */
function locationOf(dir: string): string {
  const VOLUMES = '/Volumes/';
  if (dir.startsWith(VOLUMES)) return dir.slice(VOLUMES.length);
  const home = homedir();
  if (dir === home) return '~';
  return dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir;
}

/**
 * How a library identifies itself in the window title.
 *
 * Two libraries can be indistinguishable once the window is open — a working
 * one and a copy taken to test a rebuild show the same photos, since a copy
 * carries the same asset UUIDs — while edits go to whichever was resolved at
 * startup. This is the only thing on screen that says which.
 *
 * The name, then where it lives in parentheses. Splitting the two puts the
 * distinguishing part first, where a truncating title bar cannot eat it, and
 * keeps the qualifier as long as it needs to be — a volume name for a library
 * sitting on a disk, a whole nested path for one buried in a backup.
 *
 * The default Photos directory is the one case with no qualifier at all: there
 * is only ever one of it, so naming it says nothing a reader doesn't assume.
 */
export function libraryTitle(libraryPath: string): string {
  const name = basename(libraryPath).replace(/\.photoslibrary$/, '');
  const dir = dirname(libraryPath);
  if (dir === dirname(defaultLibraryPath())) return name;
  return `${name} (${locationOf(dir)})`;
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
