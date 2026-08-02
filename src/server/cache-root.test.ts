import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { claimCacheRoot } from './cache-root';

let tmp = '';
let root = '';

const LIB_A = '/Volumes/Disk/A.photoslibrary';
const LIB_B = '/Volumes/Disk/B.photoslibrary';

/** Put something derived-looking in the root so a wipe is observable. */
function seed(contents = 'derived') {
  mkdirSync(join(root, 'cache', 'full'), { recursive: true });
  writeFileSync(join(root, 'items.json'), contents);
  writeFileSync(join(root, 'cache', 'full', 'x.jpg'), contents);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'karttapallo-cache-root-'));
  root = join(tmp, 'derived');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('claimCacheRoot', () => {
  test('creates the root when it does not exist yet', () => {
    claimCacheRoot(root, LIB_A);
    expect(existsSync(root)).toBe(true);
  });

  test('keeps derived data when the same library claims it again', () => {
    claimCacheRoot(root, LIB_A);
    seed();

    claimCacheRoot(root, LIB_A);

    expect(existsSync(join(root, 'items.json'))).toBe(true);
    expect(existsSync(join(root, 'cache', 'full', 'x.jpg'))).toBe(true);
  });

  test('empties the root when a different library claims it', () => {
    claimCacheRoot(root, LIB_A);
    seed();

    claimCacheRoot(root, LIB_B);

    expect(existsSync(join(root, 'items.json'))).toBe(false);
    expect(existsSync(join(root, 'cache'))).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  // Data left by a build that predates ownership stamping, or by a partial
  // write. Nothing identifies it, so it cannot be trusted to belong here.
  test('empties an unstamped root', () => {
    mkdirSync(root, { recursive: true });
    seed();

    claimCacheRoot(root, LIB_A);

    expect(existsSync(join(root, 'items.json'))).toBe(false);
  });

  test('empties a root whose owner record is malformed', () => {
    claimCacheRoot(root, LIB_A);
    seed();
    writeFileSync(join(root, 'owner.json'), '{ not json');

    claimCacheRoot(root, LIB_A);

    expect(existsSync(join(root, 'items.json'))).toBe(false);
  });

  test('the claim survives a round trip, so a restart is not a wipe', () => {
    claimCacheRoot(root, LIB_A);
    claimCacheRoot(root, LIB_A);
    seed();
    claimCacheRoot(root, LIB_A);

    expect(existsSync(join(root, 'items.json'))).toBe(true);
  });

  // Two libraries whose paths share a prefix must not be confused for one
  // another — the comparison is the whole path, not a prefix of it.
  test('distinguishes libraries whose paths share a prefix', () => {
    claimCacheRoot(root, LIB_A);
    seed();

    claimCacheRoot(root, `${LIB_A}/nested.photoslibrary`);

    expect(existsSync(join(root, 'items.json'))).toBe(false);
  });

  test('returns the root it claimed', () => {
    expect(claimCacheRoot(root, LIB_A)).toBe(root);
  });
});
