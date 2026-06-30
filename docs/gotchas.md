# Gotchas

Non-obvious behaviors and workarounds that are easy to rediscover the hard way. Conventions and rationale that don't fit naturally next to a single call site.

## Electrobun runtime

### Worker-thread console output is not forwarded

Anything `console.log`'d from a worker thread inside the Electrobun launcher disappears — the launcher only forwards main-thread stdout. When debugging worker code, log to a file instead.

### Load the webview URL at window creation, not via a later `loadURL`

Pass the real app URL to the `BrowserWindow` constructor (`url: buildViewUrl()` in `src/server/index.ts`). Electrobun hands the constructor `url` to the native webview at creation (`BrowserView.init` → `createWebview({ url })`), so this is race-free.

Do **not** create the window with `url: 'about:blank'` and then call `win.webview.loadURL(...)` separately during synchronous startup: `loadURL` fires `loadURLInWebView(this.ptr, ...)` immediately, and if it runs before the native webview has finished initializing, the navigation is dropped and the window stays permanently blank. This bit us once — the code "worked" only because an unrelated top-level `await import(...)` happened to yield a tick before the `loadURL`; deleting that import (it was for a since-removed iCloud backup) silently broke the production app while the dev server stayed fine. Later reloads (e.g. the post-rebuild refresh) are safe because the webview is long initialized by then.

Verified 2026-06-30 by bisecting an empty-window regression to the import removal; the browser rendered the identical bundle correctly, isolating it to the WKWebView load timing.

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
