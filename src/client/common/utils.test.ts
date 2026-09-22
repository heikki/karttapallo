import { describe, expect, test } from 'bun:test';

import { parseUserDatetime } from './utils';

describe('parseUserDatetime', () => {
  test('reads day, month, year and time', () => {
    expect(parseUserDatetime('6.9.2026 11:16', 2020)).toEqual({
      day: '2026:09:06',
      time: '11:16'
    });
  });

  test('falls back to the given year when none is typed', () => {
    expect(parseUserDatetime('6.9.', 2020)).toEqual({
      day: '2020:09:06',
      time: null
    });
  });

  test('accepts the last day of the month, leap day included', () => {
    expect(parseUserDatetime('31.12.2026 23:59:59', 2020)).not.toBeNull();
    expect(parseUserDatetime('29.2.2024', 2020)).not.toBeNull();
  });

  test.each([
    ['32.1.2026', 'day past the end of the month'],
    ['31.4.2026', 'day past a 30-day month'],
    ['29.2.2026', 'leap day in a common year'],
    ['0.1.2026', 'day zero'],
    ['1.13.2026', 'month thirteen'],
    ['1.0.2026', 'month zero'],
    ['1.1.2026 24:00', 'hour 24'],
    ['1.1.2026 12:60', 'minute 60'],
    ['1.1.2026 12:00:60', 'second 60'],
    ['32.13.2026 99:99', 'everything out of range']
  ])('refuses %s (%s) instead of rolling it over', (input) => {
    expect(parseUserDatetime(input, 2026)).toBeNull();
  });
});
