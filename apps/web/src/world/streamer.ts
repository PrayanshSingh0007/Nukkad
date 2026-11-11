import type { ChunkData, ChunkLod } from '@nukkad/worldgen';
import type { WorldClient } from './worldClient.ts';
import type { WorldView } from './worldView.ts';
import { chunkKey, distanceToChunk, planChunks } from './streamPlan.ts';
import type { StreamSettings } from './streamPlan.ts';

const MAX_IN_FLIGHT = 2; // chunks being built in the worker at once (PLAN §7)

/**
 * Loads and unloads chunks around the player: full detail near, simplified far,
 * nothing beyond the view distance. Nearest first, with a bonus for what is in front.
 * At most one finished chunk is put on screen per frame, so walking never stutters.
 */
export class Streamer {
  settings: StreamSettings;
  /** Full-detail chunk data kept for the physics colliders. */
  readonly nearData = new Map<string, ChunkData>();
  private readonly client: WorldClient;
  private readonly view: WorldView;
  private readonly loaded = new Map<string, ChunkLod>();
  private readonly inFlight = new Set<string>();
  private readonly arrived: ChunkData[] = [];
  private plan = new Map<string, ChunkLod>();
  private disposed = false;
  /** Called after a chunk appears (used to (re)build colliders). */
  onChunk: (() => void) | null = null;

  constructor(client: WorldClient, view: WorldView, settings: StreamSettings) {
    this.client = client;
    this.view = view;
    this.settings = settings;
  }

  get counts(): { near: number; far: number; building: number } {
    let near = 0;
    let far = 0;
    for (const lod of this.loaded.values()) {
      if (lod === 0) near++;
      else far++;
    }
    return { near, far, building: this.inFlight.size };
  }

  /** Call every frame with the player position and the camera's forward direction on the ground. */
  update(x: number, z: number, forwardX: number, forwardZ: number): void {
    this.plan = planChunks(x, z, this.loaded, this.settings);

    for (const [key] of this.loaded) {
      if (this.plan.has(key)) continue;
      this.view.removeChunk(key);
      this.loaded.delete(key);
      this.nearData.delete(key);
    }

    // Put at most one finished chunk on screen.
    while (this.arrived.length > 0) {
      const chunk = this.arrived.shift() as ChunkData;
      const key = chunkKey(chunk.cx, chunk.cz);
      const wanted = this.plan.get(key);
      const shown = this.loaded.get(key);
      if (wanted === undefined || shown === wanted) continue;
      // A far version is still useful as a stand-in while the near one is being built.
      if (chunk.lod !== wanted && shown !== undefined) continue;
      this.view.addChunk(chunk);
      this.loaded.set(key, chunk.lod);
      if (chunk.lod === 0) this.nearData.set(key, chunk);
      else this.nearData.delete(key);
      this.onChunk?.();
      break;
    }

    if (this.inFlight.size >= MAX_IN_FLIGHT) return;
    const todo: { cx: number; cz: number; lod: ChunkLod; score: number }[] = [];
    for (const [key, lod] of this.plan) {
      if (this.loaded.get(key) === lod || this.inFlight.has(`${key},${lod}`)) continue;
      const [cx, cz] = key.split(',').map(Number);
      const s = this.settings;
      const distance = distanceToChunk(x, z, cx, cz, s);
      const toX = -s.half + (cx + 0.5) * s.chunkSize - x;
      const toZ = -s.half + (cz + 0.5) * s.chunkSize - z;
      const inFront = toX * forwardX + toZ * forwardZ > 0;
      todo.push({ cx, cz, lod, score: distance * (inFront ? 0.7 : 1) - (lod === 0 ? 1000 : 0) });
    }
    todo.sort((a, b) => a.score - b.score);
    for (const job of todo.slice(0, MAX_IN_FLIGHT - this.inFlight.size)) this.request(job.cx, job.cz, job.lod);
  }

  private request(cx: number, cz: number, lod: ChunkLod): void {
    const id = `${chunkKey(cx, cz)},${lod}`;
    this.inFlight.add(id);
    this.client
      .requestChunk(cx, cz, lod)
      .then((message) => {
        if (!this.disposed) this.arrived.push(message.chunk);
      })
      .catch(() => {
        // The worker reports errors through the load promise; a lost chunk is simply asked for again.
      })
      .finally(() => this.inFlight.delete(id));
  }

  dispose(): void {
    this.disposed = true;
  }
}
