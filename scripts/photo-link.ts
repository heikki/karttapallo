/**
 * Print the `karttapallo://` deep link for a photo, given its uuid.
 *
 * Matching is on uuid alone — a full one or a unique prefix. Date matching
 * was deliberately dropped: Photos formats capture times EXIF-style
 * ("2026:06:10 17:22:38"), so a query written the way anyone would type it
 * silently found nothing, and a date is not a stable identifier anyway.
 *
 * The lookup exists so the link is checked against the active library before
 * you hand it out: it confirms the asset is there and prints its date and
 * whether it has a location, which is usually what you wanted to know.
 *
 * Usage:
 *   bun scripts/photo-link.ts AF597F6B-4EE6-47A8-968D-20C709CBADD6
 *   bun scripts/photo-link.ts AF597F6B
 */

import { buildItemEntry } from '@server/item-store';
import {
  openPhotosDb,
  queryNotInAlbumUuid,
  queryPhotos,
  queryVideos,
  resolveLibrary
} from '@server/photos-library';

const query = process.argv[2];
if (query === undefined || query === '') {
  console.error('Usage: bun scripts/photo-link.ts <uuid>');
  process.exit(1);
}

// Operate on the active Photos library (ADR 0012), not a hardcoded path.
const resolved = resolveLibrary();
if (!resolved.ok) {
  console.error(
    resolved.error === 'fda'
      ? `Cannot read Photos library (Full Disk Access): ${resolved.message}`
      : `Photos library not available: ${resolved.libraryPath}`
  );
  process.exit(1);
}

const db = openPhotosDb(resolved.path);
const notInAlbumUuid = queryNotInAlbumUuid(db);
const needle = query.toLowerCase();
const matches = [...queryPhotos(db), ...queryVideos(db)].filter((record) =>
  record.uuid.toLowerCase().startsWith(needle)
);

if (matches.length === 0) {
  console.error(`No photo with uuid ${query} in ${resolved.path}`);
  process.exit(1);
}

// A prefix can hit more than one asset; print them all rather than pick, so
// an ambiguous prefix can't quietly hand out a link to the wrong photo.
for (const record of matches) {
  const entry = buildItemEntry(record, notInAlbumUuid);
  const where = entry.lat === null ? 'no location' : 'located';
  console.log(
    `${entry.date} ${entry.tz ?? '     '}  ${where.padEnd(11)}  karttapallo://photo/${record.uuid}`
  );
}
