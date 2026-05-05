/**
 * Tier 4 smoke test: load libkarttakuvat.dylib and exercise a non-mutating
 * AppleScript via the FFI bridge. Skipped automatically off macOS so CI on
 * other platforms passes; runs on the macOS CI job and locally.
 *
 * Requires `bun run build:native` to have produced the dylib.
 */

import { describe, expect, test } from 'bun:test';

const isDarwin = process.platform === 'darwin';

describe.if(isDarwin)('native-bridge smoke (darwin only)', () => {
  test('dylib loads and runAppleScript executes a non-mutating script', async () => {
    const mod = await import('./native-bridge');
    expect(() => {
      mod.runAppleScript('return 1');
    }).not.toThrow();
  });

  test('resizeToJpeg returns false for a missing input file', async () => {
    const mod = await import('./native-bridge');
    expect(
      mod.resizeToJpeg('/nonexistent-source.heic', '/tmp/none.jpg', 100)
    ).toBe(false);
  });
});
