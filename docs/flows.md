# Flows

Canonical inventory of user-visible flows. Each Tier 5 e2e spec maps to one or more entries here. Behavior detail lives in the relevant component code; this file is the index.

## Browse and view

- **Browse the collection** — see all photos and videos on the map; URL state restores filters / view / styles / open popup. One photo is always selected with its popup open, unless the filters match nothing; a filter that drops the selected photo picks the newest that is left and fits the map to it.
- **Find a photo on the map** — click marker → popup; arrow keys cycle filtered items; Space or thumbnail click → lightbox. Escape, or a click on bare map, hides the popup to show the map under it and hides nothing else; the photo stays selected and its marker lit, and either of those, Space or any change of selection brings the popup back — Space reveals the card rather than skipping it for the lightbox.
- **View a photo full size** — lightbox shows the photo and nothing else; arrows cycle; Escape/Space/backdrop closes; trackpad pinch zooms.
- **Watch a video** — videos play inline in lightbox; native controls auto-hide; Enter toggles play/pause (Space closes the lightbox, whatever is in it); mute persists across videos.
- **View photo info** — Cmd+I toggles a floating panel: fields from `Photos.sqlite` plus Place and Categories, grouped under Photos / File / Capture / Location by where the value came from, empty groups omitted. Album names filter the map to that album; UUID copies and links to Photos.app. Movable, non-blocking; Cmd+I / X closes. Escape passes through to the map, as the arrows and Space already do.
- **See how accurate a photo's location is** — with the Info panel open, an `Exif` photo's marker gets a dashed circle the size of the accuracy the camera recorded, so a metre-perfect fix and a kilometre-wide one stop looking alike. Nothing is drawn for a location Photos guessed or you placed, or once you move the pin yourself.
- **Open a photo from a link** — a `karttapallo://photo/<uuid>` link opens the app (launching it if needed) on that photo: filters widen so it's visible, the map moves to it, and the popup opens.

## Filter

- **Search by place, description or category** — Cmd+F (ignored while the lightbox is up, since the box is behind it) or the Search box; typing offers matching terms grouped by kind (Places / Descriptions / Categories) with photo counts, taken by arrows + Enter or click; picking one applies it as a token and fits the map to the result, like the Fit button; whichever photo ends up selected follows the usual rule — kept if it matches the term, otherwise the newest that does (applying a term clears the album, so a search never lands you in an album's chronological order). Escape abandons a half-typed query, and pressing it again on an empty box gives up focus so the arrows drive the map. Case- and accent-insensitive on word starts — `naatamo` finds `Näätämö`. Always searches the whole library: applying a term clears the three dropdowns below, so a suggestion's count is what lands on the map, and they then list only what the term covers.
- **Filter by year** — dropdown, newest year first (limited by search); cascades to repopulate album and camera.
- **Filter by album** — dropdown (limited by search + year), or an album name in the info panel; takes you to the album's first photo and fits the map to it — an album is a trip, so you enter at the start of it even when the photo you were on is in the album; cascades to camera; loads visible GPX tracks if any. Leaving the album returns you to the photo you came in on.
- **Filter by camera** — dropdown (limited by search + year + album).
- **Filter by media type** — toggle Photos / Videos; double-click solos.
- **Filter by location precision** — toggle Exif / Inferred / User / None (color-coded; double-click solos; "None" excluded by default).

## Map view

- **Switch basemap** — Aerial / Topo / Maasto / Orto buttons; layers survive the swap.
- **Switch marker style** — Classic / Points buttons.
- **Switch projection** — globe control (bottom-right) toggles globe ↔ mercator.
- **Reset the app** — exits modes, defaults filters/styles, clears URL, selects the newest photo, fits to all photos.
- **Open in Apple Maps / Google Maps** — opens external map at the selected photo, or at the current view when the filters match nothing.

## Edit

- **Set a photo's location** — popup "set" → placement mode → click map → marker reappears at new location as pending edit; Escape cancels.
- **Copy and paste a location** — copy on one photo, paste on another; becomes a pending edit.
- **Adjust a photo's date/time** — popup "edit" → ±1d / ±1h buttons or manual `D.M.YYYY HH:MM` input; pending until saved.
- **Copy and paste a date** — copy on one photo, paste on another (computes the hour offset).
- **Save edits** — "Save to Photos" pushes pending edits to Photos.app; data reloads, popup reopens with the date edit row closed; alert on error.
- **Discard edits** — clears all pending location and time edits.
- **Open a photo in Apple Photos** — link button in the info panel's UUID row, beside the copy button.

## Album extras

- **View GPX tracks** — visible tracks load automatically when an album with `.gpx` files is selected.
- **Manage album files** — "Files" button → modal to upload / toggle visibility / delete `.gpx` and `.md` files.
- **View a photo route** — "Route" button → blue chronological line through filtered album photos; loads custom route if saved.
- **Edit a photo route** — "Edit" button → crosshair cursor; click segment to add waypoint, click waypoint to remove, drag to move, right-click for routing method (straight / driving / hiking / none); auto-saves.

## Tools

- **Measure distances** — "Measure" button → click adds points connected by dashed line; cumulative distance overlay; click point to remove.
- **Collapse the filter panel** — click header to toggle.

## Dismiss

Priority order: files modal > date edit > lightbox > the active map mode (placement / route edit / measurement, only ever one at a time) > popup. The info panel is not on the list — it stays open under Escape and closes by the key and button that opened it. Escape works in every context; clicking outside the active surface, or pressing the key or button that opened it, also dismisses. The popup sits last and is the one entry Escape only hides rather than dismisses: it belongs to the selection, and the selection always has a photo to show. A click on bare map hides it the same way — panning doesn't, and while a map mode is active the click belongs to the mode.
