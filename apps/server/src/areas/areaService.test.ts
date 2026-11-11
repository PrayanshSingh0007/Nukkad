import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { areaRefFor, decodePack } from '@nukkad/shared';
import type { AreaPack, WirePack } from '@nukkad/shared';
import { MemoryAreaStore } from '../store/areaStore.ts';
import { AreaError, AreaService } from './areaService.ts';
import type { AreaSource } from './areaService.ts';

const ref = areaRefFor(12.921, 77.695);
const other = areaRefFor(48.858, 2.294);

/** A fake map source that counts how often it is asked and can be told to fail. */
function fakeSource(options: { failOsm?: boolean; failElevation?: boolean; delayMs?: number } = {}) {
  const calls = { osm: 0, running: 0, maxRunning: 0 };
  const source: AreaSource = {
    async fetchOsm() {
      calls.osm++;
      calls.running++;
      calls.maxRunning = Math.max(calls.maxRunning, calls.running);
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5));
      calls.running--;
      if (options.failOsm) throw new Error('boom');
      return { elements: [] };
    },
    async loadSampler() {
      if (options.failElevation) throw new Error('no tiles');
      return () => 100;
    },
  };
  return { source, calls };
}

const unpack = (gz: Buffer): AreaPack => decodePack(JSON.parse(gunzipSync(gz).toString('utf8')) as WirePack);

describe('AreaService', () => {
  it('builds a place once even when many people ask at the same time', async () => {
    const { source, calls } = fakeSource();
    const service = new AreaService({ store: new MemoryAreaStore(), source });
    const results = await Promise.all(Array.from({ length: 8 }, () => service.getPackGz(ref)));
    expect(calls.osm).toBe(1);
    expect(new Set(results).size).toBe(1);
    expect(unpack(results[0]).id).toBe(ref.id);
    await service.getPackGz(ref);
    expect(calls.osm).toBe(1); // served from memory
  });

  it('reuses the stored pack after a restart', async () => {
    const store = new MemoryAreaStore();
    const first = fakeSource();
    await new AreaService({ store, source: first.source }).getPackGz(ref);
    const second = fakeSource();
    const service = new AreaService({ store, source: second.source });
    expect(await service.isCached(ref)).toBe(true);
    await service.getPackGz(ref);
    expect(second.calls.osm).toBe(0);
  });

  it('never talks to the map server for two places at once', async () => {
    const { source, calls } = fakeSource({ delayMs: 20 });
    const service = new AreaService({ store: new MemoryAreaStore(), source });
    await Promise.all([service.getPackGz(ref), service.getPackGz(other)]);
    expect(calls.osm).toBe(2);
    expect(calls.maxRunning).toBe(1);
  });

  it('falls back to flat ground when elevation is unavailable', async () => {
    const { source } = fakeSource({ failElevation: true });
    const pack = unpack(await new AreaService({ store: new MemoryAreaStore(), source }).getPackGz(ref));
    expect(pack.terrain.flat).toBe(1);
    expect(pack.attribution).toHaveLength(1);
  });

  it('reports a friendly error when the map server fails, and can retry later', async () => {
    const failing = fakeSource({ failOsm: true });
    const store = new MemoryAreaStore();
    const service = new AreaService({ store, source: failing.source });
    await expect(service.getPackGz(ref)).rejects.toMatchObject({ status: 502, code: 'map_unavailable' });
    await expect(service.getPackGz(ref)).rejects.toBeInstanceOf(AreaError);
    expect(failing.calls.osm).toBe(2); // a failure is not cached
    expect(await service.isCached(ref)).toBe(false);
  });

  it('says "busy" instead of queueing without limit', async () => {
    const { source } = fakeSource({ delayMs: 30 });
    const service = new AreaService({ store: new MemoryAreaStore(), source, maxQueue: 2 });
    const places = [0, 1, 2, 3].map((n) => areaRefFor(10 + n, 20));
    const results = await Promise.allSettled(places.map((place) => service.getPackGz(place)));
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected.length).toBe(2);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 503, code: 'busy' });
  });
});
