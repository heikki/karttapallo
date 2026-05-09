import * as edits from '@common/edits';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

import {
  insertPointAt,
  removePointAt,
  reorderRoutePhotoPoints,
  syncPhotoPoints
} from './route-data';
import type { RouteData, RoutePoint } from './route-data';

function dropOrphanPhotoPoints(
  route: RouteData,
  eligibleUuids: Set<string>
): boolean {
  let changed = false;
  for (let i = route.points.length - 1; i >= 0; i--) {
    const pt = route.points[i]!;
    if (
      pt.type === 'photo' &&
      pt.uuid !== undefined &&
      !eligibleUuids.has(pt.uuid)
    ) {
      removePointAt(route, i);
      changed = true;
    }
  }
  return changed;
}

interface InsertPlan {
  atIndex: number;
  pt: RoutePoint;
  sortKey: string;
}

interface Anchor {
  index: number;
  sortKey: string;
}

function findMissingPhotos(route: RouteData, eligible: Photo[]): Photo[] {
  const inRoute = new Set<string>();
  for (const pt of route.points) {
    if (pt.type === 'photo' && pt.uuid !== undefined) inRoute.add(pt.uuid);
  }
  return eligible.filter((p) => !inRoute.has(p.uuid));
}

function buildAnchorList(
  route: RouteData,
  sortKeyByUuid: Map<string, string>
): Anchor[] {
  const anchors: Anchor[] = [];
  for (let i = 0; i < route.points.length; i++) {
    const pt = route.points[i]!;
    if (pt.type === 'photo' && pt.uuid !== undefined) {
      const sk = sortKeyByUuid.get(pt.uuid);
      if (sk !== undefined) anchors.push({ index: i, sortKey: sk });
    }
  }
  return anchors;
}

function planInsertions(
  route: RouteData,
  missing: Photo[],
  anchors: Anchor[],
  sortKeyByUuid: Map<string, string>
): InsertPlan[] {
  const plans: InsertPlan[] = missing.map((m) => {
    const sk = sortKeyByUuid.get(m.uuid)!;
    const loc = edits.getEffectiveLocation(m)!;
    const next = anchors.find((a) => a.sortKey >= sk);
    const atIndex = next === undefined ? route.points.length : next.index;
    return {
      atIndex,
      pt: { type: 'photo', uuid: m.uuid, lon: loc.lon, lat: loc.lat },
      sortKey: sk
    };
  });
  // Apply back-to-front by atIndex; within same atIndex, larger sortKey first
  // so the lowest sortKey ends up at the lowest final index.
  plans.sort((a, b) => {
    if (a.atIndex !== b.atIndex) return b.atIndex - a.atIndex;
    return a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0;
  });
  return plans;
}

function insertMissingPhotoPoints(
  route: RouteData,
  eligible: Photo[]
): boolean {
  if (eligible.length === 0) return false;
  const missing = findMissingPhotos(route, eligible);
  if (missing.length === 0) return false;

  const sortKeyByUuid = new Map<string, string>();
  for (const p of eligible) {
    sortKeyByUuid.set(p.uuid, toUtcSortKey(edits.getEffectiveDate(p), p.tz));
  }
  const anchors = buildAnchorList(route, sortKeyByUuid);
  const plans = planInsertions(route, missing, anchors, sortKeyByUuid);
  for (const plan of plans) {
    insertPointAt(route, plan.atIndex, plan.pt);
  }
  return true;
}

/**
 * Reconcile a saved route against an album: drop orphan photo points,
 * sync existing photo coordinates, insert newly eligible photos, reorder
 * by date. Returns true if the route's structure changed.
 */
export function reconcileRouteWithAlbum(
  route: RouteData,
  albumPhotos: Photo[]
): boolean {
  const eligible = albumPhotos.filter(
    (p) => edits.getEffectiveLocation(p) !== null && p.date !== ''
  );
  const eligibleUuids = new Set(eligible.map((p) => p.uuid));

  let changed = false;
  if (dropOrphanPhotoPoints(route, eligibleUuids)) changed = true;
  if (syncPhotoPoints(route, eligible)) changed = true;
  if (insertMissingPhotoPoints(route, eligible)) changed = true;
  if (reorderRoutePhotoPoints(route, eligible)) changed = true;
  return changed;
}
