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
5. `data.ts`'s photos-load effect re-runs the URL-restored filter cascade so any search/year/album/camera that no longer exists falls back to its default.

## Server

Module set under `src/server/`:

- **`item-store.ts`** — `Item` records in memory, built from `Photos.sqlite` + `geo-tz`. Persists a snapshot to `data/libraries/{key}/items.json` so cold starts serve immediately while the post-startup rebuild refreshes. `applyEdits` re-resolves the active library first and refuses the batch if it no longer matches the one loaded at startup — see [ADR-0012](adr/0012-track-active-photos-library.md).
- **`album-store.ts`** — per-album subtree at `data/libraries/{key}/albums/{album}/` with a hard-coded `.gpx`/`.md` allowlist, `_files.json` visibility sidecar, and `_route.json`. Path-traversal is blocked at this seam; the router never builds paths from request strings.
- **`ors-client.ts`** — OpenRouteService proxy for `/api/route`. Owns API-key resolution (env first, then `ors_api_key` setting).
- **`state.ts`** — generic key-value settings, keyed by which dir is passed in. Global keys `window` and `ors_api_key` live in the top-level `data/state.json`; the per-library `view` key (map center, filters, selected photo UUID) lives in `data/libraries/{key}/state.json`. See [ADR-0006](adr/0006-flat-json-files-not-sqlite.md).
- **`photos-library/resolve-library.ts`** — resolves which library the app operates on: always the active one, decoded from the Photos container bookmark by the native bridge, failing loud rather than silently using a different library. Owns the per-library data dir (`libraryDataDir`) and its `library.json` marker. See [ADR-0012](adr/0012-track-active-photos-library.md).
- **`photos-library/image-cache.ts`** — on-demand image conversion via the native dylib, mtime-validated under `data/libraries/{key}/cache/{full,thumb}/`. See [ADR-0010](adr/0010-on-demand-image-cache.md).
- **`photos-edit.ts`** — write-back to Photos.app via NSAppleScript through the dylib (location/date target the active library; timezone is a direct SQLite write to the resolved library path). `itemStore.applyEdits` quits Photos.app at the end of a batch so the user can't undo writes via the recent-changes view.
- **`request-handler.ts`** — shared request handling for both dev and desktop entries.

### Data layout

`data/` holds a global `state.json` (only the `window` and `ors_api_key` keys) plus a per-library subtree `data/libraries/{key}/` (where `key` is a short hash of the resolved library path) containing that library's `items.json`, `cache/`, `albums/`, its own `state.json` for the per-library `view` key, and a `library.json` marker mapping the hash back to its path. Per-library namespacing is required because Apple Photos UUIDs and album names are not stable across libraries — a shared dir would collide cached images, bleed routes/visibility between libraries, and restore a selected photo / map view that doesn't belong to the active library. The active library is resolved fresh at each startup, so switching libraries in Photos.app re-points the app at a different subtree on next launch ([ADR-0012](adr/0012-track-active-photos-library.md)).

The desktop entry lives at `src/server/index.ts` (the name is required because Electrobun's launcher hardcodes `app/bun/index.js`); the dev entry lives at `src/server/dev.ts`. They differ in static-root order, a per-response hook (request logging vs FDA detection), and how a failed library resolution is surfaced (the desktop app shows a recoverable dialog with Retry; the dev server logs and exits).

## Native

`resources/native/karttapallo-bridge.mm` — ObjC++ over ImageIO (HEIC→JPEG, thumbnailing), AVFoundation (video frame extraction), and NSAppleScript (Photos edits). Compiled to `libkarttapallo.dylib` by `bun run build:native` and loaded via `bun:ffi` from `resources/native/native-bridge.ts`. Replaces an earlier subprocess pipeline — see [ADR-0002](adr/0002-native-dylib-via-bun-ffi.md). NSAppleScript main-thread requirement is documented in the source.

## Desktop app (Electrobun)

Pinned at 1.16.0 — see [ADR-0001](adr/0001-pin-electrobun-1.16.0.md). The launcher loads `app/bun/index.js`, which is the bundled `src/server/index.ts`. Application menu, sync, cache-clear, window-state persistence, external-link handling, and the Full Disk Access dialog are all wired in this file.

## URL state

App state persists in URL query params, restored on startup:

- Filters: `year`, `album`, `camera`, `gps`, `media`, `q` (applied search term)
- Selection: `id` (photo UUID)
- Map view: `lat`, `lon`, `z`
- Styles: `style` (basemap), `markers` (marker style)
- Route: `route` (presence = visible)
- Deep link: `focus` (one-shot; see below)

Defaults are omitted. The web version mirrors the URL to `localStorage` (`viewState` key); the desktop app debounces a `PUT /api/view-state` to persist under the per-library `view` key (in `data/libraries/{key}/state.json`), so the selected photo and map view restore against the right library.

## Deep links

`karttapallo://photo/<uuid>` opens the desktop app on one photo. macOS registers the scheme from `app.urlSchemes` in `electrobun.config.ts` and delivers the URL as Electrobun's `open-url` event; `src/server/deep-link.ts` parses it and `src/server/index.ts` turns it into an in-app URL. Generate links with `bun scripts/photo-link.ts <uuid>`.

The uuid rides in the path, not `?id=`, so the link can be pasted into a shell unquoted — zsh globs on `?` and rejects the command before `open` ever sees it. The older `?id=` form still parses, for links handed out before the switch.

The link resolves to `?id=<uuid>&focus=1`, carrying only `style` and `markers` over from the saved view. `focus` is what makes the difference between a restored selection and a requested one, and it licenses two overrides that plain `id` must never take: `@common/deep-link` widens filters via `data.revealPhoto` until the photo is visible, and `<map-fit>` moves the camera to it instead of fitting all photos. Both matter because the photos most worth linking to are the ones missing a location, which the default GPS filter hides. `focus` is stripped from the URL once acted on, so it can't survive into the persisted view and fire again on the next launch.

Two arrival times are handled: the app was already running (navigate the existing window and focus it), or macOS launched it to serve the link, in which case the event can land before the window exists and the uuid is buffered as the window's initial URL. A link clicked while the app is closed is lost entirely — see [gotchas.md](gotchas.md).

## Where things live

- **Why** a thing is the way it is → [docs/adr/](adr/)
- **What** terms mean → [CONTEXT.md](../CONTEXT.md)
- **What surprises** are out there → [gotchas.md](gotchas.md)
- **What the user does** → [flows.md](flows.md)
- **How we test** → [testing.md](testing.md)
- **When things changed** → [diary.md](diary.md)
