import { beforeEach, describe, expect, test } from 'bun:test';

import * as data from './data';
import * as interactionMode from './interaction-mode';
import selection from './selection';
import type { Photo } from './types';

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    uuid: 'p1',
    type: 'photo',
    full: 'full/p1.jpg',
    thumb: 'thumb/p1.jpg',
    lat: 60.17,
    lon: 24.94,
    date: '2024:06:01 12:00:00',
    tz: '+03:00',
    camera: 'iPhone 15',
    gps: 'exif',
    gps_accuracy: 5,
    albums: ['Helsinki'],
    place: [],
    description: [],
    labels: [],
    ...overrides
  };
}

function noop() {
  /* no-op */
}

async function flush() {
  await Promise.resolve();
}

beforeEach(async () => {
  // `selectPhoto` is the only public way to forget a dropped selection, so
  // the throwaway select below resets that memory between tests.
  selection.selectPhoto('reset');
  selection.selectedPhotoUuid.set(null);
  data.photos.set([]);
  data.resetFilters();
  interactionMode.exit();
  interactionMode.defineMode('placement', { onEnter: noop, onExit: noop });
  interactionMode.defineMode('measure', { onEnter: noop, onExit: noop });
  interactionMode.defineMode('route-edit', { onEnter: noop, onExit: noop });
  await flush();
});

describe('selectPhoto', () => {
  test('selectPhoto stores the uuid', () => {
    selection.selectPhoto('p1');
    expect(selection.selectedPhotoUuid.get()).toBe('p1');
  });

  test('selectPhoto exits placement mode if active', async () => {
    interactionMode.enter('placement');
    await flush();
    selection.selectPhoto('p1');
    await flush();
    expect(interactionMode.current.get()).toBe(null);
  });

  test('selectPhoto leaves measure mode untouched', async () => {
    data.photos.set([photo({ uuid: 'p1' })]);
    await flush();
    interactionMode.enter('measure');
    await flush();
    selection.selectPhoto('p1');
    await flush();
    expect(interactionMode.current.get()).toBe('measure');
  });
});

describe('selectNewest', () => {
  test('selects the last photo of the filtered set', async () => {
    data.photos.set([
      photo({ uuid: 'old', date: '2023:01:01 00:00:00' }),
      photo({ uuid: 'new', date: '2025:12:01 00:00:00' })
    ]);
    await flush();
    selection.selectPhoto('old');
    selection.selectNewest();
    expect(selection.selectedPhotoUuid.get()).toBe('new');
  });

  test('leaves the selection alone when the filters match nothing', () => {
    selection.selectPhoto('p1');
    selection.selectNewest();
    expect(selection.selectedPhotoUuid.get()).toBe('p1');
  });
});

describe('isPopupOpen', () => {
  test('returns false when nothing is selected', () => {
    expect(selection.isPopupOpen()).toBe(false);
  });

  test('returns true when a photo is selected and mode is idle', () => {
    selection.selectPhoto('p1');
    expect(selection.isPopupOpen()).toBe(true);
  });

  test('returns true when in measure mode (does not block popup)', async () => {
    data.photos.set([photo({ uuid: 'p1' })]);
    await flush();
    selection.selectPhoto('p1');
    interactionMode.enter('measure');
    await flush();
    expect(selection.isPopupOpen()).toBe(true);
  });

  test('returns false when in placement mode', async () => {
    data.photos.set([photo({ uuid: 'p1' })]);
    selection.selectPhoto('p1');
    interactionMode.enter('placement');
    await flush();
    expect(selection.isPopupOpen()).toBe(false);
  });
});

