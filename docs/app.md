# App

Lit + signals client (`src/client/`), Bun server (`src/server/`), ObjC++ native bridge via `bun:ffi` (`resources/native/`). The desktop app wraps the same server in Electrobun. Both `bun run dev` and the desktop app share `createRequestHandler` and run a local `Bun.serve({ port: 0 })` — see [ADR-0005](adr/0005-local-bun-serve-not-views-protocol.md).

## Client

- **Components** — `<filter-panel>`, `<photo-popup>`, `<photo-lightbox>`, `<metadata-modal>`, `<files-modal>`, `<app-root>`, `<map-view>` and the `<map-*>` map features. Built on Lit ([ADR-0003](adr/0003-lit-web-components-for-ui.md)).
- **Map features** — each `<map-*>` element extends `MapFeatureElement`, gets the map handle via `@consume(mapContext)`, and lives in `src/client/components/map-*/`. `<map-view>` owns `setupMap()` and the basemap-style effect.
- **Cross-feature ops** go through the `MapApi` interface — see [ADR-0007](adr/0007-mapapi-cross-feature-seam.md). Adding one is a deliberate two-step: declare in `MapApi`, implement the forwarder.
- **Layer order** = template order — see [ADR-0008](adr/0008-dom-order-as-z-order.md). `<map-markers>` keeps its z-position across runtime layer swaps via the invisible `markers-anchor` symbol layer.
- **State** lives in `@lit-labs/signals` stores under `@common/` — see [ADR-0004](adr/0004-signals-for-state.md). The stores are `data`, `edits`, `selection`, `view-state`, `interaction-mode`, plus the `urlSignal()` primitive in `url-state`.
- **Interaction modes** (`placement` | `measure` | `route-edit`) are mutually exclusive via one signal — see [ADR-0009](adr/0009-single-interaction-mode-signal.md).
- **Commands** live alongside the state they touch (`data.*` verbs, `interactionMode.*`, `selection.*`). `@common/actions` is the one-shot verbs barrel for Lit components — modal openers, MapApi forwarders, and `saveEdits` — see [ADR-0011](adr/0011-actions-as-one-shot-verbs-barrel.md). Multi-step orchestrations (e.g. the Reset button's filter + URL + viewState + map sequence) stay inlined at their call site.

### Startup

1. URL-bound view-state signals (`mapStyle`, `markerStyle`, `routeVisible`, `selectedPhotoUuid`) seed synchronously at module load.
2. `<app-root>` mounts, installs window-level handlers, kicks off `data.loadPhotos()`, renders `<map-view>` plus panel components.
3. `<map-view>`'s `firstUpdated` calls `setupMap(container, this)` and registers `map.once('load')`.
4. On map load, `<map-view>` flips `_map`, which mounts the `<map-*>` feature children. Each feature's `firstUpdated` adds its layers and effects (template order = z-order).
5. `data.ts`'s photos-load effect re-runs the URL-restored filter cascade so any album/camera that no longer exists falls back to `'all'`.

## Server

Module set under `src/server/`:

- **`item-store.ts`** — `Item` records in memory, built from `Photos.sqlite` + `geo-tz`. Persists a snapshot to `data/items.json` so cold starts serve immediately while the post-startup rebuild refreshes.
- **`album-store.ts`** — per-album subtree at `data/albums/{album}/` with a hard-coded `.gpx`/`.md` allowlist, `_files.json` visibility sidecar, and `_route.json`. Path-traversal is blocked at this seam; the router never builds paths from request strings.
- **`ors-client.ts`** — OpenRouteService proxy for `/api/route`. Owns API-key resolution (env first, then `ors_api_key` setting).
- **`state.ts`** — generic settings (`view`, `window`, `ors_api_key`) in `data/state.json`. See [ADR-0006](adr/0006-flat-json-files-not-sqlite.md).
- **`photos-library/image-cache.ts`** — on-demand image conversion via the native dylib, mtime-validated under `data/cache/{full,thumb}/`. See [ADR-0010](adr/0010-on-demand-image-cache.md).
- **`photos-edit.ts`** — write-back to Photos.app via NSAppleScript through the dylib. `itemStore.applyEdits` quits Photos.app at the end of a batch so the user can't undo writes via the recent-changes view.
- **`request-handler.ts`** — shared request handling for both dev and desktop entries.

The desktop entry lives at `src/server/index.ts` (the name is required because Electrobun's launcher hardcodes `app/bun/index.js`); the dev entry lives at `src/server/dev.ts`. They differ only in static-root order and a per-response hook (request logging vs FDA detection).

## Native

`resources/native/karttapallo-bridge.mm` — ObjC++ over ImageIO (HEIC→JPEG, thumbnailing), AVFoundation (video frame extraction), and NSAppleScript (Photos edits). Compiled to `libkarttapallo.dylib` by `bun run build:native` and loaded via `bun:ffi` from `resources/native/native-bridge.ts`. Replaces an earlier subprocess pipeline — see [ADR-0002](adr/0002-native-dylib-via-bun-ffi.md). NSAppleScript main-thread requirement is documented in the source.

## Desktop app (Electrobun)

Pinned at 1.16.0 — see [ADR-0001](adr/0001-pin-electrobun-1.16.0.md). The launcher loads `app/bun/index.js`, which is the bundled `src/server/index.ts`. Application menu, sync, cache-clear, iCloud Drive backup, window-state persistence, external-link handling, and the Full Disk Access dialog are all wired in this file.

## URL state

App state persists in URL query params, restored on startup:

- Filters: `year`, `album`, `camera`, `gps`, `media`
- Selection: `id` (photo UUID)
- Map view: `lat`, `lon`, `z`
- Styles: `style` (basemap), `markers` (marker style)
- Route: `route` (presence = visible)

Defaults are omitted. The web version mirrors the URL to `localStorage` (`viewState` key); the desktop app debounces a `PUT /api/view-state` to persist under the `view` key in `state.json`.

## Where things live

- **Why** a thing is the way it is → [docs/adr/](adr/)
- **What** terms mean → [CONTEXT.md](../CONTEXT.md)
- **What surprises** are out there → [gotchas.md](gotchas.md)
- **What the user does** → [flows.md](flows.md)
- **How we test** → [testing.md](testing.md)
- **When things changed** → [diary.md](diary.md)
