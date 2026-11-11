import { CHUNK_SIZE } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { heightAt } from '@nukkad/worldgen';
import type { ChunkData } from '@nukkad/worldgen';
import { StatsMeter, formatStats } from '../debug/statsHud.ts';
import { PhysicsWorld } from '../physics/physicsWorld.ts';
import { CameraRig } from '../player/cameraRig.ts';
import { PlayerInput } from '../player/input.ts';
import type { ReadyMessage } from '../workers/protocol.ts';
import { areaUrl } from '../world/areaUrl.ts';
import { WorldClient } from '../world/worldClient.ts';
import { WorldView } from '../world/worldView.ts';
import { LocalPlayer } from './localPlayer.ts';
import { createGameScene } from './scene.ts';
import type { GameScene } from './scene.ts';

export interface GameStatus {
  phase: 'loading' | 'playing' | 'error';
  message: string;
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  stick: HTMLElement;
  statsBox: HTMLElement;
  look: AvatarLook;
  maxTrees: number;
  windows: boolean;
  antialias: boolean;
  maxPixelRatio: number;
}

const MAX_CHUNKS_IN_FLIGHT = 2;
const COLLIDER_RADIUS = 1; // colliders for the 3 × 3 chunks around the player
/** The playable square ends this far inside the area (the rest is the foggy margin). */
const EDGE_MARGIN_M = 100;

/** The game itself: loads a place, puts the player in it, and runs the frame loop. */
export class Game {
  private readonly view3d: GameScene;
  private readonly input: PlayerInput;
  private readonly rig: CameraRig;
  private readonly meter: StatsMeter;
  private readonly options: GameOptions;
  private readonly listeners = new Set<(status: GameStatus) => void>();
  private status: GameStatus = { phase: 'loading', message: 'Starting…' };
  private look: AvatarLook;
  private physics: PhysicsWorld | null = null;
  private world: WorldView | null = null;
  private ready: ReadyMessage | null = null;
  private player: LocalPlayer | null = null;
  private readonly chunks = new Map<string, ChunkData>();
  private collidersComplete = false;
  private colliderChunk = '';
  private last = performance.now();

  constructor(options: GameOptions) {
    this.options = options;
    this.look = options.look;
    this.view3d = createGameScene(options.canvas, options);
    this.input = new PlayerInput(options.canvas, options.stick);
    this.rig = new CameraRig(this.view3d.camera);
    this.meter = new StatsMeter(this.view3d.renderer, (stats) => {
      const player = this.player;
      const extra = player
        ? [
            `chunks ${this.chunks.size} · colliders ${this.physics?.colliderChunkCount ?? 0} · ${player.speed.toFixed(1)} m/s`,
            `x ${player.x.toFixed(0)} z ${player.z.toFixed(0)} y ${player.y.toFixed(1)}${player.body.grounded ? '' : ' (air)'}`,
          ]
        : [];
      options.statsBox.textContent = formatStats(stats, extra);
    });
    window.addEventListener('resize', () => this.view3d.resize());
    this.view3d.renderer.setAnimationLoop((now) => this.frame(now));
  }

