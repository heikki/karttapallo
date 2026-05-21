import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createOrsClient, type FetchImpl } from './ors-client';

const ORIGINAL_ENV = {
  PUBLIC_ORS_API_KEY: process.env.PUBLIC_ORS_API_KEY,
  ORS_API_KEY: process.env.ORS_API_KEY
};

let dataDir = '';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'karttapallo-ors-'));
  delete process.env.PUBLIC_ORS_API_KEY;
  delete process.env.ORS_API_KEY;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (ORIGINAL_ENV.PUBLIC_ORS_API_KEY === undefined) {
    delete process.env.PUBLIC_ORS_API_KEY;
  } else {
    process.env.PUBLIC_ORS_API_KEY = ORIGINAL_ENV.PUBLIC_ORS_API_KEY;
  }
  if (ORIGINAL_ENV.ORS_API_KEY === undefined) {
    delete process.env.ORS_API_KEY;
  } else {
    process.env.ORS_API_KEY = ORIGINAL_ENV.ORS_API_KEY;
  }
});

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeFetchStub(response: Response): {
  fetchImpl: FetchImpl;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchImpl = (input, init) => {
    calls.push({ url: input, init });
    return Promise.resolve(response);
  };
  return { fetchImpl, calls };
}

describe('API key resolution', () => {
  test('returns 503 when no key configured', async () => {
    const { fetchImpl } = makeFetchStub(new Response());
    const client = createOrsClient(dataDir, { fetchImpl });
    const resp = await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'driving'
    });
    expect(resp.status).toBe(503);
  });

  test('PUBLIC_ORS_API_KEY env var takes precedence', async () => {
    process.env.PUBLIC_ORS_API_KEY = 'public-key';
    process.env.ORS_API_KEY = 'private-key';
    writeFileSync(
      join(dataDir, 'state.json'),
      JSON.stringify({ ors_api_key: 'state-key' })
    );
    const { fetchImpl, calls } = makeFetchStub(
      Response.json({
        features: [{ geometry: { type: 'LineString', coordinates: [] } }]
      })
    );
    const client = createOrsClient(dataDir, { fetchImpl });
    await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'driving'
    });
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'public-key'
    });
  });

  test('ORS_API_KEY env var fallback when PUBLIC missing', async () => {
    process.env.ORS_API_KEY = 'private-key';
    const { fetchImpl, calls } = makeFetchStub(
      Response.json({
        features: [{ geometry: { type: 'LineString', coordinates: [] } }]
      })
    );
    const client = createOrsClient(dataDir, { fetchImpl });
    await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'driving'
    });
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'private-key'
    });
  });

  test('state.json fallback when env vars missing', async () => {
    writeFileSync(
      join(dataDir, 'state.json'),
      JSON.stringify({ ors_api_key: 'state-key' })
    );
    const { fetchImpl, calls } = makeFetchStub(
      Response.json({
        features: [{ geometry: { type: 'LineString', coordinates: [] } }]
      })
    );
    const client = createOrsClient(dataDir, { fetchImpl });
    await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'driving'
    });
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'state-key'
    });
  });
});

describe('input validation', () => {
  beforeEach(() => {
    process.env.PUBLIC_ORS_API_KEY = 'k';
  });

  test('returns 400 for unknown profile', async () => {
    const { fetchImpl } = makeFetchStub(new Response());
    const client = createOrsClient(dataDir, { fetchImpl });
    const resp = await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'teleport'
    });
    expect(resp.status).toBe(400);
  });

  test('returns 400 for fewer than 2 coordinates', async () => {
    const { fetchImpl } = makeFetchStub(new Response());
    const client = createOrsClient(dataDir, { fetchImpl });
    const resp = await client.route({
      coordinates: [[0, 0]],
      profile: 'driving'
    });
    expect(resp.status).toBe(400);
  });

  test('returns 400 when coordinates is not an array', async () => {
    const { fetchImpl } = makeFetchStub(new Response());
    const client = createOrsClient(dataDir, { fetchImpl });
    const resp = await client.route({
      coordinates: undefined as unknown as Array<[number, number]>,
      profile: 'driving'
    });
    expect(resp.status).toBe(400);
  });
});

describe('profile mapping', () => {
  beforeEach(() => {
    process.env.PUBLIC_ORS_API_KEY = 'k';
  });

  test.each([
    ['driving', 'driving-car'],
    ['walking', 'foot-walking'],
    ['hiking', 'foot-hiking'],
    ['cycling', 'cycling-regular']
  ])('%s maps to %s in URL', async (clientProfile, orsProfile) => {
    const { fetchImpl, calls } = makeFetchStub(
      Response.json({ features: [{ geometry: {} }] })
    );
    const client = createOrsClient(dataDir, { fetchImpl });
    await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: clientProfile
    });
    expect(calls[0]?.url).toBe(
      `https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`
    );
  });
});

describe('upstream responses', () => {
  beforeEach(() => {
    process.env.PUBLIC_ORS_API_KEY = 'k';
  });

  test('returns geometry from first feature on 200', async () => {
    const geometry = {
      type: 'LineString' as const,
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    };
    const { fetchImpl } = makeFetchStub(
      Response.json({ features: [{ geometry }, { geometry: {} }] })
    );
    const client = createOrsClient(dataDir, { fetchImpl });
    const resp = await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'driving'
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ geometry });
  });

  test('returns 404 when upstream returns no features', async () => {
    const { fetchImpl } = makeFetchStub(Response.json({ features: [] }));
    const client = createOrsClient(dataDir, { fetchImpl });
    const resp = await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'driving'
    });
    expect(resp.status).toBe(404);
  });

  test('passes through upstream error status', async () => {
    const { fetchImpl } = makeFetchStub(
      new Response('rate limit', { status: 429 })
    );
    const client = createOrsClient(dataDir, { fetchImpl });
    const resp = await client.route({
      coordinates: [
        [0, 0],
        [1, 1]
      ],
      profile: 'driving'
    });
    expect(resp.status).toBe(429);
  });

  test('forwards coordinates as JSON body', async () => {
    const coords: Array<[number, number]> = [
      [24.93, 60.17],
      [25.0, 60.2]
    ];
    const { fetchImpl, calls } = makeFetchStub(
      Response.json({ features: [{ geometry: {} }] })
    );
    const client = createOrsClient(dataDir, { fetchImpl });
    await client.route({ coordinates: coords, profile: 'driving' });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      coordinates: coords
    });
  });
});
