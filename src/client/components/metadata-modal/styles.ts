import { css } from 'lit';

export const styles = css`
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
    /* No dim and no hit area. The panel reads metadata *about* what's on
       screen, and arrows/Space browse straight through it, so dimming the
       photo and swallowing every click would fight its own purpose. Only
       .content takes pointer events; the map stays live underneath. */
    pointer-events: none;
    z-index: 3000;
    /* Parked top-left, not centred. Anchoring the corner keeps the panel
       still while the table changes height — the row count differs per photo
       and the body blanks while the next one loads, so a centred box would
       slide around under the cursor. The 10px inset matches <filter-panel>
       and the lightbox overlays, and lives on .content because the universal
       padding reset in styles.css outranks a :host rule. */
    justify-content: flex-start;
    align-items: flex-start;
  }
  :host([active]) {
    display: flex;
  }
  .content {
    pointer-events: auto;
    background: #1c1c1e;
    color: #e5e5e7;
    border-radius: 12px;
    /* Sized for the rows that matter — filename, camera, UUID on one line —
       rather than for the widest value in the table. Anything longer (a lens
       description, a dumped object) scrolls sideways in .body instead of
       widening the panel over the photo. */
    max-width: 480px;
    width: calc(100% - 20px);
    margin: 10px;
    max-height: calc(100vh - 20px);
    display: flex;
    flex-direction: column;
    /* Carries its own separation from the map now that no dim does it. */
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
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
    overflow: auto;
    font-size: 12px;
    line-height: 1.5;
  }
  table {
    /* max-content, not 100%: with nowrap values a 100%-wide table clips the
       overflow instead of growing, so .body has nothing to scroll. min-width
       keeps the row separators spanning the full panel when everything fits. */
    width: max-content;
    min-width: 100%;
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
    width: 130px;
  }
  td:last-child {
    color: #e5e5e7;
    /* No wrapping: an overlong value scrolls rather than making the row tall,
       which keeps the panel's height tied to its row count. */
    white-space: nowrap;
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
