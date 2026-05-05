import { html } from 'lit';

export function renderSelect(
  label: string,
  options: string[],
  value: string,
  onChange: (e: Event) => void
) {
  return html`
    <label>${label}</label>
    <select @change=${onChange}>
      <option value="all" ?selected=${value === 'all'}>All</option>
      ${options.map(
        (o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`
      )}
    </select>
  `;
}

export function renderFilterBtns(
  active: string[],
  items: Array<{ value: string; label: string; color?: string }>,
  onClick: (v: string) => void,
  onDbl: (v: string) => void
) {
  return html`
    <div class="filter-buttons">
      ${items.map(
        (i) => html`
          <button
            class="filter-btn ${active.includes(i.value) ? 'active' : ''}"
            style=${i.color === undefined ? '' : `--btn-color: ${i.color}`}
            @click=${() => {
              onClick(i.value);
            }}
            @dblclick=${() => {
              onDbl(i.value);
            }}
          >
            ${i.label}
          </button>
        `
      )}
    </div>
  `;
}

export function renderStyleBtns(
  items: Array<{ style: string; label: string }>,
  active: string,
  onClick: (s: string) => void
) {
  return html`
    <div class="map-type-buttons">
      ${items.map(
        (i) => html`
          <button
            class="map-type-btn ${i.style === active ? 'active' : ''}"
            @click=${() => {
              onClick(i.style);
            }}
          >
            ${i.label}
          </button>
        `
      )}
    </div>
  `;
}