  /** Calls `listener` now and every time the loading / playing / error state changes. */
  onStatus(listener: (status: GameStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  setLook(look: AvatarLook): void {
    this.look = look;
    this.player?.avatar.setLook(look);
  }

  /** Loads the place around (lat, lng) and drops the player at its nearest street corner. */
  async start(lat: number, lng: number, halfSize = 0): Promise<void> {
    this.setStatus('loading', 'Getting the map… a brand-new place can take up to a minute.');
    try {
      const client = new WorldClient();
      // The physics engine (a big WASM file) loads while the map downloads.
      const [physics, ready] = await Promise.all([
        PhysicsWorld.create(),
        client.load(areaUrl(lat, lng, halfSize), (stage) => {
          if (stage === 'build') this.setStatus('loading', 'Building the world…');
        }),
      ]);
      this.physics = physics;
      this.ready = ready;
      this.world = new WorldView(ready, {
        maxTrees: this.options.maxTrees,
        windows: this.options.windows,
        anisotropy: Math.min(4, this.view3d.renderer.capabilities.getMaxAnisotropy()),
      });
      this.view3d.scene.add(this.world.group);
      physics.setTerrain(ready.terrain.positions, ready.terrain.indices);
      this.setStatus('loading', 'Almost there…');
      await this.loadChunks(ready, client);
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  private setStatus(phase: GameStatus['phase'], message: string): void {
    this.status = { phase, message };
    for (const listener of this.listeners) listener(this.status);
  }

  private chunkOf(x: number, z: number): [number, number] {
    const info = (this.ready as ReadyMessage).info;
    const clamp = (value: number): number => Math.min(info.chunksPerSide - 1, Math.max(0, Math.floor((value + info.halfSize) / CHUNK_SIZE)));
    return [clamp(x), clamp(z)];
  }

  /** Asks for all chunks, the ones nearest to the spawn point first. */
  private async loadChunks(ready: ReadyMessage, client: WorldClient): Promise<void> {
    const n = ready.info.chunksPerSide;
    const [sx, sz] = this.chunkOf(ready.info.spawn[0], ready.info.spawn[1]);
    const queue: [number, number][] = [];
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) queue.push([cx, cz]);
    queue.sort((a, b) => Math.hypot(a[0] - sx, a[1] - sz) - Math.hypot(b[0] - sx, b[1] - sz));
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const message = await client.requestChunk(next[0], next[1]);
        this.chunks.set(`${message.chunk.cx},${message.chunk.cz}`, message.chunk);
        this.world?.addChunk(message.chunk);
        this.collidersComplete = false;
        if (!this.player) this.trySpawn();
      }
    };
    await Promise.all(Array.from({ length: MAX_CHUNKS_IN_FLIGHT }, worker));
  }

  /** The player appears once the ground and the 3 × 3 chunks around the spawn point are solid. */
  private trySpawn(): void {
    const { ready, physics, world } = this;
    if (!ready || !physics || !world) return;
    const [x, z] = ready.info.spawn;
    if (!this.syncColliders(x, z)) return;
    const limit = ready.info.halfSize - EDGE_MARGIN_M;
    this.player = new LocalPlayer(physics, this.look, x, heightAt(world.terrain, x, z) + 0.3, z, limit);
    this.view3d.scene.add(this.player.avatar.object);
    this.setStatus('playing', '');
  }

  private syncColliders(x: number, z: number): boolean {
    const { ready, physics } = this;
    if (!ready || !physics) return false;
    const [cx, cz] = this.chunkOf(x, z);
    this.colliderChunk = `${cx},${cz}`;
    this.collidersComplete = physics.syncChunks(cx, cz, COLLIDER_RADIUS, ready.info.chunksPerSide, (key) => this.chunks.get(key));
    return this.collidersComplete;
  }

  private frame(now: number): void {
    const dtMs = Math.min(100, Math.max(0, now - this.last));
    this.last = now;
    const dt = dtMs / 1000;
    const { player, physics, world } = this;
    if (player && physics && world) {
      const terrain = world.terrain;
      const groundAt = (x: number, z: number): number => heightAt(terrain, x, z);
      this.input.update();
      const drag = this.input.consumeLook();
      this.rig.look(drag.dx, drag.dy);
      player.update(dt, this.input.moveX, this.input.moveY, this.rig.yaw, groundAt);

      // Colliders follow the player: refresh when a chunk border is crossed or chunks are still arriving.
      const [cx, cz] = this.chunkOf(player.x, player.z);
      if (!this.collidersComplete || this.colliderChunk !== `${cx},${cz}`) this.syncColliders(player.x, player.z);

      const body = player.body.collider;
      this.rig.update(player.x, player.y, player.z, dt, (ox, oy, oz, dx, dy, dz, max) => physics.castRay(ox, oy, oz, dx, dy, dz, max, body), groundAt);
    }
    this.view3d.renderer.render(this.view3d.scene, this.view3d.camera);
    this.meter.frame(dtMs);
  }

  /** For the browser console while developing. */
  get debug(): Record<string, unknown> {
    return { player: this.player, rig: this.rig, physics: this.physics, input: this.input, scene: this.view3d.scene };
  }
}