describe('togglePopup', () => {
  // `beforeEach`'s throwaway `selectPhoto` reveals the popup, so every test
  // here starts from the revealed state without a reset of its own.
  const photos = [
    photo({ uuid: 'old', date: '2023:01:01 00:00:00' }),
    photo({ uuid: 'mid', date: '2024:06:01 00:00:00', albums: ['Tampere'] }),
    photo({ uuid: 'new', date: '2025:12:01 00:00:00' })
  ];

  test('hides the popup and reveals it again', () => {
    selection.selectPhoto('p1');
    selection.togglePopup();
    expect(selection.popupRevealed.get()).toBe(false);
    selection.togglePopup();
    expect(selection.popupRevealed.get()).toBe(true);
  });

  test('leaves the selection and isPopupOpen alone while hidden', () => {
    selection.selectPhoto('p1');
    selection.togglePopup();
    expect(selection.selectedPhotoUuid.get()).toBe('p1');
    expect(selection.isPopupOpen()).toBe(true);
  });

  test('revealPopup reveals a hidden popup', () => {
    selection.selectPhoto('p1');
    selection.togglePopup();
    selection.revealPopup();
    expect(selection.popupRevealed.get()).toBe(true);
  });

  test('a user selection reveals the popup', () => {
    selection.selectPhoto('p1');
    selection.togglePopup();
    selection.selectPhoto('p2');
    expect(selection.popupRevealed.get()).toBe(true);
  });

  test('an auto-select reveals the popup', async () => {
    data.photos.set([...photos]);
    await flush();
    selection.selectPhoto('new');
    await flush();
    selection.togglePopup();
    data.setAlbum('Tampere');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('mid');
    expect(selection.popupRevealed.get()).toBe(true);
  });

  test('surviving a filter change does not reveal the popup', async () => {
    data.photos.set([...photos]);
    await flush();
    selection.selectPhoto('mid');
    await flush();
    selection.togglePopup();
    data.setAlbum('Tampere');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('mid');
    expect(selection.popupRevealed.get()).toBe(false);
  });

  test('entering and leaving placement does not reveal the popup', async () => {
    data.photos.set([photo({ uuid: 'p1' })]);
    await flush();
    selection.selectPhoto('p1');
    selection.togglePopup();
    interactionMode.enter('placement');
    await flush();
    interactionMode.exit();
    await flush();
    expect(selection.popupRevealed.get()).toBe(false);
  });
});

describe('getPhoto / getPhotoIndex', () => {
  test('getPhoto returns the photo when present in filtered set', () => {
    data.photos.set([photo({ uuid: 'a' }), photo({ uuid: 'b' })]);
    selection.selectPhoto('b');
    expect(selection.getPhoto()?.uuid).toBe('b');
  });

  test('getPhoto returns undefined when nothing is selected', () => {
    expect(selection.getPhoto()).toBeUndefined();
  });

  test('getPhotoIndex returns the index in filteredPhotos', () => {
    data.photos.set([photo({ uuid: 'a' }), photo({ uuid: 'b' })]);
    selection.selectPhoto('b');
    expect(selection.getPhotoIndex()).toBe(1);
  });

  test('getPhotoIndex returns null when uuid is not in filtered set', () => {
    data.photos.set([photo({ uuid: 'a' })]);
    selection.selectPhoto('missing');
    expect(selection.getPhotoIndex()).toBe(null);
  });
});

