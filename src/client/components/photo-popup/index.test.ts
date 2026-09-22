import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import * as edits from '@common/edits';
import type { Photo } from '@common/types';

import { PhotoPopup } from './index';

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    uuid: 'p1',
    type: 'photo',
    full: 'full/p1.jpg',
    thumb: 'thumb/p1.jpg',
    lat: 60.17,
    lon: 24.94,
    date: '2024:06:01 12:00:00',
    tz: '+03:00',
    camera: 'iPhone 15',
    gps: 'exif',
    gps_accuracy: 5,
    albums: [],
    place: [],
    description: [],
    labels: [],
    ...overrides
  };
}

async function mount(p: Photo): Promise<PhotoPopup> {
  const el = new PhotoPopup();
  el.photo = p;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function button(el: PhotoPopup, label: string): HTMLButtonElement | null {
  const buttons = el.shadowRoot?.querySelectorAll('button') ?? [];
  return (
    Array.from(buttons).find((b) => b.textContent.trim() === label) ?? null
  );
}

async function click(el: PhotoPopup, label: string) {
  const b = button(el, label);
  if (b === null) throw new Error(`missing button ${label}`);
  b.click();
  await el.updateComplete;
}

function dateInput(el: PhotoPopup): HTMLInputElement {
  const input =
    el.shadowRoot?.querySelector<HTMLInputElement>('#date-input') ?? null;
  if (input === null) throw new Error('missing date input');
  return input;
}

async function submitDate(el: PhotoPopup, value: string) {
  const input = dateInput(el);
  input.value = value;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await el.updateComplete;
}

describe('<photo-popup>', () => {
  const fetchMock = mock(() => Promise.resolve(new Response('{}')));
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    edits.clear();
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    edits.clear();
  });

  describe('confirm on an inferred location', () => {
    test('queues a pending edit instead of saving to Photos', async () => {
      const el = await mount(photo({ gps: 'inferred' }));
      await click(el, 'confirm');

      expect(edits.getCoordEdits()).toEqual([
        { uuid: 'p1', lat: 60.17, lon: 24.94 }
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('leaves other pending edits alone', async () => {
      edits.setTimeOffset('other', 1);
      const el = await mount(photo({ gps: 'inferred' }));
      await click(el, 'confirm');

      expect(edits.editCount.get()).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('hides once confirmed', async () => {
      const el = await mount(photo({ gps: 'inferred' }));
      await click(el, 'confirm');
      expect(button(el, 'confirm')).toBeNull();
    });
  });

  describe('manual date entry', () => {
    test('applies a valid date as a pending offset', async () => {
      const el = await mount(photo());
      await click(el, 'edit');
      await submitDate(el, '2.6.2024 12:00');

      expect(edits.getTimeEdits()).toEqual([{ uuid: 'p1', hours: 24 }]);
    });

    test('marks an out-of-range date invalid and queues nothing', async () => {
      const el = await mount(photo());
      await click(el, 'edit');
      await submitDate(el, '32.13.2024 99:99');

      expect(edits.editCount.get()).toBe(0);
      expect(dateInput(el).getAttribute('aria-invalid')).toBe('true');
    });

    test('clears the invalid mark as soon as the user types', async () => {
      const el = await mount(photo());
      await click(el, 'edit');
      await submitDate(el, '32.1.2024');

      const input = dateInput(el);
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      expect(input.getAttribute('aria-invalid')).toBe('false');
    });
  });
});
