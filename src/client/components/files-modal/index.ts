import { css, html, LitElement, nothing } from 'lit';
import { customElement, state as litState, property } from 'lit/decorators.js';

import { reloadAlbumGpx } from '@common/actions';

export function showAlbumFiles(album: string) {
  document.querySelector<FilesModal>('files-modal')?.show(album);
}

interface AlbumFile {
  name: string;
  visible: boolean;
}

@customElement('files-modal')
export class FilesModal extends LitElement {
  @property({ type: Boolean, reflect: true }) active = false;
  @litState() private _files: AlbumFile[] = [];
  @litState() private _loading = false;
  @litState() private _album = '';

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
      max-width: 440px;
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
      font-size: 13px;
      line-height: 1.5;
    }
    .file-row {
      display: flex;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #2c2c2e;
      gap: 8px;
    }
    .vis-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 15px;
      padding: 2px 4px;
      flex-shrink: 0;
      border-radius: 4px;
      line-height: 1;
      opacity: 0.9;
    }
    .vis-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .vis-btn.hidden {
      opacity: 0.35;
    }
    .file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .file-name.hidden {
      opacity: 0.4;
    }
    .delete-btn {
      background: none;
      border: none;
      color: #ff453a;
      cursor: pointer;
      font-size: 13px;
      padding: 2px 8px;
      flex-shrink: 0;
      border-radius: 4px;
    }
    .delete-btn:hover {
      background: rgba(255, 69, 58, 0.15);
    }
    .empty {
      color: #888;
      text-align: center;
      padding: 16px 0;
    }
    .loading {
      text-align: center;
      padding: 24px;
      color: #888;
    }
    .footer {
      padding: 12px 16px;
      border-top: 1px solid #333;
    }
    .add-btn {
      background: #0a84ff;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      width: 100%;
    }
    .add-btn:hover {
      background: #0070e0;
    }
  `;

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

  show(album: string) {
    this._album = album;
    this.active = true;
    void this._fetchFiles();
  }

  private readonly _onHostClick = (e: Event) => {
    if (e.target === this) this._close();
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

  private _close() {
    this.active = false;
  }

  private async _fetchFiles() {
    this._loading = true;
    try {
      const res = await fetch(
        `/api/albums/${encodeURIComponent(this._album)}/files`
      );
      const data = (await res.json()) as AlbumFile[];
      this._files = data.sort((a, b) => a.name.localeCompare(b.name));
      reloadAlbumGpx();
    } catch {
      this._files = [];
    }
    this._loading = false;
  }

  private async _toggleVisibility(file: AlbumFile) {
    const newVisible = !file.visible;
    try {
      const res = await fetch(
        `/api/albums/${encodeURIComponent(this._album)}/files/${encodeURIComponent(file.name)}/visibility`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visible: newVisible })
        }
      );
      if (res.ok) {
        this._files = this._files.map((f) =>
          f.name === file.name ? { ...f, visible: newVisible } : f
        );
        reloadAlbumGpx();
      }
    } catch (err) {
      console.error('Toggle visibility failed:', err);
    }
  }

  private async _deleteFile(filename: string) {
    try {
      const res = await fetch(
        `/api/albums/${encodeURIComponent(this._album)}/files/${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        this._files = this._files.filter((f) => f.name !== filename);
        reloadAlbumGpx();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  private _onAddClick() {
    const input =
      this.renderRoot.querySelector<HTMLInputElement>('input[type="file"]');
    input?.click();
  }

  private readonly _onFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (files === null || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('file', files.item(i)!);
    }

    try {
      const res = await fetch(
        `/api/albums/${encodeURIComponent(this._album)}/upload`,
        { method: 'POST', body: formData }
      );
      if (res.ok) {
        await this._fetchFiles();
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }

    input.value = '';
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
          <span>Files — ${this._album}</span>
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
          ${!this._loading && this._files.length === 0
            ? html`<div class="empty">No files</div>`
            : nothing}
          ${this._files.map(
            (f) => html`
              <div class="file-row">
                <button
                  class="vis-btn ${f.visible ? '' : 'hidden'}"
                  title="${f.visible ? 'Hide' : 'Show'}"
                  @click=${() => {
                    void this._toggleVisibility(f);
                  }}
                >
                  ${f.visible ? '\u{1F441}' : '\u{1F441}'}
                </button>
                <span class="file-name ${f.visible ? '' : 'hidden'}"
                  >${f.name}</span
                >
                <button
                  class="delete-btn"
                  @click=${() => {
                    void this._deleteFile(f.name);
                  }}
                >
                  Delete
                </button>
              </div>
            `
          )}
        </div>
        <div class="footer">
          <button
            class="add-btn"
            @click=${() => {
              this._onAddClick();
            }}
          >
            Add files...
          </button>
          <input
            type="file"
            accept=".gpx,.md"
            multiple
            style="display:none"
            @change=${this._onFileChange}
          />
        </div>
      </div>
    `;
  }
}
