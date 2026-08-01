# Flows

Canonical inventory of user-visible flows. Each Tier 5 e2e spec maps to one or more entries here. Behavior detail lives in the relevant component code; this file is the index.

## Browse and view

- **Browse the collection** — see all photos and videos on the map; URL state restores filters / view / styles / open popup.
- **Find a photo on the map** — click marker → popup; arrow keys cycle filtered items; Space or thumbnail click → lightbox.
- **View a photo full size** — lightbox shows date/timezone; arrows cycle; Escape/Space/backdrop closes; trackpad pinch zooms.
- **Watch a video** — videos play inline in lightbox; native controls auto-hide; Space toggles play/pause; mute persists across videos.
- **View photo metadata** — info button → modal with all fields from `Photos.sqlite`, plus the two searchable ones it doesn't hold: Place, and Categories (every scene label the photo carries, which can run to a few dozen). Rows are grouped under File / Capture / Location / Photos by where the value came from, and a group the photo has nothing in is left out entirely. UUID has copy button; movable, non-blocking; close with X / Escape.
- **Open a photo from a link** — a `karttapallo://photo/<uuid>` link opens the app (launching it if needed) on that photo: filters widen so it's visible, the map moves to it, and the popup opens.

## Filter

- **Search by place, description or category** — Cmd+F or the Search box; typing offers matching terms grouped by kind (Places / Descriptions / Categories, the last being Apple's own scene labels like `Lintu` or `Auto`) with photo counts (arrows + Enter, or click); picking one applies it as a token, then fits to the matches and opens the oldest, like the Fit button. Matching ignores case and accents, on word starts — `naatamo` finds `Näätämö`. Search always runs over the whole library: the year / album / camera dropdowns never limit what it finds, and applying a term clears them, so the count on a suggestion is what lands on the map. Afterwards those dropdowns list only the years, albums and cameras the term appears in, to narrow within the result.
- **Filter by year** — dropdown (limited by search); cascades to repopulate album and camera.
- **Filter by album** — dropdown (limited by search + year); cascades to camera; loads visible GPX tracks if any.
- **Filter by camera** — dropdown (limited by search + year + album).
- **Filter by media type** — toggle Photos / Videos; double-click solos.
- **Filter by location precision** — toggle Exif / Inferred / User / None (color-coded; double-click solos; "None" excluded by default).

## Map view

- **Switch basemap** — Aerial / Topo / Maasto / Orto buttons; layers survive the swap.
- **Switch marker style** — Classic / Points buttons.
- **Switch projection** — globe control (bottom-right) toggles globe ↔ mercator.
- **Reset the app** — closes popup, exits modes, defaults filters/styles, clears URL, fits to all photos.
- **Open in Apple Maps / Google Maps** — opens external map at selected photo or current view.

## Edit

- **Set a photo's location** — popup "set" → placement mode → click map → marker reappears at new location as pending edit; Escape cancels.
- **Copy and paste a location** — copy on one photo, paste on another; becomes a pending edit.
- **Adjust a photo's date/time** — popup "edit" → ±1d / ±1h buttons or manual `D.M.YYYY HH:MM` input; pending until saved.
- **Copy and paste a date** — copy on one photo, paste on another (computes the hour offset).
- **Save edits** — "Save to Photos" pushes pending edits to Photos.app; data reloads, popup reopens with the date edit row closed; alert on error.
- **Discard edits** — clears all pending location and time edits.
- **Open a photo in Apple Photos** — Photos.app link button on popup and lightbox.

## Album extras

- **View GPX tracks** — visible tracks load automatically when an album with `.gpx` files is selected.
- **Manage album files** — "Files" button → modal to upload / toggle visibility / delete `.gpx` and `.md` files.
- **View a photo route** — "Route" button → blue chronological line through filtered album photos; loads custom route if saved.
- **Edit a photo route** — "Edit" button → crosshair cursor; click segment to add waypoint, click waypoint to remove, drag to move, right-click for routing method (straight / driving / hiking / none); auto-saves.

## Tools

- **Measure distances** — "Measure" button → click adds points connected by dashed line; cumulative distance overlay; click point to remove.
- **Collapse the filter panel** — click header to toggle.

## Dismiss

Priority order: metadata modal > date edit > placement > route edit > measurement > lightbox > popup. Escape works in every context; clicking outside the active surface or pressing the toggle button also dismisses.
