import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CHUNK_SIZE, EMOTES, FLAG_GROUNDED, FLAG_RIDING, PLACE_COLORS, TICK_HZ } from '@nukkad/shared';
import type { Emote } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { BENCH_STRIDE, heightAt } from '@nukkad/worldgen';
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
import { INTERIOR_NAMES, buildInterior, carSpots } from '../world/interiors.ts';
import type { Interior } from '../world/interiors.ts';
import type { Door } from '@nukkad/worldgen';
import { LocalPlayer } from './localPlayer.ts';
import { VEHICLES } from './vehicleSpecs.ts';
import type { ParkedVehicle } from '../world/streetLifeView.ts';
import { FrameGovernor, QUALITY, QUALITY_LEVELS, saveQuality } from './quality.ts';
import type { QualityLevel, QualitySource } from './quality.ts';
import { createGameScene } from './scene.ts';
import { Sound } from '../audio/sound.ts';
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

/**
 * The finishing pass on High, like a film grade: a touch more contrast and colour, warm
 * highlights and cool shadows, and slightly darker corners (vignette). Works on the HDR
 * picture before tone mapping.
 */
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, 1.12);                                   // colour
      c = mix(c, c * c * (3.0 - 2.0 * min(c, vec3(1.0))), 0.12);       // gentle contrast below white
      c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.05, 0.8, luma)); // cool shadows, warm lights
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * 0.38;                                     // vignette
      gl_FragColor = vec4(max(c, vec3(0.0)), texel.a);
    }`,
};

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
  /** Called about 10 times a second while riding/driving: (speed m/s, top speed, vehicle name), or null on foot. */
  onSpeed: ((speed: number, max: number, label: string) => void) | null = null;
  private speedClock = 0;
  private lastSpeedShown = false;
  /** Called with the label of the Drive button ("Drive auto", "Get out") or null to hide it. */
  onDriveHint: ((label: string | null) => void) | null = null;
  private driving: ParkedVehicle | null = null;
  /** Front doors by 10 m grid cell, the door you are standing at, and the building you are inside. */
  private readonly sound = new Sound();
  private doorGrid = new Map<string, Door[]>();
  private doorNear: Door | null = null;
  private interior: Interior | null = null;
  /** Called with a short message for the player ("Inside: Mango Hypermarket"). */
  onToast: ((text: string) => void) | null = null;
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
    this.view3d.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      this.sound.unlock();
      if (event.code === 'KeyH' && !event.repeat) this.setHorn(true);
      if (event.code === 'KeyE' || event.code === 'KeyF') this.toggleDrive();
      const emote = ({ Digit1: 'wave', Digit2: 'dance', Digit3: 'sit', Digit4: 'talk' } as Record<string, Emote>)[event.code];
      if (emote) this.doEmote(emote);
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'KeyH') this.setHorn(false);
    });
    window.addEventListener('pointerdown', () => this.sound.unlock());
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
    player.seat = null;
    player.emote = 0;
    player.setRiding(!player.riding);
    this.onRiding?.(player.riding);
  }

  /** The front door you are standing at (on foot), if any. */
  private findDoor(x: number, z: number): Door | null {
    let best: Door | null = null;
    let bestD = 2.2;
    const gx = Math.floor(x / 10);
    const gz = Math.floor(z / 10);
    for (let i = -1; i <= 1; i++)
      for (let k = -1; k <= 1; k++)
        for (const door of this.doorGrid.get(`${gx + i},${gz + k}`) ?? []) {
          const d = Math.hypot(door.x - x, door.z - z);
          if (d < bestD) {
            bestD = d;
            best = door;
          }
        }
    return best;
  }

  /** Walks you through a front door into the building's inside. */
  private goInside(door: Door): void {
    const player = this.player;
    const physics = this.physics;
    if (!player || !physics) return;
    player.seat = null;
    player.emote = 0;
    const inside = buildInterior(door);
    this.interior = inside;
    this.view3d.scene.add(inside.group);
    physics.setInterior(inside.solids);
    player.body.teleport(inside.spawn.x, inside.floorY + 0.9, inside.spawn.z);
    player.resetMotion();
    this.rig.yaw = door.face; // look into the room
    this.setOutsideVisible(false);
    if (door.kind === 'showroom') this.addShowroomCars(inside);
    this.onToast?.(door.name ? `Inside: ${door.name}` : `Inside: ${INTERIOR_NAMES[door.kind]}`);
  }

  /** Back out through the door you came in. */
  private goOutside(): void {
    const player = this.player;
    const inside = this.interior;
    if (!player || !inside || !this.physics) return;
    const door = inside.door;
    const out = 1.6;
    player.body.teleport(door.x + Math.sin(door.face) * out, door.y + 0.9, door.z + Math.cos(door.face) * out);
    player.resetMotion();
    this.rig.yaw = door.face + Math.PI; // look back out at the street
    this.physics.setInterior([]);
    inside.dispose();
    this.interior = null;
    this.setOutsideVisible(true);
  }

  /** While inside, the city is not drawn at all (cheaper, and nothing leaks through the walls). */
  private setOutsideVisible(on: boolean): void {
    for (const group of [this.world?.group, this.traffic?.group, this.walkers?.group, this.streetLife?.group]) if (group) group.visible = on;
  }

  private addShowroomCars(inside: Interior): void {
    const names = ['sedan-sports', 'suv-luxury', 'hatchback-sports'];
    carSpots(inside).forEach((spot, i) => {
      const model = this.streetLife?.modelByName(names[i % names.length]);
      if (!model) return;
      const mesh = new THREE.Mesh(model.geometry, model.material);
      mesh.position.set(spot.x, inside.floorY + 0.12, spot.z);
      mesh.rotation.y = spot.heading;
      inside.group.attach(mesh);
    });
  }

  private emoteTimer: ReturnType<typeof setTimeout> | null = null;

  /** Wave, dance, talk (anywhere on foot) or sit (on a bench, chair or sofa). Friends see it too. */
  doEmote(emote: Emote): void {
    const player = this.player;
    if (!player || player.vehicle || this.driving) return;
    if (this.emoteTimer) clearTimeout(this.emoteTimer);
    if (emote === 'sit') {
      const seat = this.findSeat(player.x, player.z);
      if (!seat) {
        this.onToast?.('Walk up to a bench, chair or sofa to sit');
        return;
      }
      player.seat = seat;
      player.emote = EMOTES.indexOf('sit');
      return;
    }
    player.seat = null;
    player.emote = EMOTES.indexOf(emote);
    if (emote === 'wave') this.emoteTimer = setTimeout(() => {
      if (player.emote === EMOTES.indexOf('wave')) player.emote = 0;
    }, 2600);
  }

  /** The nearest free seat within reach: indoors the room's seats, outdoors the street benches. */
  private findSeat(x: number, z: number): { x: number; y: number; z: number; facing: number } | null {
    let best: { x: number; y: number; z: number; facing: number } | null = null;
    let bestD = 1.8;
    const consider = (seat: { x: number; y: number; z: number; facing: number }): void => {
      const d = Math.hypot(seat.x - x, seat.z - z);
      if (d < bestD) {
        bestD = d;
        best = seat;
      }
    };
    if (this.interior) for (const seat of this.interior.seats) consider(seat);
    else if (this.ready) {
      const benches = this.ready.props.benches;
      for (let i = 0; i + BENCH_STRIDE - 1 < benches.length; i += BENCH_STRIDE) {
        if (Math.abs(benches[i] - x) > 3 || Math.abs(benches[i + 2] - z) > 3) continue;
        const rotation = benches[i + 3];
        // The bench's front is its local +z; you sit a little forward of its middle.
        consider({ x: benches[i] + Math.sin(rotation) * 0.05, y: benches[i + 1], z: benches[i + 2] + Math.cos(rotation) * 0.05, facing: rotation + Math.PI });
      }
    }
    return best;
  }

  private mapPicture: HTMLCanvasElement | null = null;

  /** Everything the on-screen map needs, or null before the world is ready. */
  mapView(): {
    picture: HTMLCanvasElement;
    half: number;
    x: number;
    z: number;
    yaw: number;
    facing: number;
    driving: boolean;
    inside: boolean;
    friends: { x: number; z: number; name: string }[];
    places: { x: number; z: number; color: string; name: string }[];
    streets: { name: string; x: number; z: number; angle: number; major: boolean }[];
  } | null {
    const ready = this.ready;
    const player = this.player;
    if (!ready || !player) return null;
    if (!this.mapPicture) {
      const { size, pixels } = ready.miniMap;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext('2d') as CanvasRenderingContext2D;
      const image = c.createImageData(size, size);
      image.data.set(pixels);
      c.putImageData(image, 0, 0);
      this.mapPicture = canvas;
    }
    const inside = this.interior;
    return {
      picture: this.mapPicture,
      half: ready.info.halfSize,
      x: inside ? inside.door.x : player.x,
      z: inside ? inside.door.z : player.z,
      yaw: this.rig.yaw,
      facing: player.vehicle ? player.heading : player.avatar.facing,
      driving: player.vehicle !== null,
      inside: inside !== null,
      friends: this.remotes.positions(),
      places: ready.places.filter((p) => p.real === 1 && p.name).map((p) => ({ x: p.x / 10, z: p.z / 10, color: PLACE_COLORS[p.kind], name: p.name as string })),
      streets: ready.miniMap.streets,
    };
  }

  /** The action button / E key: get in or out of a vehicle, go into or out of a building. */
  toggleDrive(): void {
    const player = this.player;
    const streetLife = this.streetLife;
    if (!player || !streetLife) return;
    if (this.interior) {
      if (this.interior.nearExit(player.x, player.z)) {
        player.seat = null;
        this.goOutside();
      }
      return;
    }
    if (!this.driving && !player.riding && this.doorNear) {
      // A parked car right next to you wins only if it is closer than the door.
      const parked = streetLife.nearestVehicle(player.x, player.z, 3.5);
      const carD = parked ? Math.hypot(parked.item.x - player.x, parked.item.z - player.z) : Infinity;
      if (carD > Math.hypot(this.doorNear.x - player.x, this.doorNear.z - player.z)) {
        this.goInside(this.doorNear);
        return;
      }
    }
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
    player.seat = null;
    player.emote = 0;
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

  /** The horn (H key or the Horn button), on anything you ride or drive. Only you hear it for now. */
  setHorn(on: boolean): void {
    const vehicle = this.player?.vehicle;
    this.sound.unlock();
    if (!on || !vehicle) {
      this.sound.horn(false);
      return;
    }
    this.sound.horn(true, [7, 10, 11, 12].includes(vehicle.code) ? 'heavy' : vehicle.leans || vehicle.code === 5 ? 'scooter' : 'car');
  }

  /** The on-screen Drift button (handbrake). */
  setHandbrake(on: boolean): void {
    this.input.touchHandbrake = on;
  }

  /** What the Drive button should say right now. */
  private updateDriveHint(): void {
    const player = this.player;
    let label: string | null = null;
    this.doorNear = null;
    if (player && this.interior) {
      if (this.interior.nearExit(player.x, player.z)) label = 'Go outside';
    } else if (player && this.driving) label = 'Get out';
    else if (player && !player.riding && this.streetLife) {
      const parked = this.streetLife.nearestVehicle(player.x, player.z, 3.5);
      const spec = parked ? VEHICLES[parked.kind.name] : undefined;
      const door = this.findDoor(player.x, player.z);
      this.doorNear = door;
      const carD = parked ? Math.hypot(parked.item.x - player.x, parked.item.z - player.z) : Infinity;
      if (door && (!spec || carD > Math.hypot(door.x - player.x, door.z - player.z))) label = 'Go inside';
      else if (spec) label = `Drive ${spec.label}`;
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
      for (const door of ready.doors) {
        const key = `${Math.floor(door.x / 10)},${Math.floor(door.z / 10)}`;
        const list = this.doorGrid.get(key) ?? [];
        list.push(door);
        this.doorGrid.set(key, list);
      }
      this.remotes.canSee = (x, y, z) => {
        const me = this.interior;
        if (me) return me.contains(x, y, z);
        return y > heightAt((this.world as WorldView).terrain, x, z) - 10;
      };
      const settings = QUALITY[this.level];
      this.world = new WorldView(ready, {
        maxTrees: settings.maxTrees,
        windows: true,
        leafyTrees: this.level === 'high' ? 2 : this.level === 'medium' ? 1 : 0,
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
      this.walkers.setNearLimit(settings.nearPeople);
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
    this.walkers?.setNearLimit(quality.nearPeople);
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
    composer.addPass(new ShaderPass(GRADE_SHADER));
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
      const inside = this.interior;
      const groundAt = (x: number, z: number): number => (inside ? inside.floorY : heightAt(terrain, x, z));
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
      const riding = player.vehicle;
      this.sound.engine(riding ? Math.abs(player.rideSpeed) / riding.maxSpeed : 0, !riding ? 'none' : riding.code === 1 ? 'electric' : 'engine');
      this.speedClock += dt;
      if (this.speedClock > 0.1) {
        this.speedClock = 0;
        const v = player.vehicle;
        if (v) this.onSpeed?.(player.rideSpeed, v.maxSpeed, v.label);
        else if (this.lastSpeedShown) this.onSpeed?.(0, 0, '');
        this.lastSpeedShown = v !== null;
      }
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
          flags: (player.body.grounded || player.seat ? FLAG_GROUNDED : 0) | (player.vehicle ? FLAG_RIDING | (player.vehicle.code << 4) : (player.emote & 15) << 4),
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
      this.rig.distance = (vehicle ? vehicle.cameraDistance : inside ? 3.4 : 5.2) + speedShare * 1.3;
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
    if (this.interior) {
      // Indoors: lit by the room's lamps, not the sun (same lights, other strengths — no shader rebuild).
      this.view3d.sun.intensity = 0.7;
      this.view3d.ambient.intensity = 2.6;
    }
    world?.setNight(this.atmosphere.night);
    world?.setLightDir(this.atmosphere.lightDir);
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
        this.physics?.setMovers(this.traffic.update(dt, seconds, player.x, player.z, player.y));
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
