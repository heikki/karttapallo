import { describe, expect, test } from 'bun:test';

import { centerPxForZoom } from './zoom-math';

const size = { w: 800, h: 600 };

describe('centerPxForZoom', () => {
  test('leaves the centre alone when the zoom does not change', () => {
    expect(centerPxForZoom({ x: 100, y: 50 }, size, 5, 5)).toEqual([400, 300]);
  });

  test('zooming around the centre keeps the centre', () => {
    expect(centerPxForZoom({ x: 400, y: 300 }, size, 5, 6)).toEqual([400, 300]);
  });

  test('zooming in moves the centre toward the anchor', () => {
    expect(centerPxForZoom({ x: 0, y: 0 }, size, 5, 6)).toEqual([200, 150]);
  });

  test('zooming out moves the centre away from the anchor', () => {
    expect(centerPxForZoom({ x: 0, y: 0 }, size, 5, 4)).toEqual([800, 600]);
  });
});
