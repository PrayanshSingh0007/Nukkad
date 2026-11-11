import { gzipSync } from 'node:zlib';
import tzlookup from 'tz-lookup';
import { PACK_VERSION, encodePack } from '@nukkad/shared';
import type { AreaRef } from '@nukkad/shared';
import { buildHeightGrid, buildPack } from '@nukkad/worldgen';
import type { ElevationSampler, OverpassResponse } from '@nukkad/worldgen';
import type { AreaStore } from '../store/areaStore.ts';

/** Where the raw map data comes from (the internet, or saved fixtures in tests). */
export interface AreaSource {
  fetchOsm(ref: AreaRef): Promise<OverpassResponse>;
  /** May fail or return null: the place then simply gets flat ground. */
  loadSampler(ref: AreaRef): Promise<ElevationSampler | null>;
}

/** An error with a message that is safe and friendly enough to show to a player. */
export class AreaError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface AreaServiceOptions {
  store: AreaStore;
  source: AreaSource;
  /** Packs kept in memory (each is roughly 100 KB). */
  memoryItems?: number;
  /** How many places may wait for their turn to be built before we say "busy". */
  maxQueue?: number;
  log?: (message: string) => void;
}

/**
 * Gives out Area Packs: memory → store (disk or MongoDB) → build from map data.
 * - Single-flight: 8 friends asking for the same new place cause ONE build.
 * - One build at a time: we never send parallel requests to the public Overpass server.
 */
export class AreaService {
  private readonly store: AreaStore;
  private readonly source: AreaSource;
  private readonly memoryItems: number;
  private readonly maxQueue: number;
  private readonly log: (message: string) => void;
  private readonly memory = new Map<string, Buffer>();
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private buildChain: Promise<unknown> = Promise.resolve();
  private queued = 0;

  constructor(options: AreaServiceOptions) {
    this.store = options.store;
    this.source = options.source;
    this.memoryItems = options.memoryItems ?? 24;
    this.maxQueue = options.maxQueue ?? 8;
    this.log = options.log ?? (() => {});
  }

  private static keyOf(ref: AreaRef): string {
    return `v${PACK_VERSION}_${ref.id}`;
  }

  private remember(key: string, gz: Buffer): void {
    this.memory.delete(key);
    this.memory.set(key, gz);
    if (this.memory.size > this.memoryItems) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
  }

  /** True when the pack can be served without asking OpenStreetMap. */
  async isCached(ref: AreaRef): Promise<boolean> {
    const key = AreaService.keyOf(ref);
    if (this.memory.has(key) || this.inFlight.has(key)) return true;
    const stored = await this.store.get(key).catch(() => null);
    if (stored) this.remember(key, stored);
    return stored !== null;
  }

  /** The gzipped JSON of the pack for an area. */
  async getPackGz(ref: AreaRef): Promise<Buffer> {
    const key = AreaService.keyOf(ref);
    const cached = this.memory.get(key);
    if (cached) {
      this.remember(key, cached);
      return cached;
    }
    const running = this.inFlight.get(key);
    if (running) return running;
    const task = this.load(key, ref).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  private async load(key: string, ref: AreaRef): Promise<Buffer> {
    const stored = await this.store.get(key).catch(() => null);
    if (stored) {
      this.remember(key, stored);
      return stored;
    }
    if (this.queued >= this.maxQueue) {
      throw new AreaError(503, 'busy', 'Lots of new places are being built right now. Try again in a minute.');
    }
    this.queued++;
    const build = this.buildChain.then(() => this.build(ref));
    this.buildChain = build.catch(() => {});
    try {
      const gz = await build;
      this.remember(key, gz);
      await this.store.put(key, gz).catch((error: unknown) => this.log(`could not save ${key}: ${String(error)}`));
      return gz;
    } finally {
      this.queued--;
    }
  }

  private async build(ref: AreaRef): Promise<Buffer> {
    const started = Date.now();
    let osm: OverpassResponse;
    try {
      osm = await this.source.fetchOsm(ref);
    } catch (error) {
      this.log(`map data for ${ref.id} failed: ${String(error)}`);
      throw new AreaError(502, 'map_unavailable', 'The OpenStreetMap server did not answer. Try again in a minute.');
    }
    const sampler = await this.source.loadSampler(ref).catch((error: unknown) => {
      this.log(`elevation for ${ref.id} failed (using flat ground): ${String(error)}`);
      return null;
    });
    const terrain = buildHeightGrid(ref, sampler);
    let timeZone = 'UTC';
    try {
      timeZone = tzlookup(ref.lat, ref.lng);
    } catch {
      // keep UTC
    }
    const pack = buildPack({ ref, osm, terrain, timeZone });
    const gz = gzipSync(JSON.stringify(encodePack(pack)), { level: 9 });
    this.log(
      `built ${ref.id}: ${pack.stats.buildings} buildings, ${pack.stats.roadKm} km of roads, ` +
        `${Math.round(gz.length / 1024)} KB, ${Date.now() - started} ms`,
    );
    return gz;
  }
}
