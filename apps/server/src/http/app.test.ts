import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { PACK_VERSION } from '@nukkad/shared';
import { AreaService } from '../areas/areaService.ts';
import type { AreaSource } from '../areas/areaService.ts';
import { TokenBuckets } from '../security/tokenBuckets.ts';
import { MemoryAreaStore } from '../store/areaStore.ts';
import { RoomManager } from '../realtime/rooms.ts';
import { createApp } from './app.ts';
import type { AppOptions } from './app.ts';

let server: Server | undefined;
afterEach(() => server?.close());

/** Starts the real HTTP app on a free port with a fake map source. */
async function start(overrides: Partial<AppOptions> = {}, failOsm = false): Promise<{ url: string; osmCalls: () => number }> {
  let osmCalls = 0;
  const source: AreaSource = {
    async fetchOsm() {
      osmCalls++;
      if (failOsm) throw new Error('down');
      return { elements: [] };
    },
    async loadSampler() {
      return null;
    },
  };
  const areas = new AreaService({ store: new MemoryAreaStore(), source });
  const app = createApp({ areas, rooms: new RoomManager(), allowedOrigins: ['https://nukkad.example'], trustProxy: false, ...overrides });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server!.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, osmCalls: () => osmCalls };
}

describe('HTTP API', () => {
  it('answers the health check', async () => {
    const { url } = await start();
    const body = await (await fetch(`${url}/api/health`)).json();
    expect(body).toMatchObject({ ok: true, name: 'nukkad' });
  });

  it('serves an area pack as gzipped JSON with cache headers', async () => {
    const { url, osmCalls } = await start();
    const response = await fetch(`${url}/api/areas?lat=12.9206802&lng=77.695322`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.get('cache-control')).toContain('max-age');
    expect(response.headers.get('x-nukkad-area')).toBe('a_12921_77695_600');
    const pack = await response.json();
    expect(pack).toMatchObject({ id: 'a_12921_77695_600', halfSize: 600 });
    await fetch(`${url}/api/areas?lat=12.9209&lng=77.6951`); // snaps to the same area
    expect(osmCalls()).toBe(1);
  });

  it('rejects bad coordinates with a clear message', async () => {
    const { url, osmCalls } = await start();
    for (const query of ['', '?lat=abc&lng=1', '?lat=95&lng=1', '?lat=1', '?lat=1&lng=1&r=big', '?lat=1&lat=2&lng=3']) {
      const response = await fetch(`${url}/api/areas${query}`);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('bad_request');
    }
    expect(osmCalls()).toBe(0);
  });

  it('refuses a web app that expects a different pack version, without caching the refusal', async () => {
    const { url, osmCalls } = await start();
    const response = await fetch(`${url}/api/areas?lat=10&lng=20&v=${PACK_VERSION - 1}`);
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: 'version_mismatch' });
    expect(osmCalls()).toBe(0);
    expect((await fetch(`${url}/api/areas?lat=10&lng=20&v=${PACK_VERSION}`)).status).toBe(200);
  });

  it('limits how fast one address can open brand-new places', async () => {
    const { url } = await start({ newAreaBurst: 2, newAreasPerMinute: 0 });
    const statuses: number[] = [];
    for (let n = 0; n < 4; n++) statuses.push((await fetch(`${url}/api/areas?lat=${10 + n}&lng=20`)).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
    // Places that are already cached stay available.
    expect((await fetch(`${url}/api/areas?lat=10&lng=20`)).status).toBe(200);
  });

  it('limits the total number of requests per address', async () => {
    const { url } = await start({ areaRequestsPerMinute: 3 });
    const statuses: number[] = [];
    for (let n = 0; n < 5; n++) statuses.push((await fetch(`${url}/api/areas?lat=10&lng=20`)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it('passes on a friendly error when the map server is down', async () => {
    const { url } = await start({}, true);
    const response = await fetch(`${url}/api/areas?lat=10&lng=20`);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'map_unavailable' });
  });

  it('allows cross-origin calls only from the configured web app', async () => {
    const { url } = await start();
    const allowed = await fetch(`${url}/api/health`, { headers: { Origin: 'https://nukkad.example' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://nukkad.example');
    const stranger = await fetch(`${url}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns JSON for unknown pages', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/nope`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');
  });
});

describe('TokenBuckets', () => {
  it('allows a burst, then refills over time', () => {
    let time = 0;
    const buckets = new TokenBuckets(3, 60, () => time); // 3 at once, then one per second
    expect([1, 2, 3, 4].map(() => buckets.consume('a'))).toEqual([true, true, true, false]);
    expect(buckets.consume('b')).toBe(true); // other keys are independent
    time += 1000;
    expect(buckets.consume('a')).toBe(true);
    expect(buckets.consume('a')).toBe(false);
    time += 60_000;
    expect([1, 2, 3, 4].map(() => buckets.consume('a'))).toEqual([true, true, true, false]);
  });
});
