import { signal } from '@lit-labs/signals';

import { effect } from './signals';

/**
 * Whether the Info panel is showing. Lives out here rather than staying the
 * panel's own reactive property because a second feature reads it:
 * `<map-accuracy-ring>` draws only while the panel is up, so the ring and the
 * `GPS accuracy` row it pictures always appear together. Not persisted — an
 * open panel is a momentary state, unlike anything in `view-state`.
 */
export const infoPanelOpen = signal(false);

const HELP_OPEN_KEY = 'helpOpen';

/**
 * Whether the Help panel is showing. Out here because two things flip it: the
 * panel's own close button and the `?` in `<filter-panel>`'s header.
 *
 * Kept for the tab's lifetime and no longer. The desktop app reloads its
 * webview when the startup rebuild finds changed items — which a first launch
 * always does, seconds after the first-run panel opened — and again for every
 * deep link; without this each of those would shut a panel the user was
 * reading. `sessionStorage` rather than the URL, so it never reaches the saved
 * view and a relaunch starts closed.
 */
export const helpPanelOpen = signal(
  sessionStorage.getItem(HELP_OPEN_KEY) === '1'
);

effect(() => {
  if (helpPanelOpen.get()) sessionStorage.setItem(HELP_OPEN_KEY, '1');
  else sessionStorage.removeItem(HELP_OPEN_KEY);
});

export function toggleHelp() {
  helpPanelOpen.set(!helpPanelOpen.get());
}

/**
 * Open the Help panel the first time the app runs on this Mac. The server
 * owns the answer and records it as it gives it: the desktop app is served
 * from a different port every launch, so nothing the webview stores by origin
 * outlives one.
 */
export async function openHelpOnFirstRun() {
  try {
    const res = await fetch('/api/first-run', { method: 'POST' });
    if (!res.ok) return;
    const { firstRun } = (await res.json()) as { firstRun: boolean };
    if (firstRun) helpPanelOpen.set(true);
  } catch {
    // Offline or mid-reload: a panel that fails to volunteer itself is still
    // one click away.
  }
}

/**
 * What `<filter-panel>` covers at the viewport's right edge: 220px of panel,
 * 10px in from the edge, 10px of air.
 */
export const FILTER_PANEL_INSET = 240;
/** `<help-panel>` beside it: 340px wide and the 10px gap between the two. */
const HELP_PANEL_INSET = 350;
/** The photo card is 320px at its widest; less map than this can't hold one. */
const MIN_MAP_WIDTH = 360;

/**
 * How much of the viewport's right edge the camera should treat as covered,
 * so the photo card and a fit both land clear of the panels there. Reads the
 * Help panel's signal, so an effect that calls this re-runs when it opens.
 *
 * Not in a window too narrow to hold a card beside both panels: there the card
 * can't be kept clear, and chasing it would only push it off the other edge.
 */
export function rightInset() {
  if (!helpPanelOpen.get()) return FILTER_PANEL_INSET;
  const both = FILTER_PANEL_INSET + HELP_PANEL_INSET;
  return window.innerWidth - both < MIN_MAP_WIDTH ? FILTER_PANEL_INSET : both;
}
