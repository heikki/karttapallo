import { HAS_MML } from './features';
import { urlSignal } from './url-state';

export const viewState = {
  mapStyle: urlSignal(
    'style',
    (raw) => {
      if (raw === null) return 'satellite';
      if (!HAS_MML && raw.startsWith('mml_')) return 'satellite';
      return raw;
    },
    (v) => (v === 'satellite' ? null : v)
  ),
  markerStyle: urlSignal(
    'markers',
    (raw) => raw ?? 'classic',
    (v) => (v === 'classic' ? null : v)
  ),
  routeVisible: urlSignal(
    'route',
    (raw) => raw === '1',
    (v) => (v ? '1' : null)
  )
};
