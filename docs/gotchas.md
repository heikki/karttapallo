# Gotchas

Non-obvious behaviors and workarounds that are easy to rediscover the hard way. Conventions and rationale that don't fit naturally next to a single call site.

## Electrobun runtime

### Worker-thread console output is not forwarded

Anything `console.log`'d from a worker thread inside the Electrobun launcher disappears — the launcher only forwards main-thread stdout. When debugging worker code, log to a file instead.

### Load the webview URL at window creation, not via a later `loadURL`

Pass the real app URL to the `BrowserWindow` constructor (`url: buildViewUrl()` in `src/server/index.ts`). Electrobun hands the constructor `url` to the native webview at creation (`BrowserView.init` → `createWebview({ url })`), so this is race-free.

Do **not** create the window with `url: 'about:blank'` and then call `win.webview.loadURL(...)` separately during synchronous startup: `loadURL` fires `loadURLInWebView(this.ptr, ...)` immediately, and if it runs before the native webview has finished initializing, the navigation is dropped and the window stays permanently blank. This bit us once — the code "worked" only because an unrelated top-level `await import(...)` happened to yield a tick before the `loadURL`; deleting that import (it was for a since-removed iCloud backup) silently broke the production app while the dev server stayed fine. Later reloads (e.g. the post-rebuild refresh) are safe because the webview is long initialized by then.

Verified 2026-06-30 by bisecting an empty-window regression to the import removal; the browser rendered the identical bundle correctly, isolating it to the WKWebView load timing.

### Ad-hoc signing makes the TCC grant re-prompt every launch

The app reads another app's container at startup to find the active Photos
library (`resolveActiveLibraryPath` → `com.apple.Photos.plist`; see
[ADR-0012](adr/0012-track-active-photos-library.md)), which trips the
`kTCCServiceSystemPolicyAppData` permission ("...wants to access data from other
apps"). With only an ad-hoc signature macOS has no stable code identity to pin
the grant to, so it forgets it and re-prompts on every launch — and the app
shows as "launcher" rather than "Karttapallo". The fix is a stable code signature
**plus a Full Disk Access grant** (signing alone isn't enough — FDA is what
persists), not caching the path (ADR-0012 wants the detection to run fresh each
launch).
**Setup.** `bun run cert --create` makes a self-signed code-signing cert — it
need **not** be trusted (`CSSMERR_TP_NOT_TRUSTED` is fine; TCC keys on a stable
identity, not Gatekeeper trust). The identity is hardcoded in
`electrobun.config.ts` and only applies to `--env=stable` builds; a plain
`build:app` is `--env=dev` and never signs. Then `bun run install:app` signs the
build, and you add the app under System Settings ▸ Full Disk Access — the in-app
"Salli" prompt does **not** persist, only the explicit FDA entry does.

Don't be alarmed that `codesign --verify --deep --strict` fails afterward ("code
or signature have been modified"): Electrobun's `--env=stable` bundle is a
self-extractor that unpacks its payload into `Contents/Resources/app/` on first
launch, breaking the static seal. TCC validates the live launcher process (which
extraction doesn't touch), so the FDA grant still holds — no re-signing needed.

### `electrobun dev` reuses cached binaries

`electrobun dev` may reuse a cached `Resources/app` bundle, so source edits silently don't take effect. To force a clean rebuild, delete `build/dev-macos-arm64/.../Resources/app`, or run `electrobun build` first.

## WKWebView CSS

### Always prefix `user-select`

This app's WKWebView is older than Safari 17.4 and silently drops unprefixed `user-select` — the bundle contains the declaration but the rendered CSSStyleRule in Web Inspector does not. Only `-webkit-user-select` is honored. When writing client CSS (Lit `css` literals or plain CSS), always use `-webkit-user-select`; the unprefixed companion adds noise without effect on this target.

Verified 2026-05-09 by inspecting the rendered shadow-DOM `:host` rule for `<filter-panel>`.

## MapLibre basemap swap

The basemap swap in `src/client/components/map-view/setup.ts` uses `setStyle(next, { transformStyle })`, where `transformStyle` carries app-owned sources and layers from `previousStyle` into the merged result by subtracting all basemap-config IDs.

Smoke-tested 2026-04-29 (10 scenarios). The following survive the swap and do **not** need a `style.load` re-install hook:

- **GeoJSON `setData()` state** — sources installed at boot and populated via `setData()` keep their data.
- **Custom WebGL layers** — `CustomLayerInterface` instances (e.g. `BloomLayer` in `points-layer/`) are carried like any other layer.
- **Layer-bound event handlers** — `map.on('click' | 'mouseenter' | 'mouseleave', layerId, fn)` bindings remain attached.

When adding a new map subsystem (GeoJSON source, custom WebGL layer, or layer-bound handler), install it once at boot in `initMap()`'s `map.on('load', ...)` handler. Do not add a `style.load` re-install — `transformStyle` will carry it across basemap swaps.

**Caveats:**

- Sprite or glyph changes force a full style reload regardless of `transformStyle`. All current basemaps are raster-only; if a vector basemap is added, this assumption needs re-verification.
- Holds for the `maplibre-gl` version pinned in `package.json`. A major upgrade may change behavior.

## Apple Photos library internals

### Direct SQLite writes to `Photos.sqlite` survive only until the next journal coalesce — they are **not** durable

Photos does not treat `database/Photos.sqlite` as the source of truth for backup/restore. The real record of every asset lives in `resources/journals/`:

- **`Asset-snapshot.plj`** — a full snapshot of all assets (~90 fields each), regenerated periodically by reading live SQLite.
- **`Asset-change.plj`** — an append-only log of field-level changes since the last snapshot.

To reconstruct the library, Photos replays the snapshot and then applies the change log on top. **A restore rebuilds `Photos.sqlite` from these journals**, not from the `.sqlite` file itself — and `database/` and `external/` carry `com.apple.metadata:com_apple_backup_excludeItem`, so they are _not_ backed up at all. Everything else (`originals/`, `resources/`, `internal/`, `private/`, `scopes/`) is.

The consequence for us: **whether a direct-SQLite write survives a restore depends entirely on timing.**

- **AppleScript writes** (location via `set location`, date via `set date` — see `photos-edit.ts`) go through Photos.app, which journals them into `Asset-change.plj` immediately. They are durable the moment they're made.
- **Direct SQLite writes** (timezone via `setTimezone` — `UPDATE ZADDITIONALASSETATTRIBUTES`) are invisible to Photos and never journaled directly. They only become durable when photolibraryd next _coalesces_ — folds the change log back into `Asset-snapshot.plj` by re-reading live SQLite. If a restore happens before that coalesce, the write is gone.

**Coalescing is opportunistic and unpredictable.** It is not triggered by opening, closing, or rebuilding the library, and shows no correlation with library size, change-log length, or age — it's background photolibraryd maintenance that fires whenever it fires. You can observe the last coalesce via `coalesceDate` in `resources/journals/Asset.plist`, and confirm whether a given direct write was swept in by grepping `Asset-snapshot.plj` for the value written (e.g. an IANA zone name like `Europe/Helsinki`, which Photos itself never writes — it uses `GMT+nnnn`).

This is exactly how a batch of timezone edits was silently lost: the edits landed in the 7-week gap between the last coalesce (snapshot frozen) and a restore from an external drive, while the location/date edits from the same sessions — being AppleScript/journaled — survived. See [ADR-0013](adr/0013-derive-timezone-from-instant-and-coords.md) for the structural fix (stop depending on the offset column being durable).
