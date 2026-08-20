import { signal } from '@lit-labs/signals';

import * as data from '@common/data';
import * as deepLink from '@common/deep-link';
import * as interactionMode from '@common/interaction-mode';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';
import { urlSignal } from '@common/url-state';

export const selectedPhotoUuid = urlSignal<string | null>(
  'id',
  (raw) => raw,
  (v) => v
);

// Bumped every time the app chooses for the user. `<map-fit>` watches it to
// fit the camera; nothing else should care that a selection was automatic.
const autoSelectCount = signal(0);

// Whatever the last filter change knocked out of the filtered set, preferred
// over the oldest photo if it comes back — so flicking a solo toggle off and
// on returns you to where you were. Cleared whenever the user selects.
let droppedUuid: string | null = null;

// Escape hides the selected photo's card without disturbing the selection
// underneath it, so you can look at the map the card was covering. Anything
// that asks to see a photo reveals it again — every selection change,
// app-chosen as much as user-chosen, and Space — which makes this a peek at
// the photo you're on rather than a mode you browse in (ADR-0016).
// Deliberately outside `isPopupOpen`: only <map-popup> cares, and the marker
// stays lit meanwhile to show the selection survived.
const popupRevealed = signal(true);

function getPhoto(): Photo | undefined {
  const uuid = selectedPhotoUuid.get();
  if (uuid === null) return undefined;
  return data.filteredPhotos.get().find((p) => p.uuid === uuid);
}

function getPhotoIndex(): number | null {
  const uuid = selectedPhotoUuid.get();
  if (uuid === null) return null;
  const idx = data.filteredPhotos.get().findIndex((p) => p.uuid === uuid);
  return idx === -1 ? null : idx;
}

// Placement hides the popup; measure and route-edit don't conflict with it.
function isPopupOpen() {
  return (
    selectedPhotoUuid.get() !== null &&
    interactionMode.current.get() !== 'placement'
  );
}

function togglePopup() {
  popupRevealed.set(!popupRevealed.get());
}

function revealPopup() {
  popupRevealed.set(true);
}

function selectPhoto(uuid: string) {
  droppedUuid = null;
  revealPopup();
  selectedPhotoUuid.set(uuid);
  // Placement targeted the previous selection.
  if (interactionMode.current.get() === 'placement') {
    interactionMode.exit();
  }
}

function next() {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return false;
  const target = photos[(idx + 1) % photos.length];
  if (target === undefined) return false;
  selectPhoto(target.uuid);
  return true;
}

function prev() {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return false;
  const target = photos[(idx - 1 + photos.length) % photos.length];
  if (target === undefined) return false;
  selectPhoto(target.uuid);
  return true;
}

// `filteredPhotos` inherits `loadPhotos`'s sort, so [0] is the oldest.
function pick(uuid: string) {
  revealPopup();
  selectedPhotoUuid.set(uuid);
  autoSelectCount.set(autoSelectCount.get() + 1);
}

// The selection invariant (ADR-0016): null only when the filters match
// nothing. One-shot `everLoaded`, like data.ts's cascade: before the first
// load an empty set means "still loading" and a URL-seeded uuid must survive
// the wait; after it, an empty set is real and the seed is stale.
let everLoaded = false;
effect(() => {
  const filtered = data.filteredPhotos.get();
  if (data.photos.get().length > 0) everLoaded = true;
  if (!everLoaded) return;
  // A deep link widens the filters a beat later, so a seed that isn't in the
  // filtered set yet isn't stale — just early. `pending()` reads a signal, so
  // this re-runs once the link is acted on either way.
  if (deepLink.pending()) return;

  const cur = selectedPhotoUuid.get();

  // A displaced photo coming back outranks whatever was auto-selected in its
  // place. Without this the replacement usually survives the widening and the
  // memory would never pay out — flicking a solo toggle off and on has to
  // return you to where you were.
  const back = filtered.find((p) => p.uuid === droppedUuid);
  if (back !== undefined) {
    droppedUuid = null;
    if (back.uuid !== cur) pick(back.uuid);
    return;
  }

  if (cur !== null && filtered.some((p) => p.uuid === cur)) return;
  if (cur !== null) droppedUuid = cur;
  if (filtered.length === 0) {
    selectedPhotoUuid.set(null);
    return;
  }
  pick(filtered[0]!.uuid);
});

export default {
  selectedPhotoUuid,
  autoSelectCount,
  popupRevealed,
  getPhoto,
  getPhotoIndex,
  isPopupOpen,
  togglePopup,
  revealPopup,
  selectPhoto,
  next,
  prev
};
