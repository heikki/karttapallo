import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state as litState } from 'lit/decorators.js';

import * as actions from '@common/actions';
import * as data from '@common/data';
import * as edits from '@common/edits';
import { HAS_MML } from '@common/features';
import selection from '@common/selection';
import { filtersFromUrl, filtersToUrl, resetUrl } from '@common/url-state';
import { getYear, isVideo } from '@common/utils';
import { viewState } from '@common/view-state';

import './album-controls';

import {
  cascade,
  DEFAULT_GPS,
  DEFAULT_MEDIA,
  renderFilterBtns,
  renderSelect,
  renderStyleBtns
} from './helpers';
import { styles } from './styles';

const panelStyles = css`
  :host {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1000;
    width: 220px;
  }
`;

@customElement('filter-panel')
export class FilterPanel extends SignalWatcher(LitElement) {
  @litState() private _year = 'all';
  @litState() private _album = 'all';
  @litState() private _camera = 'all';
  @litState() private _gps: string[] = [...DEFAULT_GPS];
  @litState() private _media: string[] = [...DEFAULT_MEDIA];
  @litState() private _collapsed = false;

  private _initialized = false;
  private _gpsClickTimer: ReturnType<typeof setTimeout> | null = null;
  private _mediaClickTimer: ReturnType<typeof setTimeout> | null = null;

  static override styles = [styles, panelStyles];

  override connectedCallback() {
    super.connectedCallback();
    this._restoreFromUrl();
  }

  override updated() {
    if (!this._initialized && data.photos.get().length > 0) {
      this._initialized = true;
      this._applyFilters();
    }
  }

  private _restoreFromUrl() {
    const saved = filtersFromUrl();
    if (saved === null) return;
    if (saved.year !== undefined) this._year = saved.year;
    if (saved.album !== undefined) this._album = saved.album;
    if (saved.camera !== undefined) this._camera = saved.camera;
    if (saved.gps !== undefined) this._gps = saved.gps;
    if (saved.media !== undefined) this._media = saved.media;
  }

  private _applyFilters() {
    const result = cascade(data.photos.get(), {
      year: this._year,
      album: this._album,
      camera: this._camera
    });
    this._album = result.album;
    this._camera = result.camera;
    data.filters.set({
      year: this._year,
      gps: this._gps,
      media: this._media,
      album: this._album,
      camera: this._camera
    });
    filtersToUrl({
      year: this._year,
      album: this._album,
      camera: this._camera,
      gps: this._gps,
      media: this._media
    });
  }

  private readonly _onYearChange = (e: Event) => {
    this._year = (e.target as HTMLSelectElement).value;
    this._applyFilters();
  };

  private readonly _onAlbumChange = (e: Event) => {
    this._album = (e.target as HTMLSelectElement).value;
    this._applyFilters();
  };

  private readonly _onCameraChange = (e: Event) => {
    this._camera = (e.target as HTMLSelectElement).value;
    this._applyFilters();
  };

  private _onGpsClick(value: string) {
    if (this._gpsClickTimer !== null) return;
    this._gpsClickTimer = setTimeout(() => {
      this._gpsClickTimer = null;
      this._gps = this._gps.includes(value)
        ? this._gps.filter((v) => v !== value)
        : [...this._gps, value];
      this._applyFilters();
    }, 250);
  }

  private _onMediaClick(value: string) {
    if (this._mediaClickTimer !== null) return;
    this._mediaClickTimer = setTimeout(() => {
      this._mediaClickTimer = null;
      this._media = this._media.includes(value)
        ? this._media.filter((v) => v !== value)
        : [...this._media, value];
      this._applyFilters();
    }, 250);
  }

  private _onGpsDblClick(value: string) {
    if (this._gpsClickTimer !== null) {
      clearTimeout(this._gpsClickTimer);
      this._gpsClickTimer = null;
    }
    const solo = this._gps.length === 1 && this._gps[0] === value;
    this._gps = solo ? [...DEFAULT_GPS] : [value];
    this._applyFilters();
  }

  private _onMediaDblClick(value: string) {
    if (this._mediaClickTimer !== null) {
      clearTimeout(this._mediaClickTimer);
      this._mediaClickTimer = null;
    }
    const solo = this._media.length === 1 && this._media[0] === value;
    this._media = solo ? [...DEFAULT_MEDIA] : [value];
    this._applyFilters();
  }

  private _onReset() {
    this._year = 'all';
    this._album = 'all';
    this._camera = 'all';
    this._gps = [...DEFAULT_GPS];
    this._media = [...DEFAULT_MEDIA];
    data.filters.set({
      year: this._year,
      gps: this._gps,
      media: this._media,
      album: this._album,
      camera: this._camera
    });
    resetUrl();
    actions.resetMap();
  }

