import { css, unsafeCSS } from 'lit';

import { GPS_COLORS } from '@common/utils';

export const styles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  :host {
    display: flex;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    /* Same arrangement as <info-panel>: the host is a full-window frame that
       takes no clicks, and only .content does, so the map stays live around
       the panel. Parked against the filter panel's left edge, so it opens
       beside the ? that opened it and reads as part of that column; the Info
       panel has the top-left corner, and both can be open with this one. */
    pointer-events: none;
    /* The filter panel's layer, under the lightbox: a photo at full size is
       the whole screen, and this belongs to the map behind it. */
    z-index: 1000;
    justify-content: flex-end;
    align-items: flex-start;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .content {
    pointer-events: auto;
    background: var(--panel-surface);
    color: var(--panel-text);
    border-radius: var(--panel-radius);
    box-shadow: var(--panel-shadow);
    width: 340px;
    /* <filter-panel> is 220px wide and 10px in from the right; this clears
       it by the same 10px. */
    max-width: calc(100% - 250px);
    max-height: calc(100vh - 20px);
    margin: 10px 240px 10px 10px;
    display: flex;
    flex-direction: column;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--panel-line);
    font-weight: 600;
    font-size: 14px;
    /* Prefixed only — this WKWebView drops the unprefixed form (gotchas.md). */
    -webkit-user-select: none;
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
    padding: 12px 16px 16px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.5;
  }
  p,
  ul,
  dl {
    margin: 0;
  }
  h3 {
    /* 16px, not the Info panel's 14: with three headings that is what brings
       the panel level with <filter-panel> beside it, at rest. */
    margin: 16px 0 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--panel-text-faint);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    align-items: baseline;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--panel-text-dim);
  }
  ul {
    padding-left: 16px;
    color: var(--panel-text-dim);
  }
  li + li {
    margin-top: 3px;
  }
  kbd {
    min-width: 20px;
    padding: 0 5px;
    border: 1px solid var(--panel-line);
    border-radius: 4px;
    background: var(--panel-raised);
    font: inherit;
    font-weight: 400;
    text-align: center;
  }
  .swatch,
  .ring {
    width: 10px;
    height: 10px;
    margin-right: 2px;
    border-radius: 50%;
  }
  .ring {
    border: 1.5px dashed ${unsafeCSS(GPS_COLORS.exif)};
  }
`;
