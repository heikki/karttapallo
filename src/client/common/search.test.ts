import { describe, expect, test } from 'bun:test';

import { fold, matchesPrefix, matchesTerm, suggest } from './search';
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
    albums: [],
    place: null,
    description: null,
    labels: [],
    ...overrides
  };
}

describe('fold', () => {
  test('strips diacritics and lowercases, as Photos does', () => {
    expect(fold('Näätämö')).toBe('naatamo');
    expect(fold('Kevät')).toBe('kevat');
    expect(fold('Yö')).toBe('yo');
    expect(fold('Blönduós')).toBe('blonduos');
  });
});

describe('matchesPrefix', () => {
  test('matches on a word prefix', () => {
    expect(matchesPrefix('Kuhmo', 'kuh')).toBe(true);
    expect(matchesPrefix('Kuhmo', 'Kuhmo')).toBe(true);
  });

  test('does not match mid-word, matching Photos prefix indexing', () => {
    expect(matchesPrefix('Kuhmo', 'uhm')).toBe(false);
  });

  test('ignores diacritics in either direction', () => {
    expect(matchesPrefix('Näätämö', 'naa')).toBe(true);
    expect(matchesPrefix('Naatamo', 'nää')).toBe(true);
  });

  test('matches any word, not just the first', () => {
    expect(matchesPrefix('Kemiö ja Karuna', 'kar')).toBe(true);
  });

  test('ANDs multiple query words regardless of order', () => {
    expect(matchesPrefix('Kemiö ja Karuna', 'karuna kemio')).toBe(true);
    expect(matchesPrefix('Kemiö ja Karuna', 'kemio helsinki')).toBe(false);
  });

  test('an empty query matches nothing', () => {
    expect(matchesPrefix('Kuhmo', '')).toBe(false);
    expect(matchesPrefix('Kuhmo', '   ')).toBe(false);
  });
});

describe('matchesTerm', () => {
  test('matches a term held in any searchable field', () => {
    expect(matchesTerm(photo({ place: 'Kuhmo' }), 'Kuhmo')).toBe(true);
    expect(matchesTerm(photo({ description: 'Käki' }), 'Käki')).toBe(true);
    expect(matchesTerm(photo({ labels: ['Lintu'] }), 'Lintu')).toBe(true);
    expect(matchesTerm(photo({ place: 'Kuhmo' }), 'Inari')).toBe(false);
  });

  test('is exact — a term is an applied token, not a prefix', () => {
    expect(matchesTerm(photo({ place: 'Kuhmo' }), 'Kuh')).toBe(false);
  });

  test('an empty term is no filter at all', () => {
    expect(matchesTerm(photo(), '')).toBe(true);
  });

  test('tolerates items from a snapshot predating these fields', () => {
    const { place, description, ...stale } = photo();
    void place;
    void description;
    expect(matchesTerm(stale as Photo, 'Kuhmo')).toBe(false);
  });
});

describe('suggest', () => {
  const photos = [
    photo({ uuid: 'a', place: 'Kuhmo' }),
    photo({ uuid: 'b', place: 'Kuhmo' }),
    photo({ uuid: 'c', place: 'Kuusamo' }),
    photo({ uuid: 'd', place: 'Inari', description: 'Käki' })
  ];

  test('groups by term and counts photos', () => {
    expect(suggest(photos, 'ku')).toEqual([
      { term: 'Kuhmo', field: 'place', count: 2 },
      { term: 'Kuusamo', field: 'place', count: 1 }
    ]);
  });

  test('orders by count, then alphabetically', () => {
    const terms = suggest(photos, 'ku').map((s) => s.term);
    expect(terms).toEqual(['Kuhmo', 'Kuusamo']);
  });

  test('suggests descriptions alongside places', () => {
    expect(suggest(photos, 'kak')).toEqual([
      { term: 'Käki', field: 'description', count: 1 }
    ]);
  });

  test('returns nothing for a blank query', () => {
    expect(suggest(photos, '')).toEqual([]);
    expect(suggest(photos, '  ')).toEqual([]);
  });

  test('honours the limit', () => {
    expect(suggest(photos, 'k', 1)).toHaveLength(1);
  });

  // Places run to hundreds of photos each while descriptions are ones and twos.
  // A global count sort buried every description behind a full page of places.
  test('does not let high-count places crowd out descriptions', () => {
    // Every place must outrank the description on count — that alone is what
    // buried descriptions, and a fixture relying on term order wouldn't show
    // it, since localeCompare ranks `Käki` before `Kaupunki1` anyway.
    const crowded = [
      ...Array.from({ length: 9 }, (_, i) => [
        photo({ uuid: `k${i}a`, place: `Kaupunki${i}` }),
        photo({ uuid: `k${i}b`, place: `Kaupunki${i}` })
      ]).flat(),
      photo({ uuid: 'd', description: 'Käki' })
    ];

    const terms = suggest(crowded, 'ka').map((s) => s.term);
    expect(terms).toContain('Käki');
  });

  // The UI emits a heading whenever the field changes, so an interleaved
  // result would render Places → Descriptions → Places.
  test('groups all of one field before the next', () => {
    const mixed = [
      photo({ uuid: 'a', place: 'Inari' }),
      photo({ uuid: 'b', place: 'Inari' }),
      photo({ uuid: 'c', place: 'Ivalo', description: 'Ilmakuva' }),
      photo({ uuid: 'd', place: 'Islanti', description: 'Ilmakuva' }),
      photo({ uuid: 'e', place: 'Imatra' })
    ];

    const fields = suggest(mixed, 'i').map((s) => s.field);
    expect(new Set(fields)).toEqual(new Set(['place', 'description']));

    // Each field appears as one contiguous run, so no heading is emitted twice.
    const runs = fields.filter((f, i) => f !== fields[i - 1]);
    expect(runs).toEqual(['place', 'description']);
  });

  // `labels` holds many values per photo, unlike place and description.
  test('suggests scene labels, counting each photo once per label', () => {
    const labelled = [
      photo({ uuid: 'a', labels: ['Lintu', 'Ulkoilma'] }),
      photo({ uuid: 'b', labels: ['Lintu'] }),
      photo({ uuid: 'c', labels: ['Auto'] })
    ];

    expect(suggest(labelled, 'lin')).toEqual([
      { term: 'Lintu', field: 'labels', count: 2 }
    ]);
  });

  test('a field with few matches yields its slots to the other', () => {
    const lopsided = [
      ...Array.from({ length: 6 }, (_, i) =>
        photo({ uuid: `p${i}`, place: `Kaupunki${i}` })
      ),
      photo({ uuid: 'd', place: 'Kaupunki0', description: 'Käki' })
    ];

    // One description exists, so the remaining slots all go to places.
    const result = suggest(lopsided, 'ka', 4);
    expect(result).toHaveLength(4);
    expect(result.filter((s) => s.field === 'place')).toHaveLength(3);
    expect(result.filter((s) => s.field === 'description')).toHaveLength(1);
  });
});
