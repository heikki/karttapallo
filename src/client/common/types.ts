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
  /**
   * Horizontal accuracy in metres. A real measurement only where `gps` is
   * `exif`; the other sources carry a placeholder — see `accuracyRing`.
   */
  gps_accuracy: number | null;
  albums: string[];
  /** The search corpus, from Photos' search index — see ItemEntry on the server. */
  place: string[];
  description: string[];
  labels: string[];
  photos_url?: string;
  duration?: string | null;
  filename?: string;
}
