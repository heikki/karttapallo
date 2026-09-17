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
The Apple Photos `.photoslibrary` bundle the app reads from. Always the **active library** — the one Photos.app currently has open — auto-detected from the container bookmark (`IPXDefaultLibraryURLBookmark`), not hardcoded or user-picked. Because the app tracks the active library, AppleScript writes always target the same Library it reads. A Library also **holds** the data the user authored against it, at `<library>/karttapallo/`, so that data travels with the bundle instead of being looked up by path (ADR-0015).
_Avoid_: Photos DB, catalog.

**Library session**:
Everything the app holds open for one **Library** — the item store, the album store, the image cache, the routing client, and the API routes over them (`src/server/library-session.ts`). Opened once per launch against the Library resolved at startup and never re-pointed at another, so switching libraries means relaunching (ADR-0012). It owns where the **Bundle store** sits and everything under the **cache root**; it deliberately owns neither resolving the Library, nor serving HTTP, nor where the cache root itself lives — the three entries answer those differently, and that difference is the only reason they are three.
_Avoid_: app, server, context.

**Bundle store**:
The `karttapallo/` directory inside a Library, holding its saved view and its album subtrees. Distinct from the **cache root** (`~/Library/Caches/Karttapallo/`), which holds only data derived from the Library and is wiped when a different Library is opened.
_Avoid_: data dir, library dir — both used to mean the retired per-path hash directory.

**Album**:
An Apple Photos album. Read-only on the client; on the server (`AlbumStore`), it keys an augmented filesystem subtree at `<library>/karttapallo/albums/{albumUuid}/` containing GPX/markdown files, per-file visibility (`_files.json`), and a saved route (`_route.json`). Callers name an Album by its **title**; the store resolves that to the UUID the directory is named for. Server **Album** = Photos album + sidecar data.

**Roster**:
The list of an Album's title and UUID for every user album in a Library, read from `ZGENERICALBUM` and normalised to NFC. It is what `AlbumStore` resolves names against, and what tells it which subtrees are orphaned.

**Pending Edit**:
A coord or time change buffered client-side via `@common/edits` signals, not yet persisted back to Photos.app. Cleared on Save (writes through to `Photos.sqlite` via NSAppleScript) or Discard.

**Location precision**:
The GPS-source classification on each item: `Exif` (camera-set), `Inferred` (Photos.app guessed), `User` (manually set), or `None` (no GPS). Drives marker color and the Location filter.

**Accuracy ring**:
The dashed circle drawn on the ground around the selected photo, its radius the horizontal accuracy the camera recorded, in metres. Answers how much to trust a pin, so it exists only where something was actually measured: an `Exif` **Location precision** and no **Pending Edit**. Distinct from **Location precision** — that is a four-way classification of where a location came from, this is a distance.

**Selection**:
The one **Photo** the app is currently about — its popup is open, the **Info panel** describes it, and the arrow keys step from it. Held as a UUID in `@common/selection` and mirrored to the `id` URL param. Null only when no photo passes the current filters: whenever the filtered set is non-empty the app keeps a Selection, auto-selecting the newest (or the one a filter change last displaced) if the current one falls out. Because it is never idly null, the popup is not dismissable — Escape only **hides** it, leaving the Selection standing and its marker lit; any change of Selection reveals it again, as does Space. See [ADR-0016](docs/adr/0016-always-keep-a-selection.md).
_Avoid_: active photo, current photo, cursor.

**Info panel**:
The floating panel describing the selected photo (`<info-panel>`), toggled with Cmd+I. Named for what Photos.app and Finder call the same thing under the same key, and because it acts as well as reports — album names filter the map, the UUID copies and links out. The server side of it keeps the older name: `/api/metadata` really does serve metadata.
_Avoid_: metadata modal, inspector.

**Place**:
The names Photos' reverse geocoder gives an item, read from the search index Photos.app builds, not geocoded by this app. A list, ordered outward from the point of interest to the country — `Kälkäsentie, Kuhmo, Kainuu, Suomi` — minus the two-letter codes, which restate the country and state under a worse label. Named areas, so unrelated to an item's coordinates or its **Location precision**: an item can carry a Place and no GPS at all, which is why Place reaches assets the map cannot plot.

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

## Relationships

- A **Library** holds zero or more **Albums**, and exactly one **Bundle store** holding what the user authored against them.
- A **Library session** is opened against exactly one **Library**, and cannot outlive it.
- An **Album** has zero or more **Items**, zero or more **GPX Tracks**, and at most one **Route**.
- An **Item** belongs to zero or more **Albums** (Apple Photos is many-to-many).
- A **Pending Edit** targets exactly one **Item** by UUID.
- A **Selection** names at most one **Photo**, and names none only when the filters match none.
- A **Route** references **Items** by UUID; reconciliation drops references to items no longer in the album.
- An **Interaction mode** is mutually exclusive with the others; only one is active at a time.
- An **Accuracy ring** belongs to the **Selection**, and only while the **Info panel** is open.

## Flagged ambiguities

- **"Album"** means two related things: the read-only Photos album (same name and ID across the app) and the server's augmented version with sidecar files. Code distinguishes by location; CONTEXT.md treats them as one term with two aspects. An Album is also **named by title on the wire and stored by UUID on disk** — the two are bridged only inside `AlbumStore`, so anywhere else that reaches for an album's files by name is a bug waiting to happen.
- **"Photo" / "Item"** are the same thing seen from different sides. Keep server code on **Item** and client code on **Photo**; the boundary is `/api/items`.
- **"Scene label" / "labels" / "Categories"** are one thing under three names — the concept, the field, and the word the UI shows. The UI word is deliberate: users only ever meet these through search, and two names there would read as two features.
- **"Place"** is a name, **"Location"** is coordinates. The Location filter and the Place row answer different questions, and an item can have either without the other.
