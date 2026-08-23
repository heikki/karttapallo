import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ElectrobunConfig } from 'electrobun';

// Hutch evaluates this config in its own runtime, which does not read `.env`
// the way `bun run` does. Without this the PUBLIC_* keys bake in empty and the
// app ships with the MML basemaps and routing silently switched off — a build
// that looks successful and is quietly missing features. An exported variable
// still wins, so CI and release machines can set them the usual way.
function publicKey(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  // Anchored to this file: Hutch evaluates the config from a temp directory,
  // so a cwd-relative path finds nothing.
  const dotenv = fileURLToPath(new URL('.env', import.meta.url));
  if (!existsSync(dotenv)) return '';
  for (const line of readFileSync(dotenv, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1 || trimmed.slice(0, eq).trim() !== name) continue;
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return '';
}

export default {
  app: {
    name: 'Karttapallo',
    identifier: 'com.karttapallo.app',
    version: '1.0.0',

    // `karttapallo://photo/<uuid>` opens the app on one photo — see
    // src/server/deep-link.ts. macOS registers the scheme from Info.plist
    // when it sees the bundle, which in practice means the copy in
    // /Applications that `bun run install:app` puts there; a `bun run
    // dev:app` build under build/ is not reliably picked up.
    urlSchemes: ['karttapallo']
  },

  runtime: {
    exitOnLastWindowClosed: true
  },

  build: {
    mainProcess: 'bun',

    bun: {
      entrypoint: 'src/server/index.ts',
      external: ['prettier'],
      define: {
        'process.env.PUBLIC_ORS_API_KEY': JSON.stringify(
          publicKey('PUBLIC_ORS_API_KEY')
        )
      }
    },

    views: {
      app: {
        entrypoint: 'src/client/index.ts',
        define: {
          'process.env.PUBLIC_MML_API_KEY': JSON.stringify(
            publicKey('PUBLIC_MML_API_KEY')
          ),
          'process.env.PUBLIC_ORS_API_KEY': JSON.stringify(
            publicKey('PUBLIC_ORS_API_KEY')
          )
        }
      }
    },

    copy: {
      'src/client/index.html': 'views/app/index.html',
      'src/client/styles.css': 'views/app/styles.css',
      'node_modules/maplibre-gl/dist/maplibre-gl.css':
        'views/app/maplibre-gl.css',
      // maplibre 6 is ESM-only and loads its worker as a real URL, resolved
      // against the bundle's own URL — so the worker and the sibling chunk it
      // imports have to sit next to index.js.
      'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs':
        'views/app/maplibre-gl-worker.mjs',
      'node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs':
        'views/app/maplibre-gl-shared.mjs',
      'resources/native/libkarttapallo.dylib': 'libkarttapallo.dylib'
    },

    mac: {
      icons: 'resources/icon.iconset',
      defaultRenderer: 'native',
      createDmg: false,

      // Signing runs for canary and stable builds; dev builds are never signed,
      // whatever this says, so the signed path here is `bun run install:app`.
      // The identity comes from ELECTROBUN_DEVELOPER_ID, defaulted in that
      // script. Signing makes the macOS Full Disk Access grant persist across
      // launches and shows the app as "Karttapallo" instead of "launcher" —
      // see docs/gotchas.md and docs/adr/0012.
      //
      // notarize stays false because that needs a real Developer ID
      // certificate; ours is the self-signed local identity from
      // `bun run cert`. Hutch can notarize and staple when there is one — it
      // reads App Store Connect or Apple ID credentials from the environment.
      codesign: true,
      notarize: false,
      entitlements: {
        // Bun's runtime JITs, so the hardened runtime needs both of these or the
        // signed `bun` process is killed on launch.
        'com.apple.security.cs.allow-jit': true,
        'com.apple.security.cs.allow-unsigned-executable-memory': true,
        // No disable-library-validation: Hutch signs every nested Mach-O — the
        // packaged Bun, its own dylibs, and our libkarttapallo.dylib — with
        // this identity, so library validation has nothing to reject. Under
        // Electrobun 1.x they arrived unsigned and it was required.
        // The app drives Photos.app over AppleScript (location/date/timezone
        // edits — see photos-edit.ts). Under the hardened runtime, sending
        // Apple Events is BLOCKED outright without this entitlement: macOS
        // returns errAEEventNotPermitted (-1743) and never even shows the
        // consent prompt. Adding signing (hardened runtime) without this is
        // what silently broke every write — see docs/gotchas.md.
        'com.apple.security.automation.apple-events': true
      }
    }
  }
} satisfies ElectrobunConfig;
