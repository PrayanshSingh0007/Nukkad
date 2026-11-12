import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
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
import { TrafficView } from '../world/trafficView.ts';
import { PedestrianView } from '../world/pedestrianView.ts';
import { WorldView } from '../world/worldView.ts';
import { LocalPlayer } from './localPlayer.ts';
import { VEHICLES } from './vehicleSpecs.ts';
import type { ParkedVehicle } from '../world/streetLifeView.ts';
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
  private traffic: TrafficView | null = null;
  private walkers: PedestrianView | null = null;
  private readonly reflections: THREE.Texture;
  /** High only: renders through a glow pass. */
  private composer: EffectComposer | null = null;
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
  /** Called when the room moves to another place: (place name, who moved it). */
  onTravel: ((place: string, by: string) => void) | null = null;
  /** Called with the label of the Drive button ("Drive auto", "Get out") or null to hide it. */
  onDriveHint: ((label: string | null) => void) | null = null;
  private driving: ParkedVehicle | null = null;
  private driveMesh: THREE.InstancedMesh | null = null;
  private driveHint: string | null = null;
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
    // Soft studio light for reflections on car paint and glass only. Built once, ~1 MB on the GPU.
    const pmrem = new THREE.PMREMGenerator(this.view3d.renderer);
    this.reflections = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
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
    window.addEventListener('resize', () => {
      this.view3d.resize();
      this.appliedPixelRatio = 0; // the glow pass resizes on the next frame
    });
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return;
      if (event.code === 'KeyR') this.toggleRide();
      if (event.code === 'KeyE' || event.code === 'KeyF') this.toggleDrive();
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

  /** Takes the whole room to a place found by search. */
  travel(lat: number, lng: number, place: string): void {
    this.net?.travel(lat, lng, place);
  }

  /** Gets on or off your scooter (everyone has their own). */
  toggleRide(): void {
    const player = this.player;
    if (!player || this.driving) return;
    player.setRiding(!player.riding);
    this.onRiding?.(player.riding);
  }

  /** Gets into the nearest parked vehicle, or out of the one you are driving. */
  toggleDrive(): void {
    const player = this.player;
    const streetLife = this.streetLife;
    if (!player || !streetLife) return;
    if (this.driving) {
      const left = player.exitVehicle();
      if (left) streetLife.park(this.driving, left.x, left.y, left.z, left.heading);
      this.driving = null;
      this.driveMesh?.removeFromParent();
      this.driveMesh = null;
      player.avatar.object.visible = true;
      this.onRiding?.(false);
      return;
    }
    if (player.riding) return; // on your own scooter: use Ride/Walk
    const parked = streetLife.nearestVehicle(player.x, player.z, 3.5);
    const spec = parked ? VEHICLES[parked.kind.name] : undefined;
    const model = parked ? streetLife.modelOf(parked) : null;
    if (!parked || !spec || !model) return;
    streetLife.take(parked);
    player.enterVehicle(spec, parked.item.x, parked.item.z, parked.item.rotation);
    this.driving = parked;
    const mesh = new THREE.InstancedMesh(model.geometry, model.material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    if (model.paint) mesh.setColorAt(0, model.paint);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.rotation.order = 'YXZ';
    this.driveMesh = mesh;
    this.view3d.scene.add(mesh);
    this.onRiding?.(true);
  }

  /** The on-screen Drift button (handbrake). */
  setHandbrake(on: boolean): void {
    this.input.touchHandbrake = on;
  }

  /** What the Drive button should say right now. */
  private updateDriveHint(): void {
    const player = this.player;
    let label: string | null = null;
    if (player && this.driving) label = 'Get out';
    else if (player && !player.riding && this.streetLife) {
      const parked = this.streetLife.nearestVehicle(player.x, player.z, 3.5);
      const spec = parked ? VEHICLES[parked.kind.name] : undefined;
      if (spec) label = `Drive ${spec.label}`;
    }
    if (label !== this.driveHint) {
      this.driveHint = label;
      this.onDriveHint?.(label);
    }
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
      onTravel: (_lat, _lng, place, by) => this.onTravel?.(place, by === remotes.selfSlot ? 'You' : remotes.nameOf(by) ?? 'A friend'),
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
        photoSurfaces: settings.photo,
        anisotropy: Math.min(4, this.view3d.renderer.capabilities.getMaxAnisotropy()),
      });
      this.view3d.scene.add(this.world.group);
      this.streetLife = new StreetLifeView(ready.props, this.reflections);
      const streetLife = this.streetLife;
      this.remotes.vehicleModels = (model) => streetLife.modelByName(model);
      this.traffic = new TrafficView(ready.traffic, this.world.terrain, (name) => streetLife.modelByName(name), (material) => material === streetLife.material);
      this.traffic.setRadius(settings.streetLifeRadius * 1.5);
      this.view3d.scene.add(this.traffic.group);
      this.walkers = new PedestrianView(ready.walkers, this.world.terrain);
      this.walkers.setRadius(settings.streetLifeRadius * 0.8);
      this.view3d.scene.add(this.walkers.group);
      this.streetLife.setRadius(settings.streetLifeRadius, settings.shadowSize > 0 ? settings.shadowRange + 10 : 0);
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
    this.traffic?.setRadius(quality.streetLifeRadius * 1.5);
    this.walkers?.setRadius(quality.streetLifeRadius * 0.8);
    this.streetLife?.setRadius(quality.streetLifeRadius, quality.shadowSize > 0 ? quality.shadowRange + 10 : 0);
    this.applyShadows(quality.shadowSize, quality.shadowRange);
    this.applyBloom(quality.bloom);
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

  /** The glow pass (High). Bright things over the threshold get a soft halo. */
  private applyBloom(on: boolean): void {
    if (!on) {
      this.composer?.dispose();
      this.composer = null;
      return;
    }
    if (this.composer) return;
    const { renderer, scene, camera } = this.view3d;
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.4, 1.25));
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.appliedPixelRatio = 0; // sizes are set on the next frame
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
      player.handbrake = this.input.handbrake;
      player.update(dt, this.input.moveX, this.input.moveY, this.rig.yaw, groundAt);
      if (this.driveMesh) {
        this.driveMesh.position.set(player.x, player.y, player.z);
        this.driveMesh.rotation.set(0, player.heading, player.lean);
      }
      this.updateDriveHint();
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
          flags: (player.body.grounded ? FLAG_GROUNDED : 0) | (player.vehicle ? FLAG_RIDING | (player.vehicle.code << 4) : 0),
        });
      }
      this.remotes.update(dt, now);

      // Colliders follow the player: refresh when a chunk border is crossed or new chunks arrived.
      const [cx, cz] = chunkAt(player.x, player.z, streamer.settings);
      if (!this.collidersComplete || this.colliderChunk !== `${cx},${cz}`) this.syncColliders(player.x, player.z);

      // On the scooter the camera swings in behind you (unless you just dragged the view),
      // and widens a little with speed — the "FOV kick" that makes speed feel fast.
      const camera = this.view3d.camera;
      const vehicle = player.vehicle;
      const speedShare = vehicle ? Math.min(1, Math.abs(player.rideSpeed) / vehicle.maxSpeed) : 0;
      if (player.riding && Math.abs(player.rideSpeed) > 1 && now - this.lastDragAt > 1500) {
        const behind = player.rideSpeed >= 0 ? player.heading : player.heading + Math.PI;
        this.rig.yaw += Math.atan2(Math.sin(behind - this.rig.yaw), Math.cos(behind - this.rig.yaw)) * Math.min(1, dt * 2.5);
      }
      this.rig.distance = (vehicle ? vehicle.cameraDistance : 5.2) + speedShare * 1.3;
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
    this.streetLife?.setNight(this.atmosphere.night);
    world?.update(dt);
    if (player) {
      this.placeSun(player.x, player.y, player.z);
      const solids = this.streetLife?.update(player.x, player.z);
      if (solids) this.physics?.setBoxes(solids);
      if (this.traffic) {
        // The room's shared clock (ms since the server started) keeps everyone's traffic in step.
        const clock = this.remotes.clock;
        const seconds = (clock.ready ? clock.renderTime(now) : Date.now()) / 1000;
        this.physics?.setMovers(this.traffic.update(dt, seconds, player.x, player.z));
        this.walkers?.update(dt, seconds, player.x, player.z);
      }
      world?.updateShadowTrees(player.x, player.z, QUALITY[this.level].shadowSize > 0 ? QUALITY[this.level].shadowRange : 0);
    }
    else if (ready) this.placeSun(ready.info.spawn[0], 0, ready.info.spawn[1]);

    const pixelRatio = Math.min(window.devicePixelRatio, QUALITY[this.level].maxPixelRatio) * this.governor.renderScale;
    if (Math.abs(pixelRatio - this.appliedPixelRatio) > 0.01) {
      this.view3d.renderer.setPixelRatio(pixelRatio);
      this.view3d.resize();
      this.composer?.setPixelRatio(pixelRatio);
      this.composer?.setSize(window.innerWidth, window.innerHeight);
      this.appliedPixelRatio = pixelRatio;
    }
    if (this.composer) this.composer.render(dt);
    else this.view3d.renderer.render(this.view3d.scene, this.view3d.camera);
    this.meter.frame(dtMs);
  }

  private debugLines(): string[] {
    const { player, streamer, ready, physics } = this;
    if (!player || !streamer || !ready) return [`loading… (${this.status.message})`];
    const counts = streamer.counts;
    const [cx, cz] = chunkAt(player.x, player.z, streamer.settings);
    return [
      `quality ${this.level}${this.benchmarking ? ' (testing)' : ''} · render scale ${this.governor.renderScale.toFixed(2)} · pixel ratio ${this.appliedPixelRatio.toFixed(2)}`,
      `traffic ${this.traffic?.count ?? 0} routes · `+`street life shown ${this.streetLife?.shown ?? 0} · solid ${physics?.boxCount ?? 0}`,
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
