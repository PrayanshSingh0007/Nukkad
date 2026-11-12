import * as THREE from 'three';
import { CHUNK_SIZE, FLAG_GROUNDED, FLAG_RIDING, TICK_HZ } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { heightAt } from '@nukkad/worldgen';
import { Atmosphere } from '../atmosphere/atmosphere.ts';
import { DebugOverlay } from '../debug/overlay.ts';
import { buildReport } from '../debug/report.ts';
import { StatsMeter, formatStats } from '../debug/statsHud.ts';
import { NetClient } from '../net/netClient.ts';
import type { NetStatus } from '../net/netClient.ts';
import { RemotePlayers } from '../net/remotePlayers.ts';
import { Avatar } from '../player/avatar/avatar.ts';
import { PhysicsWorld } from '../physics/physicsWorld.ts';
import { CameraRig } from '../player/cameraRig.ts';
import { PlayerInput } from '../player/input.ts';
import type { ReadyMessage } from '../workers/protocol.ts';
import { areaUrl } from '../world/areaUrl.ts';
import { Streamer } from '../world/streamer.ts';
import { chunkAt } from '../world/streamPlan.ts';
import type { StreamSettings } from '../world/streamPlan.ts';
import { WorldClient } from '../world/worldClient.ts';
import { StreetLifeView } from '../world/streetLifeView.ts';
import { WorldView } from '../world/worldView.ts';
import { LocalPlayer, RIDE_MAX } from './localPlayer.ts';
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
  private streetLife: StreetLifeView | null = null;
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
  private readonly atmosphere: Atmosphere;
  private net: NetClient | null = null;
  private netStatus: NetStatus = 'closed';
  private sendClock = 0;
  /** Called with the number of people in the room (you included). */
  onPlayerCount: ((count: number) => void) | null = null;
  /** Called when you get on or off the scooter. */
  onRiding: ((riding: boolean) => void) | null = null;
  private lastDragAt = 0;
  private static readonly BASE_FOV = 62;

  constructor(options: GameOptions) {
    this.look = options.look;
    this.level = options.quality;
    this.benchmarking = options.qualitySource === 'guess';
    this.view3d = createGameScene(options.canvas, { antialias: QUALITY[this.level].antialias });
    this.input = new PlayerInput(options.canvas, options.stick);
    this.rig = new CameraRig(this.view3d.camera);
    this.remotes = new RemotePlayers(this.view3d.scene);
    this.atmosphere = new Atmosphere(this.view3d.scene, this.view3d.sun, this.view3d.ambient);
    this.view3d.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.view3d.scene.add(this.view3d.sun.target);
    this.overlay = new DebugOverlay(
      options.overlay,
      options.logo,
      (level) => {
        this.benchmarking = false;
        saveQuality(level);
        this.setQuality(level);
      },
      (hour) => (this.atmosphere.override = hour),
    );
    this.meter = new StatsMeter(this.view3d.renderer, (stats) => {
      const lines = formatStats(stats, this.debugLines());
      this.overlay.update(lines, buildReport(this.view3d.renderer, lines), this.level);
    });
    window.addEventListener('resize', () => this.view3d.resize());
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (event.code === 'KeyR' && target?.tagName !== 'INPUT') this.toggleRide();
    });
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

  /** Gets on or off your scooter (everyone has their own). */
  toggleRide(): void {
    const player = this.player;
    if (!player) return;
    player.setRiding(!player.riding);
    this.onRiding?.(player.riding);
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
      this.streetLife = new StreetLifeView(ready.props);
      this.streetLife.setRadius(settings.streetLifeRadius);
      this.view3d.scene.add(this.streetLife.group);
      this.atmosphere.setPlace(ready.info.lat, ready.info.lng, ready.info.timeZone);
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
    this.streetLife?.setRadius(quality.streetLifeRadius);
    this.applyShadows(quality.shadowSize, quality.shadowRange);
    if (this.streamer) this.streamer.settings = this.streamSettings();
    this.appliedPixelRatio = 0; // re-applied on the next frame
  }

  /** Sun shadows: one shadow picture that follows you. Off on Low (blob shadows instead). */
  private applyShadows(size: number, range: number): void {
    const renderer = this.view3d.renderer;
    const sun = this.view3d.sun;
    const on = size > 0;
    const changed = renderer.shadowMap.enabled !== on || sun.shadow.mapSize.x !== size;
    renderer.shadowMap.enabled = on;
    sun.castShadow = on;
    Avatar.realShadows = on;
    if (!on || !changed) return;
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.mapSize.set(size, size);
    const camera = sun.shadow.camera;
    camera.left = -range;
    camera.right = range;
    camera.top = range;
    camera.bottom = -range;
    camera.near = 1;
    camera.far = 400;
    camera.updateProjectionMatrix();
    camera.layers.set(0);
    camera.layers.enable(1); // layer 1 = the shadow-only copies of nearby trees
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    // Materials must be rebuilt once to start (or stop) reading shadows.
    this.view3d.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
    });
  }

  /** Keeps the shadow area centred on you, snapped to whole shadow pixels so edges don't crawl. */
  private placeSun(x: number, y: number, z: number): void {
    const sun = this.view3d.sun;
    const quality = QUALITY[this.level];
    const dir = this.atmosphere.lightDir;
    if (quality.shadowSize > 0) {
      const texel = (2 * quality.shadowRange) / quality.shadowSize;
      x = Math.round(x / texel) * texel;
      y = Math.round(y / texel) * texel;
      z = Math.round(z / texel) * texel;
    }
    sun.target.position.set(x, y, z);
    sun.position.set(x + dir.x * 150, y + dir.y * 150, z + dir.z * 150);
    sun.target.updateMatrixWorld();
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
      if (drag.dx !== 0 || drag.dy !== 0) this.lastDragAt = now;
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
          flags: (player.body.grounded ? FLAG_GROUNDED : 0) | (player.riding ? FLAG_RIDING : 0),
        });
      }
      this.remotes.update(dt, now);

      // Colliders follow the player: refresh when a chunk border is crossed or new chunks arrived.
      const [cx, cz] = chunkAt(player.x, player.z, streamer.settings);
      if (!this.collidersComplete || this.colliderChunk !== `${cx},${cz}`) this.syncColliders(player.x, player.z);

      // On the scooter the camera swings in behind you (unless you just dragged the view),
      // and widens a little with speed — the "FOV kick" that makes speed feel fast.
      const camera = this.view3d.camera;
      const speedShare = player.riding ? Math.min(1, Math.abs(player.rideSpeed) / RIDE_MAX) : 0;
      if (player.riding && Math.abs(player.rideSpeed) > 1 && now - this.lastDragAt > 1500) {
        const behind = player.rideSpeed >= 0 ? player.heading : player.heading + Math.PI;
        this.rig.yaw += Math.atan2(Math.sin(behind - this.rig.yaw), Math.cos(behind - this.rig.yaw)) * Math.min(1, dt * 2.5);
      }
      this.rig.distance = 5.2 + speedShare * 1.3;
      const fov = Game.BASE_FOV + speedShare * 14;
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
        camera.updateProjectionMatrix();
      }

      const body = player.body.collider;
      this.rig.update(player.x, player.y, player.z, dt, (ox, oy, oz, dx, dy, dz, max) => physics.castRay(ox, oy, oz, dx, dy, dz, max, body), groundAt);

      if (this.governor.frame(dtMs, this.benchmarking) === 'down') {
        const index = QUALITY_LEVELS.indexOf(this.level);
        if (index > 0) this.setQuality(QUALITY_LEVELS[index - 1]);
        else this.benchmarking = false;
      }
    }

    this.atmosphere.update(dt, this.view3d.camera);
    world?.setNight(this.atmosphere.night);
    world?.update(dt);
    if (player) {
      this.placeSun(player.x, player.y, player.z);
      const solids = this.streetLife?.update(player.x, player.z);
      if (solids) this.physics?.setBoxes(solids);
      world?.updateShadowTrees(player.x, player.z, QUALITY[this.level].shadowSize > 0 ? QUALITY[this.level].shadowRange : 0);
    }
    else if (ready) this.placeSun(ready.info.spawn[0], 0, ready.info.spawn[1]);

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
      `street life shown ${this.streetLife?.shown ?? 0} · solid ${physics?.boxCount ?? 0}`,
      `chunks near ${counts.near} · far ${counts.far} · building ${counts.building} · colliders ${physics?.colliderChunkCount ?? 0}`,
      `chunk ${cx},${cz} · x ${player.x.toFixed(0)} z ${player.z.toFixed(0)} y ${player.y.toFixed(1)} · ${player.speed.toFixed(1)} m/s`,
      `local time ${this.atmosphere.clock}${this.atmosphere.override === null ? '' : ' (slider)'} · night ${this.atmosphere.night.toFixed(2)}`,
      `net ${this.netStatus} · ping ${Math.round(this.net?.rtt ?? 0)} ms · others ${this.remotes.count} · draw delay ${Math.round(this.remotes.clock.delay)} ms`,
      `${ready.info.id} · pack ${Math.round((ready.info.downloadBytes || ready.info.packBytes) / 1024)} KB · ready in ${(this.timeToPlayMs / 1000).toFixed(1)} s`,
    ];
  }

  /** For the browser console while developing. */
  get debug(): Record<string, unknown> {
    return { player: this.player, rig: this.rig, physics: this.physics, input: this.input, streamer: this.streamer, governor: this.governor, scene: this.view3d.scene };
  }
}
