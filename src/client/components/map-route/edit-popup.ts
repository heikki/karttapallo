import type { Map as MapGL } from 'maplibre-gl';

import { HAS_ROUTING } from '@common/features';

import type { RouteSegment } from './route-data';

interface SegmentPopupOpts {
  map: MapGL;
  lngLat: [number, number];
  currentMethod: RouteSegment['method'];
  onSelect: (method: RouteSegment['method']) => void;
}

export function createSegmentPopup(opts: SegmentPopupOpts): HTMLElement {
  const px = opts.map.project(opts.lngLat);

  const el = document.createElement('div');
  el.className = 'route-edit-popup';
  el.innerHTML = [
    '<button data-method="straight">Straight</button>',
    ...(HAS_ROUTING
      ? [
          '<button data-method="driving">Drive</button>',
          '<button data-method="hiking">Hike</button>'
        ]
      : []),
    '<button data-method="none">None</button>'
  ].join('');

  el.style.cssText =
    `position:absolute;left:${px.x}px;top:${px.y}px;transform:translate(-50%,-100%) translateY(-8px);` +
    'background:rgba(44,44,46,0.95);border-radius:8px;padding:4px;display:flex;gap:2px;z-index:1500;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.5)';

  const buttons = Array.from(el.querySelectorAll('button'));
  for (const btn of buttons) {
    btn.style.cssText =
      'background:none;border:none;color:#e5e5e7;padding:6px 10px;border-radius:6px;' +
      'font:12px/1 -apple-system,sans-serif;cursor:pointer;white-space:nowrap';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.1)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
    });
    btn.addEventListener('click', (ev: MouseEvent) => {
      ev.stopPropagation();
      opts.onSelect(btn.dataset.method as RouteSegment['method']);
    });
  }

  const activeBtn = el.querySelector<HTMLElement>(
    `[data-method="${opts.currentMethod}"]`
  );
  if (activeBtn !== null) {
    activeBtn.style.background = 'rgba(96,165,250,0.3)';
  }

  return el;
}

export function showRouteError(map: MapGL, msg: string): void {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText =
    'position:absolute;top:12px;left:50%;transform:translateX(-50%);' +
    'background:rgba(220,38,38,0.9);color:#fff;padding:8px 16px;border-radius:8px;' +
    'font:13px/1.4 -apple-system,sans-serif;z-index:1500;pointer-events:none;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.3)';
  map.getContainer().appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3000);
}
