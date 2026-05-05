import { describe, expect, test } from 'bun:test';

import { MetadataModal } from './index';

const sampleData = {
  filename: 'IMG_0001.HEIC',
  date: '2024-06-01T12:00:00',
  camera: 'iPhone 15',
  uuid: 'fixture-uuid'
};

const mount = async (): Promise<MetadataModal> => {
  const el = new MetadataModal();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

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
