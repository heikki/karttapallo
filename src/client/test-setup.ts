/**
 * Registers happy-dom globals (document, window, customElements, etc.) so
 * Lit components can mount inside bun:test. Loaded via bunfig.toml [test]
 * preload.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Block any accidental Photos.app write the moment a test imports a
// module that calls into photos-edit. Set before happy-dom registers so
// it covers code that reads env at module load too.
process.env.KARTTAKUVAT_NO_PHOTOS_WRITES = '1';

// happy-dom defaults to `about:blank`, where `history.replaceState` no-ops.
// Seeding a real URL lets URL-bound signals and mapView codec round-trip.
GlobalRegistrator.register({ url: 'http://localhost/' });
