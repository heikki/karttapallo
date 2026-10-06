export interface Point {
  x: number;
  y: number;
}

/**
 * Where the map centre must move, in canvas pixels, so the ground under
 * `anchor` stays under `anchor` while the zoom goes from `oldZoom` to
 * `newZoom`.
 */
export function centerPxForZoom(
  anchor: Point,
  size: { w: number; h: number },
  oldZoom: number,
  newZoom: number
): [number, number] {
  const scale = 2 ** (newZoom - oldZoom);
  return [
    anchor.x + (size.w / 2 - anchor.x) / scale,
    anchor.y + (size.h / 2 - anchor.y) / scale
  ];
}
