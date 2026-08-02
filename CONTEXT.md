# CONTEXT

Globe view of an Apple Photos library — fix missing locations and wrong dates or timezones in place. This file pins terminology used across the codebase and docs; consult it whenever a term is ambiguous.

## Language

**Item**:
A server-side per-photo record (`src/server/item-store.ts`) covering both photos and videos. The unit served by `/api/items`.
_Avoid_: Photo (server-side), Record, Asset.

**Photo**:
A client-side, user-facing thing on the map. Includes videos in the general sense; "photo" is the dominant noun in client code and UI strings.
_Avoid_: Item (client-side).

**Media**:
Photos plus videos collectively, in contexts where the distinction matters (e.g. the Media filter toggle).

**Library**:
The Apple Photos `.photoslibrary` bundle the app reads from. Always the **active library** — the one Photos.app currently has open — auto-detected from the container bookmark (`IPXDefaultLibraryURLBookmark`), not hardcoded or user-picked. Because the app tracks the active library, AppleScript writes always target the same Library it reads. Each Library gets its own namespaced data subtree (`data/libraries/{key}/`) for cache, item snapshot, and album sidecars, since UUIDs and album names are not stable across Libraries.
_Avoid_: Photos DB, catalog.

**Album**:
An Apple Photos album. Read-only on the client; on the server (`AlbumStore`), the same name keys an augmented filesystem subtree under `data/libraries/{key}/albums/{album}/` containing GPX/markdown files, per-file visibility (`_files.json`), and a saved route (`_route.json`). Server **Album** = Photos album + sidecar data.

**Pending Edit**:
A coord or time change buffered client-side via `@common/edits` signals, not yet persisted back to Photos.app. Cleared on Save (writes through to `Photos.sqlite` via NSAppleScript) or Discard.

**Location precision**:
The GPS-source classification on each item: `Exif` (camera-set), `Inferred` (Photos.app guessed), `User` (manually set), or `None` (no GPS). Drives marker color and the Location filter.

**Info panel**:
The floating panel describing the selected photo (`<info-panel>`), toggled with Cmd+I. Named for what Photos.app and Finder call the same thing under the same key, and because it acts as well as reports — album names filter the map, the UUID copies and links out. The server side of it keeps the older name: `/api/metadata` really does serve metadata.
_Avoid_: metadata modal, inspector.

**Place**:
The names Photos' reverse geocoder gives an item, read from the search index Photos.app builds, not geocoded by this app. A list, ordered outward from the point of interest to the city — `Kälkäsentie, Kuhmo`; `Kalottireitti, Käsivarren Erämaa, Kilpisjärvi` — and stopping there, since region and country are true of thousands of items at once. Named areas, so unrelated to an item's coordinates or its **Location precision**: an item can carry a Place and no GPS at all, which is why Place reaches assets the map cannot plot.

**Scene label**:
One of Apple's own image classifications for an item (`Lintu`, `Ulkoilma`), read from the search index Photos.app builds. Called `labels` in code and **Categories** in the UI, in both the search suggestions and the info panel. An analyzed item carries roughly ten; an unanalyzed one carries none.

**Search corpus**:
The three fields a search term is matched against — **Place**, description, **Scene label**. Assembled onto each item by the item store, so both the search box and the info panel read them from the same client-side record.

**Route**:
A chronologically-ordered line connecting an album's filtered photos. Owned by the app, editable by the user (waypoints, per-segment routing method: straight / driving / hiking / none), persisted server-side as `_route.json`. Distinct from a **GPX Track**.

**GPX Track**:
A third-party `.gpx` file dropped into an album. Read-only, rendered as colored line + waypoint markers. Distinct from a **Route**.

**Interaction mode**:
The exclusive map-input mode: `placement`, `measure`, or `route-edit`. One signal in `@common/interaction-mode` makes them mutually exclusive by construction; entering one fires the previous mode's `onExit`.

**Basemap**:
The underlying map style — `Aerial` (default), `Topo`, `Maasto`, `Orto`. Switched via the filter panel; persisted as the `style` URL param. App-owned layers survive basemap swaps via MapLibre's `transformStyle`.

**Marker style**:
The marker rendering — `Classic` (color-coded circles) or `Points` (white WebGL bloom dots with day/night shadow). Persisted as the `markers` URL param. Independent of **Basemap**.

## Relationships

- An **Album** has zero or more **Items**, zero or more **GPX Tracks**, and at most one **Route**.
- An **Item** belongs to zero or more **Albums** (Apple Photos is many-to-many).
- A **Pending Edit** targets exactly one **Item** by UUID.
- A **Route** references **Items** by UUID; reconciliation drops references to items no longer in the album.
- An **Interaction mode** is mutually exclusive with the others; only one is active at a time.

## Flagged ambiguities

- **"Album"** means two related things: the read-only Photos album (same name and ID across the app) and the server's augmented version with sidecar files. Code distinguishes by location; CONTEXT.md treats them as one term with two aspects.
- **"Photo" / "Item"** are the same thing seen from different sides. Keep server code on **Item** and client code on **Photo**; the boundary is `/api/items`.
- **"Scene label" / "labels" / "Categories"** are one thing under three names — the concept, the field, and the word the UI shows. The UI word is deliberate: users only ever meet these through search, and two names there would read as two features.
- **"Place"** is a name, **"Location"** is coordinates. The Location filter and the Place row answer different questions, and an item can have either without the other.
