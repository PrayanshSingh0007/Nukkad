import * as THREE from 'three';
import { CHUNK_SIZE, FLAG_GROUNDED, TICK_HZ } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { heightAt } from '@nukkad/worldgen';
import { DebugOverlay } from '../debug/overlay.ts';
import { buildReport } from '../debug/report.ts';
import { StatsMeter, formatStats } from '../debug/statsHud.ts';
import { NetClient } from '../net/netClient.ts';
import type { NetStatus } from '../net/netClient.ts';
import { RemotePlayers } from '../net/remotePlayers.ts';
import { PhysicsWorld } from '../physics/physicsWorld.ts';
import { CameraRig } from '../player/cameraRig.ts';
import { PlayerInput } from '../player/input.ts';
import type { ReadyMessage } from '../workers/protocol.ts';
import { areaUrl } from '../world/areaUrl.ts';
import { Streamer } from '../world/streamer.ts';
import { chunkAt } from '../world/streamPlan.ts';
import type { StreamSettings } from '../world/streamPlan.ts';
import { WorldClient } from '../world/worldClient.ts';
import { WorldView } from '../world/worldView.ts';
import { LocalPlayer } from './localPlayer.ts';
import { FrameGovernor, QUALITY, QUALITY_LEVELS, saveQuality } from './quality.ts';
import type { QualityLevel, QualitySource } from './quality.ts';
import { createGameScene } from './scene.ts';
import type { GameScene } from './scene.ts';

export interface GameStatus {
  phase: 'loading' | 'playing' | 'error';
  message: string;
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  stick: HTMLElement;
  overlay: HTMLElement;
  logo: HTMLElement;
  look: AvatarLook;
  quality: QualityLevel;
  qualitySource: QualitySource;
}

const COLLIDER_RADIUS = 1; // colliders for the 3 × 3 chunks around the player
const EDGE_MARGIN_M = 100; // the playable square ends this far inside the area
const HYSTERESIS_M = 30;

/** The game itself: loads a place, streams it around the player, and runs the frame loop. */
export class Game {
  private readonly view3d: GameScene;
  private readonly input: PlayerInput;
  private readonly rig: CameraRig;
  private readonly meter: StatsMeter;
  private readonly overlay: DebugOverlay;
  private readonly governor = new FrameGovernor();
  private readonly listeners = new Set<(status: GameStatus) => void>();
  private status: GameStatus = { phase: 'loading', message: 'Starting…' };
  private look: AvatarLook;
  private level: QualityLevel;
  private benchmarking: boolean;
  private physics: PhysicsWorld | null = null;
  private world: WorldView | null = null;
  private ready: ReadyMessage | null = null;
  private streamer: Streamer | null = null;
  private player: LocalPlayer | null = null;
  private collidersComplete = false;
  private colliderChunk = '';
  private last = performance.now();
  private loadStarted = performance.now();
  private timeToPlayMs = 0;
  private appliedPixelRatio = 0;
  private readonly remotes: RemotePlayers;
  private net: NetClient | null = null;
  private netStatus: NetStatus = 'closed';
  private sendClock = 0;
  /** Called with the number of people in the room (you included). */
  onPlayerCount: ((count: number) => void) | null = null;

  constructor(options: GameOptions) {
    this.look = options.look;
    this.level = options.quality;
    this.benchmarking = options.qualitySource === 'guess';
    this.view3d = createGameScene(options.canvas, { antialias: QUALITY[this.level].antialias });
    this.input = new PlayerInput(options.canvas, options.stick);
    this.rig = new CameraRig(this.view3d.camera);
    this.remotes = new RemotePlayers(this.view3d.scene);
    this.overlay = new DebugOverlay(options.overlay, options.logo, (level) => {
      this.benchmarking = false;
      saveQuality(level);
      this.setQuality(level);
    });
    this.meter = new StatsMeter(this.view3d.renderer, (stats) => {
      const lines = formatStats(stats, this.debugLines());
      this.overlay.update(lines, buildReport(this.view3d.renderer, lines), this.level);
    });
    window.addEventListener('resize', () => this.view3d.resize());
    this.applyQuality();
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
    this.net?.setLook(look);
  }

