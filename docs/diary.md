# Development Diary

Geotagged photo map viewer with Apple Photos integration.

## Project Stats (as of 05.05.2026)

- **TypeScript files**: 85
- **Lines of code**: 12,299 (+ 1,689 tests)
- **Total commits**: 546
- **Total tokens**: ~2,045M | **Total cost**: ~$1,254

## Updating This Diary

When adding an entry:

1. Write the entry under a new `## DD.MM.YYYY` heading.
2. Refresh the Project Stats block at the top — file count, LOC, commits, cumulative tokens/cost.

Gather data with:

```bash
bunx ccusage                    # Token usage and cost per day
git log --oneline | wc -l       # Total commits
find . -name "*.ts" -not -path "./node_modules/*" -not -name "*.test.ts" -not -name "*.e2e.ts" -not -path "./e2e/*" -not -name "test-setup.ts" | xargs wc -l | tail -1  # Source lines
find . \( -name "*.test.ts" -o -name "*.e2e.ts" -o -name "test-setup.ts" -o -path "./e2e/*.ts" \) -not -path "./node_modules/*" | xargs wc -l | tail -1  # Test lines
git log --pretty=format:"%ad|%s" --date=format:"%Y-%m-%d" | head -50  # Recent commits
```

**Style guide:**

- Add `**Tokens**: NM | **Cost**: $N` from `bunx ccusage` for the entry's date; omit only if no record.
- One short bullet (≲100 chars) per change; flat list, no sub-bullets or prose.
- Skip minor tweaks — only significant features and fixes belong in the entry, especially on busy days.
- State the user-visible change only; skip mechanism and backstory unless that _is_ the change.
- Describe final outcomes, not reverted intermediate attempts.

## 05.05.2026 — Module consolidation; testing tiers; backend rewrite

**Tokens**: 292M | **Cost**: $187

- App: keyboard works immediately on launch when `?id=...` pre-selects a photo
- Map: globe background canvas no longer intercepts clicks
- Map view fills the window — was leaving a 28px dark band at the bottom
- Internal: big module-consolidation pass — features encapsulated, helpers re-inlined into their hosts, map-view api/context/feature-element trio collapsed into one
- Internal: state primitives extracted — `urlSignal()` for URL-backed signals, `defineMode`/enter/exit/toggle for interaction modes, filter verbs+codec folded into `data.ts`
- Internal: `MapFeatureElement` defaults to shadow DOM; map features no longer reach sibling panels via `document.getElementById`
- Internal: bun:test covers @common (data, edits, selection, url-state, interaction-mode), server modules, components via happy-dom, and a darwin-gated FFI/AppleScript smoke
- Internal: Playwright WebKit E2E covers page mount, filter-panel collapse, cascade, filter persistence, a full-session journey, and a popup flow with keyboard nav + placement
- Internal: macOS GitHub Actions CI for format/lint/typecheck/test/e2e; `KARTTAKUVAT_NO_PHOTOS_WRITES` latch keeps tests away from Photos.app
- Internal: server refactor — dropped SQLite `app.db` (items live in memory backed by `data/items.json`, settings in `data/state.json`, per-album visibility in `_files.json` sidecars); dev and desktop entries collapsed into `src/server/` sharing one `createRequestHandler`; sync runs in-process via `itemStore.rebuild()`

## 04.05.2026 — Lit elements & actions module

**Tokens**: 259M | **Cost**: $151

- Empty-map click during measure or route-edit no longer exits the active mode
- `?markers=points` now actually persists in the URL
- Markers refresh on filter change (was a stale-view bug)
- Internal: map subsystems converted to `<map-*>` Lit elements with `<app-root>`/`<map-view>` shells
- Internal: commands route through a single `@common/actions` module; `events.ts` deleted
- Internal: map module inits run from a single `map.once('load')` in `index.ts`

## 03.05.2026 — Route polish & signals foundation

**Tokens**: 199M | **Cost**: $128

