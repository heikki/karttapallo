import { beforeEach, describe, expect, test } from 'bun:test';

import {
  albumOptions,
  cameraOptions,
  filteredPhotos,
  filters,
  photos,
  resetFilters,
  revealPhoto,
  setAlbum,
  setCamera,
  setYear,
  soloGps,
  soloMedia,
  toggleGps,
  toggleMedia
} from './data';
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
    albums: ['Helsinki'],
    ...overrides
  };
}

async function flush() {
  await Promise.resolve();
}

beforeEach(async () => {
  photos.set([]);
  resetFilters();
  await flush();
});

describe('filteredPhotos', () => {
  test('returns all photos with default filters', () => {
    photos.set([photo({ uuid: 'a' }), photo({ uuid: 'b', gps: 'user' })]);
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['a', 'b']);
  });

  test('excludes gps=null photos when "none" is not in the gps filter', () => {
    photos.set([photo({ uuid: 'a' }), photo({ uuid: 'b', gps: null })]);
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['a']);
  });

  test('includes gps=null photos when "none" is added', () => {
    photos.set([photo({ uuid: 'a' }), photo({ uuid: 'b', gps: null })]);
    toggleGps('none');
    expect(
      filteredPhotos
        .get()
        .map((p) => p.uuid)
        .sort()
    ).toEqual(['a', 'b']);
  });

  test('filters videos out when soloGps is irrelevant — media filter wins', () => {
    photos.set([
      photo({ uuid: 'a', type: 'photo' }),
      photo({ uuid: 'b', type: 'video' })
    ]);
    soloMedia('photo');
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['a']);
  });

  test('year filter narrows by getYear()', () => {
    photos.set([
      photo({ uuid: 'a', date: '2023:01:01 00:00:00' }),
      photo({ uuid: 'b', date: '2024:01:01 00:00:00' })
    ]);
    setYear('2024');
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['b']);
  });

  test('album filter narrows by membership', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Helsinki'] }),
      photo({ uuid: 'b', albums: ['Tampere'] })
    ]);
    setAlbum('Tampere');
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['b']);
  });

  test('album filter treats empty albums as "(no album)"', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Helsinki'] }),
      photo({ uuid: 'b', albums: [] })
    ]);
    setAlbum('(no album)');
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['b']);
  });

  test('camera filter treats null camera as "(unknown)"', () => {
    photos.set([
      photo({ uuid: 'a', camera: 'iPhone 15' }),
      photo({ uuid: 'b', camera: null })
    ]);
    setCamera('(unknown)');
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['b']);
  });

  test('empty gps array filters everything out', () => {
    photos.set([photo()]);
    toggleGps('exif');
    toggleGps('inferred');
    toggleGps('user');
    expect(filteredPhotos.get()).toHaveLength(0);
  });
});

describe('option cascades', () => {
  test('albumOptions are sorted unique album names from the year-filtered set', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Tampere', 'Lahti'] }),
      photo({ uuid: 'b', albums: ['Helsinki'] }),
      photo({ uuid: 'c', albums: ['Helsinki'] })
    ]);
    expect(albumOptions.get()).toEqual(['Helsinki', 'Lahti', 'Tampere']);
  });

  test('albumOptions narrow when year is set', () => {
    photos.set([
      photo({
        uuid: 'a',
        date: '2023:01:01 00:00:00',
        albums: ['Old']
      }),
      photo({
        uuid: 'b',
        date: '2024:01:01 00:00:00',
        albums: ['New']
      })
    ]);
    setYear('2024');
    expect(albumOptions.get()).toEqual(['New']);
  });

  test('cameraOptions narrow when album is set', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Helsinki'], camera: 'iPhone' }),
      photo({ uuid: 'b', albums: ['Tampere'], camera: 'Sony' })
    ]);
    setAlbum('Helsinki');
    expect(cameraOptions.get()).toEqual(['iPhone']);
  });

  test('albumOptions includes "(no album)" when albumless photos exist', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Helsinki'] }),
      photo({ uuid: 'b', albums: [] })
    ]);
    expect(albumOptions.get()).toEqual(['(no album)', 'Helsinki']);
  });

  test('albumOptions excludes "(no album)" when every photo has an album', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Helsinki'] }),
      photo({ uuid: 'b', albums: ['Tampere'] })
    ]);
    expect(albumOptions.get()).toEqual(['Helsinki', 'Tampere']);
  });

  test('cameraOptions narrow to albumless photos when album is "(no album)"', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Helsinki'], camera: 'iPhone' }),
      photo({ uuid: 'b', albums: [], camera: 'Sony' })
    ]);
    setAlbum('(no album)');
    expect(cameraOptions.get()).toEqual(['Sony']);
  });
});

