# App

Lit + signals client (`src/client/`), Bun server (`src/server/`), ObjC++ native bridge via `bun:ffi` (`resources/native/`). The desktop app wraps the same server in Electrobun. Both `bun run dev` and the desktop app share `createRequestHandler` and run a local `Bun.serve({ port: 0 })` — see [ADR-0005](adr/0005-local-bun-serve-not-views-protocol.md).

## Client

- **Components** — `<filter-panel>`, `<photo-popup>`, `<photo-lightbox>`, `<info-panel>`, `<files-modal>`, `<app-root>`, `<map-view>` and the `<map-*>` map features. Built on Lit ([ADR-0003](adr/0003-lit-web-components-for-ui.md)).
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

- **`item-store.ts`** — `Item` records in memory, built from `Photos.sqlite` + `geo-tz`, with the searchable terms (place, description, categories) merged in from `psi.sqlite` — see [ADR-0014](adr/0014-search-over-derived-metadata-not-photos-search.md). Persists a snapshot to `items.json` in the cache root so cold starts serve immediately while the post-startup rebuild refreshes. `applyEdits` re-resolves the active library first and refuses the batch if it no longer matches the one loaded at startup — see [ADR-0012](adr/0012-track-active-photos-library.md).
- **`album-store.ts`** — per-album subtree at `<library>/karttapallo/albums/{albumUuid}/` with a hard-coded `.gpx`/`.md` allowlist, `_files.json` visibility sidecar, and `_route.json`. Callers address albums by **name**; the store translates to UUID off a roster read from the library, so a rename in Photos doesn't strand a route ([ADR-0015](adr/0015-store-library-data-inside-the-bundle.md)). `pruneOrphans` drops subtrees for albums the library no longer has. Path-traversal is blocked at this seam; the router never builds paths from request strings.
- **`cache-root.ts`** — claims the derived-data slot for one library, wiping it when `owner.json` names a different one. Runs before the image cache, which creates its subdirectories at construction.
- **`ors-client.ts`** — OpenRouteService proxy for `/api/route`. Owns API-key resolution (env first, then `ors_api_key` setting).
- **`state.ts`** — generic key-value settings, keyed by which dir is passed in. Machine-scoped keys `window` and `ors_api_key` live in `Application Support/Karttapallo/state.json`; the per-library `view` key (map center, filters, selected photo UUID) lives in `<library>/karttapallo/state.json`, so it travels with the library. See [ADR-0006](adr/0006-flat-json-files-not-sqlite.md).
- **`request-handler.ts`** — shared request handling for both dev and desktop entries. Static paths are resolved and then checked for containment in their root: the URL parser strips a literal `../`, but `%2e%2e%2f` survives decoding as a real one.
- **`photos-library/resolve-library.ts`** — resolves which library the app operates on: always the active one, decoded from the Photos container bookmark by the native bridge, failing loud rather than silently using a different library. See [ADR-0012](adr/0012-track-active-photos-library.md).
- **`photos-library/image-cache.ts`** — on-demand image conversion via the native dylib, mtime-validated under `Caches/Karttapallo/cache/{full,thumb}/`. See [ADR-0010](adr/0010-on-demand-image-cache.md).
- **`photos-edit.ts`** — write-back to Photos.app via NSAppleScript through the dylib (location/date target the active library; timezone is a direct SQLite write to the resolved library path). `itemStore.applyEdits` quits Photos.app at the end of a batch so the user can't undo writes via the recent-changes view.

### Data layout

Three roots, split by what the data _is_ rather than which library it belongs to ([ADR-0015](adr/0015-store-library-data-inside-the-bundle.md)):

| Root                                         | Holds                                             | Backed up |
| -------------------------------------------- | ------------------------------------------------- | --------- |
| `<library>.photoslibrary/karttapallo/`       | `state.json` (`view`), `albums/{albumUuid}/`      | yes       |
| `~/Library/Application Support/Karttapallo/` | `state.json` (`window`, `ors_api_key`)            | yes       |
| `~/Library/Caches/Karttapallo/`              | `owner.json`, `items.json`, `cache/{full,thumb}/` | no        |

The rule for anything new: authored by the user → the bundle; recomputable from Photos → Caches; describes this Mac → Application Support.

Handmade data lives **inside the library bundle** so it travels with it — a move, a rename, or a copy to another Mac carries the routes along, and nothing has to work out which stored directory belongs to which library. Derived data is a **single slot** stamped with `owner.json`; opening a different library empties it, which is affordable because the snapshot is rebuilt every startup anyway and the image cache is lazy and per-entry mtime-validated. `~/Library/Caches` is Time Machine-excluded by path policy, so the regenerable gigabytes stay out of backups while the ~11 MB that can't be regenerated is inside the bundle and covered.

A dev or test run that redirects the support dir (`KARTTAPALLO_DATA_DIR`, or a project-local `.data/`) keeps its derived data beside it in `derived/`, so one directory holds everything that run created.

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

Defaults are omitted. The web version mirrors the URL to `localStorage` (`viewState` key); the desktop app debounces a `PUT /api/view-state` to persist under the per-library `view` key (in `<library>/karttapallo/state.json`), so the selected photo and map view restore against the right library — and on whichever Mac that library is opened on.

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
