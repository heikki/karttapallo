import { css, html, LitElement, nothing } from 'lit';
import { customElement, state as litState, property } from 'lit/decorators.js';

export function showMetadata(uuid: string): void {
  document.querySelector<MetadataModal>('metadata-modal')?.loadMetadata(uuid);
}

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSimpleValue(value: boolean | string | number): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    return value === '' ? '<em>—</em>' : escapeHtml(value);
  }
  return String(value);
}

function formatMetadataValue(value: unknown): string {
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

function isEmptyValue(val: unknown): boolean {
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
      align-items: center;
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
        this._data = data;
        this._loading = false;
      })
      .catch((err: unknown) => {
        this._loading = false;
        this._error = err instanceof Error ? err.message : String(err);
      });
  }

  private _close() {
    this.active = false;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener('click', this._onHostClick);
    document.addEventListener('keydown', this._onKeydown, true);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this._onHostClick);
    document.removeEventListener('keydown', this._onKeydown, true);
  }

  private readonly _onHostClick = (e: Event) => {
    // Backdrop click: if click is directly on the host element
    if (e.target === this) {
      this._close();
    }
  };

  private readonly _onKeydown = (e: KeyboardEvent) => {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this._close();
      return;
    }
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
        <div class="header">
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
