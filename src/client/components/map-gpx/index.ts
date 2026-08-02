import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { customElement } from 'lit/decorators.js';
import type { GeoJSONSource, LayerSpecification } from 'maplibre-gl';

import * as data from '@common/data';
import { effect } from '@common/signals';
import { MapFeatureElement } from '@components/map-view/api';

const LAYERS: LayerSpecification[] = [
  {
    id: 'gpx-track-outline',
    type: 'line',
    source: 'gpx-tracks',
    paint: { 'line-color': 'rgba(0, 0, 0, 0.4)', 'line-width': 6 },
    layout: {
      'visibility': 'visible',
      'line-cap': 'round',
      'line-join': 'round'
    }
  },
  {
    id: 'gpx-track-line',
    type: 'line',
    source: 'gpx-tracks',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 3,
      'line-opacity': 0.85
    },
    layout: {
      'visibility': 'visible',
      'line-cap': 'round',
      'line-join': 'round'
    }
  },
  {
    id: 'gpx-waypoint-circles',
    type: 'circle',
    source: 'gpx-waypoints',
    paint: {
      'circle-radius': 5,
      'circle-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-stroke-color': ['get', 'color']
    },
    layout: { visibility: 'visible' }
  },
  {
    id: 'gpx-waypoint-labels',
    type: 'symbol',
    source: 'gpx-waypoints',
    layout: {
      'visibility': 'visible',
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-optional': true
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0, 0, 0, 0.7)',
      'text-halo-width': 1.5
    }
  }
];

// Album color palette
const TRACK_COLORS = [
  '#ff6b6b',
  '#4ecdc4',
  '#ffe66d',
  '#a29bfe',
  '#fd79a8',
  '#00cec9',
  '#fab1a0',
  '#81ecec'
];

function extractTrackPoints(trk: Element): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  for (const pt of Array.from(trk.querySelectorAll('trkpt'))) {
    const lat = parseFloat(pt.getAttribute('lat') ?? '');
    const lon = parseFloat(pt.getAttribute('lon') ?? '');
    if (isNaN(lat) || isNaN(lon)) continue;
    coords.push([lon, lat]);
  }
  return coords;
}

@customElement('map-gpx')
export class MapGpx extends MapFeatureElement {
  private currentAlbum: string | null = null;
  private trackFeatures: Array<Feature<LineString>> = [];
  private waypointFeatures: Array<Feature<Point>> = [];
  private nextColorIndex = 0;
  // Discriminates concurrent loadGpxForAlbum calls: rapid album switches
  // (A → B → A) must not let the in-flight A fetches push their parsed
  // features into the (now-A again) arrays alongside B's. Each call
  // captures the sequence at entry and only commits results if it's still
  // the latest.
  private loadSeq = 0;

  override firstUpdated() {
    this.addLayers();
    effect(() => {
      const album = data.filters.get().album;
      void this.loadGpxForAlbum(album === 'all' ? null : album);
    });
  }

  /** Force-reload GPX tracks for the current album. */
  reloadTracks() {
    const album = this.currentAlbum;
    this.currentAlbum = null; // reset cache so loadGpxForAlbum re-fetches
    void this.loadGpxForAlbum(album);
  }

  private addLayers() {
    const map = this.api.map;
    map.addSource('gpx-tracks', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: this.trackFeatures }
    });
    map.addSource('gpx-waypoints', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: this.waypointFeatures }
    });
    for (const spec of LAYERS) map.addLayer(spec);
  }

  private async loadGpxForAlbum(album: string | null) {
    if (album === this.currentAlbum) return;
    this.currentAlbum = album;
    const seq = ++this.loadSeq;

    const tracks: Array<Feature<LineString>> = [];
    const waypoints: Array<Feature<Point>> = [];

    if (album !== null && album !== 'all') {
      try {
        const res = await fetch(
          `/api/albums/${encodeURIComponent(album)}/files`
        );
        if (res.ok) {
          const files = (await res.json()) as Array<{
            name: string;
            visible: boolean;
          }>;
          const gpxFiles = files
            .filter((f) => f.visible && f.name.toLowerCase().endsWith('.gpx'))
            .map((f) => f.name);
          const color =
            TRACK_COLORS[this.nextColorIndex++ % TRACK_COLORS.length]!;
          await Promise.all(
            gpxFiles.map((name) =>
              this.loadGpxFile(
                { album, filename: name, color },
                {
                  tracks,
                  waypoints
                }
              )
            )
          );
        }
      } catch {
        // No files for this album
      }
    }

    if (seq !== this.loadSeq) return;
    this.trackFeatures = tracks;
    this.waypointFeatures = waypoints;
    this.updateSources();
  }

  private async loadGpxFile(
    src: { album: string; filename: string; color: string },
    out: {
      tracks: Array<Feature<LineString>>;
      waypoints: Array<Feature<Point>>;
    }
  ) {
    try {
      const url = `/api/albums/${encodeURIComponent(src.album)}/files/${encodeURIComponent(src.filename)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const xml = await res.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      this.parseTracks(doc, src.color, out.tracks);
      this.parseWaypoints(doc, src.color, out.waypoints);
    } catch {
      // skip unparseable files
    }
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure parser, doesn't need instance state
  private parseTracks(
    doc: Document,
    color: string,
    out: Array<Feature<LineString>>
  ) {
    const tracks = Array.from(doc.querySelectorAll('trk'));
    for (const trk of tracks) {
      const coords = extractTrackPoints(trk);
      if (coords.length < 2) continue;
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { color }
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure parser, doesn't need instance state
  private parseWaypoints(
    doc: Document,
    color: string,
    out: Array<Feature<Point>>
  ) {
    const wpts = Array.from(doc.querySelectorAll('wpt'));
    for (const wpt of wpts) {
      const lat = parseFloat(wpt.getAttribute('lat') ?? '');
      const lon = parseFloat(wpt.getAttribute('lon') ?? '');
      if (isNaN(lat) || isNaN(lon)) continue;
      const name = wpt.querySelector('name')?.textContent ?? '';
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { name, color }
      });
    }
  }

  private updateSources() {
    const trackSrc = this.api.map.getSource<GeoJSONSource>('gpx-tracks');
    if (trackSrc !== undefined) {
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: this.trackFeatures
      };
      trackSrc.setData(fc);
    }

    const wptSrc = this.api.map.getSource<GeoJSONSource>('gpx-waypoints');
    if (wptSrc !== undefined) {
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: this.waypointFeatures
      };
      wptSrc.setData(fc);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-gpx': MapGpx;
  }
}
