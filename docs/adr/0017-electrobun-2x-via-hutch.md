# Move to Electrobun 2.x, built by Hutch

The desktop app builds on Electrobun 2.x, whose toolchain is Hutch and whose default main-process runtime is Cottontail. This supersedes [ADR-0001](0001-pin-electrobun-1.16.0.md): the pin at 1.16.0 is gone, and so is the bug it existed for.

## The pin outlived its unblock condition

ADR-0001 pinned electrobun at 1.16.0 until [oven-sh/bun#30478](https://github.com/oven-sh/bun/pull/30478) landed. It never did — the PR was closed unmerged in June 2026 because its implementation lived in Zig files that the Rust migration deleted, and [#30477](https://github.com/oven-sh/bun/issues/30477) is still open. Waiting on that PR would have been waiting forever.

The bug itself is nonetheless fixed. Electrobun 2.x bundles through Cottontail rather than `Bun.build()`, and Cottontail honours `experimentalDecorators`: the built view bundle carries `__legacyDecorateClassTS`, not `__decorateElement`, so Lit's `@property` / `@state` / `@query` / `@consume` work unchanged and the TC39 migration ADR-0001 dreaded is not needed.

## The main process stays Bun

`build.mainProcess` is `"bun"`, not the 2.x default of `"cottontail"`. The server process is not portable JavaScript: it loads the ObjC++ bridge through `bun:ffi` ([ADR-0002](0002-native-dylib-via-bun-ffi.md)) and serves the client from `Bun.serve` ([ADR-0005](0005-local-bun-serve-not-views-protocol.md)). Electrobun packages its own pinned Bun 1.4.0 for this, so the runtime is fixed by the electrobun version rather than by whatever `bun` is on PATH. Moving to Cottontail would mean re-validating both of those against a different runtime's FFI and server APIs, for no gain that this app can see; it can be a separate change if it is ever worth making.

## The SDK is no longer in node_modules

Hutch projects the SDK into a generated `.hutch/devkit/` sysroot, and the npm `electrobun` package is a bootstrap whose only export is an error pointing there. Consequences worth knowing:

- `.hutch/` is generated and gitignored. `electrobun sync` creates it, and **typecheck needs it** — CI runs `electrobun sync` before `tsc`, or `electrobun/*` imports resolve to that error module and fail with TS7016.
- `tsconfig.json` maps `electrobun` and `electrobun/main` into the devkit itself rather than extending `.hutch/devkit/tsconfig.json`, because that file sets its own `baseUrl` and a child's `paths` block replaces rather than merges — extending it would silently re-root every `@client/*` alias inside `.hutch/devkit/`.
- `@types/three` is gone. It was a devDependency only because electrobun 1.16 shipped raw `.ts` that imported the untyped `three`; nothing in this repo imports three.
- `hutch.config.ts` declares `packageManager: "bun"`. Hutch's built-in resolver would otherwise own dependencies and write its own `hutch.lock`, ignoring `bun.lock` entirely.

## Bundler plugins are gone, and were not needed

Electrobun 2.x serializes the config while loading it, so function-valued bundler plugins cannot cross that boundary. The inline `tsconfig-paths` plugin that resolved `@common/*` and friends at bundle time is deleted: Cottontail's bundler reads `paths` from `tsconfig.json` directly, which is what the plugin was hand-rolling. One mirror of the alias list instead of two.

## Signing moved out of the config

The same serialization boundary broke code signing: `electrobun.config.ts` used to set `ELECTROBUN_DEVELOPER_ID` on `process.env`, which reached 1.x's sign step because it ran in the same process. Hutch signs from another process, so the build now fails with `MissingDeveloperId`. The default lives in the `build:app:stable` script instead, where an explicit environment value still wins.

`scripts/finalize-stable.sh` survives unchanged: 2.x still emits `entitlements.plist` beside the bundle and still ships the app as a `*.tar.zst` self-extractor payload, so patching `NSAppleEventsUsageDescription` into both copies and re-signing works exactly as before. 2.x has no config field for Info.plist usage descriptions either, so the script is still needed.

What did change is the bundle's shape, and `install:app` now deletes the installed bundle before copying — see [gotchas.md](../gotchas.md).
