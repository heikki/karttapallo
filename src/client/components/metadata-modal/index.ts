import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, state as litState, property } from 'lit/decorators.js';

import * as data from '@common/data';
import selection from '@common/selection';

import { styles } from './styles';

/**
 * The two corpus fields `/api/metadata` knows nothing about. `queryMetadata`
 * reads `Photos.sqlite` alone, but a place name comes from the moment table and
 * a scene label from `psi.sqlite` (ADR-0014) — both already assembled onto the
 * client's own photo record by the item store, so they are merged in from there
 * rather than queried a second time per open.
 *
 * A photo missing from the record (or a snapshot written before these fields
 * existed) yields keys with no value, which `isEmptyValue` drops like any other
 * empty row.
 */
function searchCorpusOf(uuid: string): Record<string, unknown> {
  const photo = data.photos.get().find((p) => p.uuid === uuid);
  return { place: photo?.place, labels: photo?.labels };
}

export function showMetadata(uuid: string) {
  document.querySelector<MetadataModal>('metadata-modal')?.loadMetadata(uuid);
}

/**
 * Follow photo navigation that happened underneath an open modal. A no-op
 * when the modal is closed or already showing `uuid`, so navigators can call
 * it unconditionally — and so the lightbox and the popup both pushing the
 * same uuid on one arrow key costs a single fetch.
 */
export function refreshMetadata(uuid: string) {
  const modal = document.querySelector<MetadataModal>('metadata-modal');
  if (modal === null) return;
  if (!modal.active || modal.shownUuid === uuid) return;
  modal.loadMetadata(uuid);
}

