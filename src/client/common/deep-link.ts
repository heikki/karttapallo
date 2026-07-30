import * as data from './data';
import type { Photo } from './types';
import { updateUrl } from './url-state';

/**
 * Client half of `karttapallo://photo/<uuid>` — see `@server/deep-link`.
 *
 * The server turns a deep link into `?id=<uuid>&focus=1`. `id` alone would
 * already seed the selection, but it cannot be trusted to show anything: the
 * photo may sit outside the current filters, and the camera would fit all
 * photos rather than move to it. `focus` is what separates "the user just
 * asked for this photo" from "this is where they left off", and licenses
 * overriding both.
 */

// Captured at module load, before any effect can rewrite the URL.
const params = new URLSearchParams(location.search);
const requestedUuid = params.get('focus') === '1' ? params.get('id') : null;

/** Whether this page load came from a deep link that still needs acting on. */
export function pending() {
  return requestedUuid !== null && !consumed;
}

let consumed = false;

/**
 * Act on the deep link now that photos are in: widen the filters so the
 * photo is visible, and hand it back so the caller can move the camera.
 * Returns null if the link names a photo this library doesn't have.
 *
 * Selection needs no help here — `selectedPhotoUuid` seeded from the same
 * `id` param at load; it just couldn't resolve while the filters hid it.
 */
export function resolve(photos: Photo[]): Photo | null {
  consumed = true;
  // A deep link is a one-shot instruction, not state. Drop `focus` either
  // way so it can't survive into the persisted view and fire again on the
  // next launch.
  updateUrl((p) => {
    p.delete('focus');
  });
  if (requestedUuid === null) return null;

  const photo = photos.find((p) => p.uuid === requestedUuid);
  if (photo === undefined) {
    console.warn(`[deep-link] No photo with uuid ${requestedUuid}`);
    return null;
  }
  data.revealPhoto(photo);
  return photo;
}
