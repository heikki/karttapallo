/**
 * Print `karttapallo://` deep links for photos matching a query.
 *
 * The point is to skip the manual hunt: a finding usually names a datetime or
 * a filename, and this turns that into a link that opens the app on the photo.
 *
 * Dates are built with `buildItemEntry`, the same function the API serves
 * from, so what you match against is the wall clock the app actually shows —
 * derived from instant + coordinates, not the stored offset (ADR-0013). A
 * query matched against ZTIMEZONEOFFSET instead would miss exactly the
 * mis-zoned assets most worth linking to.
 *
 * Usage:
 *   bun scripts/photo-link.ts 2019-07-14           # a day
 *   bun scripts/photo-link.ts "2019-07-14 13:2"    # narrowed to ~10 minutes
 *   bun scripts/photo-link.ts IMG_1234             # a filename
 *   bun scripts/photo-link.ts A1B2C3D4             # a uuid prefix
 */

import { buildItemEntry } from '@server/item-store';
import {
  openPhotosDb,
  queryNotInAlbumUuid,
  queryPhotos,
  queryVideos,
  resolveLibrary
} from '@server/photos-library';

const MAX_RESULTS = 40;

const query = process.argv[2];
if (query === undefined || query === '') {
  console.error(
    'Usage: bun scripts/photo-link.ts <datetime | filename | uuid>'
  );
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
const records = [...queryPhotos(db), ...queryVideos(db)];

const needle = query.toLowerCase();
const matches = records
  .map((record) => ({ record, entry: buildItemEntry(record, notInAlbumUuid) }))
  .filter(
    ({ record, entry }) =>
      entry.date.toLowerCase().includes(needle) ||
      record.uuid.toLowerCase().startsWith(needle) ||
      (record.originalFilename ?? record.filename ?? '')
        .toLowerCase()
        .includes(needle)
  )
  .sort((a, b) => a.entry.date.localeCompare(b.entry.date));

if (matches.length === 0) {
  console.error(`No photo matches ${query}`);
  process.exit(1);
}

for (const { record, entry } of matches.slice(0, MAX_RESULTS)) {
  const name = record.originalFilename ?? record.filename ?? '';
  const where = entry.lat === null ? 'no location' : 'located';
  console.log(
    `${entry.date} ${entry.tz ?? '     '}  ${name.padEnd(24)} ${where.padEnd(11)} karttapallo://photo?id=${record.uuid}`
  );
}

if (matches.length > MAX_RESULTS) {
  console.log(`… ${matches.length - MAX_RESULTS} more; narrow the query`);
}
