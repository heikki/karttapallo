import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import * as actions from '@common/actions';
import * as data from '@common/data';
import * as edits from '@common/edits';
import type { Photo } from '@common/types';
import {
  formatCoords,
  formatDate,
  getFullUrl,
  getVideoUrl,
  isVideo
} from '@common/utils';

function stopPropagation(e: Event) {
  e.stopPropagation();
}

export function showLightbox(index: number): void {
  document.querySelector<PhotoLightbox>('photo-lightbox')?.show(index);
}

@customElement('photo-lightbox')
export class PhotoLightbox extends SignalWatcher(LitElement) {
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) photo: Photo | null = null;
  @property({ type: Number }) currentIndex = 0;
  @property({ type: Number }) totalCount = 0;

  private _hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  private _videoMuted = false;
  private _scale = 1;
  private _tx = 0;
  private _ty = 0;
  private _gestureStartScale = 1;

  show(index: number) {
    this.currentIndex = index;
    const photo = data.filteredPhotos.get()[index];
    if (photo === undefined) return;
    this.photo = photo;
    this.totalCount = data.filteredPhotos.get().length;
    this.active = true;
  }

  hide() {
    this.active = false;
    this.photo = null;
    if (this._hideControlsTimer !== null) {
      clearTimeout(this._hideControlsTimer);
      this._hideControlsTimer = null;
    }
  }

  private _navigate(delta: number) {
    const total = data.filteredPhotos.get().length;
    if (total === 0) return;
    const newIndex = (this.currentIndex + delta + total) % total;
    this.currentIndex = newIndex;
    const photo = data.filteredPhotos.get()[newIndex] ?? null;
    this.photo = photo;
    this.totalCount = total;
    if (photo !== null) actions.refreshMetadata(photo.uuid);
  }

  private _resetTransform() {
    this._scale = 1;
    this._tx = 0;
    this._ty = 0;
    this._applyTransform();
  }

  private _applyTransform() {
    const el = this.shadowRoot?.querySelector<HTMLElement>('img, video');
    if (el === null || el === undefined) return;
    el.style.transform = `translate(${this._tx}px, ${this._ty}px) scale(${this._scale})`;
    el.style.cursor = this._scale > 1 ? 'grab' : '';
  }

  private _clampPan() {
    const el = this.shadowRoot?.querySelector<HTMLElement>('img, video');
    const wrap = this.shadowRoot?.querySelector<HTMLElement>('.image-wrap');
    if (el === null || el === undefined) return;
    if (wrap === null || wrap === undefined) return;
    const baseW = el.clientWidth;
    const baseH = el.clientHeight;
    if (baseW === 0 || baseH === 0) return;
    const maxX = Math.max(0, (baseW * this._scale - wrap.clientWidth) / 2);
    const maxY = Math.max(0, (baseH * this._scale - wrap.clientHeight) / 2);
    this._tx = Math.max(-maxX, Math.min(maxX, this._tx));
    this._ty = Math.max(-maxY, Math.min(maxY, this._ty));
  }

  private _zoomAt(clientX: number, clientY: number, newScale: number) {
    const wrap = this.shadowRoot?.querySelector<HTMLElement>('.image-wrap');
    if (wrap === null || wrap === undefined) return;
    const clamped = Math.max(1, Math.min(8, newScale));
    if (clamped === this._scale) return;
    const rect = wrap.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const ratio = clamped / this._scale;
    this._tx = cx - (cx - this._tx) * ratio;
    this._ty = cy - (cy - this._ty) * ratio;
    this._scale = clamped;
    if (this._scale === 1) {
      this._tx = 0;
      this._ty = 0;
    }
    this._clampPan();
    this._applyTransform();
  }

  private readonly _onWheel = (e: WheelEvent) => {
    if (!this.active) return;
    if (this._scale <= 1) return;
    e.preventDefault();
    this._tx -= e.deltaX;
    this._ty -= e.deltaY;
    this._clampPan();
    this._applyTransform();
  };

  private readonly _onGestureStart = (e: Event) => {
    if (!this.active) return;
    e.preventDefault();
    this._gestureStartScale = this._scale;
  };

  private readonly _onGestureChange = (e: Event) => {
    if (!this.active) return;
    e.preventDefault();
    const ge = e as Event & {
      scale: number;
      clientX: number;
      clientY: number;
    };
    this._zoomAt(ge.clientX, ge.clientY, this._gestureStartScale * ge.scale);
  };

  private readonly _onGestureEnd = (e: Event) => {
    if (!this.active) return;
    e.preventDefault();
  };

  static override styles = css`
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    :host {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      z-index: 2000;
      justify-content: center;
      align-items: center;
    }
    :host([active]) {
      display: flex;
    }
    .image-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    img,
    video {
      max-width: 100vw;
      max-height: 100vh;
      object-fit: contain;
    }
    video {
      background: #000;
      outline: none;
    }
    video::-webkit-media-controls-overlay-enclosure {
      display: none !important;
    }
    .info {
      color: white;
    }
    .overlay-buttons {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      gap: 4px;
      z-index: 5;
    }
    .overlay-btn {
      width: 36px;
      height: 36px;
      background: rgba(0, 0, 0, 0.5);
      border: none;
      outline: none;
      border-radius: 8px;
      cursor: pointer;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 20px;
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
    .top-left {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.5);
      color: white;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      z-index: 5;
      pointer-events: none;
    }
    .camera-overlay {
      display: none;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .camera-overlay.visible {
      display: block;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeydown);
    this.addEventListener('wheel', this._onWheel, { passive: false });
    this.addEventListener('gesturestart', this._onGestureStart);
    this.addEventListener('gesturechange', this._onGestureChange);
    this.addEventListener('gestureend', this._onGestureEnd);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeydown);
    this.removeEventListener('wheel', this._onWheel);
    this.removeEventListener('gesturestart', this._onGestureStart);
    this.removeEventListener('gesturechange', this._onGestureChange);
    this.removeEventListener('gestureend', this._onGestureEnd);
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('photo')) this._resetTransform();
  }

  private readonly _onKeydown = (e: KeyboardEvent) => {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'ArrowRight') this._navigate(1);
    if (e.key === 'ArrowLeft') this._navigate(-1);
    if (e.key === ' ') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const video = this.shadowRoot?.querySelector('video');
      if (video !== undefined && video !== null) {
        if (video.paused) {
          void video.play();
        } else {
          video.pause();
        }
      } else {
        this.hide();
      }
    }
  };

  private _onVideoMouseMove() {
    const video = this.shadowRoot?.querySelector('video');
    if (video === undefined || video === null) return;
    video.controls = true;
    if (this._hideControlsTimer !== null) clearTimeout(this._hideControlsTimer);
    this._hideControlsTimer = setTimeout(() => {
      video.controls = false;
      this._hideControlsTimer = null;
    }, 3000);
  }

  private _onInfoClick(e: Event) {
    e.stopPropagation();
    if (this.photo !== null) actions.showMetadata(this.photo.uuid);
  }

  override render() {
    if (this.photo === null) return nothing;
    const photo = this.photo;
    const effectiveDate = edits.getEffectiveDate(photo);
    const loc = edits.getEffectiveLocation(photo);

    return html`
      <div class="image-wrap" @click=${stopPropagation}>
        ${isVideo(photo)
          ? html`<video
              src=${getVideoUrl(photo)}
              poster=${getFullUrl(photo)}
              autoplay
              playsinline
              @mousemove=${() => {
                this._onVideoMouseMove();
              }}
              @volumechange=${(e: Event) => {
                this._videoMuted = (e.target as HTMLVideoElement).muted;
              }}
              .muted=${this._videoMuted}
            ></video>`
          : html`<img src=${getFullUrl(photo)} alt="" />`}
        <div class="top-left">
          <div class="camera-overlay ${photo.camera === null ? '' : 'visible'}">
            ${photo.camera ?? ''}
          </div>
          <div class="info">
            ${formatDate(effectiveDate, photo.tz)}<br />${formatCoords(loc)}
          </div>
        </div>
        <div class="overlay-buttons">
          <button
            class="overlay-btn info-btn"
            @click=${(e: Event) => {
              this._onInfoClick(e);
            }}
            tabindex="-1"
          ></button>
          ${photo.photos_url === undefined
            ? nothing
            : html`<a
                class="overlay-btn photos-btn"
                href=${photo.photos_url}
                target="_blank"
                tabindex="-1"
                @click=${(e: Event) => {
                  e.stopPropagation();
                }}
              ></a>`}
        </div>
      </div>
    `;
  }
}