function escapeHtml(s: string) {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSimpleValue(value: boolean | string | number) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    return value === '' ? '<em>—</em>' : escapeHtml(value);
  }
  return String(value);
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined) return '<em>—</em>';
  if (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return formatSimpleValue(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<em>—</em>';
    return value
      .map((v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(', ');
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value, null, 2);
    return `<details><summary>object</summary><pre style="font-size:11px;white-space:pre-wrap">${escapeHtml(json)}</pre></details>`;
  }
  return '';
}

const METADATA_FIELDS: Array<[string, string]> = [
  ['filename', 'Filename'],
  ['original_filename', 'Original filename'],
  ['date', 'Date'],
  ['original_date', 'Original date'],
  ['title', 'Title'],
  ['description', 'Description'],
  ['place', 'Place'],
  ['keywords', 'Keywords'],
  // "Categories" is what the search box calls these, and they are only ever
  // met through it — the same word in both places or they read as two features.
  ['labels', 'Categories'],
  ['albums', 'Albums'],
  ['persons', 'Persons'],
  ['camera', 'Camera'],
  ['lens', 'Lens'],
  ['aperture', 'Aperture'],
  ['shutter_speed', 'Shutter speed'],
  ['iso', 'ISO'],
  ['focal_length', 'Focal length'],
  ['flash', 'Flash'],
  ['dimensions', 'Dimensions'],
  ['original_filesize', 'File size'],
  ['duration', 'Duration'],
  ['uti', 'UTI'],
  ['latitude', 'Latitude'],
  ['longitude', 'Longitude'],
  ['gps_accuracy', 'GPS accuracy'],
  ['favorite', 'Favorite'],
  ['hidden', 'Hidden'],
  ['ismovie', 'Video'],
  ['hdr', 'HDR'],
  ['screenshot', 'Screenshot'],
  ['uuid', 'UUID']
];

/**
 * Fields that keep their row when the server sends no value, rendering as "—".
 * `original_date` is one: for an asset with no EXIF there is nothing the camera
 * recorded, and an empty row states that, where a missing row would read as
 * "not looked at". The server omits the key entirely when the row genuinely has
 * nothing to add, so an absent key still drops the row.
 */
const ALWAYS_SHOWN = new Set(['original_date']);

/**
 * Fields whose value wraps onto as many lines as it needs instead of scrolling
 * sideways. Only the unbounded one: every other value is a filename, a camera
 * or a number, where a tall row would cost more than a rare sideways scroll.
 */
const WRAPPED = new Set(['labels']);

/** How long a metadata read may take before the panel says it's loading. */
const LOADING_ANNOUNCE_MS = 200;

function isEmptyValue(val: unknown) {
  return (
    val === null ||
    val === undefined ||
    val === '' ||
    val === false ||
    (Array.isArray(val) && val.length === 0)
  );
}

function onCopyUuid(uuid: string, e: Event) {
  const btn = e.currentTarget as HTMLButtonElement;
  void navigator.clipboard.writeText(uuid).then(() => {
    btn.classList.add('copied');
    setTimeout(() => {
      btn.classList.remove('copied');
    }, 1000);
  });
}

@customElement('metadata-modal')
export class MetadataModal extends SignalWatcher(LitElement) {
  @property({ type: Boolean, reflect: true }) active = false;
  @litState() private _data: Record<string, unknown> | null = null;
  @litState() private _loading = false;
  @litState() private _error: string | null = null;

  /** Photo the modal is showing (or loading). */
  shownUuid: string | null = null;
  // Bumped per load so a slow response for a photo the user has already
  // navigated past can't overwrite the current one.
  private _loadSeq = 0;
  private _loadingTimer: ReturnType<typeof setTimeout> | null = null;

  // Header-drag offset from the top-left resting spot, in CSS px. Written
  // straight to .content's transform rather than through a reactive property:
  // a pointermove per frame shouldn't cost a render, and the element survives
  // re-renders, so a dragged panel stays put while the user browses photos.
  // Closing forgets it — see _close().
  private _offsetX = 0;
  private _offsetY = 0;
  private _dragStart: {
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
    base: { left: number; top: number; width: number } | null;
  } | null = null;

  static override styles = styles;

  loadMetadata(uuid: string) {
    const seq = ++this._loadSeq;
    this.shownUuid = uuid;
    // Hold the height the outgoing table had, before dropping its rows: a
    // photo change would otherwise collapse the panel to a "Loading…" stub and
    // pop back out, twice per arrow key.
    this._holdBodyHeight();
    this._data = null;
    this._error = null;
    this._startLoading();
    this.active = true;

    void fetch(`/api/metadata/${uuid}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Record<string, unknown>>;
      })
      .then((record) => {
        if (seq !== this._loadSeq) return;
        this._data = { ...record, ...searchCorpusOf(uuid) };
        this._settleLoading();
      })
      .catch((err: unknown) => {
        if (seq !== this._loadSeq) return;
        this._error = err instanceof Error ? err.message : String(err);
        this._settleLoading();
      });
  }

  /**
   * A local metadata read is usually a few milliseconds, so showing "Loading…"
   * straight away only flashes text at the user on every arrow key. Announce
   * the wait only once it's long enough to be worth admitting to.
   */
  private _startLoading() {
    this._clearLoadingTimer();
    this._loadingTimer = setTimeout(() => {
      this._loadingTimer = null;
      this._loading = true;
    }, LOADING_ANNOUNCE_MS);
  }

  private _settleLoading() {
    this._clearLoadingTimer();
    this._loading = false;
    this._releaseBodyHeight();
  }

  private _clearLoadingTimer() {
    if (this._loadingTimer === null) return;
    clearTimeout(this._loadingTimer);
    this._loadingTimer = null;
  }

  private get _bodyEl(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>('.body') ?? null;
  }

  private _holdBodyHeight() {
    const body = this._bodyEl;
    if (body === null) return;
    const height = body.offsetHeight;
    // 0 while closed or in a layout-less test DOM: nothing to hold onto.
    if (height === 0) return;
    body.style.minHeight = `${height}px`;
  }

  private _releaseBodyHeight() {
    const body = this._bodyEl;
    if (body === null) return;
    body.style.minHeight = '';
  }

  private _close() {
    this.active = false;
    this.shownUuid = null;
    this._clearLoadingTimer();
    this._loading = false;
    this._releaseBodyHeight();
    // Back to the corner: a panel dragged aside for one photo shouldn't decide
    // where the next open appears, half a session later.
    this._offsetX = 0;
    this._offsetY = 0;
    this._applyOffset();
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeydown, true);
    document.addEventListener('copy', this._onCopy);
    window.addEventListener('resize', this._onResize);
  }

  override firstUpdated() {
    // The panel describes one photo, so it can't outlive the selection of it:
    // an empty-map click, a filter that excludes it, Reset. Covers every path
    // that lands on a null uuid, which pushing from the popup would not — the
    // popup is torn down rather than re-rendered when it closes.
    this.updateEffect(() => {
      const uuid = selection.selectedPhotoUuid.get();
      if (!this.active) return;
      if (uuid === null) this._close();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeydown, true);
    document.removeEventListener('copy', this._onCopy);
    window.removeEventListener('resize', this._onResize);
    this._endDrag();
    this._clearLoadingTimer();
  }

  private get _contentEl(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>('.content') ?? null;
  }

  private _applyOffset() {
    const content = this._contentEl;
    if (content === null) return;
    content.style.transform =
      this._offsetX === 0 && this._offsetY === 0
        ? ''
        : `translate(${this._offsetX}px, ${this._offsetY}px)`;
  }

  /**
   * Where the box sits with no offset applied. Derived from the live rect,
   * which already includes the applied transform — so this is only correct
   * while `_offsetX/_offsetY` and that transform agree, i.e. not mid-drag.
   * Returns null when the box has no layout to measure (closed, or happy-dom).
   */
  private _baseBox(): { left: number; top: number; width: number } | null {
    const content = this._contentEl;
    if (content === null) return null;
    const rect = content.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      left: rect.left - this._offsetX,
      top: rect.top - this._offsetY,
      width: rect.width
    };
  }

  /**
   * Keep the modal grabbable: the header can't leave the top of the viewport,
   * and a strip of the box always stays inside the other three edges.
   */
  private _clampOffset(base: { left: number; top: number; width: number }) {
    const edge = 60;
    this._offsetX = Math.min(
      window.innerWidth - edge - base.left,
      Math.max(edge - base.width - base.left, this._offsetX)
    );
    this._offsetY = Math.min(
      window.innerHeight - edge - base.top,
      Math.max(-base.top, this._offsetY)
    );
  }

  private readonly _onResize = () => {
    if (!this.active) return;
    if (this._offsetX === 0 && this._offsetY === 0) return;
    const base = this._baseBox();
    if (base === null) return;
    this._clampOffset(base);
    this._applyOffset();
  };

  private readonly _onHeaderPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Let the close button have its click.
    if (
      (e.target as HTMLElement | null)?.classList.contains('close') === true
    ) {
      return;
    }
    e.preventDefault();
    this._dragStart = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      offsetX: this._offsetX,
      offsetY: this._offsetY,
      // Measured once, here: mid-drag the rect lags a frame behind the offset
      // fields, which would drift the clamp bounds by a step each move.
      base: this._baseBox()
    };
    // On window, not the header: the pointer routinely outruns the box.
    window.addEventListener('pointermove', this._onDragMove);
    window.addEventListener('pointerup', this._onDragEnd);
    window.addEventListener('pointercancel', this._onDragEnd);
  };

  private readonly _onDragMove = (e: PointerEvent) => {
    const start = this._dragStart;
    if (start === null) return;
    const dx = e.clientX - start.pointerX;
    const dy = e.clientY - start.pointerY;
    this._offsetX = start.offsetX + dx;
    this._offsetY = start.offsetY + dy;
    if (start.base !== null) this._clampOffset(start.base);
    this._applyOffset();
  };

  private readonly _onDragEnd = () => {
    this._endDrag();
  };

  private _endDrag() {
    this._dragStart = null;
    window.removeEventListener('pointermove', this._onDragMove);
    window.removeEventListener('pointerup', this._onDragEnd);
    window.removeEventListener('pointercancel', this._onDragEnd);
  }

  /**
   * The text currently selected inside this modal, or '' if the selection is
   * empty or lives elsewhere on the page.
   */
  private _selectedText() {
    const shadow = this.shadowRoot;
    const selection = window.getSelection();
    if (shadow === null || selection === null) return '';
    // Shadow-crossing ranges: in the DOM types, but still absent from older
    // engines (and from happy-dom), where Selection.toString() is the best
    // available read.
    const reader: Partial<Selection> = selection;
    if (reader.getComposedRanges === undefined) return selection.toString();
    const staticRange = reader.getComposedRanges.call(selection, {
      shadowRoots: [shadow]
    })[0];
    if (staticRange === undefined) return '';
    if (staticRange.startContainer.getRootNode() !== shadow) return '';
    const range = document.createRange();
    range.setStart(staticRange.startContainer, staticRange.startOffset);
    range.setEnd(staticRange.endContainer, staticRange.endOffset);
    return range.toString();
  }

  /**
   * WebKit dispatches `copy` for a selection inside a shadow root but leaves
   * the clipboard payload empty, so Cmd+C over the metadata table copies
   * nothing. Fill it in ourselves from the selection we can read.
   */
  private readonly _onCopy = (e: ClipboardEvent) => {
    if (!this.active) return;
    if (e.clipboardData === null) return;
    // Non-empty already means the engine handled it; don't second-guess it.
    if (e.clipboardData.getData('text/plain') !== '') return;
    const text = this._selectedText();
    if (text === '') return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };

  private readonly _onKeydown = (e: KeyboardEvent) => {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this._close();
      return;
    }
    // Browsing keys fall through to the lightbox / map popup so the modal can
    // stay open while the user works: arrows cycle photos (those navigators
    // call back into refreshMetadata() to pull the modal along), Space toggles
    // between the popup and the lightbox — or plays/pauses a video, whichever
    // the lightbox decides. Same photo either way, so nothing to refresh.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') {
      return;
    }
    e.stopImmediatePropagation();
  };

  override render() {
    return html`
      <div class="content">
        <div
          class="header"
          title="Drag to move"
          @pointerdown=${this._onHeaderPointerDown}
        >
          <span>Metadata</span>
          <span
            class="close"
            @click=${() => {
              this._close();
            }}
            >&times;</span
          >
        </div>
        <div class="body">
          ${this._loading
            ? html`<div class="loading">Loading...</div>`
            : nothing}
          ${this._error !== null && this._error !== ''
            ? html`<div class="loading">
                Failed to load metadata: ${this._error}
              </div>`
            : nothing}
          ${this._data === null ? nothing : this._renderTable()}
        </div>
      </div>
    `;
  }

  private _renderTable() {
    if (this._data === null) return nothing;
    const rows = [];
    for (const [key, label] of METADATA_FIELDS) {
      if (!(key in this._data)) continue;
      const val = this._data[key];
      if (isEmptyValue(val) && !ALWAYS_SHOWN.has(key)) continue;
      if (key === 'uuid') {
        const uuid = typeof val === 'string' ? val : '';
        rows.push(
          html`<tr>
            <td>${label}</td>
            <td>
              ${uuid}
              <button
                class="copy-btn"
                @click=${(e: Event) => {
                  onCopyUuid(uuid, e);
                }}
                title="Copy UUID"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path
                    d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25z"
                  />
                  <path
                    d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25z"
                  />
                </svg>
              </button>
            </td>
          </tr>`
        );
      } else {
        // Use innerHTML for values that may contain HTML (em, details, etc.)
        rows.push(
          html`<tr>
            <td>${label}</td>
            <td
              class=${WRAPPED.has(key) ? 'wrap' : nothing}
              .innerHTML=${formatMetadataValue(val)}
            ></td>
          </tr>`
        );
      }
    }
    return html`<table>
      ${rows}
    </table>`;
  }
}
