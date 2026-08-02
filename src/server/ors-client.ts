/**
 * OrsClient — proxy to OpenRouteService.
 *
 * Owns API key resolution (env vars `PUBLIC_ORS_API_KEY` / `ORS_API_KEY`,
 * falling back to the `ors_api_key` setting in `state.json`), profile mapping
 * from client-side names to ORS names, and the upstream HTTP call. Returns a
 * `Response` the router can relay directly.
 */

import { getSetting } from './state';

const ORS_PROFILES: Record<string, string> = {
  driving: 'driving-car',
  walking: 'foot-walking',
  hiking: 'foot-hiking',
  cycling: 'cycling-regular'
};

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions';

export interface OrsRouteRequest {
  coordinates: Array<[number, number]>;
  profile: string;
}

export interface OrsClient {
  route: (input: OrsRouteRequest) => Promise<Response>;
}

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export interface OrsClientOptions {
  /** Override fetch for tests. Defaults to globalThis.fetch. */
  fetchImpl?: FetchImpl;
}

export function createOrsClient(
  supportDir: string,
  options: OrsClientOptions = {}
): OrsClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  function resolveApiKey(): string | null {
    const envKey = process.env.PUBLIC_ORS_API_KEY ?? process.env.ORS_API_KEY;
    if (envKey !== undefined && envKey !== '') return envKey;
    const setting = getSetting(supportDir, 'ors_api_key');
    return setting === '' ? null : setting;
  }

  async function route(input: OrsRouteRequest): Promise<Response> {
    const apiKey = resolveApiKey();
    if (apiKey === null) {
      return new Response(
        'ORS_API_KEY not configured. Set env var or db setting "ors_api_key".',
        { status: 503 }
      );
    }

    const orsProfile = ORS_PROFILES[input.profile];
    if (
      orsProfile === undefined ||
      !Array.isArray(input.coordinates) ||
      input.coordinates.length < 2
    ) {
      return new Response('Invalid request', { status: 400 });
    }

    const resp = await fetchImpl(`${ORS_BASE_URL}/${orsProfile}/geojson`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({ coordinates: input.coordinates })
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[route] ORS ${resp.status}: ${text}`);
      return new Response(`Routing error: ${resp.status}`, {
        status: resp.status
      });
    }
    const data = (await resp.json()) as {
      features?: Array<{ geometry: unknown }>;
    };
    const feature = data.features?.[0];
    if (feature === undefined) {
      return new Response('No route found', { status: 404 });
    }
    return Response.json({ geometry: feature.geometry });
  }

  return { route };
}
