import { signal } from '@lit-labs/signals';

/**
 * Whether the Info panel is showing. Lives out here rather than staying the
 * panel's own reactive property because a second feature reads it:
 * `<map-accuracy-ring>` draws only while the panel is up, so the ring and the
 * `GPS accuracy` row it pictures always appear together. Not persisted — an
 * open panel is a momentary state, unlike anything in `view-state`.
 */
export const infoPanelOpen = signal(false);
