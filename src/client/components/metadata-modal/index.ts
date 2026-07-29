import { css, html, LitElement, nothing } from 'lit';
import { customElement, state as litState, property } from 'lit/decorators.js';

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
  ['keywords', 'Keywords'],
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
export class MetadataModal extends LitElement {
  @property({ type: Boolean, reflect: true }) active = false;
  @litState() private _data: Record<string, unknown> | null = null;
  @litState() private _loading = false;
  @litState() private _error: string | null = null;

  /** Photo the modal is showing (or loading). */
  shownUuid: string | null = null;
  // Bumped per load so a slow response for a photo the user has already
  // navigated past can't overwrite the current one.
  private _loadSeq = 0;

  // Header-drag offset from the centered resting spot, in CSS px. Written
  // straight to .content's transform rather than through a reactive property:
  // a pointermove per frame shouldn't cost a render, and the element survives
  // re-renders so the position sticks across photo navigation and reopening.
  private _offsetX = 0;
  private _offsetY = 0;
  private _dragStart: {
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
    base: { left: number; top: number; width: number } | null;
  } | null = null;
  // Whether the press that a pending click belongs to started on the backdrop.
  private _pressedBackdrop = false;

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
      background: rgba(0, 0, 0, 0.6);
      z-index: 3000;
      justify-content: center;
      /* Top-anchored, not centred: the row count differs per photo and the
         table blanks while the next one loads, and a centred box would slide
         up and down under the cursor as that height changes. The top inset
         lives on .content because the universal padding reset in styles.css
         outranks a :host rule. */
      align-items: flex-start;
    }
    :host([active]) {
      display: flex;
    }
    .content {
      background: #1c1c1e;
      color: #e5e5e7;
      border-radius: 12px;
      max-width: 600px;
      width: 90%;
      margin-top: 10vh;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #333;
      font-weight: 600;
      font-size: 14px;
      cursor: move;
      /* Prefixed only — this WKWebView drops the unprefixed form (gotchas.md). */
      -webkit-user-select: none;
      /* Keep a touch drag from scrolling the page instead of moving us. */
      touch-action: none;
    }
    .close {
      font-size: 24px;
      cursor: pointer;
      color: #888;
      line-height: 1;
    }
    .close:hover {
      color: #ccc;
    }
    .body {
      padding: 12px 16px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      padding: 3px 8px 3px 0;
      vertical-align: top;
      border-bottom: 1px solid #2c2c2e;
    }
    td:first-child {
      font-weight: 600;
      color: #98989d;
      white-space: nowrap;
      width: 140px;
    }
    td:last-child {
      color: #e5e5e7;
      word-break: break-all;
    }
    .loading {
      text-align: center;
      padding: 24px;
      color: #888;
    }
    details {
      margin: 4px 0;
    }
    summary {
      cursor: pointer;
      color: #0a84ff;
      font-size: 11px;
    }
    .copy-btn {
      margin-left: 6px;
      padding: 2px;
      background: none;
      color: #98989d;
      border: none;
      cursor: pointer;
      vertical-align: middle;
      line-height: 1;
    }
    .copy-btn:hover {
      color: #0a84ff;
    }
    .copy-btn.copied {
      color: #30d158;
    }
  `;

  loadMetadata(uuid: string) {
    const seq = ++this._loadSeq;
    this.shownUuid = uuid;
    this._data = null;
    this._loading = true;
    this._error = null;
    this.active = true;

    void fetch(`/api/metadata/${uuid}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Record<string, unknown>>;
      })
      .then((data) => {
        if (seq !== this._loadSeq) return;
        this._data = data;
        this._loading = false;
      })
      .catch((err: unknown) => {
        if (seq !== this._loadSeq) return;
        this._loading = false;
        this._error = err instanceof Error ? err.message : String(err);
      });
  }

  private _close() {
    this.active = false;
    this.shownUuid = null;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this._onHostPointerDown);
    this.addEventListener('click', this._onHostClick);
    document.addEventListener('keydown', this._onKeydown, true);
    document.addEventListener('copy', this._onCopy);
    window.addEventListener('resize', this._onResize);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this._onHostPointerDown);
    this.removeEventListener('click', this._onHostClick);
    document.removeEventListener('keydown', this._onKeydown, true);
    document.removeEventListener('copy', this._onCopy);
    window.removeEventListener('resize', this._onResize);
    this._endDrag();
  }

  // composedPath()[0] rather than e.target: events from inside the shadow tree
  // are retargeted to the host, so target alone can't tell a backdrop press
  // from a press on the table.
  private readonly _onHostPointerDown = (e: PointerEvent) => {
    this._pressedBackdrop = e.composedPath()[0] === this;
  };

  private readonly _onHostClick = (e: Event) => {
    // Dismiss only when the press *and* the release landed on the backdrop.
    // A header drag or a text selection dragged past the edge of the box also
    // ends in a click on the host, and neither of those means "close".
    if (e.target === this && this._pressedBackdrop) {
      this._close();
    }
  };

  override updated(changed: Map<string, unknown>) {
    // The window may have been resized while we were closed, leaving a
    // remembered position off-screen.
    if (!changed.has('active')) return;
    this._onResize();
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
    // Arrow keys fall through to the lightbox / map popup so the user can keep
    // browsing photos with the modal open; those navigators call back into
    // refreshMetadata() to pull the modal along.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    e.stopImmediatePropagation();
  };

  override render() {
    return html`
      <div
        class="content"
        @click=${(e: Event) => {
          e.stopPropagation();
        }}
      >
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
            <td .innerHTML=${formatMetadataValue(val)}></td>
          </tr>`
        );
      }
    }
    return html`<table>
      ${rows}
    </table>`;
  }
}
