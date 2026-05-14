import { computed, signal } from '@lit-labs/signals';

import { effect } from './signals';

export type Mode = 'placement' | 'measure' | 'route-edit';

interface ModeDef {
  onEnter: () => void;
  onExit: () => void;
  /** Return false to refuse the transition; current stays unchanged. */
  canEnter?: () => boolean;
}

const _current = signal<Mode | null>(null);
const _defs = new Map<Mode, ModeDef>();
let _entered: Mode | null = null;

export const current = computed(() => _current.get());

export function defineMode(name: Mode, def: ModeDef): void {
  _defs.set(name, def);
  // Catch up if current was set before defineMode ran (deep-link race).
  if (_current.get() === name && _entered !== name) {
    _entered = name;
    def.onEnter();
  }
}

export function enter(name: Mode): boolean {
  if (_current.get() === name) return true;
  if (_defs.get(name)?.canEnter?.() === false) return false;
  _current.set(name);
  return true;
}

export function exit(): void {
  _current.set(null);
}

export function toggle(name: Mode): void {
  if (_current.get() === name) exit();
  else enter(name);
}

// Single edge watcher; replaces the per-feature copies.
effect(() => {
  const next = _current.get();
  if (next === _entered) return;
  if (_entered !== null) _defs.get(_entered)?.onExit();
  if (next === null) {
    _entered = null;
    return;
  }
  const def = _defs.get(next);
  if (def === undefined) {
    // Feature not mounted yet; defineMode's catch-up will fire onEnter.
    _entered = null;
    return;
  }
  _entered = next;
  def.onEnter();
});
