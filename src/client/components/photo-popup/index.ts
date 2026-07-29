import { signal, SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import * as actions from '@common/actions';
import * as edits from '@common/edits';
import * as interactionMode from '@common/interaction-mode';
import type { Photo } from '@common/types';
import {
  computeDateOffsetHours,
  computeFullDatetimeOffsetHours,
  editableDateStr,
  formatCoords,
  formatDate,
  getThumbUrl,
  isVideo,
  parseExifDate,
  parseUserDatetime
} from '@common/utils';

// Module-level copy buffers shared across popup mounts. Signals so that
// paste-button visibility reacts the moment the user copies.
const copiedLocation = signal<{ lat: number; lon: number } | null>(null);
const copiedDate = signal<string | null>(null);

function computeManualDateOffset(
  originalDate: string,
  parsed: { day: string; time: string | null }
): number | null {
  if (parsed.time === null) {
    return computeDateOffsetHours(originalDate, parsed.day);
  }
  const timeParts = parsed.time.split(':').map(Number);
  const dayParts = parsed.day.split(':');
  const target = new Date(
    parseInt(dayParts[0]!, 10),
    parseInt(dayParts[1]!, 10) - 1,
    parseInt(dayParts[2]!, 10),
    timeParts[0] ?? 0,
    timeParts[1] ?? 0,
    timeParts[2] ?? 0
  );
  return computeFullDatetimeOffsetHours(originalDate, target);
}

@customElement('photo-popup')
export class PhotoPopup extends SignalWatcher(LitElement) {
  @property({ attribute: false }) photo: Photo | null = null;
  @property({ type: Number }) index = 0;

  // Date edit mode is local UI state. Auto-clears when the photo changes
  // or a save starts (see updated() and firstUpdated() below). Escape inside
  // the input clears it directly; Escape elsewhere routes through
  // closeDateEdit() called by <map-popup>.
  @state() private _dateEditMode = false;
  private _lastSeenUuid: string | null = null;

  static override styles = css`
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    :host {
      display: block;
    }
    .photo-popup {
      text-align: center;
      min-width: 280px;
    }
    .photo-popup img {
      max-width: 100%;
      max-height: 220px;
    }
    .info {
      margin: 8px 12px;
      font-size: 12px;
      color: #666;
    }
    .popup-image-wrap {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #111;
      min-height: 160px;
    }
    .video-indicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, calc(-50% + 5px));
      width: 48px;
      height: 48px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 50%;
      pointer-events: none;
    }
    .video-indicator::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 54%;
      transform: translate(-50%, -50%);
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 10px 0 10px 18px;
      border-color: transparent transparent transparent white;
    }
    .overlay-buttons {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 4px;
      z-index: 5;
    }
    .overlay-btn {
      width: 28px;
      height: 28px;
      background: rgba(0, 0, 0, 0.5);
      border: none;
      outline: none;
      border-radius: 6px;
      cursor: pointer;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 16px;
      display: block;
      text-decoration: none;
    }
    .overlay-btn:hover {
      background-color: rgba(0, 0, 0, 0.75);
    }
    .photos-btn {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/%3E%3Cpolyline points='15 3 21 3 21 9'/%3E%3Cline x1='10' y1='14' x2='21' y2='3'/%3E%3C/svg%3E");
    }
    .info-btn {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='16' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12.01' y2='8'/%3E%3C/svg%3E");
    }
    .action-buttons {
      display: inline-flex;
      gap: 2px;
      margin-left: 4px;
      vertical-align: middle;
    }
    .action-btn {
      padding: 1px 5px;
      font-size: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #f5f5f5;
      color: #666;
      cursor: pointer;
      line-height: 1.2;
    }
    .action-btn:hover {
      background: #e0e0e0;
      border-color: #bbb;
    }
    .date-edit-row {
      display: flex;
      gap: 4px;
      margin-top: 4px;
      align-items: center;
    }
    .date-input {
      flex: 1;
      padding: 2px 6px;
      font-size: 11px;
      border: 1px solid #ddd;
      border-radius: 4px;
      min-width: 0;
    }
    .date-input:focus {
      outline: none;
      border-color: #007aff;
    }
  `;

  private _onImgClick() {
    actions.showLightbox(this.index);
  }

  private _onInfoClick(e: Event) {
    e.stopPropagation();
    if (this.photo !== null) actions.showMetadata(this.photo.uuid);
  }

  private _onPlacement(e: Event) {
    e.preventDefault();
    if (this.photo !== null) interactionMode.enter('placement');
  }

  private _copyLocation() {
    const photo = this.photo;
    if (photo === null) return;
    const loc = edits.getEffectiveLocation(photo);
    if (loc === null) return;
    copiedLocation.set({ lat: loc.lat, lon: loc.lon });
  }

  private _pasteLocation() {
    const photo = this.photo;
    const copied = copiedLocation.get();
    if (photo === null || copied === null) return;
    edits.setCoord(photo.uuid, copied.lat, copied.lon);
  }

  private _confirmLocation() {
    const photo = this.photo;
    if (photo === null) return;
    const loc = edits.getEffectiveLocation(photo);
    if (loc === null) return;
    edits.setCoord(photo.uuid, loc.lat, loc.lon);
    actions.saveEdits();
  }

  private _copyDate() {
    const photo = this.photo;
    if (photo === null) return;
    const effectiveDate = edits.getEffectiveDate(photo);
    if (effectiveDate === '') return;
    copiedDate.set(effectiveDate);
  }

  private _pasteDate() {
    const photo = this.photo;
    if (photo === null) return;
    const copied = copiedDate.get();
    if (copied === null) return;
    const parsed = parseExifDate(copied);
    if (parsed === null) return;
    const offset = computeFullDatetimeOffsetHours(photo.date, parsed);
    if (offset === null) return;
    edits.setTimeOffset(photo.uuid, offset);
  }

  private _adjustTime(hours: number) {
    const photo = this.photo;
    if (photo === null) return;
    edits.addTimeOffset(photo.uuid, hours);
  }

  private _toggleDateEdit() {
    this._dateEditMode = !this._dateEditMode;
  }

  private _applyManualDate() {
    const input = this.shadowRoot?.getElementById(
      'date-input'
    ) as HTMLInputElement | null;
    if (input === null) return;
    const value = input.value;
    const photo = this.photo;
    if (photo === null) return;
    if (value.trim() === '') return;
    const yearStr = photo.date.split(':')[0];
    const fallbackYear =
      yearStr !== undefined && yearStr !== ''
        ? parseInt(yearStr, 10)
        : new Date().getFullYear();
    const parsed = parseUserDatetime(value, fallbackYear);
    if (parsed === null) return;
    const offset = computeManualDateOffset(photo.date, parsed);
    if (offset === null) return;
    // Clear edit mode before the signal write so the next render sees
    // the read-only date row.
    this._dateEditMode = false;
    edits.setTimeOffset(photo.uuid, offset);
  }

  /**
   * Called by `<map-popup>`'s document keydown handler so it can give
   * date-edit Escape priority over closing the popup. Returns true if
   * the key was consumed.
   */
  closeDateEdit() {
    if (!this._dateEditMode) return false;
    this._dateEditMode = false;
    return true;
  }

  private _onDateInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this._applyManualDate();
    } else if (e.key === 'Escape') {
      this._dateEditMode = false;
    }
    // Stop all keydown propagation so external handlers (arrow nav, spacebar)
    // don't intercept keys meant for this input.
    e.stopPropagation();
  }

  override firstUpdated() {
    // "Save to Photos" flushes the pending edits and reloads the photos under
    // the still-open popup, so an open date-edit row would be editing state
    // that no longer exists. Drop it the moment a save starts.
    this.updateEffect(() => {
      const saving = edits.saving.get();
      if (saving) this._dateEditMode = false;
    });
  }

  override updated(changed: Map<string, unknown>) {
    const uuid = this.photo?.uuid ?? null;
    if (uuid !== this._lastSeenUuid) {
      if (this._lastSeenUuid !== null) this._dateEditMode = false;
      this._lastSeenUuid = uuid;
      // Keep an open metadata modal on the photo the popup now shows.
      if (uuid !== null) actions.refreshMetadata(uuid);
    }
    if (changed.has('_dateEditMode') && this._dateEditMode) {
      const input = this.shadowRoot?.getElementById(
        'date-input'
      ) as HTMLInputElement | null;
      input?.focus();
    }
  }

  private _renderDateLine() {
    const photo = this.photo!;
    const effectiveDate = edits.getEffectiveDate(photo);
    const dateText = formatDate(effectiveDate, photo.tz);
    const copied = copiedDate.get();
    const showPasteDate =
      copied !== null && effectiveDate !== '' && effectiveDate !== copied;

    if (this._dateEditMode) {
      const inputVal = editableDateStr(effectiveDate);
      return html`
        ${dateText}
        <span class="action-buttons" role="group" aria-label="Date actions">
          <button
            class="action-btn"
            @click=${() => {
              this._adjustTime(-24);
            }}
          >
            -1d
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this._adjustTime(24);
            }}
          >
            +1d
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this._adjustTime(-1);
            }}
          >
            -1h
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this._adjustTime(1);
            }}
          >
            +1h
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this._toggleDateEdit();
            }}
          >
            done
          </button>
        </span>
        <div class="date-edit-row">
          <input
            class="date-input"
            type="text"
            .value=${inputVal}
            id="date-input"
            @keydown=${(e: KeyboardEvent) => {
              this._onDateInputKey(e);
            }}
            @mousedown=${(e: Event) => {
              e.stopPropagation();
            }}
            @mousemove=${(e: Event) => {
              e.stopPropagation();
            }}
            @mouseup=${(e: Event) => {
              e.stopPropagation();
            }}
          />
          <button
            class="action-btn"
            @click=${() => {
              this._applyManualDate();
            }}
          >
            OK
          </button>
        </div>
      `;
    }

    return html`
      ${dateText}
      <span class="action-buttons" role="group" aria-label="Date actions">
        <button
          class="action-btn"
          @click=${() => {
            this._copyDate();
          }}
        >
          copy
        </button>
        <button
          class="action-btn"
          @click=${() => {
            this._pasteDate();
          }}
          style=${showPasteDate ? '' : 'display:none'}
        >
          paste
        </button>
        <button
          class="action-btn"
          @click=${() => {
            this._toggleDateEdit();
          }}
        >
          edit
        </button>
      </span>
    `;
  }

  private _renderLocationLine() {
    const photo = this.photo!;
    const loc = edits.getEffectiveLocation(photo);
    const copied = copiedLocation.get();
    const showPasteLocation =
      copied !== null && (copied.lat !== loc?.lat || copied.lon !== loc.lon);

    return html`
      ${formatCoords(loc)}
      <span class="action-buttons" role="group" aria-label="Location actions">
        <button
          class="action-btn"
          @click=${(e: Event) => {
            this._onPlacement(e);
          }}
        >
          set
        </button>
        ${loc !== null && photo.gps === 'inferred'
          ? html`<button
              class="action-btn"
              @click=${() => {
                this._confirmLocation();
              }}
            >
              confirm
            </button>`
          : nothing}
        ${loc === null
          ? nothing
          : html`<button
              class="action-btn"
              @click=${() => {
                this._copyLocation();
              }}
            >
              copy
            </button>`}
        <button
          class="action-btn"
          @click=${() => {
            this._pasteLocation();
          }}
          style=${showPasteLocation ? '' : 'display:none'}
        >
          paste
        </button>
      </span>
    `;
  }

  override render() {
    if (this.photo === null) return nothing;
    const photo = this.photo;

    return html`
      <div class="photo-popup">
        <div class="popup-image-wrap">
          <img
            src=${getThumbUrl(photo)}
            alt="Photo"
            @click=${() => {
              this._onImgClick();
            }}
          />
          ${isVideo(photo)
            ? html`<div class="video-indicator"></div>`
            : nothing}
          <div class="overlay-buttons">
            <button
              class="overlay-btn info-btn"
              @click=${(e: Event) => {
                this._onInfoClick(e);
              }}
              tabindex="-1"
            ></button>
            ${photo.photos_url !== undefined && photo.photos_url !== ''
              ? html`<a
                  class="overlay-btn photos-btn"
                  href=${photo.photos_url}
                  target="_blank"
                  tabindex="-1"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                  }}
                ></a>`
              : nothing}
          </div>
        </div>
        <div class="info">
          ${this._renderDateLine()}<br />
          ${this._renderLocationLine()}
        </div>
      </div>
    `;
  }
}
