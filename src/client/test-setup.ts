/**
 * Registers happy-dom globals (document, window, customElements, etc.) so
 * Lit components can mount inside bun:test. Loaded via bunfig.toml [test]
 * preload.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