- Route edit: dragging a point no longer gets stuck if the mouse is released off-map
- Photo route toggle is instant — data cached across off/on instead of refetched
- Autosave defers during a pending photo location edit (was persisting mid-edit coords)
- Arrow-key popup navigation no longer flashes the previous image at the new location
- Internal: state moved to signals via `@lit-labs/signals` (data, filters, edits, selection, mapStyle)
- Internal: map subsystems split out (popup, edits, selection, cascade, clipboard, markers)
- Internal: dead-code sweep — `MapStyle`/`MapStyles` types, orphan CSS, unused devDeps

## 02.05.2026 — Photo Route Reconciliation & Edit Polish

**Tokens**: 37M | **Cost**: $28

- Photo route now reconciles with album state when shown — drops removed photos, inserts newly added ones at chronological positions, and refreshes coordinates and order
- Route edit: blue route line now reflects edits immediately on exit (was showing pre-edit geometry until the next interaction)
- Routed segments (driving/hiking) now downgrade to straight consistently on any ORS failure, not just missing key

## 01.05.2026 — Optional API Keys

**Tokens**: 32M | **Cost**: $24

- MML and ORS API keys are now optional in `.env`. Without the MML key the Maasto and Orto basemaps are hidden; without the ORS key the Drive and Hike routing methods are hidden
- Photo route: when a photo point moves or its time changes, adjacent waypoints are cleaned up so the route stays tidy
- App now creates the user data directory on first launch — previously `app.db` could fail to open on a clean machine
- Selected photo popup now also restores on reload/relaunch alongside filters and map position

## 30.04.2026 — Route Reorder on Time Edits

**Tokens**: 11M | **Cost**: $6

- Saved photo route auto-reorders photo points to chronological order when times are edited, and prunes waypoints left stranded by the reorder

## 29.04.2026 — Map: Basemap Swap via transformStyle

**Tokens**: 46M | **Cost**: $24

- Basemap swaps now preserve all app layers (markers, GPX, routes, measure) via MapLibre's `transformStyle` instead of tearing them down and re-adding after load
- Removed `cleanupMapLayers` — was only needed by the old tear-down/re-add pattern
- Background-click-to-dismiss bound once at boot instead of re-bound on each marker style swap
- `MarkerLayer.install` now accepts photos and self-initializes; `updateMarkers` wrapper inlined into its only caller

## 28.04.2026 — Code Review

**Tokens**: 3M | **Cost**: $2

- `/simplify` audit of recent popup changes; code was clean — one minor cleanup: popup `loc` variable reuse

## 27.04.2026 — Popup Coordinate & Location Pending-Edit Fix

**Tokens**: 1M | **Cost**: $1

- Popup now shows pending location coordinates immediately after placement (was showing stale coords until save)

## 26.04.2026 — Lightbox Zoom & Cropped Dimensions

**Tokens**: 17M | **Cost**: $13

- Lightbox: pinch-to-zoom and two-finger pan on trackpads
- Metadata: dimensions show post-crop size, with original appended when different
- Videos edited in Photos (rotated/trimmed) now play and thumbnail with the edit applied

## 18.04.2026 — Reset & Fit Improvements

**Tokens**: 15M | **Cost**: $6

- Fixed Reset not persisting state: old `history.replaceState` bypassed the save pipeline; now clears all URL params atomically and saves immediately
- Reset now also resets marker style to Classic
- Fixed reset fit animation being interrupted by a stale deferred `panToFitPopup` callback calling `map.stop()`
- Fit button selects oldest visible photo; if oldest is already selected, selects newest instead

## 17.04.2026 — In-App Video Playback & Dependency Upgrades

**Tokens**: ~13M | **Cost**: ~$8

