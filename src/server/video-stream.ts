/**
 * Stream a video file with HTTP range support.
 *
 * No conversion or copying — the webview plays the original `.mov`/`.mp4`
 * directly via sendfile(2). Seeking works via standard Range requests.
 *
 * This module is pure HTTP/range logic; bundle-layout knowledge lives in
 * photos-library.
 */

import { extname } from 'node:path';

function videoMimeType(filename: string) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.m4v') return 'video/x-m4v';
  return 'video/mp4';
}

function parseRange(
  header: string,
  size: number
): { start: number; end: number } | null {
  const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/.exec(header);
  if (match?.groups === undefined) return null;
  const { start: s, end: e } = match.groups;
  const start = s === '' ? 0 : parseInt(s!, 10);
  const end = e === '' ? size - 1 : Math.min(parseInt(e!, 10), size - 1);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start > end ||
    start >= size ||
    start < 0
  ) {
    return null;
  }
  return { start, end };
}

/**
 * Serve the video at `filePath`, honoring the Range header for seeking.
 * Returns null when the file doesn't exist on disk.
 */
export async function serveVideo(
  filePath: string | null,
  req: Request
): Promise<Response | null> {
  if (filePath === null) return null;

  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return null;

  const size = file.size;
  const contentType = videoMimeType(filePath);
  const rangeHeader = req.headers.get('range');

  if (rangeHeader === null) {
    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    });
  }

  const range = parseRange(rangeHeader, size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    });
  }

  const chunkSize = range.end - range.start + 1;
  return new Response(file.slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(chunkSize),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes'
    }
  });
}