  private static _renderStats() {
    const filtered = data.filteredPhotos.get();
    if (filtered.length === 0) return 'No results';
    const pc = filtered.filter((p) => !isVideo(p)).length;
    const vc = filtered.filter((p) => isVideo(p)).length;
    if (pc > 0 && vc > 0) return `${pc} photos, ${vc} videos`;
    return vc > 0 ? `${vc} videos` : `${pc} photos`;
  }

  override render() {
    const allPhotos = data.photos.get();
    const years = [
      ...new Set(allPhotos.map(getYear).filter((y): y is string => y !== null))
    ].sort();
    const { albumOptions, cameraOptions } = cascade(allPhotos, {
      year: this._year,
      album: this._album,
      camera: this._camera
    });
    const editCount = edits.editCount.get();
    const isSaving = edits.saving.get();
    return html`
      <div class="wrapper">
        <div
          class="panel-header"
          @click=${() => {
            this._collapsed = !this._collapsed;
          }}
        >
          <h2>Karttakuvat</h2>
          <p>${FilterPanel._renderStats()}</p>
        </div>
        ${this._collapsed
          ? nothing
          : html`
              <div class="panel-body">
                ${renderSelect('Year', years, this._year, this._onYearChange)}
                ${renderSelect(
                  'Album',
                  albumOptions,
                  this._album,
                  this._onAlbumChange
                )}
                ${renderSelect(
                  'Camera',
                  cameraOptions,
                  this._camera,
                  this._onCameraChange
                )}
                <label>Media</label>
                ${renderFilterBtns(
                  this._media,
                  [
                    { value: 'photo', label: 'Photos' },
                    { value: 'video', label: 'Videos' }
                  ],
                  (v) => {
                    this._onMediaClick(v);
                  },
                  (v) => {
                    this._onMediaDblClick(v);
                  }
                )}
                <label>Location</label>
                ${renderFilterBtns(
                  this._gps,
                  [
                    { value: 'exif', label: 'Exif', color: '#3b82f6' },
                    { value: 'inferred', label: 'Inferred', color: '#f59e0b' },
                    { value: 'user', label: 'User', color: '#22c55e' },
                    { value: 'none', label: 'None', color: '#9ca3af' }
                  ],
                  (v) => {
                    this._onGpsClick(v);
                  },
                  (v) => {
                    this._onGpsDblClick(v);
                  }
                )}
                <label>Map</label>
                ${renderStyleBtns(
                  [
                    { style: 'satellite', label: 'Aerial' },
                    { style: 'topo', label: 'Topo' },
                    ...(HAS_MML
                      ? [
                          { style: 'mml_maastokartta', label: 'Maasto' },
                          { style: 'mml_ortokuva', label: 'Orto' }
                        ]
                      : [])
                  ],
                  viewState.mapStyle.get(),
                  (s) => {
                    viewState.mapStyle.set(s);
                  }
                )}
                <label>Markers</label>
                ${renderStyleBtns(
                  [
                    { style: 'classic', label: 'Classic' },
                    { style: 'points', label: 'Points' }
                  ],
                  viewState.markerStyle.get(),
                  (s) => {
                    viewState.markerStyle.set(s);
                  }
                )}
                <div class="view-buttons">
                  <button
                    class="view-btn"
                    @click=${() => {
                      actions.fitToPhotos(true, true);
                    }}
                  >
                    Fit
                  </button>
                  <button
                    class="view-btn"
                    @click=${() => {
                      this._onReset();
                    }}
                  >
                    Reset
                  </button>
                  <button
                    class="view-btn ${selection.interactionMode.get() ===
                    'measure'
                      ? 'active'
                      : ''}"
                    @click=${() => {
                      actions.toggleMeasure();
                    }}
                  >
                    Measure
                  </button>
                </div>
                <album-controls .album=${this._album}></album-controls>
                <div class="view-buttons">
                  <button
                    class="view-btn"
                    @click=${() => {
                      actions.openExternalMap('apple');
                    }}
                  >
                    Apple Maps
                  </button>
                  <button
                    class="view-btn"
                    @click=${() => {
                      actions.openExternalMap('google');
                    }}
                  >
                    Google Maps
                  </button>
                </div>
                ${editCount > 0
                  ? html` <div class="edit-section">
                      <span class="count">${editCount}</span> pending edits
                      <div class="edit-buttons">
                        <button
                          ?disabled=${isSaving}
                          @click=${() => {
                            actions.saveEdits();
                          }}
                        >
                          ${isSaving ? 'Saving...' : 'Save to Photos'}
                        </button>
                        <button
                          class="secondary"
                          @click=${() => {
                            edits.clear();
                          }}
                        >
                          Discard
                        </button>
                      </div>
                    </div>`
                  : nothing}
              </div>
            `}
      </div>
    `;
  }
}
