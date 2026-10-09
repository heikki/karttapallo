export interface ExternalView {
  lat: number;
  lon: number;
  /** MapLibre zoom of the map as it stands. */
  zoom: number;
  /** Drop a pin at the point rather than only centring on it. */
  pin: boolean;
}

/**
 * Where Apple Maps or Google Maps should open to show the same thing this
 * map does, in satellite view.
 */
export function externalMapUrl(
  target: 'apple' | 'google',
  { lat, lon, zoom, pin }: ExternalView
) {
  // About 10 cm, and it keeps float noise out of the URL.
  const at = `${Number(lat.toFixed(6))},${Number(lon.toFixed(6))}`;
  // MapLibre counts zoom on 512px tiles; both of these count on 256px ones.
  const z = Math.round(zoom) + 1;

  if (target === 'apple') {
    // `q` is what drops the pin, and Maps then settles on a close zoom of its
    // own whatever else the link says: `z` is ignored outright, and a `spn`
    // span is honoured for a moment before the search result overrides it. A
    // label in `q` searches for the label instead. So pinned means Maps' zoom.
    return pin
      ? `maps://?ll=${at}&q=${at}&z=${z}&t=k`
      : `maps://?ll=${at}&z=${z}&t=k`;
  }
  // Google's documented URLs can't pin and show satellite at once, so the
  // pinned form leans on the `data` flag its own site writes for satellite.
  return pin
    ? `https://www.google.com/maps/place/${at}/@${at},${z}z/data=!3m1!1e3`
    : `https://www.google.com/maps/@?api=1&map_action=map&center=${at}&zoom=${z}&basemap=satellite`;
}
