# Testing

The project uses two runners chosen by tier:

- **`bun test`** for unit, server-integration, and native smoke tests. Specs are co-located as `*.test.ts` next to source.
- **Playwright** (WebKit) for end-to-end tests. Specs live under `tests/specs/` as `*.e2e.ts` — that suffix is intentional, since `*.spec.ts` would also be picked up by bare `bun test` and Playwright's runner cannot execute under bun:test. WebKit is the only target because Electrobun renders the desktop app in WKWebView; running E2E in Chromium would test a different engine than the shipping binary.

Run locally:

```sh
bun run test         # bun:test only
bun run test:watch   # bun:test in watch mode
bun run e2e:install  # one-time WebKit binary download (~75 MB)
bun run e2e          # Playwright against bun tests/server.ts (headless)
bun run e2e:headed   # same, headed — defaults to slowMo=700ms; override with E2E_SLOW=200
```

## Tiers

The strategy is layered. Each tier owns a slice of the codebase; together they keep CI fast while covering the parts most likely to break.

### Tier 1 — pure logic (`bun:test`)

Modules with no I/O, no DOM, no native deps. Examples: `src/client/common/interaction-mode.ts`, signal stores, URL codecs, date helpers. These run in milliseconds and exercise the patterns the rest of the codebase repeats.

Seed: `src/client/common/interaction-mode.test.ts`.

### Tier 2 — server with fixtures (`bun:test`)

In-process server modules backed by tempdir state. `item-store.ts` opens against a tempdir snapshot with an injected `PhotosWriter` and `buildFreshItems`; `state.ts` and `album-store.ts` round-trip through tempdir JSON, the latter with an injected album roster so no library is needed; `cache-root.ts` and `request-handler.ts` assert on what a tempdir holds and what a request may reach; `photos-library/db.ts` will eventually point at a committed fixture sqlite.

`request-handler.test.ts` asserts on response **status**, not bodies: `bunfig.toml` preloads happy-dom for Tier 3, which replaces the global `Response`, and happy-dom's does not special-case a `BunFile` — a served file reads back as the string `"[object Blob]"`. Anything asserting on served bytes belongs in Tier 5.

Seed: `src/server/item-store.test.ts`.

### Tier 3 — Lit components (`bun:test` + happy-dom)

Lit elements instantiated and mounted into a happy-dom document via `bunfig.toml` `[test] preload = ["./src/client/test-setup.ts"]`. Tests construct elements with `new ComponentClass()` (rather than `document.createElement`, since happy-dom doesn't auto-upgrade unregistered tags), append them to `document.body`, await `updateComplete`, then assert against `shadowRoot.textContent` or attributes. Suitable for leaf components with no transitive map/MapLibre dependencies; heavier components are best left to Tier 5 in WebKit.

Seed: `src/client/components/info-panel/index.test.ts`.

### Tier 4 — native smoke (`bun:test`, gated)

Loads `libkarttapallo.dylib` via `bun:ffi` and runs non-mutating AppleScript (`return 1`). Also probes `resizeToJpeg` against a missing input to confirm the error path returns cleanly. Skipped automatically off macOS so CI on other platforms passes. Requires `bun run build:native` first so the dylib exists.

Seed: `resources/native/native-bridge.test.ts`.

### Tier 5 — end-to-end (Playwright)

`tests/server.ts` boots the same `createApiHandler` + `createRequestHandler` the production servers (`src/server/dev.ts`, `src/server/index.ts`) use, but against a tempdir (`tests/output/data/`) pre-seeded with three fake items and a stub `PhotosLibrary`: `resolveImagePath` points every UUID at a checked-in fixture (`tests/fixtures/sample.jpg`), and `getMetadata` returns a small canned record so the info panel renders. Playwright drives WebKit against the running server.

The tempdir mirrors the production split: a stand-in bundle (`library.photoslibrary/karttapallo/`) for album data, and `derived/` for the item snapshot. Album directories are keyed by UUID here too, off a stub roster — so a spec that reaches for a file on disk has to go through the same name→UUID mapping the app does, and a spec that resets state between runs has to know where the bundle is. Getting that path wrong doesn't fail loudly; it lets state leak between tests, which is what the `beforeEach` in `routes.e2e.ts` exists to stop.

Specs are organised by user journey, not by component. Each one mirrors one or more flows from `docs/flows.md` and is named after its dominant flow; see `tests/specs/` for the current set, with the journey scope documented in each spec's header comment.

**What Tier 5 verifies:** the wired-together server (`createApiHandler` + `createRequestHandler` + Bun routing), the static-asset and image-route paths under WebKit, and the user-driven UI flows end-to-end.

**What Tier 5 does not verify:** the native bridge / image-cache codepath (the fake `PhotosLibrary` returns the fixture path directly, bypassing the dylib), real Apple Photos library reads or writes (the stub returns canned metadata and `null` for video, and a no-op `PhotosWriter` is injected so the save route never reaches AppleScript), and the Electrobun launcher (no driver — closest proxy is the WebKit engine in Playwright).

## What we do not test in CI

- The Electrobun desktop binary itself.
- Real Photos.app reads or edits — `photos-edit.ts` writes to the user's library via NSAppleScript and is exercised manually.
