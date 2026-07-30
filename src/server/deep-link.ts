/**
 * `karttapallo://` deep links — open the desktop app straight on one photo.
 *
 * Registered as a macOS URL scheme (`app.urlSchemes` in electrobun.config.ts)
 * and delivered to `src/server/index.ts` via Electrobun's `open-url` event.
 * Parsing lives here so it stays testable without an app bundle.
 *
 * The form is:
 *   karttapallo://photo?id=<uuid>
 *
 * `id` is deliberately the same param name the app already uses for a
 * selected photo in its own URL, so a deep link and the in-app URL name the
 * photo the same way and there is one spelling to remember.
 */

// Photos UUIDs are `8-4-4-4-12` hex. Checked loosely — the point is to reject
// characters that could smuggle something into the query string we build from
// this, not to re-validate Apple's identifier format.
const UUID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface DeepLink {
  uuid: string;
}

function toUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function parseDeepLink(raw: string): DeepLink | null {
  const url = toUrl(raw);
  if (url?.protocol !== 'karttapallo:') return null;

  // The host (`photo`) is not checked: it reads as the target and leaves
  // room for other kinds later, but `id` is what carries the meaning.
  const uuid = url.searchParams.get('id');
  if (uuid === null || !UUID_RE.test(uuid)) return null;
  return { uuid };
}

/**
 * The in-app URL a deep link resolves to. `focus=1` marks it as a deep link
 * rather than restored state, so the client may widen filters and move the
 * camera to land on the photo — see `@common/deep-link`.
 *
 * Filters and map position are deliberately dropped: a deep link means "show
 * me this photo", and inheriting a restored year/album filter is exactly what
 * would hide it. Basemap and marker style carry over because they're taste,
 * not scope.
 */
export function deepLinkViewUrl(
  baseUrl: string,
  uuid: string,
  savedView: Record<string, string> = {}
): string {
  const params = new URLSearchParams({ id: uuid, focus: '1' });
  for (const key of ['style', 'markers']) {
    const value = savedView[key];
    if (value !== undefined && value !== '') params.set(key, value);
  }
  return `${baseUrl}?${params.toString()}`;
}
