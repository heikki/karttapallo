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

### The hardened runtime blocks AppleScript writes without the apple-events entitlement

Signing the stable build turns on the **hardened runtime** (`codesign … flags=0x10000(runtime)`; it's what the `com.apple.security.cs.*` entitlements imply). Under the hardened runtime an app **cannot send Apple Events at all** unless it carries `com.apple.security.automation.apple-events`. Without it every `tell application "Photos"` — the location/date/timezone write path in `photos-edit.ts` — fails with _"Not authorized to send Apple events to Photos"_ (`errAEEventNotPermitted`, ‑1743), and macOS **never shows the consent prompt**, so no Automation entry ever appears in System Settings.

This is a silent trap: adding signing (for the persistent FDA grant, above) simultaneously broke every Photos write, because dev builds have no hardened runtime and so sent Apple Events fine. The entitlement lives in `electrobun.config.ts` alongside the JIT/library-validation ones.

**The entitlement alone is not enough — you also need the `NSAppleEventsUsageDescription` Info.plist string.** Without the usage string, macOS still auto-denies Automation and _still never prompts_ — indistinguishable from the missing-entitlement case. Electrobun's CLI _does_ auto-derive usage strings from entitlements, but its `ENTITLEMENT_TO_PLIST_KEY` map omits `apple-events`, and the CLI ships as a **prebuilt binary** (the `electrobun` npm bin downloads and runs it), so the map cannot be patched from source — a `bun patch` on `node_modules/electrobun/src/cli/index.ts` is inert. So the key is injected post-build by `scripts/finalize-stable.sh` (run automatically by `bun run install:app`, after the build and before the copy to `/Applications`).

The subtle part: an `--env=stable` build is a **self-extractor**. The real app bundle lives compressed in `Contents/Resources/<hash>.tar.zst` and is unpacked _over the bundle_ on first launch — this overwrites `Contents/Info.plist` with the payload's copy. So patching only the outer `Contents/Info.plist` is useless (the first launch reverts it — this is exactly the bug that made the prompt never appear). `finalize-stable.sh` therefore unpacks the payload, injects the key into the **payload's** `Info.plist`, re-signs that inner bundle so its own `Contents/_CodeSignature` covers the change, repacks the tarball with the same `tar -cf`/zstd Electrobun uses, then patches and re-signs the outer bundle too. Verify a build with: `zstd -dc "$(ls build/stable-macos-arm64/Karttapallo.app/Contents/Resources/*.tar.zst)" | tar -xOf - Karttapallo.app/Contents/Info.plist | grep NSAppleEvents`. After reinstalling, the first edit shows _"Karttapallo wants to control Photos"_ → Allow. If the prompt is stuck from a previous denied state, clear it with `tccutil reset AppleEvents com.karttapallo.app`.

The failure was invisible for a second reason: `alert()` is a **no-op** in Electrobun's WKWebView (the host wires up no JS-dialog delegate), and the save path both swallowed the per-edit error and mutated the display optimistically — so a rejected write looked applied until the next rebuild reverted it. Fixed by returning per-edit `failures` from `/api/save-edits`, only mutating on success, and routing failures to the Shift+D debug log (not just `alert`). When surfacing errors to the user, prefer the debug log — `alert()` cannot be relied on here.

### `electrobun dev` reuses cached binaries

`electrobun dev` may reuse a cached `Resources/app` bundle, so source edits silently don't take effect. To force a clean rebuild, delete `build/dev-macos-arm64/.../Resources/app`, or run `electrobun build` first.

## WKWebView CSS

### Always prefix `user-select`

This app's WKWebView is older than Safari 17.4 and silently drops unprefixed `user-select` — the bundle contains the declaration but the rendered CSSStyleRule in Web Inspector does not. Only `-webkit-user-select` is honored. When writing client CSS (Lit `css` literals or plain CSS), always use `-webkit-user-select`; the unprefixed companion adds noise without effect on this target.

Verified 2026-05-09 by inspecting the rendered shadow-DOM `:host` rule for `<filter-panel>`.

## Shadow DOM in WebKit

### Cmd+C over a selection inside a shadow root copies nothing

WebKit highlights the selection and dispatches a `copy` event, but hands it an
**empty** `clipboardData` when the selected text lives in a shadow tree — so the
clipboard silently keeps whatever it held before. Any component with selectable
text inside its shadow root has to fill the payload in itself: listen for `copy`,
read the selection, `clipboardData.setData('text/plain', …)`, `preventDefault()`.
See `_onCopy` in `src/client/components/metadata-modal/index.ts`.

Reading the selection needs care too. `document.getSelection()` reports a
collapsed caret retargeted to the light-DOM host (`APP-ROOT` here), so it can't
locate the range; `ShadowRoot.getSelection()` is Chrome-only. What works is
`Selection.getComposedRanges({ shadowRoots: [root] })` (WebKit 17+), whose
`StaticRange` can be copied into a live `Range` to read `toString()` — and it
also tells you whether the selection is inside your root at all, which
`Selection.toString()` cannot.

Verified 2026-07-30 in Playwright WebKit against the metadata modal: the `copy`
event arrived with `''` while `getComposedRanges` returned the right text.

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

### `ZEXTENDEDATTRIBUTES` is not an EXIF table

It holds aperture, ISO and camera model, so it reads like one. It is not — it is Photos' general per-asset metadata cache, and `ZDATECREATED`, `ZTIMEZONEOFFSET` and `ZTIMEZONENAME` are the only columns it fills for **every** asset. A file the camera wrote no EXIF into still gets a date there, sourced from whatever Photos could find, and that can be an artifact of copying with no bearing on when the thing was shot.

In this library 554 of 4841 assets carry no camera metadata at all — every video from a camera that writes none, plus screenshots, scans and stripped exports. For one album's clips the stored dates all fall inside a nine-minute window, ascending in exact filename order, while the clips themselves span a month: a copy session, recorded as if it were the filming.

Nothing in the schema records where the date came from, so infer it from the shooting fields — make, model, lens, ISO, aperture, shutter speed, focal length. If any survived, Photos had an EXIF block to read the date from too. **Make and model alone are too narrow**: some stills have both stripped while keeping ISO, aperture and a lens model, and testing on those two blanks a date the camera really did record.

Photos writes the row once at import and never saves it again — `Z_OPT` stays at 1 while `ZASSET` climbs into the teens — so no later date edit touches it, through Photos or otherwise. That also makes it the last surviving record of a capture time once the originals themselves have been rewritten by copying, which is a reason not to clear it. Clearing would not stick anyway (see the journal-coalesce gotcha above), and the same row carries duration, fps and codec.

### `ZINFERREDTIMEZONEOFFSET` is populated for everything and still wrong often enough not to use

Photos fills it for all 4841 assets, which makes it look like a free answer to "what zone was this taken in". It disagrees with a coordinate-derived offset for 955 of the 4649 assets where both can be computed. Iceland is the clearest failure: 37 assets there claim +3600 where 0 is correct.

Derive the offset from coordinates instead (ADR-0013). Do not read this column, and do not treat agreement with it as corroboration.

### A `karttapallo://` link is dropped when it launches the app

macOS delivers the URL as an Apple Event while the bundle is still starting, and Electrobun's native side keeps no queue for one that arrives before `setURLOpenHandler` is called — which happens in the Bun child process, seconds into launch. So a link clicked while the app is **closed** launches the app on its saved view and the requested photo is silently lost. Clicking it again, with the app up, works: that path is delivered to the running window and is verified.

Nothing in `src/server/index.ts` can recover it — the uuid is buffered there as early as possible and consumed as the window's initial URL, which covers an event that lands after the Bun process is alive but before the window exists. The gap is earlier than any JavaScript we get to run, and closing it means patching Electrobun's prebuilt launcher to hold the URL until a handler registers.

Separately: replacing `/Applications/Karttapallo.app` in place does **not** make LaunchServices notice a newly declared URL scheme — `open` keeps answering `kLSApplicationNotFoundErr` against a bundle whose `Info.plist` plainly declares it. `bun run install:app` therefore ends with `lsregister -f` on the installed bundle.
