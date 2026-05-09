import { signal } from '@lit-labs/signals';

import type { RouteData } from './route-data';

// Where the canonical route lives + how it persists.
//
// In-memory: a mutable RouteData reference, signal-backed via a revision
// counter so subscribers fire on in-place mutation (without paying for a
// deep clone on every drag-move). Read paths call getRoute() to subscribe;
// mutators call notifyChanged() after splicing arrays/objects in place.

let currentRoute: RouteData | null = null;
let currentRouteAlbum: string | null = null;
// Counter lives outside the signal so writers don't read the signal — calling
// `revision.get()` inside setRoute would subscribe the calling effect to
// `revision` and create a setRoute → re-fire → setRoute loop.
let revCounter = 0;
const revision = signal(0);

export function getRoute(): RouteData | null {
  revision.get();
  return currentRoute;
}

/**
 * The album the current route belongs to. Use to guard mutations against
 * stale-route races when multiple effects respond to an album change.
 */
export function getRouteAlbum(): string | null {
  revision.get();
  return currentRouteAlbum;
}

export function setRoute(album: string, r: RouteData): void {
  currentRoute = r;
  currentRouteAlbum = album;
  revision.set(++revCounter);
}

export function clearRoute(): void {
  currentRoute = null;
  currentRouteAlbum = null;
  revision.set(++revCounter);
}

/** Call after an in-place mutation so subscribers re-run. */
export function notifyChanged(): void {
  revision.set(++revCounter);
}

export async function loadFromServer(album: string): Promise<RouteData | null> {
  try {
    const resp = await fetch(`/api/albums/${encodeURIComponent(album)}/route`);
    if (!resp.ok) return null;
    return (await resp.json()) as RouteData;
  } catch {
    return null;
  }
}

export async function saveToServer(
  album: string,
  route: RouteData
): Promise<void> {
  await fetch(`/api/albums/${encodeURIComponent(album)}/route`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(route)
  });
}
