import type { Map as MapGL } from 'maplibre-gl';

export interface Photo {
  uuid: string;
  type: 'photo' | 'video';
  full: string;
  thumb: string;
  lat: number | null;
  lon: number | null;
  date: string;
  tz: string | null;
  camera: string | null;
  gps: string | null;
  albums: string[];
  place: string | null;
  description: string | null;
  labels: string[];
  photos_url?: string;
  duration?: string | null;
  filename?: string;
}

export interface MarkerLayer {
  readonly id: string;
  install: (map: MapGL, beforeId: string) => void;
  uninstall: () => void;
  setView: (view: {
    photos: Photo[];
    selectedPhoto: Photo | null;
    hidden: boolean;
  }) => void;
  markerRadius: (zoom: number) => number;
}
