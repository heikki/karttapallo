# Search reads the Photos databases directly, not Photos' search API

Karttapallo's text search matches against metadata Karttapallo reads out of the Photos library itself — moment place names from `Photos.sqlite`, asset descriptions, and scene labels from `psi.sqlite` — folded into the item snapshot and matched client-side. It does **not** call Photos.app's own search, and it does not classify images itself.

## Why

All 4832 items already live in client memory (`data.photos`, loaded once from `/api/items`). Search is therefore a predicate over an array, not an index or a query service: whatever corpus we can attach to a `Photo` is searchable for free. The only real question is which corpus exists.

Measured against the working library (`/Volumes/Crucial X10`, 4841 assets):

| Source                                    | Coverage                                   |
| ----------------------------------------- | ------------------------------------------ |
| Named persons                             | 1 (4 detected faces in the entire library) |
| Keywords                                  | 1                                          |
| Titles                                    | 0                                          |
| Descriptions                              | 22 (23 rows, one on a hidden asset)        |
| Scene labels (`psi.sqlite` category 1500) | 17                                         |
| **Moment place names (`ZMOMENT.ZTITLE`)** | **4443**                                   |

Place names are the only corpus with meaningful coverage, and they cost one `LEFT JOIN` onto `BASE_SQL` — Photos has already reverse-geocoded the library into 155 distinct localized places (`Kuhmo`, `Inari`, `Sevettijärvi`, `Kilpisjärvi`, `Pariisi`, `Egilsstaðir`, `Lontoo`). They also reach the 1238 items belonging to no album at all, which the album filter structurally cannot.

Everything else in that table is empty for one reason: `ZANALYSISSTATEMODIFICATIONDATE` is NULL for 4823 of 4841 assets. Photos has never analyzed this library. The cause is almost certainly that it lives on an external volume — Photos runs analysis only while idle, plugged in, and with the library open and mounted, a window a drive that gets unplugged after each session never reaches. This is not something Karttapallo can trigger; there is no public API to force analysis.

The `psi.sqlite` reader is built anyway, because it costs almost nothing and needs no revisiting later. On a fully-analyzed library the same code yields a rich Finnish corpus: the 67-asset system library at `~/Pictures` produces 139 distinct labels over 66 photos — `Lintu`, `Perhonen`, `Koiperhonen`, `Hyönteinen`, `Eläin`, `Kukka`, `Metsä`, `Lehtimetsä`, `Järvi`, `Niitty`, `Erämaa`, `Vene`, `Kanootti`, `Jeeppi`, `Mökki`, `Lato`, and species-level hits like `Pursuhopeatäplä` and `Päivänkakkara`. Wiring the reader in now means labels appear by themselves if analysis ever runs, with no second decision to make.

## Alternatives rejected

**Call Photos' own search over AppleScript.** `Photos.sdef` does expose it — `search for` (text), returning a list of `media item` — and on an analyzed library it is genuinely good, handling Finnish inflection through synonym groups (category 1501 holds 768 forms collapsing `Renkaat`/`Renkaan`/`Autonpyörä` into one). It fails on the library that matters. Measured on the 4841-asset library with Photos holding it open, every query returned zero — including `Kuhmo`, which 279 moments carry, and bare filename fragments, which require no analysis whatsoever — at roughly 10.5s per query, with intermittent `connection invalid` XPC failures. That search is backed by an index covering 746 assets against the 4443 reachable by direct SQL, so even fully working it would see six times less of the library.

Three further costs stand independent of coverage. `runAppleScript` in the native bridge returns only an `i32` status and an error buffer, discarding script output, so any read path needs the native side extended. Photos answers for whichever library it currently has open, while Karttapallo tracks the active library itself ([ADR 0012](0012-track-active-photos-library.md)) and supports more than one — a search silently answering from the wrong library is a failure mode the SQL path cannot have. And it is UI automation: it launches Photos and takes focus, which no other read path in the app does.

**Classify images ourselves with Vision.** `VNClassifyImageRequest` would give guaranteed full coverage on any library, independent of Apple's scheduler, and it is a modest addition — `karttapallo-bridge.mm` is 263 lines built by a single `clang++` invocation that already links ImageIO and CoreGraphics, so this is `-framework Vision` plus a `classifyImage` symbol. It is deferred, not rejected on merit. It buys English labels (`bird`, `car`) that would sit alongside Finnish place names as a second vocabulary, and it is only worth that cost if Photos' own analysis genuinely never progresses. Leaving the library mounted and open on a plugged-in idle Mac tests that for free; this decision can be revisited with that evidence rather than ahead of it.

**Search persons and keywords.** The original framing, abandoned on measurement: one named person, one keyword, four detected faces. It could not be populated by tagging either, since there are no detected faces to name until analysis runs.

## Consequences

Two fields join `PhotoRecord` and the item snapshot: `place` (from `ZMOMENT.ZTITLE` via `ZASSET.ZMOMENT`) and `description` (from `ZASSETDESCRIPTION.ZLONGDESCRIPTION`, already read by `queryMetadata` for the inspector panel). A third, `labels`, joins the snapshot only — it comes from a different database, so `PhotoRecord` stays a faithful mirror of a `Photos.sqlite` row and `buildItemEntry` merges the labels in. The snapshot grows by roughly one short string per item; `labels` is empty for all but 17 items on the working library, and populated for 66 of the 67 in the system library.

Search is a filter dimension, not a separate result list. It composes with the existing cascade and reuses `filteredPhotos`, marker rendering, fit-to-view and the stats line, so there is exactly one model of "what the map is showing". It follows the other filters into URL state, and `revealPhoto` must clear it for the same reason it widens the GPS filter — a deep link has to land on its photo whatever filter state arrived with it.

`psi.sqlite` is a second database handle per library, opened read-only from `<library>/database/search/psi.sqlite` and tolerating absence: a library that has never been searched may not have one. Its `assets` table identifies photos by `uuid_0`/`uuid_1`, a pair of **signed int64s** that are the UUID's 16 bytes little-endian. Bun's SQLite driver returns integers as float64 by default, which silently rounds values of this magnitude and yields plausible-looking but wrong UUIDs that match nothing — the handle is opened with `safeIntegers` so the halves arrive as `BigInt`.

Matching is confined to place, description and label. Album, camera, year and media already have dedicated filters, and folding them into the same box would make a hit ambiguous about why it matched — `Kuhmo` is both a place and part of seven album names.
