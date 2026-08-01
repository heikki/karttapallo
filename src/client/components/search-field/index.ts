/**
 * Photos-style search: typing offers matching terms grouped by where they came
 * from, and picking one applies it as a token (ADR-0014). The applied term is a
 * filter dimension like any other, so it composes with year/album/camera rather
 * than replacing them — see `data.filters.search`.
 */

import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, state as litState, query } from 'lit/decorators.js';

import * as actions from '@common/actions';
import * as data from '@common/data';
import { suggest, type CorpusField, type Suggestion } from '@common/search';

import { styles } from './styles';

const FIELD_LABELS: Record<CorpusField, string> = {
  place: 'Places',
  description: 'Descriptions',
  labels: 'Categories'
};

@customElement('search-field')
export class SearchField extends SignalWatcher(LitElement) {
  @litState() private _query = '';
  @litState() private _highlighted = 0;
  @query('input') private readonly _input?: HTMLInputElement;

  static override styles = styles;

  private get _suggestions(): Suggestion[] {
    return suggest(data.photosForSearch.get(), this._query);
  }

  /**
   * Focus the text input, called by `<filter-panel>`'s Cmd+F handler. An
   * applied token is cleared first: the input only exists in its absence, and
   * Cmd+F means "start searching", so replacing the term is the intent.
   */
  focusInput() {
    if (data.filters.get().search !== '') data.setSearch('');
    void this.updateComplete.then(() => {
      this._input?.focus();
      this._input?.select();
    });
  }

  private _apply(term: string) {
    data.setSearch(term);
    this._query = '';
    this._highlighted = 0;
    // Move the camera to what was just picked and open its oldest photo —
    // the same (animate, selectFirst) pair the Fit button uses, so a search
    // lands you exactly where fitting would. Safe to call synchronously:
    // `fitToPhotos` reads `filteredPhotos`, which the signal above has already
    // recomputed, and it no-ops on an empty set.
    actions.fitToPhotos(true, true);
  }

  private _clear() {
    data.setSearch('');
    this._query = '';
    this._highlighted = 0;
    // The input only exists once the token is gone, so focus after re-render.
    void this.updateComplete.then(() => this._input?.focus());
  }

  private _onInput(e: Event) {
    this._query = (e.target as HTMLInputElement).value;
    this._highlighted = 0;
  }

  private _onKeyDown(e: KeyboardEvent) {
    const items = this._suggestions;
    if (e.key === 'Escape') {
      this._query = '';
      return;
    }
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._highlighted = (this._highlighted + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._highlighted = (this._highlighted - 1 + items.length) % items.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = items[this._highlighted];
      if (chosen !== undefined) this._apply(chosen.term);
    }
  }

  private _renderToken(term: string) {
    return html`
      <div class="token" role="status">
        <span class="term">${term}</span>
        <button
          class="clear"
          aria-label="Clear search"
          @click=${() => {
            this._clear();
          }}
        >
          ×
        </button>
      </div>
    `;
  }

  private _renderSuggestions(items: Suggestion[]) {
    if (this._query.trim() === '') return nothing;
    if (items.length === 0) {
      return html`<div class="suggestions">
        <p class="empty">No matches</p>
      </div>`;
    }

    // Grouped under a heading per field, as Photos groups its results, but only
    // when a group actually has hits — a lone "Places" heading is just noise.
    let lastField: CorpusField | null = null;
    return html`
      <ul class="suggestions" role="listbox" aria-label="Search suggestions">
        ${items.map((s, i) => {
          const heading =
            s.field === lastField
              ? nothing
              : html`<li class="group" role="presentation">
                  ${FIELD_LABELS[s.field]}
                </li>`;
          lastField = s.field;
          return html`
            ${heading}
            <li
              role="option"
              aria-selected=${i === this._highlighted}
              class="suggestion ${i === this._highlighted ? 'active' : ''}"
              @mouseenter=${() => {
                this._highlighted = i;
              }}
              @click=${() => {
                this._apply(s.term);
              }}
            >
              <span class="term">${s.term}</span>
              <span class="count">${s.count}</span>
            </li>
          `;
        })}
      </ul>
    `;
  }

  override render() {
    const applied = data.filters.get().search;
    return html`
      <label for="search">Search</label>
      ${applied === ''
        ? html`
            <input
              id="search"
              type="search"
              role="combobox"
              aria-expanded=${this._query.trim() !== ''}
              aria-controls="search-suggestions"
              autocomplete="off"
              placeholder="Place or description"
              .value=${this._query}
              @input=${(e: Event) => {
                this._onInput(e);
              }}
              @keydown=${(e: KeyboardEvent) => {
                this._onKeyDown(e);
              }}
            />
            ${this._renderSuggestions(this._suggestions)}
          `
        : this._renderToken(applied)}
    `;
  }
}
