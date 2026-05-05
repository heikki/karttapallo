# Testing

The project uses two runners chosen by tier:

- **`bun test`** for unit, server-integration, and native smoke tests. Specs are co-located as `*.test.ts` next to source.
- **Playwright** (WebKit) for end-to-end and component tests. Specs live under `e2e/` as `*.spec.ts`. WebKit is the only target because Electrobun renders the desktop app in WKWebView; running E2E in Chromium would test a different engine than the shipping binary.

Run locally:

```sh
bun run test         # bun:test only
bun run test:watch   # bun:test in watch mode
bun run e2e:install  # one-time WebKit binary download (~75 MB)
bun run e2e          # Playwright against bun e2e/server.ts
```

## Tiers

The strategy is layered. Each tier owns a slice of the codebase; together they keep CI fast while covering the parts most likely to break.

### Tier 1 — pure logic (`bun:test`)

Modules with no I/O, no DOM, no native deps. Examples: `src/client/common/interaction-mode.ts`, signal stores, URL codecs, date helpers. These run in milliseconds and exercise the patterns the rest of the codebase repeats.

Seed: `src/client/common/interaction-mode.test.ts`.

### Tier 2 — server with fixtures (`bun:test`)

In-process server modules backed by ephemeral SQLite. `app-db.ts` opens a DB under a tempdir per test; `photos-db.ts` will eventually point at a committed fixture sqlite. API-route tests boot `Bun.serve({ port: 0 })` with injected fakes for anything macOS-specific.

Seed: `src/server/app-db.test.ts`.

### Tier 3 — Lit components (Playwright component testing)

Lit elements mounted in real WebKit. Verifies shadow-DOM rendering and event handling against the same engine the desktop app uses.

### Tier 4 — native smoke (`bun:test`, gated)

Loads `libkarttakuvat.dylib` via `bun:ffi` and runs non-mutating AppleScript (`return 1`). Also probes `resizeToJpeg` against a missing input to confirm the error path returns cleanly. Skipped automatically off macOS so CI on other platforms passes. Requires `bun run build:native` first so the dylib exists.

Seed: `resources/native/native-bridge.test.ts`.

### Tier 5 — end-to-end (Playwright)

`e2e/server.ts` boots the same `createApiHandler` + routing the production `src/server/server.ts` uses, but against a tempdir (`e2e/.data/`) pre-seeded with one fake item — so the sync-on-empty branch is skipped and no Apple Photos library access is required. Playwright drives WebKit against the running server. Catches integration breakage that unit tests miss (HTML routing, static asset serving, native bridge init via the image cache import).

Seed: `e2e/smoke.spec.ts` — verifies `/api/items` returns the seeded fixture and `<app-root>` mounts.

## What we do not test in CI

- The Electrobun desktop binary itself. No driver exists; closest proxy is Tier 5 against the web build, which shares the WebKit engine.
- Real Photos.app edits. `photos-edit.ts` writes to the user's library via NSAppleScript and is exercised manually.
