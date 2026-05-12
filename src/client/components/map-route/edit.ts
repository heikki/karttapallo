import type {
  Map as MapGL,
  MapLayerMouseEvent,
  MapMouseEvent
} from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import * as interactionMode from '@common/interaction-mode';
import { effect } from '@common/signals';
import { setLayersVisibility } from '@components/map-view/api';

import {
  ALL_EDIT_LAYERS,
  createEditLayers,
  raiseEditPoints,
  setHoverSource,
  updateEditSources
} from './edit-display';
import { findNearestSegment } from './edit-geometry';
import { createSegmentPopup, showRouteError } from './edit-popup';
import * as route from './route';
import { buildDefault } from './route-data';

// ---------- State machine ----------

/**
 * Pointer interaction state during edit mode. `null` means edit mode is off.
 *  - idle: cursor is not over any clickable thing
 *  - hoveringSegment: cursor is over a route segment (highlight is shown)
 *  - hoveringPoint: cursor is over a route point (segment highlight is cleared)
 *  - dragging: a point is being dragged
 */
type InteractionState =
  | { kind: 'idle' }
  | { kind: 'hoveringSegment'; segIdx: number }
  | { kind: 'hoveringPoint'; pointId: number }
  | { kind: 'dragging'; pointIdx: number };

let map: MapGL | null = null;
let interaction: InteractionState | null = null;
let popupEl: HTMLElement | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Set when a segment-hit mousedown both inserted a waypoint and started a
// drag, so the trailing click event can be ignored. Cleared on the click
// (via consume) and on enter/exit (so a stale flag from an Escape-during-drag
// doesn't leak into the next session).
let suppressNextMapClick = false;

function isActive(): boolean {
  return interactionMode.current.get() === 'route-edit';
}

/** Apply a state transition with the appropriate side effects. */
function transition(next: InteractionState | null): void {
  const prev = interaction;
  interaction = next;

  // Segment hover highlight: present iff state is hoveringSegment.
  const prevSeg = prev?.kind === 'hoveringSegment' ? prev.segIdx : null;
  const nextSeg = next?.kind === 'hoveringSegment' ? next.segIdx : null;
  if (prevSeg !== nextSeg) {
    if (nextSeg === null) {
      clearHoverHighlight();
    } else {
      showHoverHighlight(nextSeg);
    }
  }

  setCursorClass(cursorFor(next));
}

function cursorFor(s: InteractionState | null): string | null {
  if (s === null) return null;
  switch (s.kind) {
    case 'dragging':
      return 'cursor-grabbing';
    case 'hoveringSegment':
    case 'hoveringPoint':
      return 'cursor-pointer';
    case 'idle':
      return null;
  }
}

// ---------- Public API ----------

export function initRouteEdit(m: MapGL): void {
  map = m;
  createEditLayers(m);

  interactionMode.defineMode('route-edit', {
    canEnter: () =>
      (route.current.get() ?? buildDefault(data.filteredPhotos.get())) !== null,
    onEnter,
    onExit
  });

  // Push the latest RouteData to the edit-mode MapLibre sources whenever
  // it changes, but only while edit mode is active.
  effect(() => {
    const cur = route.current.get();
    if (!isActive() || cur === null || map === null) return;
    updateEditSources(map, cur.data);
  });

  // Sync photo point positions when pending edits change.
  effect(() => {
    edits.pendingCoords.get();
    edits.pendingTimeOffsets.get();
    if (!isActive()) return;
    route.syncPhotoPoints(data.filteredPhotos.get());
  });
}

// ---------- Lifecycle ----------

function onEnter(): void {
  if (map === null) return;
  let cur = route.current.get();
  if (cur === null) {
    const defaultRoute = buildDefault(data.filteredPhotos.get());
    if (defaultRoute === null) return;
    const album = data.filters.get().album;
    if (album === 'all') return;
    route.setRoute(album, defaultRoute);
    cur = route.current.get();
    if (cur === null) return;
  }
  route.syncPhotoPoints(data.filteredPhotos.get());

  suppressNextMapClick = false;
  setLayerVisibility(true);
  raiseEditPoints(map);
  // First push to sources happens explicitly so layers have data before
  // they become visible; subsequent updates run via the effect above.
  const latest = route.current.get();
  if (latest !== null) updateEditSources(map, latest.data);

  map.on('click', onMapClick);
  map.on('contextmenu', onRightClick);
  map.on('mousedown', 'route-edit-points-layer', onPointMouseDown);
  map.on('mousedown', 'route-edit-hit-layer', onSegmentMouseDown);
  map.on('mouseleave', 'route-edit-hit-layer', onSegmentLeave);
  map.on('mousemove', 'route-edit-hit-layer', onSegmentMove);
  map.on('mouseenter', 'route-edit-points-layer', onPointEnter);
  map.on('mouseleave', 'route-edit-points-layer', onPointLeave);

  transition({ kind: 'idle' });
}