describe('cascade on verb', () => {
  test('setYear clears album that no longer exists in the new year', () => {
    photos.set([
      photo({
        uuid: 'a',
        date: '2023:01:01 00:00:00',
        albums: ['Old']
      }),
      photo({
        uuid: 'b',
        date: '2024:01:01 00:00:00',
        albums: ['New']
      })
    ]);
    setAlbum('Old');
    expect(filters.get().album).toBe('Old');
    setYear('2024');
    expect(filters.get().album).toBe('all');
  });

  test('setAlbum clears camera that no longer exists in the new album', () => {
    photos.set([
      photo({ uuid: 'a', albums: ['Helsinki'], camera: 'iPhone' }),
      photo({ uuid: 'b', albums: ['Tampere'], camera: 'Sony' })
    ]);
    setCamera('Sony');
    expect(filters.get().camera).toBe('Sony');
    setAlbum('Helsinki');
    expect(filters.get().camera).toBe('all');
  });
});

describe('verbs', () => {
  test('toggleGps adds and removes the value', () => {
    toggleGps('none');
    expect(filters.get().gps).toContain('none');
    toggleGps('none');
    expect(filters.get().gps).not.toContain('none');
  });

  test('soloGps swaps to single value, then restores defaults on second call', () => {
    soloGps('user');
    expect(filters.get().gps).toEqual(['user']);
    soloGps('user');
    expect(filters.get().gps.sort()).toEqual(['exif', 'inferred', 'user']);
  });

  test('toggleMedia removes and re-adds the value', () => {
    toggleMedia('video');
    expect(filters.get().media).toEqual(['photo']);
    toggleMedia('video');
    expect(filters.get().media.sort()).toEqual(['photo', 'video']);
  });

  test('revealPhoto exposes a photo the default GPS filter hides', () => {
    const target = photo({ uuid: 'lost', gps: null, lat: null, lon: null });
    photos.set([photo({ uuid: 'a' }), target]);
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['a']);

    revealPhoto(target);
    expect(filteredPhotos.get().map((p) => p.uuid)).toContain('lost');
  });

  test('revealPhoto widens every filter that hides the photo', () => {
    const target = photo({
      uuid: 'target',
      type: 'video',
      gps: null,
      date: '2019:07:14 13:22:00',
      camera: 'Canon EOS',
      albums: ['Iceland']
    });
    photos.set([photo({ uuid: 'a' }), target]);
    setYear('2024');
    setAlbum('Helsinki');
    setCamera('iPhone 15');
    soloMedia('photo');
    soloGps('exif');

    revealPhoto(target);
    expect(filteredPhotos.get().map((p) => p.uuid)).toContain('target');
  });

  test('revealPhoto leaves filters the photo already passes alone', () => {
    const target = photo({ uuid: 'target', albums: ['Helsinki'] });
    photos.set([target, photo({ uuid: 'other', albums: ['Iceland'] })]);
    setAlbum('Helsinki');
    soloGps('exif');

    revealPhoto(target);
    const f = filters.get();
    expect(f.album).toBe('Helsinki');
    expect(f.gps).toEqual(['exif']);
    expect(filteredPhotos.get().map((p) => p.uuid)).toEqual(['target']);
  });

  test('resetFilters returns every field to its default', () => {
    setYear('2024');
    setAlbum('Helsinki');
    soloGps('user');
    soloMedia('video');
    resetFilters();
    const f = filters.get();
    expect(f.year).toBe('all');
    expect(f.album).toBe('all');
    expect(f.camera).toBe('all');
    expect(f.gps.sort()).toEqual(['exif', 'inferred', 'user']);
    expect(f.media.sort()).toEqual(['photo', 'video']);
  });
});
