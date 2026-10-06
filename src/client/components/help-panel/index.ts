import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';

import { helpPanelOpen, toggleHelp } from '@common/panels';
import { GPS_COLORS } from '@common/utils';

import { styles } from './styles';

/** What the desktop entry's Help menu item dispatches on `window`. */
const MENU_EVENT = 'karttapallo:toggle-help';

const KEYS: Array<[string[], string]> = [
  [['←', '→'], 'Previous / next photo'],
  [['Space'], 'Full size, and back'],
  [['Esc'], 'Back out of whatever is on top'],
  [['Enter'], 'Play / pause a video'],
  [['⌘F'], 'Search'],
  [['⌘I'], 'Info']
];

const GESTURES = [
  'Click a marker to select it; click empty map to hide its card.',
  'Scroll or pinch to zoom.',
  'Double-click a filter toggle to show only that one.',
  'While editing a route: click to add or remove a point, drag to move one, right-click a segment to choose how it is routed.'
];

const COLOURS: Array<[string, string, string]> = [
  [GPS_COLORS.exif, 'Exif', 'recorded by the camera'],
  [GPS_COLORS.inferred, 'Inferred', 'guessed by Photos'],
  [GPS_COLORS.user, 'User', 'set by you'],
  [GPS_COLORS.none, 'None', 'no location']
];

/**
 * The Help panel (CONTEXT.md). Principles, not an inventory: a flow that adds
 * a key or a gesture the screen doesn't show belongs here, the rest stays in
 * docs/flows.md.
 *
 * Takes no keys of its own, so arrows, Space and Escape reach the map exactly
 * as they do with it closed — the point is to try what it says while reading.
 */
@customElement('help-panel')
export class HelpPanel extends SignalWatcher(LitElement) {
  static override styles = styles;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener(MENU_EVENT, toggleHelp);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(MENU_EVENT, toggleHelp);
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Lit lifecycle
  override render() {
    if (!helpPanelOpen.get()) return nothing;
    return html`
      <div class="content">
        <div class="header">
          <span>Help</span>
          <span
            class="close"
            @click=${() => {
              helpPanelOpen.set(false);
            }}
            >&times;</span
          >
        </div>
        <div class="body">
          <p>
            Karttapallo shows your Apple Photos library on a globe. Changes to a
            location or time wait until you press Save to Photos.
          </p>
          <h3>Keyboard</h3>
          <dl>
            ${KEYS.map(
              ([keys, what]) =>
                html`<dt>${keys.map((k) => html`<kbd>${k}</kbd>`)}</dt>
                  <dd>${what}</dd>`
            )}
          </dl>
          <h3>Mouse and trackpad</h3>
          <ul>
            ${GESTURES.map((g) => html`<li>${g}</li>`)}
          </ul>
          <h3>Marker colours</h3>
          <dl>
            ${COLOURS.map(
              ([color, name, meaning]) =>
                html`<dt>
                    <span class="swatch" style="background: ${color}"></span
                    >${name}
                  </dt>
                  <dd>${meaning}</dd>`
            )}
            <dt><span class="ring"></span>Ring</dt>
            <dd>GPS accuracy, with Info open</dd>
          </dl>
        </div>
      </div>
    `;
  }
}
