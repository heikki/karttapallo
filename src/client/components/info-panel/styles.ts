import { css } from 'lit';

export const styles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  :host {
    /* Named so the one wrapping column can be sized against the panel it has
       to fit inside, rather than against a number that silently stops matching
       when the panel or the label column is retuned. */
    --panel-width: 480px;
    --body-padding-x: 16px;
    --label-column: 130px;
    --value-gap: 8px;

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
    background: var(--panel-surface);
    color: var(--panel-text);
    border-radius: var(--panel-radius);
    /* Sized for the rows that matter — filename, camera, UUID on one line —
       rather than for the widest value in the table. Anything longer (a lens
       description, a dumped object) scrolls sideways in .body instead of
       widening the panel over the photo. */
    max-width: var(--panel-width);
    width: calc(100% - 20px);
    margin: 10px;
    max-height: calc(100vh - 20px);
    display: flex;
    flex-direction: column;
    /* Carries its own separation from the map now that no dim does it. */
    box-shadow: var(--panel-shadow);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--panel-line);
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
    padding: 12px var(--body-padding-x);
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
    padding: 3px var(--value-gap) 3px 0;
    vertical-align: top;
    border-bottom: 1px solid var(--panel-raised);
  }
  td:first-child {
    font-weight: 600;
    color: var(--panel-text-dim);
    white-space: nowrap;
    width: var(--label-column);
  }
  td:last-child {
    color: var(--panel-text);
    /* No wrapping: an overlong value scrolls rather than making the row tall,
       which keeps the panel's height tied to its row count. */
    white-space: nowrap;
    /* The gap exists to separate the two columns; after the last one there is
       nothing to separate from, and the padding would only stop a right-aligned
       control short of where the row's rule ends. */
    padding-right: 0;
  }
  /* The UUID and its two buttons. Both buttons travel to the far edge as a
     pair — the auto margin is on the first of them, so everything after it
     goes along — with the Photos.app link outermost, flush with where the row
     rule ends. */
  td.uuid {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  td.uuid .copy-btn {
    margin-left: auto;
  }
  /* Section heading. Spans both columns, so it matches td:first-child and
     td:last-child at once and has to undo what they set. Quiet on purpose:
     it groups the rows below it, it doesn't compete with them. */
  tr.section td {
    width: auto;
    padding: 14px 0 3px;
    border-bottom: none;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--panel-text-faint);
  }
  tr.section:first-child td {
    padding-top: 0;
  }
  /* Categories is the one value with no length bound — dozens of scene labels
     on a single photo. Left to scroll it would drag every other row sideways
     with it, so it wraps instead, and pays for it in height.

     The max-width is what forces the break: the table is width: max-content, so
     a cell with nothing to wrap against would just report its unwrapped length
     as the column's preferred width and never break at all. It is everything
     .content has left once the body's padding and the label column are spent —
     the value column carries no padding of its own to subtract. */
  td.wrap {
    white-space: normal;
    overflow-wrap: break-word;
    max-width: calc(
      var(--panel-width) - 2 * var(--body-padding-x) - var(--label-column)
    );
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
    color: var(--panel-accent);
    font-size: 11px;
  }
  /* Reads as text until pointed at — a table of values shouldn't sprout
     buttons. It wraps with its row (the cell is .wrap) so a photo in several
     albums doesn't push the table sideways. */
  .album-btn {
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .album-btn:hover {
    color: var(--panel-accent);
    text-decoration: underline;
  }
  .copy-btn {
    padding: 2px;
    background: none;
    color: var(--panel-text-dim);
    border: none;
    cursor: pointer;
    vertical-align: middle;
    line-height: 1;
  }
  .copy-btn:hover,
  .photos-btn:hover {
    color: var(--panel-accent);
  }
  .photos-btn {
    color: var(--panel-text-dim);
    vertical-align: middle;
    line-height: 1;
  }
  .copy-btn.copied {
    color: #30d158;
  }
`;
