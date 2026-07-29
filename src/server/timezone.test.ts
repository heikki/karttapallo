import { describe, expect, test } from 'bun:test';

import {
  localizeInstant,
  tzNameFromCoords,
  tzOffsetFromCoords,
  tzOffsetFromTzName,
  tzOffsetSecondsAtInstant
} from './timezone';

/** Unix seconds for a UTC wall clock (hour precision), for building test instants. */
const utc = (y: number, mo: number, d: number, h: number): number =>
  Date.UTC(y, mo - 1, d, h, 0, 0) / 1000;

describe('tzNameFromCoords', () => {
  test('returns IANA name for a known coordinate', () => {
    // Helsinki, Finland
    expect(tzNameFromCoords(60.17, 24.94)).toBe('Europe/Helsinki');
  });

  test('uses geo-tz/all dataset (Iceland gets Atlantic/Reykjavik, not Africa/Abidjan)', () => {
    expect(tzNameFromCoords(64.13, -21.94)).toBe('Atlantic/Reykjavik');
  });
});

describe('tzOffsetFromTzName', () => {
  test('returns DST-aware offset for Europe/Helsinki in summer', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', '2024:07:01 12:00:00')).toBe(
      '+03:00'
    );
  });

  test('returns DST-aware offset for Europe/Helsinki in winter', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', '2024:01:15 12:00:00')).toBe(
      '+02:00'
    );
  });

  test('returns +00:00 for UTC', () => {
    expect(tzOffsetFromTzName('UTC', '2024:06:01 12:00:00')).toBe('+00:00');
  });

  test('returns negative offset for western timezones', () => {
    // New York, summer (EDT)
    expect(tzOffsetFromTzName('America/New_York', '2024:07:01 12:00:00')).toBe(
      '-04:00'
    );
  });

  test('handles timezones with non-zero minutes', () => {
    // India is UTC+05:30 year-round
    expect(tzOffsetFromTzName('Asia/Kolkata', '2024:06:01 12:00:00')).toBe(
      '+05:30'
    );
  });

  test('returns null for malformed date string', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', 'not a date')).toBeNull();
  });

  test('returns null for empty date string', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', '')).toBeNull();
  });

  test('returns null for invalid timezone name', () => {
    expect(
      tzOffsetFromTzName('Not/A/Real/Zone', '2024:06:01 12:00:00')
    ).toBeNull();
  });
});

describe('tzOffsetFromCoords', () => {
  test('composes name lookup with offset resolution', () => {
    // Helsinki in winter
    expect(tzOffsetFromCoords(60.17, 24.94, '2024:01:15 12:00:00')).toBe(
      '+02:00'
    );
    // Helsinki in summer (DST)
    expect(tzOffsetFromCoords(60.17, 24.94, '2024:07:01 12:00:00')).toBe(
      '+03:00'
    );
  });

  test('returns null for empty date string', () => {
    expect(tzOffsetFromCoords(60.17, 24.94, '')).toBeNull();
  });
});

describe('tzOffsetSecondsAtInstant', () => {
  test('DST-aware: Helsinki summer instant is +3h', () => {
    // 2024-07-01 09:00 UTC == 12:00 EEST
    expect(
      tzOffsetSecondsAtInstant('Europe/Helsinki', utc(2024, 7, 1, 9))
    ).toBe(10800);
  });

  test('DST-aware: Helsinki winter instant is +2h', () => {
    expect(
      tzOffsetSecondsAtInstant('Europe/Helsinki', utc(2024, 1, 15, 10))
    ).toBe(7200);
  });

  test('negative offset west of UTC (New York winter)', () => {
    expect(
      tzOffsetSecondsAtInstant('America/New_York', utc(2024, 1, 15, 17))
    ).toBe(-18000);
  });

  test('returns 0 for UTC', () => {
    expect(tzOffsetSecondsAtInstant('UTC', utc(2024, 6, 1, 12))).toBe(0);
  });

  test('returns null for invalid timezone name', () => {
    expect(
      tzOffsetSecondsAtInstant('Not/A/Real/Zone', utc(2024, 6, 1, 12))
    ).toBeNull();
  });
});

describe('localizeInstant', () => {
  test('derives wall clock and offset from instant + coords (Helsinki summer)', () => {
    // 2024-07-01 09:00 UTC in Helsinki (+03:00) is 12:00 local.
    expect(localizeInstant(60.17, 24.94, utc(2024, 7, 1, 9))).toEqual({
      date: '2024:07:01 12:00:00',
      tz: '+03:00'
    });
  });

  test('applies DST at the instant, not a fixed offset (Helsinki winter)', () => {
    expect(localizeInstant(60.17, 24.94, utc(2024, 1, 15, 10))).toEqual({
      date: '2024:01:15 12:00:00',
      tz: '+02:00'
    });
  });

  test('handles crossing midnight into the previous UTC day', () => {
    // 2024-07-01 00:00 UTC is 03:00 the same day in Helsinki.
    expect(localizeInstant(60.17, 24.94, utc(2024, 7, 1, 0))).toEqual({
      date: '2024:07:01 03:00:00',
      tz: '+03:00'
    });
  });

  test('western timezone rolls back to the previous day (New York)', () => {
    // 2024-07-01 02:00 UTC is 2024-06-30 22:00 in New York (-04:00 DST).
    expect(localizeInstant(40.71, -74.0, utc(2024, 7, 1, 2))).toEqual({
      date: '2024:06:30 22:00:00',
      tz: '-04:00'
    });
  });

  test('open-ocean coords resolve to a nautical Etc/GMT zone, not null', () => {
    // geo-tz/all covers oceans with nautical Etc/GMT zones; 0,0 is UTC.
    expect(localizeInstant(0, 0, utc(2024, 6, 1, 12))).toEqual({
      date: '2024:06:01 12:00:00',
      tz: '+00:00'
    });
  });
});
