# Search reads Photos' search index directly, not its search API

Karttapallo's text search matches against terms it reads out of `psi.sqlite`, the search index Photos.app builds for its own search field — places, descriptions and scene labels — folded into the item snapshot and matched client-side. It reads that index directly; it does **not** call Photos.app's search, and it does not classify images itself.

## Why

All 4841 items already live in client memory (`data.photos`, loaded once from `/api/items`). Search is therefore a predicate over an array, not an index or a query service: whatever corpus we can attach to a `Photo` is searchable for free. The only real question is which corpus exists.

Measured against the working library (`/Volumes/Crucial X10`, 4841 visible assets):

| Source                           | Coverage                                   |
| -------------------------------- | ------------------------------------------ |
| Titles                           | 0                                          |
| Named persons                    | 1                                          |
| Keywords (`psi.sqlite` 1200)     | 15                                         |
| Descriptions (`psi.sqlite` 1202) | 22 (23 rows in SQL, one on a hidden asset) |
| Scene labels (`psi.sqlite` 1500) | 2095                                       |
| **Places (`psi.sqlite` 1–14)**   | **4466, over 1156 distinct terms**         |

Places are the corpus with real coverage, and they reach the 1238 items belonging to no album at all, which the album filter structurally cannot. They arrive as a hierarchy rather than one name — point of interest, street, neighborhood, city — so a photo carries `Kalottireitti`, `Käsivarren Erämaa` and `Kilpisjärvi` at once, each independently searchable.

### One index, because two can disagree

The decisive argument is not coverage but agreement. Places previously came from `ZMOMENT.ZTITLE` in `Photos.sqlite` while labels came from `psi.sqlite`, and on 2026-08-01 a Photos database migration regenerated all 1177 moments of this library with `ZTITLE`, `ZSUBTITLE` and `ZLOCALIZEDLOCATIONNAMES` NULL. Place search went silently dead — 4443 items to zero — while Photos.app's own search kept finding every one of those places, because it had never read that column. The pre-migration copy Photos left behind (`Photos.sqlite.aside`) still holds 1114 titled moments, which is how the collapse was confirmed rather than inferred.

Reading the index Photos.app reads makes "Photos finds it" and "Karttapallo finds it" one condition instead of two. That does not make the corpus immune to going empty — `psi.sqlite` is derived and Photos rebuilds it — but it makes an empty corpus something the user can see in Photos.app itself, rather than a divergence only a SQL query can explain.

### On analysis

An earlier revision of this record concluded that scene labels would stay near zero forever, because `ZANALYSISSTATEMODIFICATIONDATE` was NULL for 4823 of 4841 assets and the library is not the System Photo Library (`photolibraryd` still names `~/Pictures/Photos Library.photoslibrary` in `search.coreSpotlight.lastKnownSPLPath`). That prediction was wrong. The same migration analyzed 2122 assets and populated the index fully — labels went from 17 items to 2095, and every metadata-derived category filled in for all 4841.

The lesson worth keeping is about coupling, not about Apple's scheduler: the corpus a library exposes moves on its own, in both directions, for reasons outside this app. Reading it from one place means it moves as a unit.

## Alternatives rejected

**Call Photos' own search over AppleScript.** `Photos.sdef` does expose it — `search for` (text), returning a list of `media item` — and on an analyzed library it is genuinely good, handling Finnish inflection through synonym groups (category 1501 holds 768 forms collapsing `Renkaat`/`Renkaan`/`Autonpyörä` into one). It failed on the library that matters. Measured on the 4841-asset library with Photos holding it open, every query returned zero — including `Kuhmo`, which 279 moments carried, and bare filename fragments, which require no analysis whatsoever — at roughly 10.5s per query, with intermittent `connection invalid` XPC failures. Reading `psi.sqlite` gets at the same corpus that API is a slow, flaky front end for.

Three further costs stand independent of that. `runAppleScript` in the native bridge returns only an `i32` status and an error buffer, discarding script output, so any read path needs the native side extended. Photos answers for whichever library it currently has open, while Karttapallo tracks the active library itself ([ADR 0012](0012-track-active-photos-library.md)) and supports more than one — a search silently answering from the wrong library is a failure mode the SQL path cannot have. And it is UI automation: it launches Photos and takes focus, which no other read path in the app does.

**Classify images ourselves with Vision.** `VNClassifyImageRequest` would give full coverage independent of Apple's scheduler, and it is a modest addition — `karttapallo-bridge.mm` is 263 lines built by a single `clang++` invocation that already links ImageIO and CoreGraphics, so this is `-framework Vision` plus a `classifyImage` symbol. It was deferred on the reasoning that it is only worth the cost if Apple's labels stay out of reach. They did not: 2095 items now carry them, in Finnish, at species level. Deferring it was right, and it stays deferred — English labels sitting alongside Finnish ones as a second vocabulary would now be a downgrade in coherence, not an upgrade in coverage.

**Search persons and keywords.** The original framing, abandoned on measurement: one named person, 15 keywords, four detected faces. Both are in `psi.sqlite` (1300 and 1200), so adding them is a line in the category map rather than a new source, if tagging ever makes them worth it.

## Consequences

`place`, `description` and `labels` join the item snapshot only, never `PhotoRecord`, which stays a faithful mirror of a `Photos.sqlite` row — `buildItemEntry` merges all three in from `readSearchTerms`. `BASE_SQL` correspondingly carries no `ZMOMENT` or `ZASSETDESCRIPTION` join. `queryMetadata` still reads the description from `Photos.sqlite` for the info panel's Description row, which is a different job: that row shows the caption where the user typed it, not the copy an index made of it.

All three are lists, because the index attaches terms rather than a value — a photo sits in a point of interest and a street and a city at once. The snapshot grows by roughly four short strings per item.

Places span the full hierarchy Photos names, point of interest through country. The broad levels are how a trip is actually reached — `Islanti` and `Portugali` are the terms for a journey with no album of its own — at the cost of matching thousands of items each (`Suomi`: 2817 of 4841), which puts them at the head of the Places group whenever they match. Only the two-letter codes are dropped (11, 13): `FI` duplicates `Suomi` at an identical count under a worse label, so a query for `fi` would offer the code above the name it stands for.

Terms are ordered specific-first within each field, which is what lets the info panel's Place row read outward as `Kälkäsentie, Kuhmo, Kainuu, Suomi`.

Search is a filter dimension, not a separate result list. It composes with the existing cascade and reuses `filteredPhotos`, marker rendering, fit-to-view and the stats line, so there is exactly one model of "what the map is showing". It follows the other filters into URL state, and `revealPhoto` must clear it for the same reason it widens the GPS filter — a deep link has to land on its photo whatever filter state arrived with it.

`psi.sqlite` is a second database handle per library, opened read-only from `<library>/database/search/psi.sqlite` and tolerating absence: a library Photos has never indexed may not have one. An empty corpus is a normal result, not a failure, and must never break a rebuild — which is also why a snapshot on disk may hold either older shape of these fields, and `fieldValues` reads all three. Its `assets` table identifies photos by `uuid_0`/`uuid_1`, a pair of **signed int64s** that are the UUID's 16 bytes little-endian. Bun's SQLite driver returns integers as float64 by default, which silently rounds values of this magnitude and yields plausible-looking but wrong UUIDs that match nothing — the handle is opened with `safeIntegers` so the halves arrive as `BigInt`.

Matching is confined to place, description and label. Album, camera, year and media already have dedicated filters, and folding them into the same box would make a hit ambiguous about why it matched — `Kuhmo` is both a place and part of seven album names.
