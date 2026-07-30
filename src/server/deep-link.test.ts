import { describe, expect, test } from 'bun:test';

import { deepLinkViewUrl, parseDeepLink } from './deep-link';

const UUID = 'A1B2C3D4-5E6F-4071-8A9B-0C1D2E3F4A5B';

describe('parseDeepLink', () => {
  test('reads the uuid from id, case intact', () => {
    expect(parseDeepLink(`karttapallo://photo?id=${UUID}`)).toEqual({
      uuid: UUID
    });
  });

  test('rejects other schemes', () => {
    expect(parseDeepLink(`https://example.com/photo?id=${UUID}`)).toBeNull();
    expect(parseDeepLink(`photos://asset?id=${UUID}`)).toBeNull();
  });

  test('rejects a link with no id', () => {
    expect(parseDeepLink('karttapallo://')).toBeNull();
    expect(parseDeepLink(`karttapallo://photo/${UUID}`)).toBeNull();
    expect(parseDeepLink('karttapallo://photo?id=')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
  });

  // The uuid is interpolated into a query string, so anything that could add
  // a second param or escape the value has to be turned away at the door.
  test('rejects a uuid carrying query-string metacharacters', () => {
    expect(parseDeepLink('karttapallo://photo?id=abc%26style=evil')).toBeNull();
    expect(parseDeepLink('karttapallo://photo?id=../../etc')).toBeNull();
  });
});

describe('deepLinkViewUrl', () => {
  test('selects the photo and flags it as a deep link', () => {
    expect(deepLinkViewUrl('http://127.0.0.1:5000', UUID)).toBe(
      `http://127.0.0.1:5000?id=${UUID}&focus=1`
    );
  });

  test('carries style and markers over, but not filters or map position', () => {
    const url = deepLinkViewUrl('http://127.0.0.1:5000', UUID, {
      style: 'mml_topo',
      markers: 'points',
      year: '2019',
      album: 'Iceland',
      lat: '64.1',
      lon: '-21.9',
      z: '12'
    });
    const params = new URLSearchParams(new URL(url).search);
    expect([...params.keys()].sort()).toEqual([
      'focus',
      'id',
      'markers',
      'style'
    ]);
    expect(params.get('style')).toBe('mml_topo');
    expect(params.get('markers')).toBe('points');
  });
});