function onExit(): void {
  if (map === null) return;

  if (interaction?.kind === 'dragging') teardownDragListeners();

  transition(null);
  suppressNextMapClick = false;
  removePopup();
  flushPendingSave();
  setLayerVisibility(false);

  map.off('click', onMapClick);
  map.off('contextmenu', onRightClick);
  map.off('mousedown', 'route-edit-points-layer', onPointMouseDown);
  map.off('mousedown', 'route-edit-hit-layer', onSegmentMouseDown);
  map.off('mouseleave', 'route-edit-hit-layer', onSegmentLeave);
  map.off('mousemove', 'route-edit-hit-layer', onSegmentMove);
  map.off('mouseenter', 'route-edit-points-layer', onPointEnter);
  map.off('mouseleave', 'route-edit-points-layer', onPointLeave);
}

function setLayerVisibility(show: boolean): void {
  if (map === null) return;
  setLayersVisibility(map, ALL_EDIT_LAYERS, show);
}

function scheduleAutoSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPendingSave, 1000);
}

function flushPendingSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const cur = route.current.get();
  if (cur === null) return;
  void route.saveToServer(cur.album, cur.data);
}

// ---------- Click / right-click ----------

/** Find the first non-'none' segment index from hit query results. */
function firstClickableHit(
  features: Array<{ properties: Record<string, unknown> }> | undefined
): number | null {
  if (features === undefined) return null;
  const cur = route.current.get();
  if (cur === null) return null;
  for (const f of features) {
    const idx = f.properties.segIndex as number;
    if (cur.data.segments[idx]?.method !== 'none') return idx;
  }
  return null;
}

function onMapClick(e: MapMouseEvent): void {
  if (map === null) return;
  const cur = route.current.get();
  if (cur === null) return;
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }

  // 1. Clicking on a route edit point
  const pointFeatures = map.queryRenderedFeatures(e.point, {
    layers: ['route-edit-points-layer']
  });
  if (pointFeatures.length > 0) {
    const idx = pointFeatures[0]!.properties.index as number;
    if (cur.data.points[idx]?.type === 'waypoint') removeWaypointAt(idx);
    return;
  }

  // 2. Click-through to photo markers
  if (e.defaultPrevented) return;

  // 3. Add new waypoint — on segment if hit, otherwise nearest segment
  removePopup();
  const hitFeatures = map.queryRenderedFeatures(e.point, {
    layers: ['route-edit-hit-layer']
  });
  const hitSegIdx = firstClickableHit(hitFeatures);
  if (hitSegIdx === null) {
    addWaypointAtClick(e.lngLat.lng, e.lngLat.lat);
  } else {
    insertWaypointAt(hitSegIdx, e.lngLat.lng, e.lngLat.lat);
  }
}

function onRightClick(e: MapMouseEvent): void {
  if (map === null) return;
  if (route.current.get() === null) return;
  e.preventDefault();
  const hitFeatures = map.queryRenderedFeatures(e.point, {
    layers: ['route-edit-hit-layer']
  });
  if (hitFeatures.length > 0) {
    const segIdx = hitFeatures[0]!.properties.segIndex as number;
    showSegmentPopup(segIdx, e.lngLat.lng, e.lngLat.lat);
  }
}

function addWaypointAtClick(lon: number, lat: number): void {
  if (map === null) return;
  const cur = route.current.get();
  if (cur === null || cur.data.segments.length === 0) return;
  const bestIdx = findNearestSegment(map, cur.data, lon, lat);
  insertWaypointAt(bestIdx, lon, lat);
}

function insertWaypointAt(segIdx: number, lon: number, lat: number): void {
  const cur = route.current.get();
  if (cur === null) return;
  const method = cur.data.segments[segIdx]?.method;
  if (method === undefined || method === 'none') return;

  route.insertWaypoint(segIdx, lon, lat);

  if (method !== 'straight') {
    void Promise.all([
      route.rerouteSegment(segIdx),
      route.rerouteSegment(segIdx + 1)
    ]);
  }

  scheduleAutoSave();
}

function removeWaypointAt(pointIdx: number): void {
  const segBefore = pointIdx - 1;
  const method = route.removeWaypoint(pointIdx);
  if (method === null) return;

  if (method !== 'straight') {
    void route.rerouteSegment(segBefore);
  }

  scheduleAutoSave();
}

// ---------- Segment routing popup ----------

function showSegmentPopup(segIdx: number, lon: number, lat: number): void {
  if (map === null) return;
  removePopup();
  const cur = route.current.get();
  popupEl = createSegmentPopup({
    map,
    lngLat: [lon, lat],
    currentMethod: cur?.data.segments[segIdx]?.method ?? 'straight',
    onSelect: (method) => {
      void route.applySegmentMethod(segIdx, method).then((ok) => {
        if (ok) {
          scheduleAutoSave();
        } else if (map !== null) {
          showRouteError(map, 'Routing failed. Check your API key.');
        }
      });
      removePopup();
    }
  });
  map.getContainer().appendChild(popupEl);
}

