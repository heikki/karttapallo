import { describe, expect, test } from 'bun:test';

import { searchableText } from './db';

// Built from explicit combining marks rather than pasted literals, so the
// assertion cannot be silently defeated by an editor normalizing the source.
const COMBINING_DIAERESIS = '̈';
const COMBINING_ACUTE = '́';

describe('searchableText', () => {
  test('composes decomposed Nordic place names to NFC', () => {
    // How Photos stores them: base letter + combining mark. Typed input is
    // composed, so an un-normalized value would never match (ADR-0014).
    const d = COMBINING_DIAERESIS;
    const decomposed = `Na${d}a${d}ta${d}mo${d}`;

    expect(decomposed).not.toBe('Näätämö');
    expect(decomposed.length).toBe(11);
    expect(searchableText(decomposed)).toBe('Näätämö');
  });

  test('composes a mix of diaeresis and acute', () => {
    const decomposed = `Blo${COMBINING_DIAERESIS}nduo${COMBINING_ACUTE}s`;

    expect(decomposed).not.toBe('Blönduós');
    expect(searchableText(decomposed)).toBe('Blönduós');
  });

  test('leaves already-composed text untouched', () => {
    expect(searchableText('Sevettijärvi')).toBe('Sevettijärvi');
  });

  test('treats blank and whitespace-only values as absent', () => {
    expect(searchableText(null)).toBeNull();
    expect(searchableText('')).toBeNull();
    expect(searchableText('   ')).toBeNull();
  });

  test('trims surrounding whitespace', () => {
    expect(searchableText('  Kuhmo \n')).toBe('Kuhmo');
  });
});
