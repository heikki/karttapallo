import * as edits from '@common/edits';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

import {
  insertPoint,
  removePoint,
  reorderPhotoPoints,
  syncPhotoPoints
} from './route-data';
import type { RouteData, RoutePoint } from './route-data';

function dropOrphanPhotoPoints(
  r: RouteData,
  eligibleUuids: Set<string>
): { route: RouteData; changed: boolean } {
  let cur = r;
  let changed = false;
  for (let i = cur.points.length - 1; i >= 0; i--) {
    const pt = cur.points[i]!;
    if (
      pt.type === 'photo' &&
      pt.uuid !== undefined &&
      !eligibleUuids.has(pt.uuid)
    ) {
      cur = removePoint(cur, i);
      changed = true;
    }
  }
  return { route: cur, changed };
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

function findMissingPhotos(r: RouteData, eligible: Photo[]): Photo[] {
  const inRoute = new Set<string>();
  for (const pt of r.points) {
    if (pt.type === 'photo' && pt.uuid !== undefined) inRoute.add(pt.uuid);
  }
  return eligible.filter((p) => !inRoute.has(p.uuid));
}

function buildAnchorList(
  r: RouteData,
  sortKeyByUuid: Map<string, string>
): Anchor[] {
  const anchors: Anchor[] = [];
  for (let i = 0; i < r.points.length; i++) {
    const pt = r.points[i]!;
    if (pt.type === 'photo' && pt.uuid !== undefined) {
      const sk = sortKeyByUuid.get(pt.uuid);
      if (sk !== undefined) anchors.push({ index: i, sortKey: sk });
    }
  }
  return anchors;
}

function planInsertions(
  r: RouteData,
  missing: Photo[],
  anchors: Anchor[],
  sortKeyByUuid: Map<string, string>
): InsertPlan[] {
  const plans: InsertPlan[] = missing.map((m) => {
    const sk = sortKeyByUuid.get(m.uuid)!;
    const loc = edits.getEffectiveLocation(m)!;
    const next = anchors.find((a) => a.sortKey >= sk);
    const atIndex = next === undefined ? r.points.length : next.index;
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
  r: RouteData,
  eligible: Photo[]
): { route: RouteData; changed: boolean } {
  if (eligible.length === 0) return { route: r, changed: false };
  const missing = findMissingPhotos(r, eligible);
  if (missing.length === 0) return { route: r, changed: false };

  const sortKeyByUuid = new Map<string, string>();
  for (const p of eligible) {
    sortKeyByUuid.set(p.uuid, toUtcSortKey(edits.getEffectiveDate(p), p.tz));
  }
  const anchors = buildAnchorList(r, sortKeyByUuid);
  const plans = planInsertions(r, missing, anchors, sortKeyByUuid);
  let cur = r;
  for (const plan of plans) {
    cur = insertPoint(cur, plan.atIndex, plan.pt);
  }
  return { route: cur, changed: true };
}

/**
 * Reconcile a saved route against an album: drop orphan photo points,
 * sync existing photo coordinates, insert newly eligible photos, reorder
 * by date. Returns the new RouteData and whether structure changed.
 */
export function reconcileWithAlbum(
  r: RouteData,
  albumPhotos: Photo[]
): { route: RouteData; changed: boolean } {
  const eligible = albumPhotos.filter(
    (p) => edits.getEffectiveLocation(p) !== null && p.date !== ''
  );
  const eligibleUuids = new Set(eligible.map((p) => p.uuid));

  let cur = r;
  let changed = false;

  const dropped = dropOrphanPhotoPoints(cur, eligibleUuids);
  cur = dropped.route;
  if (dropped.changed) changed = true;

  const synced = syncPhotoPoints(cur, eligible);
  cur = synced.route;
  if (synced.changed) changed = true;

  const inserted = insertMissingPhotoPoints(cur, eligible);
  cur = inserted.route;
  if (inserted.changed) changed = true;

  const reordered = reorderPhotoPoints(cur, eligible);
  cur = reordered.route;
  if (reordered.changed) changed = true;

  return { route: cur, changed };
}
