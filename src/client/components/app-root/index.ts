import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

import * as data from '@common/data';

const debugLog: string[] = [];

function debugPush(msg: string) {
  debugLog.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (debugLog.length > 50) debugLog.shift();
  console.error('[debug]', msg);
}

@customElement('app-root')
export class AppRoot extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();

    // Electrobun: WKWebView's document doesn't take keyboard focus on
    // first load, so document-level keydown handlers (e.g. arrow-key
    // navigation in <map-popup>) sit silent until the user clicks.
    // Mark the body programmatically focusable and grab focus so
    // keyboard works immediately when ?id=... pre-selects a photo.
    document.body.tabIndex = -1;
    document.body.focus();

    // window.__debugLog is read by map-view/setup.ts (Shift+D handler) so
    // Safari Inspector can surface errors that happened before devtools
    // was open. Keep the global names stable.
    window.addEventListener('error', (e) => {
      debugPush(`ERR: ${e.message} at ${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      debugPush(`REJECT: ${e.reason}`);
    });
    (window as unknown as Record<string, unknown>).__debugLog = debugLog;
    (window as unknown as Record<string, unknown>).__showDebug = () => {
      const text = debugLog.slice(-20).join('\n');
      // eslint-disable-next-line no-alert -- debug-only function, not shown in UI
      alert(text === '' ? '(no errors logged)' : text);
    };

    document.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) e.preventDefault();
      },
      { passive: false }
    );
    function preventGesture(e: Event) {
      e.preventDefault();
    }
    document.addEventListener('gesturestart', preventGesture);
    document.addEventListener('gesturechange', preventGesture);

    void data.loadPhotos();
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Lit lifecycle
  override render() {
    return html`
      <map-view></map-view>
      <filter-panel></filter-panel>
      <photo-lightbox id="lightbox"></photo-lightbox>
      <metadata-modal id="metadata-modal"></metadata-modal>
      <files-modal id="files-modal"></files-modal>
    `;
  }
}
