import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import * as actions from '@/common/actions';
import * as interactionMode from '@/common/interaction-mode';
import { viewState } from '@/common/view-state';
import { current as routeCurrent } from '@/components/map-route/route';

import { styles } from './styles';

@customElement('album-controls')
export class AlbumControls extends SignalWatcher(LitElement) {
  @property() album = 'all';
  private _albumInitialized = false;

  static override styles = styles;

  override willUpdate(changed: PropertyValues) {
    if (!changed.has('album')) return;
    if (!this._albumInitialized) {
      this._albumInitialized = true;
      return;
    }
    if (!viewState.routeVisible.get()) return;
    if (interactionMode.current.get() === 'route-edit') {
      interactionMode.exit();
    }
    if (this.album === 'all') viewState.routeVisible.set(false);
  }

  override render() {
    const disabled = this.album === 'all';
    const routeActive = viewState.routeVisible.get();
    const editActive = interactionMode.current.get() === 'route-edit';
    // Mirror canEnter on the button so the load window is visibly
    // disabled rather than silently refusing the click.
    const editDisabled =
      disabled || !routeActive || routeCurrent.get() === null;
    return html`
      <div class="view-buttons">
        <button
          class="view-btn"
          ?disabled=${disabled}
          @click=${() => {
            actions.showAlbumFiles(this.album);
          }}
        >
          Files
        </button>
        <button
          class="view-btn ${routeActive ? 'active' : ''}"
          ?disabled=${disabled}
          @click=${() => {
            if (routeActive && editActive) interactionMode.exit();
            viewState.routeVisible.set(!routeActive);
          }}
        >
          Route
        </button>
        <button
          class="view-btn ${editActive ? 'active' : ''}"
          ?disabled=${editDisabled}
          @click=${() => {
            interactionMode.toggle('route-edit');
          }}
        >
          Edit
        </button>
      </div>
    `;
  }
}
