import type { ElectrobunConfig } from 'electrobun';

// macOS code-signing identity (create it locally with `bun run cert --create`).
// Electrobun reads the signing identity from process.env at sign time, after
// this config loads, so setting it here is enough. An explicit
// ELECTROBUN_DEVELOPER_ID already in the environment still wins, e.g. a
// Developer ID on a release machine.
process.env.ELECTROBUN_DEVELOPER_ID ??= 'Karttapallo Signing';

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
          process.env.PUBLIC_ORS_API_KEY ?? ''
        )
      }
    },

    views: {
      app: {
        entrypoint: 'src/client/index.ts',
        define: {
          'process.env.PUBLIC_MML_API_KEY': JSON.stringify(
            process.env.PUBLIC_MML_API_KEY ?? ''
          ),
          'process.env.PUBLIC_ORS_API_KEY': JSON.stringify(
            process.env.PUBLIC_ORS_API_KEY ?? ''
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

      // Sign with the identity set into process.env above, which Electrobun's
      // codesign step reads. Only `--env=stable` builds actually
      // sign — plain `electrobun build` defaults to dev and skips signing — so
      // the signed path is `bun run install:app`. Signing makes the macOS Full
      // Disk Access grant persist across launches and shows the app as
      // "Karttapallo" instead of "launcher" — see docs/gotchas.md and
      // docs/adr/0012.
      codesign: true,
      notarize: false,
      entitlements: {
        // Bun's runtime JITs, so the hardened runtime needs both of these or the
        // signed `bun` process is killed on launch.
        'com.apple.security.cs.allow-jit': true,
        'com.apple.security.cs.allow-unsigned-executable-memory': true,
        // The launcher loads dylibs (libkarttapallo.dylib, libNativeWrapper.dylib,
        // and Bun's own) that aren't signed with our identity; without this the
        // hardened runtime refuses to load them.
        'com.apple.security.cs.disable-library-validation': true,
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
