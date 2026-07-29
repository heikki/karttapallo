/**
 * TypeScript FFI wrapper for libkarttapallo.dylib.
 *
 * Provides convertToJpeg, resizeToJpeg, and extractVideoFrame as typed
 * functions matching the old subprocess-based signatures.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dlopen, FFIType, ptr } from 'bun:ffi';

function findDylib() {
  const argv0Dir = dirname(process.argv[0] ?? '.');
  const candidates = [
    // 1. resources/native/ next to this source file (bun dev from project root)
    join(dirname(import.meta.path), 'libkarttapallo.dylib'),
    // 2. Electrobun installed: Contents/MacOS/../Resources/app/
    join(argv0Dir, '..', 'Resources', 'app', 'libkarttapallo.dylib'),
    // 3. Electrobun dev: Contents/MacOS → up 5 levels → project root/resources/native/
    join(
      argv0Dir,
      '..',
      '..',
      '..',
      '..',
      '..',
      'resources',
      'native',
      'libkarttapallo.dylib'
    )
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `libkarttapallo.dylib not found. Searched:\n${candidates.join('\n')}\nRun: bun run build:native`
  );
}

function toCString(s: string): Uint8Array {
  return new TextEncoder().encode(`${s}\0`);
}

const lib = dlopen(findDylib(), {
  convertToJpeg: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.float],
    returns: FFIType.i32
  },
  resizeToJpeg: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.float],
    returns: FFIType.i32
  },
  extractVideoFrame: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32
  },
  runAppleScript: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32
  },
  resolveActiveLibraryPath: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32
  }
});

export function convertToJpeg(input: string, output: string, quality = 0.9) {
  const inBuf = toCString(input);
  const outBuf = toCString(output);
  return lib.symbols.convertToJpeg(ptr(inBuf), ptr(outBuf), quality) === 0;
}

export function resizeToJpeg(
  input: string,
  output: string,
  maxDim: number,
  quality = 0.8
) {
  const inBuf = toCString(input);
  const outBuf = toCString(output);
  return (
    lib.symbols.resizeToJpeg(ptr(inBuf), ptr(outBuf), maxDim, quality) === 0
  );
}

const ERR_BUF_LEN = 1024;

export function runAppleScript(script: string) {
  const scriptBuf = toCString(script);
  const errBuf = new Uint8Array(ERR_BUF_LEN);
  const rc = lib.symbols.runAppleScript(
    ptr(scriptBuf),
    ptr(errBuf),
    ERR_BUF_LEN
  );
  if (rc !== 0) {
    const nullIdx = errBuf.indexOf(0);
    const msg = new TextDecoder().decode(
      errBuf.subarray(0, nullIdx === -1 ? undefined : nullIdx)
    );
    throw new Error(`AppleScript failed: ${msg}`);
  }
}

/**
 * Resolves the path of the Photos library Photos.app currently treats as
 * active, decoded from the `IPXDefaultLibraryURLBookmark` bookmark in the
 * Photos container preferences (requires Full Disk Access).
 *
 * - `{ status: 'ok', path }` — the active library path
 * - `{ status: 'no-bookmark' }` — no bookmark exists; caller falls back to the
 *   system library at ~/Pictures
 * - `{ status: 'denied', message }` — prefs exist but couldn't be read (FDA)
 */
export type ActiveLibraryResult =
  | { status: 'ok'; path: string }
  | { status: 'no-bookmark' }
  | { status: 'denied'; message: string };

const PATH_BUF_LEN = 4096;

export function resolveActiveLibraryPath(): ActiveLibraryResult {
  const outBuf = new Uint8Array(PATH_BUF_LEN);
  const errBuf = new Uint8Array(ERR_BUF_LEN);
  const rc = lib.symbols.resolveActiveLibraryPath(
    ptr(outBuf),
    PATH_BUF_LEN,
    ptr(errBuf),
    ERR_BUF_LEN
  );
  if (rc === 0) {
    return { status: 'ok', path: decodeCString(outBuf) };
  }
  if (rc === 2) {
    return { status: 'denied', message: decodeCString(errBuf) };
  }
  return { status: 'no-bookmark' };
}

function decodeCString(buf: Uint8Array) {
  const nullIdx = buf.indexOf(0);
  return new TextDecoder().decode(
    buf.subarray(0, nullIdx === -1 ? undefined : nullIdx)
  );
}

export function extractVideoFrame(
  videoPath: string,
  output: string,
  maxDim = 1920
) {
  const inBuf = toCString(videoPath);
  const outBuf = toCString(output);
  return lib.symbols.extractVideoFrame(ptr(inBuf), ptr(outBuf), maxDim) === 0;
}
