import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ElectrobunConfig } from 'electrobun';

const baseDir = resolve('.');

// macOS code-signing identity (create it locally with `bun run cert --create`).
// Electrobun reads the signing identity from process.env at sign time (lazily,
// in its codesign step after this config loads — cli/index.ts ~4440), so setting
// it here is enough. An explicit ELECTROBUN_DEVELOPER_ID already in the
// environment still wins, e.g. a Developer ID on a release machine.
process.env.ELECTROBUN_DEVELOPER_ID ??= 'Karttapallo Signing';

// Aliases never include extensions, so we always append one. Listing
// '/index.ts' as a candidate (rather than relying on directory fall-through)
// matters because existsSync returns true for directories, which would
// otherwise short-circuit to a path Bun then can't read.
function resolveWithExtensions(basePath: string): string {
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return basePath;
}

// Inline plugin to resolve tsconfig path aliases at bundle time. Mirrors the
// `paths` block in tsconfig.json — keep both in sync.
const ALIASES: Array<{ prefix: string; target: string }> = [
  { prefix: '@common/', target: 'src/client/common' },
  { prefix: '@components/', target: 'src/client/components' },
  { prefix: '@client/', target: 'src/client' },
  { prefix: '@server/', target: 'src/server' },
  { prefix: '@native/', target: 'resources/native' }
];

const pathAliasPlugin = {
  name: 'tsconfig-paths',
  setup(build: {
    onResolve: (
      opts: { filter: RegExp },
      cb: (args: { path: string }) => { path: string }
    ) => void;
  }) {
    for (const { prefix, target } of ALIASES) {
      const filter = new RegExp(`^${prefix.replace('/', '\\/')}`);
      build.onResolve(
        { filter },
        (args: { path: string }): { path: string } => ({
          path: resolveWithExtensions(
            resolve(baseDir, target, args.path.replace(prefix, ''))
          )
        })
      );
    }
  }
};

export default {
  app: {
    name: 'Karttapallo',
    identifier: 'com.karttapallo.app',
    version: '1.0.0'
  },

  runtime: {
    exitOnLastWindowClosed: true
  },

  build: {
    bun: {
      entrypoint: 'src/server/index.ts',
      external: ['prettier'],
      plugins: [pathAliasPlugin],
      define: {
        'process.env.PUBLIC_ORS_API_KEY': JSON.stringify(
          process.env.PUBLIC_ORS_API_KEY ?? ''
        )
      }
    },

    views: {
      app: {
        entrypoint: 'src/client/index.ts',
        plugins: [pathAliasPlugin],
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
        'com.apple.security.cs.disable-library-validation': true
      }
    }
  }
} satisfies ElectrobunConfig;