describe('next / prev navigation', () => {
  test('next moves to the following photo and wraps around', () => {
    data.photos.set([
      photo({ uuid: 'a', date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', date: '2024:02:01 00:00:00' }),
      photo({ uuid: 'c', date: '2024:03:01 00:00:00' })
    ]);
    selection.selectPhoto('a');
    selection.next();
    expect(selection.selectedPhotoUuid.get()).toBe('b');
    selection.next();
    expect(selection.selectedPhotoUuid.get()).toBe('c');
    selection.next();
    expect(selection.selectedPhotoUuid.get()).toBe('a');
  });

  test('prev moves backward and wraps around', () => {
    data.photos.set([
      photo({ uuid: 'a', date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', date: '2024:02:01 00:00:00' })
    ]);
    selection.selectPhoto('a');
    selection.prev();
    expect(selection.selectedPhotoUuid.get()).toBe('b');
    selection.prev();
    expect(selection.selectedPhotoUuid.get()).toBe('a');
  });

  test('next/prev return false when nothing is selected', () => {
    expect(selection.next()).toBe(false);
    expect(selection.prev()).toBe(false);
  });
});

describe('enterAlbum', () => {
  const trip = [
    photo({ uuid: 'trip-1', date: '2024:06:01 00:00:00', albums: ['Tampere'] }),
    photo({ uuid: 'trip-2', date: '2024:06:02 00:00:00', albums: ['Tampere'] }),
    photo({ uuid: 'other', date: '2025:01:01 00:00:00' })
  ];

  test("jumps to the album's first photo", async () => {
    data.photos.set([...trip]);
    await flush();
    data.setAlbum('Tampere');
    selection.enterAlbum();
    expect(selection.selectedPhotoUuid.get()).toBe('trip-1');
  });

  test('jumps even from a photo already in the album', async () => {
    data.photos.set([...trip]);
    await flush();
    selection.selectPhoto('trip-2');
    data.setAlbum('Tampere');
    selection.enterAlbum();
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('trip-1');
  });

  test('fits the camera, since the app chose', async () => {
    data.photos.set([...trip]);
    await flush();
    const before = selection.autoSelectCount.get();
    data.setAlbum('Tampere');
    selection.enterAlbum();
    expect(selection.autoSelectCount.get()).toBe(before + 1);
  });

  test('leaving the album returns to the photo you came in on', async () => {
    data.photos.set([...trip]);
    await flush();
    selection.selectPhoto('other');
    data.setAlbum('Tampere');
    selection.enterAlbum();
    await flush();
    data.setAlbum('all');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('other');
  });

  test('does nothing for the all-albums option', async () => {
    data.photos.set([...trip]);
    await flush();
    selection.selectPhoto('trip-2');
    data.setAlbum('all');
    selection.enterAlbum();
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('trip-2');
  });
});

describe('the selection invariant', () => {
  const photos = [
    photo({ uuid: 'old', date: '2023:01:01 00:00:00' }),
    photo({ uuid: 'mid', date: '2024:06:01 00:00:00', albums: ['Tampere'] }),
    photo({ uuid: 'new', date: '2025:12:01 00:00:00' })
  ];

  test('auto-selects the newest once photos load', async () => {
    data.photos.set([...photos]);
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('new');
  });

  test('picks the newest when a non-album filter drops the selection', async () => {
    data.photos.set([
      photo({ uuid: 'a', date: '2024:01:01 00:00:00' }),
      photo({ uuid: 'b', date: '2024:02:01 00:00:00' }),
      photo({ uuid: 'c', date: '2025:01:01 00:00:00' })
    ]);
    await flush();
    data.setYear('2024');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('b');
  });

  test('auto-selects when a filter drops the selected photo', async () => {
    data.photos.set([...photos]);
    await flush();
    selection.selectPhoto('new');
    await flush();
    data.setAlbum('Tampere');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('mid');
  });

  test('keeps a selection that survives the filter change', async () => {
    data.photos.set([...photos]);
    await flush();
    selection.selectPhoto('mid');
    await flush();
    data.setAlbum('Tampere');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('mid');
  });

  test('is null only when the filters match nothing', async () => {
    // The default Location filter excludes `none`, so a library of unplaced
    // photos filters down to nothing.
    data.photos.set([photo({ uuid: 'unplaced', gps: 'none' })]);
    await flush();
    expect(data.filteredPhotos.get()).toHaveLength(0);
    expect(selection.selectedPhotoUuid.get()).toBe(null);
  });

  test('restores the dropped photo when it comes back', async () => {
    data.photos.set([...photos]);
    await flush();
    selection.selectPhoto('new');
    await flush();
    data.setAlbum('Tampere');
    await flush();
    data.setAlbum('all');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('new');
  });

  test('a user selection forgets the dropped photo', async () => {
    data.photos.set([...photos]);
    await flush();
    selection.selectPhoto('new');
    await flush();
    data.setAlbum('Tampere');
    await flush();
    selection.selectPhoto('mid');
    data.setAlbum('all');
    await flush();
    expect(selection.selectedPhotoUuid.get()).toBe('mid');
  });

  test('counts auto-selects but not user selections', async () => {
    data.photos.set([...photos]);
    await flush();
    const afterLoad = selection.autoSelectCount.get();
    selection.selectPhoto('new');
    await flush();
    expect(selection.autoSelectCount.get()).toBe(afterLoad);
    data.setAlbum('Tampere');
    await flush();
    expect(selection.autoSelectCount.get()).toBe(afterLoad + 1);
  });
});
