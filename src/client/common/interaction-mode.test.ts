import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { current, defineMode, enter, exit, toggle } from './interaction-mode';

const flush = async (): Promise<void> => {
  await Promise.resolve();
};

const noop = (): void => undefined;
const newSpy = (): ReturnType<typeof mock<() => void>> => mock(noop);

interface ModeSpies {
  onEnter: ReturnType<typeof mock<() => void>>;
  onExit: ReturnType<typeof mock<() => void>>;
}

const newSpies = (): ModeSpies => ({ onEnter: newSpy(), onExit: newSpy() });

let placement: ModeSpies = newSpies();
let measure: ModeSpies = newSpies();
let canEnterPlacement = mock<() => boolean>(() => true);

beforeEach(async () => {
  placement = newSpies();
  measure = newSpies();
  canEnterPlacement = mock<() => boolean>(() => true);
  defineMode('placement', {
    onEnter: placement.onEnter,
    onExit: placement.onExit,
    canEnter: () => canEnterPlacement()
  });
  defineMode('measure', {
    onEnter: measure.onEnter,
    onExit: measure.onExit
  });
  // Drain any onExit fired by redefinition catch-up.
  await flush();
  placement.onEnter.mockClear();
  placement.onExit.mockClear();
  measure.onEnter.mockClear();
  measure.onExit.mockClear();
});

afterEach(async () => {
  exit();
  await flush();
});

describe('interaction-mode', () => {
  test('enter fires onEnter once and updates current', async () => {
    const ok = enter('placement');
    await flush();
    expect(ok).toBe(true);
    expect(current.get()).toBe('placement');
    expect(placement.onEnter).toHaveBeenCalledTimes(1);
    expect(placement.onExit).not.toHaveBeenCalled();
  });

  test('exit fires onExit on the active mode', async () => {
    enter('placement');
    await flush();
    exit();
    await flush();
    expect(current.get()).toBe(null);
    expect(placement.onExit).toHaveBeenCalledTimes(1);
  });

  test('switching modes runs prev onExit then next onEnter', async () => {
    enter('placement');
    await flush();
    enter('measure');
    await flush();
    expect(current.get()).toBe('measure');
    expect(placement.onExit).toHaveBeenCalledTimes(1);
    expect(measure.onEnter).toHaveBeenCalledTimes(1);
  });

  test('canEnter returning false blocks the transition', async () => {
    canEnterPlacement.mockImplementation(() => false);
    const ok = enter('placement');
    await flush();
    expect(ok).toBe(false);
    expect(current.get()).toBe(null);
    expect(placement.onEnter).not.toHaveBeenCalled();
  });

  test('entering the active mode is a no-op', async () => {
    enter('placement');
    await flush();
    placement.onEnter.mockClear();
    const ok = enter('placement');
    await flush();
    expect(ok).toBe(true);
    expect(placement.onEnter).not.toHaveBeenCalled();
  });

  test('toggle round-trips active mode', async () => {
    toggle('measure');
    await flush();
    expect(current.get()).toBe('measure');
    toggle('measure');
    await flush();
    expect(current.get()).toBe(null);
    expect(measure.onEnter).toHaveBeenCalledTimes(1);
    expect(measure.onExit).toHaveBeenCalledTimes(1);
  });

  test('exit with no active mode is a no-op', async () => {
    exit();
    await flush();
    expect(current.get()).toBe(null);
    expect(placement.onExit).not.toHaveBeenCalled();
    expect(measure.onExit).not.toHaveBeenCalled();
  });

  test('mode entered before defineMode runs onEnter via catch-up', async () => {
    // Synthetic mode name: bun:test shares module state across files, and
    // sibling unit tests pre-register all three real modes, defeating the
    // "def missing at enter time" precondition.
    const fakeMode = 'fake-test-mode' as 'measure';
    const fake = newSpies();
    enter(fakeMode);
    await flush();
    expect(fake.onEnter).not.toHaveBeenCalled();

    defineMode(fakeMode, { onEnter: fake.onEnter, onExit: fake.onExit });
    expect(fake.onEnter).toHaveBeenCalledTimes(1);
    expect(current.get()).toBe(fakeMode);
  });
});
