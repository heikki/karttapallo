import { describe, expect, test } from 'bun:test';

import { buildDateTimeScript } from './photos-edit';

/**
 * Run the emitted script's date assignments against a starting "today".
 *
 * AppleScript's date object re-normalises after every component assignment,
 * exactly as JS Date setters do (setting month to February while the day is
 * the 29th of a non-leap year yields 1 March in both). Modelling it here lets
 * these tests assert the date the script actually produces rather than the
 * order its lines happen to appear in.
 */
function evalScript(script: string, today: Date): Date {
  const d = new Date(today);
  for (const line of script.split('\n')) {
    const m = /^set (?<part>\w+) of d to (?<value>\d+)$/.exec(line);
    if (m?.groups === undefined) continue;
    const v = parseInt(m.groups.value!, 10);
    switch (m.groups.part) {
      case 'year':
        d.setFullYear(v);
        break;
      case 'month':
        d.setMonth(v - 1);
        break;
      case 'day':
        d.setDate(v);
        break;
      case 'hours':
        d.setHours(v);
        break;
      case 'minutes':
        d.setMinutes(v);
        break;
      case 'seconds':
        d.setSeconds(v);
        break;
      default:
        throw new Error(`unmodelled assignment: ${line}`);
    }
  }
  return d;
}

const wallClock = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
  `${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:` +
  `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

describe('buildDateTimeScript', () => {
  test('produces the requested date regardless of what day it is run', () => {
    const script = buildDateTimeScript('UUID', '2015-02-04', '20:34:12');
    // Every day of a 31-day month, including the ones past the end of the
    // target month — where a stale day-of-month would roll the date forward.
    for (let day = 1; day <= 31; day++) {
      const today = new Date(2026, 6, day, 13, 45, 30);
      expect(wallClock(evalScript(script, today))).toBe('2015-02-04 20:34:12');
    }
  });

  test('sets a leap day from a non-leap year', () => {
    const script = buildDateTimeScript('UUID', '2016-02-29', '00:00:00');
    const today = new Date(2026, 6, 29, 13, 45, 30);
    expect(wallClock(evalScript(script, today))).toBe('2016-02-29 00:00:00');
  });

  test('targets the given asset', () => {
    const script = buildDateTimeScript('ABC-123', '2015-02-04', '20:34:12');
    expect(script).toContain(
      'tell application "Photos" to set the date of media item id "ABC-123" to d'
    );
  });

  test('builds the date from components, never a locale-parsed string', () => {
    const script = buildDateTimeScript('UUID', '2015-02-04', '20:34:12');
    expect(script).not.toContain('date "');
  });
});