  /** Connects to a room. Other players appear as their snapshots arrive. */
  join(roomId: string, name: string): void {
    const remotes = this.remotes;
    const count = (): void => this.onPlayerCount?.(remotes.count + 1);
    this.net = new NetClient({
      onWelcome: (slot, _room, players) => {
        remotes.reset(slot, players);
        count();
      },
      onJoined: (player) => {
        remotes.add(player);
        count();
      },
      onLeft: (slot) => {
        remotes.remove(slot);
        count();
      },
      onLook: (slot, look) => remotes.setLook(slot, look),
      onSnapshot: (snapshot, local) => remotes.onSnapshot(snapshot, local),
      onStatus: (status) => (this.netStatus = status),
      onError: (code, message) => {
        if (code === 'room_full' || code === 'room_not_found' || code === 'bad_name') this.setStatus('error', message);
      },
    });
    this.net.connect(roomId, name, this.look);
    window.addEventListener('pagehide', () => this.net?.leave());
  }

  setQuality(level: QualityLevel): void {
    this.level = level;
    this.applyQuality();
  }

  /** Loads the place around (lat, lng) and drops the player at its nearest street corner. */
  async start(lat: number, lng: number, halfSize = 0): Promise<void> {
    this.loadStarted = performance.now();
    this.setStatus('loading', 'Getting the map… a brand-new place can take up to a minute.');
    try {
      const client = new WorldClient();
      // The physics engine (a big WASM file) downloads while the map downloads.
      const [physics, ready] = await Promise.all([
        PhysicsWorld.create(),
        client.load(areaUrl(lat, lng, halfSize), (stage) => {
          if (stage === 'build') this.setStatus('loading', 'Building the world…');
        }),
      ]);
      this.physics = physics;
      this.ready = ready;
      const settings = QUALITY[this.level];
      this.world = new WorldView(ready, {
        maxTrees: settings.maxTrees,
        windows: true,
        anisotropy: Math.min(4, this.view3d.renderer.capabilities.getMaxAnisotropy()),
      });
      this.view3d.scene.add(this.world.group);
      physics.setTerrain(ready.terrain.positions, ready.terrain.indices);
      this.streamer = new Streamer(client, this.world, this.streamSettings());
      this.streamer.onChunk = () => {
        this.collidersComplete = false;
      };
      this.setStatus('loading', 'Almost there…');
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  private streamSettings(): StreamSettings {
    const info = (this.ready as ReadyMessage).info;
    const quality = QUALITY[this.level];
    return {
      half: info.halfSize,
      chunksPerSide: info.chunksPerSide,
      chunkSize: CHUNK_SIZE,
      nearRing: quality.nearRing,
      viewDistance: quality.viewDistance,
      hysteresis: HYSTERESIS_M,
    };
  }

  /** Applies view distance, fog, sharpness and tree count of the current level. */
  private applyQuality(): void {
    const quality = QUALITY[this.level];
    const fog = this.view3d.scene.fog as THREE.Fog;
    fog.far = quality.viewDistance;
    fog.near = quality.viewDistance * 0.45;
    this.view3d.camera.far = quality.viewDistance + 80;
    this.view3d.camera.updateProjectionMatrix();
    this.world?.setTreeLimit(quality.maxTrees);
    if (this.streamer) this.streamer.settings = this.streamSettings();
    this.appliedPixelRatio = 0; // re-applied on the next frame
  }

  private setStatus(phase: GameStatus['phase'], message: string): void {
    this.status = { phase, message };
    for (const listener of this.listeners) listener(this.status);
  }

  /** The player appears once the 3 × 3 chunks around the spawn point are solid. */
  private trySpawn(): void {
    const { ready, physics, world } = this;
    if (!ready || !physics || !world) return;
    const [x, z] = ready.info.spawn;
    if (!this.syncColliders(x, z)) return;
    const limit = ready.info.halfSize - EDGE_MARGIN_M;
    this.player = new LocalPlayer(physics, this.look, x, heightAt(world.terrain, x, z) + 0.3, z, limit);
    this.view3d.scene.add(this.player.avatar.object);
    this.timeToPlayMs = performance.now() - this.loadStarted;
    this.setStatus('playing', '');
  }

  private syncColliders(x: number, z: number): boolean {
    const { physics, streamer } = this;
    if (!physics || !streamer) return false;
    const [cx, cz] = chunkAt(x, z, streamer.settings);
    this.colliderChunk = `${cx},${cz}`;
    this.collidersComplete = physics.syncChunks(cx, cz, COLLIDER_RADIUS, streamer.settings.chunksPerSide, (key) => streamer.nearData.get(key));
    return this.collidersComplete;
  }

  private frame(now: number): void {
    const dtMs = Math.min(100, Math.max(0, now - this.last));
    this.last = now;
    const dt = dtMs / 1000;
    const { player, physics, world, streamer, ready } = this;
    const forwardX = -Math.sin(this.rig.yaw);
    const forwardZ = -Math.cos(this.rig.yaw);

    if (streamer && ready && !player) {
      streamer.update(ready.info.spawn[0], ready.info.spawn[1], forwardX, forwardZ);
      this.trySpawn();
    }
    if (player && physics && world && streamer) {
      const terrain = world.terrain;
      const groundAt = (x: number, z: number): number => heightAt(terrain, x, z);
      this.input.update();
      const drag = this.input.consumeLook();
      this.rig.look(drag.dx, drag.dy);
      player.update(dt, this.input.moveX, this.input.moveY, this.rig.yaw, groundAt);
      streamer.update(player.x, player.z, forwardX, forwardZ);
      this.sendClock += dt;
      if (this.net && this.sendClock >= 1 / TICK_HZ) {
        this.sendClock %= 1 / TICK_HZ;
        this.net.sendState({
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.avatar.facing,
          speed: player.speed,
          flags: player.body.grounded ? FLAG_GROUNDED : 0,
        });
      }
      this.remotes.update(dt, now);

      // Colliders follow the player: refresh when a chunk border is crossed or new chunks arrived.
      const [cx, cz] = chunkAt(player.x, player.z, streamer.settings);
      if (!this.collidersComplete || this.colliderChunk !== `${cx},${cz}`) this.syncColliders(player.x, player.z);

      const body = player.body.collider;
      this.rig.update(player.x, player.y, player.z, dt, (ox, oy, oz, dx, dy, dz, max) => physics.castRay(ox, oy, oz, dx, dy, dz, max, body), groundAt);

      if (this.governor.frame(dtMs, this.benchmarking) === 'down') {
        const index = QUALITY_LEVELS.indexOf(this.level);
        if (index > 0) this.setQuality(QUALITY_LEVELS[index - 1]);
        else this.benchmarking = false;
      }
    }

    const pixelRatio = Math.min(window.devicePixelRatio, QUALITY[this.level].maxPixelRatio) * this.governor.renderScale;
    if (Math.abs(pixelRatio - this.appliedPixelRatio) > 0.01) {
      this.view3d.renderer.setPixelRatio(pixelRatio);
      this.view3d.resize();
      this.appliedPixelRatio = pixelRatio;
    }
    this.view3d.renderer.render(this.view3d.scene, this.view3d.camera);
    this.meter.frame(dtMs);
  }

  private debugLines(): string[] {
    const { player, streamer, ready, physics } = this;
    if (!player || !streamer || !ready) return [`loading… (${this.status.message})`];
    const counts = streamer.counts;
    const [cx, cz] = chunkAt(player.x, player.z, streamer.settings);
    return [
      `quality ${this.level}${this.benchmarking ? ' (testing)' : ''} · render scale ${this.governor.renderScale.toFixed(2)} · pixel ratio ${this.appliedPixelRatio.toFixed(2)}`,
      `chunks near ${counts.near} · far ${counts.far} · building ${counts.building} · colliders ${physics?.colliderChunkCount ?? 0}`,
      `chunk ${cx},${cz} · x ${player.x.toFixed(0)} z ${player.z.toFixed(0)} y ${player.y.toFixed(1)} · ${player.speed.toFixed(1)} m/s`,
      `net ${this.netStatus} · ping ${Math.round(this.net?.rtt ?? 0)} ms · others ${this.remotes.count} · draw delay ${Math.round(this.remotes.clock.delay)} ms`,
      `${ready.info.id} · pack ${Math.round((ready.info.downloadBytes || ready.info.packBytes) / 1024)} KB · ready in ${(this.timeToPlayMs / 1000).toFixed(1)} s`,
    ];
  }

  /** For the browser console while developing. */
  get debug(): Record<string, unknown> {
    return { player: this.player, rig: this.rig, physics: this.physics, input: this.input, streamer: this.streamer, governor: this.governor, scene: this.view3d.scene };
  }
}
