import { signal } from '@lit-labs/signals';

import * as data from '@common/data';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';
import { urlSignal } from '@common/url-state';

export type InteractionMode = 'idle' | 'placement' | 'measure' | 'route-edit';

export const selectedPhotoUuid = urlSignal<string | null>(
  'id',
  (raw) => raw,
  (v) => v
);
// Captured at module load: the URL-seeded uuid (if any). Used by the
// restoration effect below to decide whether the seed actually points
// at a photo we have, independent of any later user-initiated changes.
const seedUuid = selectedPhotoUuid.get();
export const interactionMode = signal<InteractionMode>('idle');

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
function isPopupOpen(): boolean {
  return (
    selectedPhotoUuid.get() !== null && interactionMode.get() !== 'placement'
  );
}

function selectPhoto(uuid: string): void {
  selectedPhotoUuid.set(uuid);
  // Placement targeted the previous selection.
  if (interactionMode.get() === 'placement') {
    interactionMode.set('idle');
  }
}

function clear(): void {
  selectedPhotoUuid.set(null);
  interactionMode.set('idle');
}

// Close the popup without touching interactionMode — measure and
// route-edit shouldn't exit when the user dismisses the popup.
function closePopup(): void {
  selectedPhotoUuid.set(null);
}

function enterPlacement(): void {
  if (selectedPhotoUuid.get() === null) return;
  interactionMode.set('placement');
}

function next(): boolean {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return false;
  const target = photos[(idx + 1) % photos.length];
  if (target === undefined) return false;
  selectPhoto(target.uuid);
  return true;
}

function prev(): boolean {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return false;
  const target = photos[(idx - 1 + photos.length) % photos.length];
  if (target === undefined) return false;
  selectPhoto(target.uuid);
  return true;
}

function toggleOldestNewest(): void {
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return;
  let oldestIdx = 0;
  let newestIdx = 0;
  for (let i = 1; i < photos.length; i++) {
    if (photos[i]!.date < photos[oldestIdx]!.date) oldestIdx = i;
    if (photos[i]!.date > photos[newestIdx]!.date) newestIdx = i;
  }
  const cur = selectedPhotoUuid.get();
  if (cur === photos[oldestIdx]!.uuid) {
    selectPhoto(photos[newestIdx]!.uuid);
  } else if (cur === photos[newestIdx]!.uuid) {
    selectPhoto(photos[oldestIdx]!.uuid);
  } else if (cur === null) {
    selectPhoto(photos[oldestIdx]!.uuid);
  }
}

let restoredFromUrl = false;
effect(() => {
  const filtered = data.filteredPhotos.get();
  if (!restoredFromUrl) {
    if (seedUuid === null) {
      restoredFromUrl = true;
      return;
    }
    if (filtered.some((p) => p.uuid === seedUuid)) {
      // Signal already seeded from URL — no .set() needed.
      restoredFromUrl = true;
    }
    return;
  }
  const cur = selectedPhotoUuid.get();
  if (cur === null) return;
  if (!filtered.some((p) => p.uuid === cur)) clear();
});

export default {
  selectedPhotoUuid,
  interactionMode,
  getPhoto,
  getPhotoIndex,
  isPopupOpen,
  selectPhoto,
  clear,
  closePopup,
  enterPlacement,
  next,
  prev,
  toggleOldestNewest
};