function removePopup(): void {
  if (popupEl !== null) {
    popupEl.remove();
    popupEl = null;
  }
}

// ---------- Drag ----------

function onPointMouseDown(e: MapLayerMouseEvent): void {
  if (map === null || e.originalEvent.button !== 0) return;
  if (route.current.get() === null) return;
  const feature = e.features?.[0];
  if (feature === undefined) return;
  const idx = feature.properties.index as number;
  startDrag(idx, e);
}

function onSegmentMouseDown(e: MapLayerMouseEvent): void {
  if (map === null || e.originalEvent.button !== 0) return;
  if (route.current.get() === null) return;
  // Don't start segment drag if also on a point
  const pointFeatures = map.queryRenderedFeatures(e.point, {
    layers: ['route-edit-points-layer']
  });
  if (pointFeatures.length > 0) return;

  const segIdx = firstClickableHit(e.features);
  if (segIdx === null) return;
  route.insertWaypoint(segIdx, e.lngLat.lng, e.lngLat.lat);

  // The new waypoint is at segIdx + 1; suppress the trailing click.
  suppressNextMapClick = true;
  startDrag(segIdx + 1, e);
}

function startDrag(idx: number, e: MapMouseEvent): void {
  if (map === null) return;
  e.preventDefault();
  map.dragPan.disable();
  map.on('mousemove', onDragMove);
  map.on('mouseup', onDragEnd);
  // Fallback: maplibre's mouseup is canvas-bound and won't fire if the
  // user releases outside the map container.
  document.addEventListener('mouseup', onDragEnd);
  transition({ kind: 'dragging', pointIdx: idx });
}

function onDragMove(e: MapMouseEvent): void {
  if (interaction?.kind !== 'dragging') return;
  route.updateAdjacentSegments(
    interaction.pointIdx,
    e.lngLat.lng,
    e.lngLat.lat
  );
}

function onDragEnd(): void {
  if (interaction?.kind !== 'dragging') return;
  const idx = interaction.pointIdx;
  teardownDragListeners();
  transition({ kind: 'idle' });
  rerouteAfterDrag(idx);
}

function rerouteAfterDrag(pointIdx: number): void {
  const cur = route.current.get();
  if (cur === null) return;
  const segBefore = pointIdx - 1;
  const segAfter = pointIdx;
  const segs = cur.data.segments;
  const fireBefore = segBefore >= 0 && segs[segBefore]?.method !== 'straight';
  const fireAfter =
    segAfter < segs.length && segs[segAfter]?.method !== 'straight';
  if (fireBefore) void route.rerouteSegment(segBefore);
  if (fireAfter) void route.rerouteSegment(segAfter);
  scheduleAutoSave();
}

function teardownDragListeners(): void {
  if (map === null) return;
  map.dragPan.enable();
  map.off('mousemove', onDragMove);
  map.off('mouseup', onDragEnd);
  document.removeEventListener('mouseup', onDragEnd);
}

// ---------- Cursor & hover ----------

const CURSOR_CLASSES = ['cursor-pointer', 'cursor-grabbing'];

function setCursorClass(cls: string | null): void {
  if (map === null) return;
  const canvas = map.getCanvas();
  for (const c of CURSOR_CLASSES) canvas.classList.remove(c);
  if (cls !== null) canvas.classList.add(cls);
}

function showHoverHighlight(segIdx: number): void {
  if (map === null) return;
  const cur = route.current.get();
  if (cur === null) return;
  const seg = cur.data.segments[segIdx];
  if (seg === undefined) return;
  setHoverSource(map, {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: seg.geometry },
    properties: {}
  });
}

function clearHoverHighlight(): void {
  if (map === null) return;
  setHoverSource(map, { type: 'FeatureCollection', features: [] });
}

// ---------- Hover handlers ----------

function onSegmentLeave(): void {
  if (interaction?.kind === 'hoveringSegment') {
    transition({ kind: 'idle' });
  }
}

function onSegmentMove(e: MapLayerMouseEvent): void {
  if (
    map === null ||
    interaction === null ||
    interaction.kind === 'dragging' ||
    interaction.kind === 'hoveringPoint'
  ) {
    return;
  }
  if (route.current.get() === null) return;
  const segIdx = firstClickableHit(e.features);
  if (segIdx === null) {
    if (interaction.kind === 'hoveringSegment') {
      transition({ kind: 'idle' });
    }
    return;
  }
  if (interaction.kind === 'hoveringSegment' && interaction.segIdx === segIdx) {
    return;
  }
  transition({ kind: 'hoveringSegment', segIdx });
}

function onPointEnter(e: MapLayerMouseEvent): void {
  if (map === null || interaction === null || interaction.kind === 'dragging') {
    return;
  }
  const id = e.features?.[0]?.id as number | undefined;
  if (id === undefined) return;
  transition({ kind: 'hoveringPoint', pointId: id });
}

function onPointLeave(): void {
  if (interaction?.kind === 'hoveringPoint') {
    transition({ kind: 'idle' });
  }
}
