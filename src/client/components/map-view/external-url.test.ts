import { describe, expect, test } from 'bun:test';

import { externalMapUrl } from './external-url';

const photo = { lat: 60.1700000004, lon: 24.94, zoom: 11.4, pin: true };
const view = { lat: -33.8567844, lon: 151.2152967, zoom: 3.6, pin: false };

describe('externalMapUrl', () => {
  test('pins a photo in Apple Maps', () => {
    expect(externalMapUrl('apple', photo)).toBe(
      'maps://?ll=60.17,24.94&q=60.17,24.94&z=12&t=k'
    );
  });

  test('centres Apple Maps on a view without a pin', () => {
    expect(externalMapUrl('apple', view)).toBe(
      'maps://?ll=-33.856784,151.215297&z=5&t=k'
    );
  });

  test('pins a photo in Google Maps, in satellite', () => {
    expect(externalMapUrl('google', photo)).toBe(
      'https://www.google.com/maps/place/60.17,24.94/@60.17,24.94,12z/data=!3m1!1e3'
    );
  });

  test('centres Google Maps on a view, in satellite', () => {
    expect(externalMapUrl('google', view)).toBe(
      'https://www.google.com/maps/@?api=1&map_action=map&center=-33.856784,151.215297&zoom=5&basemap=satellite'
    );
  });
});