- Videos play inline in the lightbox, streamed from the Photos library originals via range-aware `GET /video/:uuid` — no copying or transcoding
- Native controls auto-hide after 3 s and reappear on mouse move; Space toggles play/pause; mute state persists across videos in the session
- Upgraded electrobun 1.13.1 → 1.16.0 and dropped the local patch: both issues fixed upstream (rmdirSync→rmSync via PR #171, setApplicationMenu GC bug via native strdup fix)
- Updated maplibre-gl 5.16→5.23, geo-tz, eslint, prettier, @types/bun; added @types/three required by new electrobun

## 12.04.2026 — Fix Time Edits Wrong in Photos

**Tokens**: 3M | **Cost**: $2

- Fixed time edits saving 2 h off in Apple Photos: AppleScript dates use system local time but Photos stores UTC; when system tz ≠ photo tz the displayed time was off by the difference — fixed by adjusting the target time by `(systemTz − photoTz)` before calling `setDateTime`

## 11.04.2026 — Timezone Audit & Bulk Fix

**Tokens**: 21M | **Cost**: $8

- Switched `geo-tz` → `geo-tz/all` so coordinates in Iceland return `Atlantic/Reykjavik` instead of the population-alias `Africa/Abidjan`
- Wrote `scripts/fix-timezones.ts` to bulk-correct 1359+ photos where iPhone recorded Helsinki timezone abroad: fixes `ZDATECREATED`, `ZTIMEZONEOFFSET`, and `ZTIMEZONENAME` in Photos.sqlite while preserving displayed local time, and updates `tz` in app.db
- Fixed metadata modal `Date` field to show local capture time instead of UTC

## 29.03.2026 — Crash Fix: NSAppleScript Thread Safety

**Tokens**: 3M | **Cost**: $1

- Analysed a production crash log: `EXC_BREAKPOINT / SIGTRAP` with ARM64 pointer authentication trap (PAC IB) on a Bun internal worker thread
- Root cause: `NSAppleScript` is not thread-safe and must run on the main thread; Bun's `fetch` handler can be dispatched to worker threads, so AppleScript was being called from the wrong thread, corrupting Objective-C runtime state
- Fixed by wrapping `runAppleScript()` in the native bridge to dispatch via `dispatch_sync(dispatch_get_main_queue(), ...)` when not already on main thread
- Also fixed `development: true` being passed to `Bun.serve()` in the production app (changes internal Bun threading and error handling behaviour)

## 09.03.2026 — iCloud Backup & UI Polish

- Added iCloud Drive backup of album data on startup: incremental mirror to `latest/`, daily snapshots, 30-day pruning
- Fixed filter panel layout to keep album control buttons (Route, Edit, Files) always visible
- Extracted shared map utilities and album controls into reusable components
- Extracted shared date utilities and sanitized error responses

## 04.03.2026 — Google Terrain & Route Refinements

**Tokens**: 3M | **Cost**: $1

- Replaced Thunderforest Outdoors topo map with Google Terrain tiles (no API key needed)
- Added "none" segment type to hide route segments between points
- Removed walking and cycling routing options (kept straight, driving, hiking)
- Fixed route not hiding when switching between albums
- Removed tile freeze detection banner (false positives)

## 03.03.2026 — Photo Route Display & Interactive Editing

**Tokens**: 70M | **Cost**: $41

- Added album photo route display: connects filtered photos chronologically with a blue line on the map, toggled via "Route" button in the filter panel
- Added interactive route editing with OpenRouteService integration: add/remove/drag waypoints, choose routing method per segment (straight, driving, walking, hiking, cycling)
- Routes saved per album to server, with auto-save on edit and URL state persistence
- Segment right-click popup to switch routing method, hover highlight on segments and waypoints
- Distinguished waypoints (smaller markers) from photo points in route edit mode

## 26.02.2026 — Popup Globe Masking

**Tokens**: 15M | **Cost**: $10

- Masked popup behind globe edge in 3D projection so it clips correctly when the marker is near the horizon

## 23.02.2026 — Map Stability Fixes & Diagnostics

**Tokens**: 25M | **Cost**: $14.15

- Fixed map freeze caused by re-entrant MapLibre render loop: throttled `replaceState` to avoid browser rate limit, simplified popup reanchoring to `setOffset()`, wrapped BloomLayer render in try/catch with guaranteed GL state restore
- Fixed lint hang caused by `map.getProjection().type` triggering exponential type resolution in typescript-eslint
- Added Shift+D diagnostics overlay: render stats, error log, WebGL context loss detection, tile freeze auto-recovery

## 22.02.2026 — SQLite Migration, Album Management & View State Persistence

**Tokens**: 82M | **Cost**: $46.47

- Reorganized root directory structure, moved data files to `data/`
- Migrated `items.json` to SQLite `items` table in `app.db`
- Added album file management: upload/delete GPX and markdown files per album, with modal dialog
- Added per-file visibility toggles with server-side SQLite persistence
- Replaced `/api/gpx/{album}` with `/api/albums/{album}/files` for unified file management
- Persisted view state (map position, filters, style) between sessions via `settings` table and `localStorage`
- Desktop app waits for initial sync before showing the page
- Fixed image rotation for HEIC conversions and edited photos
- Removed web production build, kept dev server for debugging
- Dead code cleanup: removed unused query functions, dead api.ts module, unnecessary exports, and trivial wrappers across server and client
- Removed unused dependencies: `@kikuchan/decimal` and `bun-tsconfig-paths`

## 21.02.2026 — Python Replacement, Electrobun Desktop App & Native AppleScript

**Tokens**: 186M | **Cost**: $107.41

- Replaced all Python scripts with TypeScript: SQLite reads via `bun:sqlite`, export pipeline using `sips`/`qlmanage`
- Built Electrobun desktop app with application menu, window state persistence, script runner with progress
- Enriched metadata modal with EXIF fields (lens, aperture, shutter speed, ISO, focal length, flash)
- Replaced `osascript` subprocess spawning with in-process `NSAppleScript` via native dylib (`bun:ffi`)
- Fixed ESLint config and resolved all 43 lint errors

## 20.02.2026 — Code Quality & Bug Fixes

**Tokens**: 43M | **Cost**: $26.98

- Eliminated keyboard.ts by distributing logic to popup and lightbox
- Replaced 7 custom document events with callbacks object in photo-popup
- Renamed abbreviated identifiers for readability across codebase
- Fixed panToFitPopup: use easeTo, account for filter panel
- Fixed osxphotos timewarp crash on photos without timezone
- Fixed dates for 112 photos that had no timezone in Photos.app
- Added transparent hit area layer to classic markers for accurate click targets

## 19.02.2026 — Lit Components & Architecture

**Tokens**: 64M | **Cost**: $40.12

- Refactored UI to Lit web components with shadow DOM
- Reorganized file structure: co-located modules, added @common/@components path aliases
- Extracted keyboard handling, save logic, and event handling into owning modules
- Decoupled filter panel from map via typed command events
- Formatted entire codebase with Prettier

## 18.02.2026 — GPX Tracks & Timestamps

**Tokens**: 18M | **Cost**: $10.01

- Included seconds in displayed timestamps
- Added GPX track visualization for album-scoped routes

## 17.02.2026 — Classic Markers & Popup Polish

**Tokens**: 68M | **Cost**: $38.96

- Revamped classic marker style with dynamic popup offset based on zoom
- Added selected marker highlight with dark fill
- Improved popup interaction: scroll zoom around marker, pan-through behavior
- Fixed event handler leak, WebGL state restore, and marker drift at high zoom
- Fixed multiple performance issues across rendering and filtering
- Moved popup files into popup/ directory

## 16.02.2026 — Points Layer & Cleanup

**Tokens**: 68M | **Cost**: $42.26

- Refactored glow layer into three focused modules with generic Shader class
- Unified marker styles behind MarkerLayer interface
- Moved points layer into src/lib/points-layer/ with minimal public API
- Fixed glow pixelation and overexposure at close zoom
- Removed unused exports, dead functions, and stale comments

## 15.02.2026 — Visual Effects & Marker Styles

**Tokens**: 83M | **Cost**: $50.43

- Added animated cosmic background shader for globe projection
- Made stats panel collapsible
- Simplified lightbox (removed nav/close buttons)
- Added switchable marker styles: Classic (pins) and Glass/Points (glowing dots)
- Added Unreal Bloom glow layer for Points style restricted to night side
- Replaced maplibre-gl-nightlayer with built-in night shadow rendering

## 14.02.2026 — URL State & External Maps

**Tokens**: 58M | **Cost**: $34.03

- Persisted filters, selected item, map view, and map style in URL params
- Added reset button to restore initial app state
- Added Apple Maps and Google Maps buttons with marker pin
- Switched satellite tiles from Esri to Google for better coverage
- Added Thunderforest Outdoors topo layer
- Added distance measurement tool with @turf/distance
- Prevented accidental page zoom from trackpad pinch

## 13.02.2026 — Globe, Filters & Metadata

**Tokens**: 96M | **Cost**: $64.01

- Added camera info overlay and cascading filters: Year → Album → Camera
- Added photo metadata viewer via osxphotos API
- Enabled globe projection with dark background
- Added worldwide base layers behind MML maps
- Added globe/mercator toggle control
- Added day/night shadow on globe with animated transitions
- Dark mode for stats panel, filters, and popups

## 11.02.2026 — Timezones & Atlantti Voyage

**Tokens**: 55M | **Cost**: $39.07

- Added timezone offset to metadata, derived from coordinates via TimezoneFinder
- Sorted photos by UTC time instead of local time
- Added date copy/paste and manual entry to popups
- Built intra-day coordinate interpolation script for Atlantti sailing voyage photos
- Fixed timestamps for Dominica photos (Finnish time → local)

## 10.02.2026 — Map Layers & UI Overhaul

**Tokens**: 29M | **Cost**: $18.98

- Replaced OSM/CyclOSM with MML (National Land Survey) map layers
- Color-coded markers by GPS precision with pulsing highlight ring
- Added Photos overlay button and lightbox-marker sync
- Replaced dropdowns with segmented button bars for map type, media, and GPS filters
- Replaced location action links with inline buttons in popup
- Added metric scale bar

## 09.02.2026 — Export Fixes & Album Filter

**Tokens**: 27M | **Cost**: $17.75

- Added album filter and "Fit to view" button to stats panel
- Regenerated stale thumbnails when full-size image is newer
- Fixed edited photos being overwritten by originals during export
- Clean up orphan files when photos are deleted from Apple Photos

## 08.02.2026 — Location & Time Editing

**Tokens**: 27M | **Cost**: $18.71

- Added location editing: set/copy/paste photo locations, save to Apple Photos via osxphotos
- Added time adjustment with +1h/-1h buttons to shift timestamps
- Added export for all media regardless of geotag, with No Location filter

## 02.02.2026 — Stability

**Tokens**: 6M | **Cost**: $5.15

- Fixed MapLibre crash on dropdown selections

## 28.01.2026 — Video Support

**Tokens**: 24M | **Cost**: $15.12

- Added video support to map with unified export pipeline
- Added media type filter and GPS accuracy tracking

## 27.01.2026 — Export Pipeline & Navigation

**Tokens**: 28M | **Cost**: $16.87

- Added docs with app spec, user flows, and timeline plan
- Added arrow key navigation in photo popups
- Built photo export pipeline with progress counters, edited file handling, and orphan cleanup
- Detected user-set locations via Photos database GPS accuracy
- Fixed MapLibre crash when changing filters during animation

## 26.01.2026 — Lint Fixes

**Cost**: $0.00

- Resolved all remaining 19 lint errors

## 19.01.2026 — Project Bootstrap

**Tokens**: 10M | **Cost**: $6.77

- First commit: initial codebase with map display of geotagged photos
- Migrated to Bun + TypeScript from vanilla JS
- Fixed type and lint errors, added popup keyboard navigation
