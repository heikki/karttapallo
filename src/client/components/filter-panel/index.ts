import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state as litState } from 'lit/decorators.js';

import * as actions from '@common/actions';
import * as data from '@common/data';
import * as edits from '@common/edits';
import { HAS_MML } from '@common/features';
import * as interactionMode from '@common/interaction-mode';
import { resetUrl } from '@common/url-state';
import { getYear, isVideo } from '@common/utils';
import { viewState } from '@common/view-state';

import './album-controls';

import { renderFilterBtns, renderSelect, renderStyleBtns } from './helpers';
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

function onYearChange(e: Event): void {
  data.setYear((e.target as HTMLSelectElement).value);
}

function onAlbumChange(e: Event): void {
  data.setAlbum((e.target as HTMLSelectElement).value);
}

function onCameraChange(e: Event): void {
  data.setCamera((e.target as HTMLSelectElement).value);
}

function onReset(): void {
  data.resetFilters();
  resetUrl();
  actions.resetMap();
}

@customElement('filter-panel')
export class FilterPanel extends SignalWatcher(LitElement) {
  @litState() private _collapsed = false;

  // 250ms timer separates a single click (toggle) from a double click (solo).
  private _gpsClickTimer: ReturnType<typeof setTimeout> | null = null;
  private _mediaClickTimer: ReturnType<typeof setTimeout> | null = null;

  static override styles = [styles, panelStyles];

  private _onGpsClick(value: string) {
    if (this._gpsClickTimer !== null) return;
    this._gpsClickTimer = setTimeout(() => {
      this._gpsClickTimer = null;
      data.toggleGps(value);
    }, 250);
  }

  private _onMediaClick(value: string) {
    if (this._mediaClickTimer !== null) return;
    this._mediaClickTimer = setTimeout(() => {
      this._mediaClickTimer = null;
      data.toggleMedia(value);
    }, 250);
  }

  private _onGpsDblClick(value: string) {
    if (this._gpsClickTimer !== null) {
      clearTimeout(this._gpsClickTimer);
      this._gpsClickTimer = null;
    }
    data.soloGps(value);
  }

  private _onMediaDblClick(value: string) {
    if (this._mediaClickTimer !== null) {
      clearTimeout(this._mediaClickTimer);
      this._mediaClickTimer = null;
    }
    data.soloMedia(value);
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
    const f = data.filters.get();
    const albumOpts = data.albumOptions.get();
    const cameraOpts = data.cameraOptions.get();
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
                ${renderSelect('Year', years, f.year, onYearChange)}
                ${renderSelect('Album', albumOpts, f.album, onAlbumChange)}
                ${renderSelect('Camera', cameraOpts, f.camera, onCameraChange)}
                <label>Media</label>
                ${renderFilterBtns(
                  f.media,
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
                  f.gps,
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
                  <button class="view-btn" @click=${onReset}>Reset</button>
                  <button
                    class="view-btn ${interactionMode.current.get() ===
                    'measure'
                      ? 'active'
                      : ''}"
                    @click=${() => {
                      interactionMode.toggle('measure');
                    }}
                  >
                    Measure
                  </button>
                </div>
                <album-controls .album=${f.album}></album-controls>
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
