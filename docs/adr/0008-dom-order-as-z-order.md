# DOM order = z-order for map layers

Cross-feature MapLibre layer order is the order of `<map-*>` elements in `<map-view>`'s feature template, bottom to top. Each feature's `firstUpdated` calls `addLayer(...)` with no `before` argument, so the layer lands on top of whatever's already in the stack. Lit fires `firstUpdated` in document order, so template order = init order = z-order. Considered explicit z-index numbers per layer (brittle, requires global coordination) and an explicit `before:` chain (forces every feature to know about its neighbours). DOM-order is self-documenting in the template and refactor-safe: moving an element re-orders its z-position in one edit.

> **Amended: nothing swaps layers at runtime any more.** The retired points marker style was the only feature that did, and its `markers-anchor` symbol layer went with it — `<map-markers>` now adds the classic layers on init like every other feature, so DOM order is the whole rule again.
