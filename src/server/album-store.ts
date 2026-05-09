/**
 * AlbumStore — owns the per-album filesystem subtree at
 * `{dataDir}/albums/{album}/`: GPX/markdown files (upload, list, delete), the
 * `_files.json` visibility sidecar, and the `_route.json` route file. Route
 * data passes through as bytes; the route shape is owned client-side in
 * `map-route/route-data.ts`.
 *
 * Album and file names are validated at the seam to prevent path traversal.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const SIDECAR_NAME = '_files.json';
const ROUTE_NAME = '_route.json';
const ALLOWED_EXTS = ['.gpx', '.md'];

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

function assertSafeName(name: string, kind: 'album' | 'file'): void {
  if (name === '' || name === '.' || name === '..') {
    throw new InvalidNameError(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new InvalidNameError(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  }
}

function isAllowedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

export interface AlbumStore {
  uploadFiles: (album: string, formData: FormData) => Promise<string[]>;
  listFiles: (album: string) => Promise<AlbumFileEntry[]>;
  deleteFile: (album: string, filename: string) => Promise<void>;
  setFileVisibility: (
    album: string,
    filename: string,
    visible: boolean
  ) => void;
  getRouteBytes: (album: string) => Promise<string | null>;
  putRouteBytes: (album: string, body: string) => Promise<void>;
  deleteRoute: (album: string) => Promise<void>;
}

export function createAlbumStore(dataDir: string): AlbumStore {
  function albumDir(album: string): string {
    assertSafeName(album, 'album');
    return join(dataDir, 'albums', album);
  }

  function loadVisibility(album: string): Record<string, FileVisibility> {
    const path = join(albumDir(album), SIDECAR_NAME);
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
  ): void {
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
    const dir = albumDir(album);
    const entries = await readdir(dir).catch(() => [] as string[]);
    const files = entries.filter(isAllowedFile);
    const visibility = loadVisibility(album);
    return files.map((name) => ({
      name,
      visible: visibility[name]?.visible ?? true
    }));
  }

  async function deleteFile(album: string, filename: string): Promise<void> {
    assertSafeName(filename, 'file');
    const dir = albumDir(album);
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
  ): void {
    assertSafeName(filename, 'file');
    const store = loadVisibility(album);
    store[filename] = { visible };
    saveVisibility(album, store);
  }

  async function getRouteBytes(album: string): Promise<string | null> {
    const path = join(albumDir(album), ROUTE_NAME);
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return null;
    }
  }

  async function putRouteBytes(album: string, body: string): Promise<void> {
    const dir = albumDir(album);
    await mkdir(dir, { recursive: true });
    await Bun.write(join(dir, ROUTE_NAME), body);
  }

  async function deleteRoute(album: string): Promise<void> {
    const path = join(albumDir(album), ROUTE_NAME);
    await unlink(path).catch(() => undefined);
  }

  return {
    uploadFiles,
    listFiles,
    deleteFile,
    setFileVisibility,
    getRouteBytes,
    putRouteBytes,
    deleteRoute
  };
}
