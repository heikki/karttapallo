import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import * as data from '@common/data';
import selection from '@common/selection';

import { MetadataModal, refreshMetadata } from './index';

const sampleData = {
  filename: 'IMG_0001.HEIC',
  date: '2024-06-01T12:00:00',
  camera: 'iPhone 15',
  uuid: 'fixture-uuid'
};

function jsonResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' }
  });
}

async function mount(): Promise<MetadataModal> {
  const el = new MetadataModal();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function query(el: MetadataModal, selector: string): HTMLElement {
  const found = el.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
}

/** Press on the header, move by (dx, dy), release. */
function dragHeader(el: MetadataModal, dx: number, dy: number) {
  const header = query(el, '.header');
  header.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: 100,
      clientY: 100,
      button: 0,
      bubbles: true
    })
  );
  window.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX: 100 + dx,
      clientY: 100 + dy
    })
  );
  window.dispatchEvent(new PointerEvent('pointerup', {}));
}

describe('<metadata-modal>', () => {
  test('mounts and starts hidden (active=false)', async () => {
    const el = await mount();
    expect(el.active).toBe(false);
    expect(el.hasAttribute('active')).toBe(false);
    el.remove();
  });

  test('reflects active attribute when activated', async () => {
    const el = await mount();
    el.active = true;
    await el.updateComplete;
    expect(el.hasAttribute('active')).toBe(true);
    el.remove();
  });

  test('renders metadata fields once data is populated', async () => {
    const el = await mount();
    // Bypass fetch: poke the private state directly via index access.
    (el as unknown as { _data: Record<string, unknown> })._data = sampleData;
    el.requestUpdate();
    await el.updateComplete;
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('Filename');
    expect(text).toContain('IMG_0001.HEIC');
    expect(text).toContain('Camera');
    expect(text).toContain('iPhone 15');
    expect(text).toContain('UUID');
    expect(text).toContain('fixture-uuid');
    el.remove();
  });

  test('omits empty fields from the rendered table', async () => {
    const el = await mount();
    (el as unknown as { _data: Record<string, unknown> })._data = {
      filename: 'IMG_0002.HEIC',
      title: '',
      keywords: [],
      uuid: 'u2'
    };
    el.requestUpdate();
    await el.updateComplete;
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('IMG_0002.HEIC');
    expect(text).not.toContain('Title');
    expect(text).not.toContain('Keywords');
    el.remove();
  });
});

