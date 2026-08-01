/**
 * Text search over the corpus Karttapallo reads out of the Photos library —
 * moment place names and asset descriptions (ADR-0014).
 *
 * Matching mirrors Photos.app, which indexes a case- and diacritic-folded
 * form of each term with an FTS5 token-prefix index: `kuh` finds `Kuhmo`,
 * `naatamo` finds `Näätämö`, and `uhm` finds nothing.
 *
 * Photos' inflection and synonym expansion (`Nurmikko` → `Ruoho`) is not
 * reproduced here. Those tables live in `psi.sqlite`, which covers a fraction
 * of the library, and they buy little over place names — proper nouns you type
 * as `Kuhmo`, never as `Kuhmossa`.
 */

import type { Photo } from './types';

/** Fields a query is matched against, in suggestion-grouping order. */
export const CORPUS_FIELDS = ['place', 'description', 'labels'] as const;

export type CorpusField = (typeof CORPUS_FIELDS)[number];

export interface Suggestion {
  term: string;
  field: CorpusField;
  count: number;
}

/**
 * Case- and diacritic-folded form, matching Photos' `normalized_string`:
 * `Kevät` → `kevat`, `Yö` → `yo`. Decomposing first turns `ä` into `a` plus a
 * combining mark, so stripping marks leaves the base letter.
 */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function words(value: string): string[] {
  return fold(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');
}

/**
 * True when every word of `query` prefixes some word of `candidate`. Multi-word
 * queries are AND-ed and order-independent, so `karuna kemio` finds
 * `Kemiö ja Karuna`.
 */
export function matchesPrefix(candidate: string, query: string): boolean {
  const terms = words(query);
  if (terms.length === 0) return false;
  const candidateWords = words(candidate);
  return terms.every((t) => candidateWords.some((w) => w.startsWith(t)));
}

/**
 * Every value a photo carries for one field — `labels` holds many, the rest
 * hold at most one.
 *
 * A snapshot written before these fields existed has none of them, so they read
 * `undefined` until the startup rebuild swaps in fresh items.
 */
function fieldValues(photo: Photo, field: CorpusField): string[] {
  // `??` rather than a null check: the field is typed as always present, but a
  // snapshot written before it existed genuinely omits it at runtime.
  const value = photo[field] ?? null;
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** True when `photo` carries `term` verbatim in any searchable field. */
export function matchesTerm(photo: Photo, term: string): boolean {
  if (term === '') return true;
  return CORPUS_FIELDS.some((f) => fieldValues(photo, f).includes(term));
}

/**
 * Terms matching `query`, grouped by field and most photos first within each.
 *
 * Callers pass the whole library, less what the map cannot plot — a search must
 * not be confined to the slice the selects happen to allow. Applying a term
 * clears those selects, so the counts here are exactly what picking one shows.
 *
 * Slots are dealt round-robin across fields rather than by raw count, because
 * the corpora are wildly different sizes: places run to hundreds of photos each
 * while descriptions are ones and twos, so a global count sort buries every
 * description behind eight places. A field with few matches yields its unused
 * slots to the others. Output stays in `CORPUS_FIELDS` order so the UI can emit
 * one heading per group — interleaved fields would repeat them.
 */
export function suggest(
  photos: Photo[],
  query: string,
  limit = 8
): Suggestion[] {
  if (query.trim() === '') return [];

  const counts = new Map<string, Suggestion>();
  for (const photo of photos) {
    for (const field of CORPUS_FIELDS) {
      for (const value of fieldValues(photo, field)) {
        if (!matchesPrefix(value, query)) continue;
        const key = `${field} ${value}`;
        const existing = counts.get(key);
        if (existing === undefined) {
          counts.set(key, { term: value, field, count: 1 });
        } else {
          existing.count += 1;
        }
      }
    }
  }

  const byField = CORPUS_FIELDS.map((field) =>
    [...counts.values()]
      .filter((s) => s.field === field)
      .sort((a, b) =>
        a.count === b.count ? a.term.localeCompare(b.term) : b.count - a.count
      )
  );

  const taken = dealSlots(
    byField.map((g) => g.length),
    limit
  );
  return byField.flatMap((group, i) => group.slice(0, taken[i]));
}

/**
 * Deal `limit` slots round-robin over groups of the given sizes, returning how
 * many each gets. A group that runs out is skipped, so its slots fall to the
 * others rather than going unused.
 */
function dealSlots(sizes: number[], limit: number): number[] {
  const taken = sizes.map(() => 0);
  let total = 0;
  let dealt = true;
  while (dealt && total < limit) {
    dealt = false;
    for (let i = 0; i < sizes.length && total < limit; i++) {
      if (taken[i]! >= sizes[i]!) continue;
      taken[i]! += 1;
      total += 1;
      dealt = true;
    }
  }
  return taken;
}
