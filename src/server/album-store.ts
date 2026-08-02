/**
 * AlbumStore — owns the per-album filesystem subtree at
 * `<library>/karttapallo/albums/{albumUuid}/`: GPX/markdown files (upload, list, delete),
 * the `_files.json` visibility sidecar, and the `_route.json` route file. Route
 * data passes through as bytes; the route shape is owned client-side in
 * `map-route/data.ts`.
 *
 * Callers address albums by name; directories are keyed by UUID (ADR-0015).
 * Translation happens here and nowhere else.
 *
 * Album and file names are validated at the seam to prevent path traversal.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const SIDECAR_NAME = '_files.json';
const ROUTE_NAME = '_route.json';
const ALLOWED_EXTS = ['.gpx', '.md'];

/**
 * Only directories shaped like an album UUID are ever removed by pruning, so
 * anything else that ends up under `albums/` is left where it is rather than
 * mistaken for an album Photos has forgotten.
 */
const UUID_DIR =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

interface FileVisibility {
  visible: boolean;
}

export interface AlbumFileEntry {
  name: string;
  visible: boolean;
}

export class InvalidNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNameError';
  }
}

function assertSafeName(name: string, kind: 'album' | 'file') {
  if (name === '' || name === '.' || name === '..') {
    throw new InvalidNameError(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new InvalidNameError(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  }
}

function isAllowedFile(name: string) {
  const lower = name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

/** One user album, as `photos-library` reports it. */
export interface AlbumRoster {
  uuid: string;
  title: string;
}

/**
 * Reads treat an unknown album as empty; writes raise this rather than invent a
 * directory from the name, which would recreate the name-keyed layout that
 * pruning then deletes.
 */
export class UnknownAlbumError extends Error {
  constructor(album: string) {
    super(`No album named ${JSON.stringify(album)} in this library`);
    this.name = 'UnknownAlbumError';
  }
}

export interface AlbumStore {
  uploadFiles: (album: string, formData: FormData) => Promise<string[]>;
  listFiles: (album: string) => Promise<AlbumFileEntry[]>;
  getFileBytes: (album: string, filename: string) => Promise<string | null>;
  deleteFile: (album: string, filename: string) => Promise<void>;
  setFileVisibility: (
    album: string,
    filename: string,
    visible: boolean
  ) => void;
  getRouteBytes: (album: string) => Promise<string | null>;
  putRouteBytes: (album: string, body: string) => Promise<void>;
  deleteRoute: (album: string) => Promise<void>;
  /** Drop the subtree of every album that no longer exists in the library. */
  pruneOrphans: () => void;
}

/**
 * @param loadAlbums roster seam — reads the library's albums. Called lazily and
 * cached, then re-read once whenever a name misses, so an album created while
 * the app is running resolves without a restart.
 */
export function createAlbumStore(
  bundleDir: string,
  loadAlbums: () => AlbumRoster[]
): AlbumStore {
  let roster: Map<string, string> | null = null;

  function readRoster(refresh = false): Map<string, string> {
    if (roster !== null && !refresh) return roster;
    const map = new Map<string, string>();
    for (const album of loadAlbums()) {
      const title = album.title.normalize('NFC');
      if (title === '' || album.uuid === '') continue;
      // Two albums can share a title. The API addresses albums by name, so they
      // are one album as far as this store can tell; picking the lower UUID at
      // least keeps which one deterministic across restarts.
      const seen = map.get(title);
      if (seen === undefined || album.uuid < seen) map.set(title, album.uuid);
    }
    roster = map;
    return map;
  }

  function uuidFor(album: string): string | null {
    assertSafeName(album, 'album');
    const title = album.normalize('NFC');
    return readRoster().get(title) ?? readRoster(true).get(title) ?? null;
  }

  /** Directory for reads: null when the album is unknown, so callers go empty. */
  function albumDirOrNull(album: string): string | null {
    const uuid = uuidFor(album);
    return uuid === null ? null : join(bundleDir, 'albums', uuid);
  }

  /** Directory for writes: throws rather than write outside the roster. */
  function albumDir(album: string) {
    const dir = albumDirOrNull(album);
    if (dir === null) throw new UnknownAlbumError(album);
    return dir;
  }

  function loadVisibility(album: string): Record<string, FileVisibility> {
    const dir = albumDirOrNull(album);
    if (dir === null) return {};
    const path = join(dir, SIDECAR_NAME);
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as Record<
        string,
        FileVisibility
      >;
    } catch {
      return {};
    }
  }

  function saveVisibility(
    album: string,
    store: Record<string, FileVisibility>
  ) {
    const dir = albumDir(album);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SIDECAR_NAME), JSON.stringify(store));
  }

  async function uploadFiles(
    album: string,
    formData: FormData
  ): Promise<string[]> {
    const dir = albumDir(album);
    await mkdir(dir, { recursive: true });
    const writes = formData
      .getAll('file')
      .filter(
        (value): value is File =>
          value instanceof File && isAllowedFile(value.name)
      )
      .map(async (file) => {
        assertSafeName(file.name, 'file');
        const bytes = await file.arrayBuffer();
        await Bun.write(join(dir, file.name), bytes);
        return file.name;
      });
    return await Promise.all(writes);
  }

  async function listFiles(album: string): Promise<AlbumFileEntry[]> {
    const dir = albumDirOrNull(album);
    if (dir === null) return [];
    const entries = await readdir(dir).catch(() => [] as string[]);
    const files = entries.filter(isAllowedFile);
    const visibility = loadVisibility(album);
    return files.map((name) => ({
      name,
      visible: visibility[name]?.visible ?? true
    }));
  }

  async function getFileBytes(
    album: string,
    filename: string
  ): Promise<string | null> {
    assertSafeName(filename, 'file');
    if (!isAllowedFile(filename)) return null;
    const dir = albumDirOrNull(album);
    if (dir === null) return null;
    try {
      return await readFile(join(dir, filename), 'utf-8');
    } catch {
      return null;
    }
  }

  async function deleteFile(album: string, filename: string) {
    assertSafeName(filename, 'file');
    const dir = albumDirOrNull(album);
    // Nothing to remove from an album the library no longer has — the caller's
    // end state already holds, so this is a no-op rather than an error.
    if (dir === null) return;
    await unlink(join(dir, filename)).catch(() => undefined);
    const store = loadVisibility(album);
    if (filename in store) {
      const { [filename]: _drop, ...rest } = store;
      saveVisibility(album, rest);
    }
  }

  function setFileVisibility(
    album: string,
    filename: string,
    visible: boolean
  ) {
    assertSafeName(filename, 'file');
    const store = loadVisibility(album);
    store[filename] = { visible };
    saveVisibility(album, store);
  }

  async function getRouteBytes(album: string): Promise<string | null> {
    const dir = albumDirOrNull(album);
    if (dir === null) return null;
    try {
      return await readFile(join(dir, ROUTE_NAME), 'utf-8');
    } catch {
      return null;
    }
  }

  async function putRouteBytes(album: string, body: string) {
    const dir = albumDir(album);
    await mkdir(dir, { recursive: true });
    await Bun.write(join(dir, ROUTE_NAME), body);
  }

  async function deleteRoute(album: string) {
    const dir = albumDirOrNull(album);
    if (dir === null) return;
    await unlink(join(dir, ROUTE_NAME)).catch(() => undefined);
  }

  /**
   * Guarded on a non-empty roster: an empty one means the library could not be
   * read, which is indistinguishable from every album having been deleted.
   */
  function pruneOrphans() {
    const live = new Set(readRoster(true).values());
    if (live.size === 0) return;
    const root = join(bundleDir, 'albums');
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!UUID_DIR.test(entry.name) || live.has(entry.name)) continue;
      try {
        rmSync(join(root, entry.name), { recursive: true, force: true });
      } catch {
        /* a subtree we cannot remove is not worth failing a rebuild over */
      }
    }
  }

  return {
    uploadFiles,
    listFiles,
    getFileBytes,
    deleteFile,
    setFileVisibility,
    getRouteBytes,
    putRouteBytes,
    deleteRoute,
    pruneOrphans
  };
}