describe('<metadata-modal> photo navigation', () => {
  const originalFetch = globalThis.fetch;
  let fetched: string[] = [];

  beforeEach(() => {
    fetched = [];
    globalThis.fetch = mock((url: string) => {
      fetched.push(url);
      return Promise.resolve(
        jsonResponse({ ...sampleData, uuid: url.split('/').pop() ?? '' })
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('refreshMetadata does nothing while the modal is closed', async () => {
    const el = await mount();
    refreshMetadata('other-uuid');
    expect(fetched).toEqual([]);
    expect(el.active).toBe(false);
    el.remove();
  });

  test('refreshMetadata loads the new photo while the modal is open', async () => {
    const el = await mount();
    el.loadMetadata('first-uuid');
    refreshMetadata('second-uuid');
    expect(el.shownUuid).toBe('second-uuid');
    expect(fetched).toEqual([
      '/api/metadata/first-uuid',
      '/api/metadata/second-uuid'
    ]);
    el.remove();
  });

  test('refreshMetadata skips a refetch of the photo already shown', async () => {
    const el = await mount();
    el.loadMetadata('first-uuid');
    refreshMetadata('first-uuid');
    expect(fetched).toEqual(['/api/metadata/first-uuid']);
    el.remove();
  });

  test('the in-flight response of a photo navigated past is dropped', async () => {
    const el = await mount();
    const first = Promise.withResolvers<Response>();
    globalThis.fetch = mock((url: string) =>
      url.endsWith('first-uuid')
        ? first.promise
        : Promise.resolve(jsonResponse({ filename: 'second.jpg' }))
    ) as unknown as typeof fetch;

    el.loadMetadata('first-uuid');
    refreshMetadata('second-uuid');
    await Bun.sleep(0);
    // The stale response lands last and must not win.
    first.resolve(jsonResponse({ filename: 'first.jpg' }));
    await Bun.sleep(0);
    await el.updateComplete;

    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('second.jpg');
    expect(text).not.toContain('first.jpg');
    el.remove();
  });

  test('closes when the photo it describes is deselected', async () => {
    const el = await mount();
    // The photo has to be in the filtered set, or selection's own auto-clear
    // effect nulls the uuid before the panel ever opens.
    data.resetFilters();
    data.photos.set([
      {
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
        albums: ['Helsinki'],
        place: null,
        description: null,
        labels: []
      }
    ]);
    await Bun.sleep(0);
    selection.selectPhoto('p1');
    el.loadMetadata('p1');
    await el.updateComplete;
    expect(el.active).toBe(true);

    selection.closePopup();
    await Bun.sleep(0);

    expect(el.active).toBe(false);
    expect(el.shownUuid).toBe(null);
    data.photos.set([]);
    el.remove();
  });

  test('browsing keys reach navigators underneath, other keys do not', async () => {
    const el = await mount();
    el.loadMetadata('first-uuid');
    const seen: string[] = [];
    function listener(e: Event) {
      seen.push((e as KeyboardEvent).key);
    }
    document.addEventListener('keydown', listener);

    for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'Enter', 'd']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }

    document.removeEventListener('keydown', listener);
    expect(seen).toEqual(['ArrowRight', 'ArrowLeft', ' ']);
    el.remove();
  });
});

describe('<metadata-modal> header drag', () => {
  test('dragging the header offsets the modal', async () => {
    const el = await mount();
    el.active = true;
    await el.updateComplete;

    dragHeader(el, 40, -25);

    expect(query(el, '.content').style.transform).toBe(
      'translate(40px, -25px)'
    );
    el.remove();
  });

  test('a second drag continues from where the first left off', async () => {
    const el = await mount();
    el.active = true;
    await el.updateComplete;

    dragHeader(el, 40, -25);
    dragHeader(el, -10, 5);

    expect(query(el, '.content').style.transform).toBe(
      'translate(30px, -20px)'
    );
    el.remove();
  });

  test('closing forgets the position', async () => {
    const el = await mount();
    el.active = true;
    await el.updateComplete;
    dragHeader(el, 60, 40);
    expect(query(el, '.content').style.transform).toBe('translate(60px, 40px)');

    query(el, '.close').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    await el.updateComplete;

    expect(el.active).toBe(false);
    expect(query(el, '.content').style.transform).toBe('');
    el.remove();
  });

  test('the position survives a photo change', async () => {
    const el = await mount();
    el.active = true;
    await el.updateComplete;
    dragHeader(el, 30, 30);

    (el as unknown as { _data: Record<string, unknown> })._data = sampleData;
    el.requestUpdate();
    await el.updateComplete;

    expect(query(el, '.content').style.transform).toBe('translate(30px, 30px)');
    el.remove();
  });
});

describe('<metadata-modal> copying text', () => {
  function selectBody(el: MetadataModal) {
    const range = document.createRange();
    range.selectNodeContents(query(el, '.body'));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function dispatchCopy(): ClipboardEvent {
    const event = new ClipboardEvent('copy', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    return event;
  }

  async function mountWithTable(): Promise<MetadataModal> {
    const el = await mount();
    el.active = true;
    (el as unknown as { _data: Record<string, unknown> })._data = sampleData;
    el.requestUpdate();
    await el.updateComplete;
    return el;
  }

  test('fills the empty clipboard payload from the selection', async () => {
    const el = await mountWithTable();
    selectBody(el);

    const event = dispatchCopy();

    expect(event.clipboardData?.getData('text/plain')).toContain(
      'IMG_0001.HEIC'
    );
    expect(event.defaultPrevented).toBe(true);
    window.getSelection()?.removeAllRanges();
    el.remove();
  });

  test('leaves a payload the engine already filled in alone', async () => {
    const el = await mountWithTable();
    selectBody(el);

    const event = new ClipboardEvent('copy', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true
    });
    event.clipboardData?.setData('text/plain', 'engine text');
    document.dispatchEvent(event);

    expect(event.clipboardData?.getData('text/plain')).toBe('engine text');
    expect(event.defaultPrevented).toBe(false);
    window.getSelection()?.removeAllRanges();
    el.remove();
  });

  test('stays out of the way while the modal is closed', async () => {
    const el = await mountWithTable();
    selectBody(el);
    el.active = false;
    await el.updateComplete;

    const event = dispatchCopy();

    expect(event.clipboardData?.getData('text/plain')).toBe('');
    expect(event.defaultPrevented).toBe(false);
    window.getSelection()?.removeAllRanges();
    el.remove();
  });

  test('does nothing when there is no selection', async () => {
    const el = await mountWithTable();
    window.getSelection()?.removeAllRanges();

    const event = dispatchCopy();

    expect(event.clipboardData?.getData('text/plain')).toBe('');
    expect(event.defaultPrevented).toBe(false);
    el.remove();
  });
});
