import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ElectrobunConfig } from 'electrobun';

const baseDir = resolve('.');

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
      createDmg: false
    }
  }
} satisfies ElectrobunConfig;
