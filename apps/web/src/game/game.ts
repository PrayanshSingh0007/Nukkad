import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CHUNK_SIZE, EMOTES, GAME_HALF_SIZE, FLAG_GROUNDED, FLAG_RIDING, PLACE_COLORS, TICK_HZ } from '@nukkad/shared';
import type { Emote } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { BENCH_STRIDE, StreetFinder, heightAt } from '@nukkad/worldgen';
import { Atmosphere, cycleHour, partOfDay } from '../atmosphere/atmosphere.ts';
import { DebugOverlay } from '../debug/overlay.ts';
import { buildReport } from '../debug/report.ts';
import { StatsMeter, formatStats } from '../debug/statsHud.ts';
import { NetClient } from '../net/netClient.ts';
import type { NetStatus } from '../net/netClient.ts';
import { RemotePlayers } from '../net/remotePlayers.ts';
import { Avatar } from '../player/avatar/avatar.ts';
import { setPeopleLight } from '../player/avatar/rocketbox.ts';
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
import { BirdsView } from '../world/birdsView.ts';
import { WaitingPeople } from '../world/waitingPeople.ts';
import { setHeadlightHaze } from '../world/headlightCones.ts';
import { WorldView } from '../world/worldView.ts';
import { INTERIOR_NAMES, buildInterior, carSpots } from '../world/interiors.ts';
import type { Interior } from '../world/interiors.ts';
import type { Door } from '@nukkad/worldgen';
import { LocalPlayer } from './localPlayer.ts';
import { VEHICLES, gearAt, gearTop, specForModel } from './vehicleSpecs.ts';
import type { VehicleSpec } from './vehicleSpecs.ts';
import type { ParkedVehicle } from '../world/streetLifeView.ts';
import { FrameGovernor, QUALITY, QUALITY_LEVELS, saveQuality } from './quality.ts';
import type { QualityLevel, QualitySource } from './quality.ts';
import { createGameScene } from './scene.ts';
import { Sound } from '../audio/sound.ts';
import { SpeedLines } from './speedLines.ts';
import { TyreFx } from './tyreFx.ts';
import { CarLights } from './carLights.ts';
import { CityReflections } from '../atmosphere/cityReflections.ts';
import { CloudShadows, installCloudShadows } from '../atmosphere/cloudShadows.ts';
import { LightningBolt } from '../atmosphere/lightningBolt.ts';
import { RainSplashes, RainView, rainAt } from '../atmosphere/weather.ts';

/**
 * A simple gearbox for the engine note: gears get longer as you go up, the revs climb through
 * each gear and drop at the change. Scooters (and the electric one) are smooth automatics.
 */
function engineRpm(vehicle: VehicleSpec, speed: number): number {
  const share = Math.min(1, speed / vehicle.maxSpeed);
  if (vehicle.code === 1 || vehicle.code === 6) return 0.3 + 0.6 * share;
  // The same gearbox the physics uses, so the note drops exactly when the pull dips.
  const gear = gearAt(vehicle, speed);
  const low = gear === 1 ? 0 : gearTop(vehicle, gear - 1) * 0.75;
  return 0.25 + 0.75 * Math.min(1, Math.max(0, (speed - low) / (gearTop(vehicle, gear) - low)));
}
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
 * The finishing pass on High, like a camera and a film grade. Works on the HDR picture before
 * tone mapping. In order:
 * - speed blur: at high speed the picture smears outwards from the centre (not in the middle,
 *   where you look); when slow, a faint colour fringe in the corners like a real lens;
 * - sun shafts: bright sky near the sun is smeared towards it (22 taps), so light pours through gaps
 *   between buildings and trees; nothing when the sun is hidden or behind you;
 * - lens flare: soft coloured rings along the line from the sun through the centre, a glow
 *   and a thin horizontal streak, and smudges of dirt on the lens lighting up, only while the
 *   sun itself is visible;
 * - grade: a touch more contrast and colour, warm highlights and cool shadows, vignette,
 *   and a very fine moving film grain.
 */
const CINEMA_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunAmt: { value: 0 },
    uBlur: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uThreshold: { value: 2.2 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uSunAmt;
    uniform float uBlur;
    uniform float uTime;
    uniform float uAspect;
    uniform float uThreshold;
    varying vec2 vUv;
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    // Only the very bright parts (sun and the sky right around it), capped.
    vec3 bright(vec2 uv) {
      vec3 s = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
      float l = dot(s, LUMA);
      return min(s * (max(l - uThreshold, 0.0) / max(l, 0.001)), vec3(6.0));
    }
    float ring(vec2 p, vec2 c, float r) { vec2 d = p - c; d.x *= uAspect; return smoothstep(r, r * 0.55, length(d)); }
    void main() {
      vec2 toC = vUv - 0.5;
      float r2 = dot(toC, toC);
      vec3 c;
      if (uBlur > 0.001) {
        vec3 acc = vec3(0.0);
        float len = uBlur * 0.085 * smoothstep(0.01, 0.22, r2);
        float j = hash(vUv * 517.0 + uTime) / 10.0;
        for (int i = 0; i < 10; i++) acc += texture2D(tDiffuse, vUv - toC * len * (float(i) / 10.0 + j)).rgb;
        c = acc / 10.0;
      } else {
        c = texture2D(tDiffuse, vUv).rgb;
      }
      // The fringe uses unblurred samples, so it fades out as the speed blur comes in.
      float caMix = 0.8 * (1.0 - smoothstep(0.0, 0.25, uBlur));
      if (caMix > 0.0) {
        float ca = 0.004 * r2;
        c.r = mix(c.r, texture2D(tDiffuse, vUv + toC * ca).r, caMix);
        c.b = mix(c.b, texture2D(tDiffuse, vUv - toC * ca).b, caMix);
      }

      if (uSunAmt > 0.001) {
        // Shafts: march from this pixel towards the sun, adding up bright sky on the way.
        vec2 fromSun = (vUv - uSun) * vec2(uAspect, 1.0);
        float near = 1.0 - smoothstep(0.0, 1.1, length(fromSun));
        if (near > 0.0) {
          vec2 delta = (uSun - vUv) / 22.0;
          vec2 uv = vUv + delta * hash(vUv * 731.0 + uTime);
          float decay = 1.0;
          vec3 shafts = vec3(0.0);
          for (int i = 0; i < 22; i++) {
            shafts += bright(uv) * decay;
            decay *= 0.935;
            uv += delta;
          }
          c += shafts / 22.0 * 1.15 * uSunAmt * near * vec3(1.0, 0.85, 0.62);
        }

        // Flare: only while the sun disc itself is in view (not behind a building).
        vec3 seen = bright(uSun) + bright(uSun + vec2(0.01, 0.0)) + bright(uSun - vec2(0.01, 0.0)) + bright(uSun + vec2(0.0, 0.012)) + bright(uSun - vec2(0.0, 0.012));
        float vis = clamp(dot(seen, LUMA) * 0.12, 0.0, 1.0) * uSunAmt;
        if (vis > 0.001) {
          vec2 axis = vec2(0.5) - uSun;
          vec3 flare = vec3(0.0);
          flare += ring(vUv, uSun + axis * 0.5, 0.035) * vec3(0.4, 0.55, 1.0) * 0.4;
          flare += ring(vUv, uSun + axis * 0.8, 0.07) * vec3(0.45, 1.0, 0.65) * 0.17;
          flare += ring(vUv, uSun + axis * 1.2, 0.022) * vec3(1.0, 0.75, 0.45) * 0.55;
          flare += ring(vUv, uSun + axis * 1.55, 0.13) * vec3(0.6, 0.55, 1.0) * 0.11;
          flare += ring(vUv, uSun + axis * 2.0, 0.05) * vec3(1.0, 0.55, 0.35) * 0.26;
          float streak = exp(-abs(fromSun.y) * 260.0) * exp(-abs(fromSun.x) * 2.6);
          float glow = exp(-length(fromSun) * 7.0);
          flare += vec3(1.0, 0.86, 0.68) * (streak * 0.9 + glow * 0.45);
          c += flare * vis;
          // Lens dirt: soft smudges and specks on the lens that light up when the sun shines
          // into it (brightest near the sun, fading across the picture).
          vec2 dUv = vUv * vec2(uAspect, 1.0);
          float dirt = 0.0;
          for (int k = 0; k < 2; k++) {
            float scale = k == 0 ? 4.5 : 10.0;
            vec2 g = dUv * scale + float(k) * 13.7;
            vec2 cell = floor(g);
            vec2 f = fract(g) - 0.5;
            vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
            float radius = (k == 0 ? 0.34 : 0.2) * (0.45 + 0.55 * hash(cell + 11.3));
            dirt += step(0.5, hash(cell + float(k) * 17.0)) * smoothstep(radius, radius * 0.25, length(f - off * 0.45)) * (k == 0 ? 0.55 : 0.45);
          }
          c += vec3(1.0, 0.9, 0.76) * dirt * exp(-length(fromSun) * 1.7) * vis * 0.24;
        }
      }

      float luma = dot(c, LUMA);
      c = mix(vec3(luma), c, 1.12);                                   // colour
      c = mix(c, c * c * (3.0 - 2.0 * min(c, vec3(1.0))), 0.12);       // gentle contrast below white
      c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.05, 0.8, luma)); // cool shadows, warm lights
      c *= 1.0 - r2 * (0.38 + uBlur * 0.3);                            // vignette, stronger at speed
      c *= 1.0 + (hash(vUv * vec2(1931.0, 1213.0) + fract(uTime * 7.13)) - 0.5) * 0.045; // film grain
      gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
    }`,
};

const INTRO_S = 4.5; // the arrival drone shot
const COLLIDER_RADIUS = 1; // colliders for the 3 × 3 chunks around the player
const EDGE_MARGIN_M = 100; // the playable square ends this far inside the area
const HYSTERESIS_M = 30;

/** The game itself: loads a place, streams it around the player, and runs the frame loop. */
// Before any shader is compiled: the sun's light is dimmed under drifting cloud shadows.
installCloudShadows();

/** The renderer's normal exposure (scene.ts); eye adaptation moves around it. */
const BASE_EXPOSURE = 1.15;

/** Reused for where your character looks. */
const LOOK_DIR = new THREE.Vector3();
const LOOK_POINT = new THREE.Vector3();

/** Reused for the rain splashes' sprite size. */
const SPLASH_VIEW = new THREE.Vector2();

/** The rim light colour handed to the realistic people each frame (reused). */
const PEOPLE_RIM = new THREE.Color();

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
  private birds: BirdsView | null = null;
  private waiting: WaitingPeople | null = null;
  private readonly clouds = new CloudShadows();
  /** Photo mode: the page hides the HUD; the mouse wheel moves the camera in and out. */
  private photo = false;
  private photoDistance = 5.2;
  /** The horn is held (birds on the wires take off). */
  private hornOn = false;
  /** Counts footsteps (one per ~0.65 m walked), for splashes on wet ground. */
  private stepClock = 0;
  /** How wet the streets are: soaks up within seconds of rain, dries over about four minutes. */
  private wetness = 0;
  /** How hard it rained lately (fades over about three minutes after the rain), for rainbows. */
  private recentRain = 0;
  /** Eyes adjusting: > 1 just after stepping out into daylight (glare), < 1 just after going into a dim room. */
  private adapt = 1;
  private readonly reflections: CityReflections;
  /** High only: renders through a glow pass. */
  private composer: EffectComposer | null = null;
  private cinema: ShaderPass | null = null;
  private cinemaKmh = 0;
  /** The debug overlay's time slider (null = the game's own running day). */
  private hourSlider: number | null = null;
  private introLeft = 0;
  private introAngle = 0;
  private readonly introFrom = new THREE.Vector3();
  private readonly introLook = new THREE.Vector3();
  private readonly introQuat = new THREE.Quaternion();
  private readonly sunOnScreen = new THREE.Vector3();
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
  /** The named road you have just arrived on (null = off the named roads). */
  onStreet: ((name: string | null) => void) | null = null;
  private streets: StreetFinder | null = null;
  private street: string | null = null;
  private streetCandidate: string | null = null;
  private streetSince = 0;
  private streetCheckAt = 0;
  private driveMesh: THREE.InstancedMesh | null = null;
  private driveHint: string | null = null;
  private lastDragAt = 0;
  private static readonly BASE_FOV = 62;
  /** Camera pull-back from acceleration (metres; negative = pushed in by braking). */
  private cameraLag = 0;
  private readonly speedLines: SpeedLines;
  private readonly tyreFx = new TyreFx();
  private readonly carLights = new CarLights();
  private readonly rainView = new RainView();
  private readonly splashes = new RainSplashes();
  private readonly bolt = new LightningBolt();
  /** `?rain=0…1` in the address fixes the weather (for testing); null = the shared weather. */
  private readonly rainOverride: number | null = null;
  private rain = 0;
  /** The real weather over the area (Open-Meteo, via our server), or null when unknown. */
  private realWeather: { rain: number; cloud: number } | null = null;
  private weatherTimer = 0;
  private lightning = 0;
  private nextLightning = 0;

  constructor(options: GameOptions) {
    this.look = options.look;
    this.level = options.quality;
    this.benchmarking = options.qualitySource === 'guess';
    this.view3d = createGameScene(options.canvas, { antialias: QUALITY[this.level].antialias });
    this.input = new PlayerInput(options.canvas, options.stick);
    this.rig = new CameraRig(this.view3d.camera);
    this.speedLines = new SpeedLines(options.canvas.parentElement ?? document.body);
    this.view3d.scene.add(this.tyreFx.group);
    this.view3d.scene.add(this.rainView.lines);
    this.view3d.scene.add(this.splashes.points);
    this.view3d.scene.add(this.bolt.group);
    const rainParam = new URLSearchParams(location.search).get('rain');
    this.rainOverride = rainParam === null ? null : Math.min(1, Math.max(0, Number(rainParam) || 0));
    this.remotes = new RemotePlayers(this.view3d.scene);
    this.atmosphere = new Atmosphere(this.view3d.scene, this.view3d.sun, this.view3d.ambient);
    this.view3d.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.view3d.scene.add(this.view3d.sun.target);
    // What car paint and glass reflect: the sky, the sun and a city skyline (~1 MB on the GPU).
    this.reflections = new CityReflections(this.view3d.renderer);
    this.overlay = new DebugOverlay(
      options.overlay,
      options.logo,
      (level) => {
        this.benchmarking = false;
        saveQuality(level);
        this.setQuality(level);
      },
      (hour) => (this.hourSlider = hour),
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
    // Photo mode: the wheel pulls the camera back for a wider shot, or in close.
    options.canvas.addEventListener(
      'wheel',
      (event) => {
        if (!this.photo) return;
        event.preventDefault();
        this.photoDistance = THREE.MathUtils.clamp(this.photoDistance * (1 + event.deltaY * 0.0012), 1.6, 18);
      },
      { passive: false },
    );
    // ...and on a phone, pinching does the same.
    let pinch = 0;
    options.canvas.addEventListener(
      'touchmove',
      (event) => {
        if (!this.photo || event.touches.length !== 2) {
          pinch = 0;
          return;
        }
        event.preventDefault();
        const [a, b] = [event.touches[0], event.touches[1]];
        const spread = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinch > 0 && spread > 0) this.photoDistance = THREE.MathUtils.clamp(this.photoDistance * (pinch / spread), 1.6, 18);
        pinch = spread;
      },
      { passive: false },
    );
    options.canvas.addEventListener('touchend', () => (pinch = 0));
    this.applyQuality();
    this.view3d.renderer.setAnimationLoop((now) => this.frame(now));
  }

  /** Calls `listener` now and every time the loading / playing / error state changes. */
  onStatus(listener: (status: GameStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Photo mode on or off (the page hides its buttons and shows the photo bar). */
  setPhotoMode(on: boolean): void {
    this.photo = on;
    this.photoDistance = this.rig.distance;
    if (!on) this.setPhotoFilter('');
  }

  /** A look for photo mode, as a CSS filter on the picture ('' = natural). */
  setPhotoFilter(filter: string): void {
    this.view3d.renderer.domElement.style.filter = filter;
  }

  /**
   * Saves what is on screen as a PNG (downloaded by the browser), with the photo filter (a CSS
   * filter string, '' for none) baked in.
   */
  takePhoto(filter: string): void {
    this.frame(performance.now()); // draw now, so the picture is in the canvas when it is read
    const source = this.view3d.renderer.domElement;
    const shot = document.createElement('canvas');
    shot.width = source.width;
    shot.height = source.height;
    const context = shot.getContext('2d');
    if (!context) return;
    context.filter = filter || 'none';
    context.drawImage(source, 0, 0);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `nukkad-${stamp}.png`;
    link.href = shot.toDataURL('image/png');
    link.click();
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
    // Out of the daylight the room looks dark for a moment, until your eyes adjust.
    this.adapt = 1 - 0.55 * (1 - this.atmosphere.night);
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
    // Stepping out into daylight: glare for a moment, then your eyes adjust (at night the street
    // is the darker place).
    this.adapt = this.atmosphere.night > 0.5 ? 0.65 : 2.1;
  }

  /** While inside, the city is not drawn at all (cheaper, and nothing leaks through the walls). */
  private setOutsideVisible(on: boolean): void {
    for (const group of [this.world?.group, this.traffic?.group, this.walkers?.group, this.streetLife?.group, this.waiting?.group]) if (group) group.visible = on;
    if (this.birds) this.birds.mesh.layers.set(on ? 0 : 31); // indoors: no birds (their own update sets visible)
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
      this.carLights.detach();
      player.avatar.object.visible = true;
      this.onRiding?.(false);
      return;
    }
    if (player.riding) return; // on your own scooter: use Ride/Walk
    player.seat = null;
    player.emote = 0;
    const parked = streetLife.nearestVehicle(player.x, player.z, 3.5);
    // The kind's handling with this model's real top speed and pull (a BMW M3 is not a Honda City).
    const kindSpec = parked ? VEHICLES[parked.kind.name] : undefined;
    const spec = parked && kindSpec ? specForModel(kindSpec, streetLife.modelFile(parked)) : undefined;
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
    if (!model.geometry.boundingBox) model.geometry.computeBoundingBox();
    if (model.geometry.boundingBox) this.carLights.attach(mesh, model.geometry.boundingBox, spec.leans === true);
    this.onRiding?.(true);
  }

  /** The horn (H key or the Horn button), on anything you ride or drive. Only you hear it for now. */
  setHorn(on: boolean): void {
    const vehicle = this.player?.vehicle;
    this.sound.unlock();
    this.hornOn = on && !!vehicle;
    if (!on || !vehicle) {
      this.sound.horn(false);
      return;
    }
    // People nearby hear it: they stop, look and complain.
    if (this.player) this.walkers?.honk(this.player.x, this.player.z);
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
  async start(lat: number, lng: number, halfSize: number = GAME_HALF_SIZE): Promise<void> {
    this.loadStarted = performance.now();
    // The real weather over this place, now and every 10 minutes.
    void this.fetchWeather(lat, lng);
    window.clearInterval(this.weatherTimer);
    this.weatherTimer = window.setInterval(() => void this.fetchWeather(lat, lng), 10 * 60_000);
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
      this.streetLife = new StreetLifeView(ready.props, this.reflections.texture);
      this.streets = new StreetFinder(ready.roads);
      const streetLife = this.streetLife;
      this.remotes.vehicleModels = (model) => streetLife.modelByName(model);
      this.traffic = new TrafficView(ready.traffic, this.world.terrain, (name, light) => streetLife.modelByName(name, light), (name, variant) => streetLife.paintFor(name, variant));
      this.traffic.setRadius(settings.streetLifeRadius * 1.5);
      this.view3d.scene.add(this.traffic.group);
      this.walkers = new PedestrianView(ready.walkers, this.world.terrain);
      this.walkers.setRadius(settings.streetLifeRadius * 0.8);
      this.walkers.setNearLimit(settings.nearPeople);
      this.view3d.scene.add(this.walkers.group);
      this.birds = new BirdsView();
      this.view3d.scene.add(this.birds.mesh);
      this.waiting = new WaitingPeople(ready.props.stops);
      this.view3d.scene.add(this.waiting.group);
      this.streetLife.setRadius(settings.streetLifeRadius, settings.shadowSize > 0 ? settings.shadowRange + 10 : 0);
      this.view3d.scene.add(this.streetLife.group);
      this.atmosphere.setPlace(ready.info.lat, ready.info.lng, ready.info.timeZone);
      physics.setTerrain(ready.terrain.positions, ready.terrain.indices);
      this.streamer = new Streamer(client, this.world, this.streamSettings());
      this.streamer.onChunk = () => {
        this.collidersComplete = false;
        this.streetLife?.refresh(); // roof tanks appear with their buildings
      };
      const streamer = this.streamer;
      if (this.streetLife) this.streetLife.roofReady = (x, z) => streamer.hasChunkAt(x, z);
      this.world?.setRoofReady((x, z) => streamer.hasChunkAt(x, z));
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
    fog.near = quality.viewDistance * 0.15; // a light city haze from fairly close: depth, like a real Bengaluru afternoon
    this.atmosphere?.setFogRange(fog.near, fog.far); // morning mist and rain pull it in from here
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

  /**
   * The arrival shot: the camera starts high above the street like a drone, circles a little
   * and glides down into the normal camera behind you. Moving or dragging the view cuts it short.
   */
  private introShot(player: LocalPlayer, dt: number): void {
    if (this.introLeft <= 0) return;
    if (this.input.moveX !== 0 || this.input.moveY !== 0 || performance.now() - this.lastDragAt < 100) this.introLeft = Math.min(this.introLeft, 0.7);
    this.introLeft = Math.max(0, this.introLeft - dt);
    const k = 1 - this.introLeft / INTRO_S;
    const e = k * k * k * (k * (k * 6 - 15) + 10); // smooth start and end
    const camera = this.view3d.camera;
    const a = this.introAngle + k * 0.9;
    const radius = 75 * (1 - e) + 8;
    const from = this.introFrom.set(player.x + Math.sin(a) * radius, player.y + 55 * (1 - e) + 4, player.z + Math.cos(a) * radius);
    const rigQuat = this.introQuat.copy(camera.quaternion);
    camera.position.lerpVectors(from, camera.position, e);
    const look = this.introLook.copy(camera.position);
    camera.position.copy(from);
    camera.lookAt(player.x, player.y + 1.2, player.z);
    camera.quaternion.slerp(rigQuat, e);
    camera.position.copy(look);
  }

  /** The time on the game's clock, e.g. "18:05 · Evening". */
  clockText(): string {
    const hour = this.atmosphere.override ?? 12;
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    const weather = this.rain > 0.7 ? ' · Storm' : this.rain > 0.25 ? ' · Rain' : '';
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${partOfDay(hour)}${weather}`;
  }

  /**
   * The street name card: twice a second, which named road you are on. A new one has to hold
   * for a second (so crossing a junction does not flash names) before the card shows it.
   */
  private updateStreet(player: LocalPlayer, now: number): void {
    if (!this.streets || now < this.streetCheckAt) return;
    this.streetCheckAt = now + 500;
    const here = this.interior ? null : this.streets.at(player.x, player.z);
    if (here !== this.streetCandidate) {
      this.streetCandidate = here;
      this.streetSince = now;
      return;
    }
    if (here !== this.street && here !== null && now - this.streetSince >= 1000) {
      this.street = here;
      this.onStreet?.(here);
    }
  }

  /**
   * Asks our server for the real weather over the area (Open-Meteo). If it cannot be had, the
   * game falls back to its own rain spells (`rainAt`).
   */
  private async fetchWeather(lat: number, lng: number): Promise<void> {
    try {
      const response = await fetch(`/api/weather?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rain?: number; cloud?: number };
      this.realWeather = { rain: Math.min(1, Math.max(0, Number(body.rain) || 0)), cloud: Math.min(1, Math.max(0, Number(body.cloud) || 0)) };
    } catch {
      this.realWeather = null;
    }
  }

  /** In heavy rain, lightning now and then: a double flicker, and thunder a moment later. */
  private updateLightning(now: number, dt: number): void {
    if (this.rain > 0.65 && !this.interior) {
      if (this.nextLightning === 0) this.nextLightning = now + 4000 + Math.random() * 8000;
      if (now > this.nextLightning) {
        this.lightning = 1;
        // A visible bolt somewhere ahead; its thunder arrives after the sound has travelled.
        this.bolt.strike(this.view3d.camera, this.player?.y ?? 0, this.view3d.camera.far);
        const delay = this.bolt.distance / 343;
        this.sound.thunder(delay, 1 - delay / 3.1);
        this.nextLightning = now + 9000 + Math.random() * 20000;
      }
    } else this.nextLightning = 0;
    // Fades fast, with a second flicker as it dies down.
    this.lightning = Math.max(0, this.lightning - dt * 5);
    const flicker = this.lightning > 0.55 || (this.lightning > 0.15 && this.lightning < 0.35) ? this.lightning : this.lightning * 0.25;
    if (!this.interior) this.atmosphere.flash(flicker);
    this.bolt.update(this.interior ? 0 : flicker);
  }

  /** Where the sun is on screen and how fast you go, for the cinema pass. */
  private updateCinema(now: number): void {
    const u = this.cinema?.uniforms;
    if (!u) return;
    const camera = this.view3d.camera;
    const sunDir = this.atmosphere.sky.uniforms.uSunDir.value;
    const p = this.sunOnScreen.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
    const facing = camera.getWorldDirection(new THREE.Vector3()).dot(sunDir);
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    // Fades out as the sun leaves the screen, sets, or when you are indoors.
    const off = Math.max(Math.abs(p.x), Math.abs(p.y)) - 1;
    const up = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.12);
    u.uSunAmt.value = facing > 0 && !this.interior ? (1 - THREE.MathUtils.smoothstep(off, 0, 0.8)) * up * (1 - this.atmosphere.night) * (1 - this.rain) : 0;
    u.uBlur.value = this.player?.vehicle ? THREE.MathUtils.smoothstep(this.cinemaKmh, 90, 260) * 0.9 : 0;
    u.uTime.value = (now / 1000) % 1000;
    u.uAspect.value = camera.aspect;
  }

  /** The glow pass (High). Bright things over the threshold get a soft halo. */
  private applyBloom(on: boolean): void {
    if (!on) {
      this.composer?.dispose();
      this.composer = null;
      this.cinema = null;
      return;
    }
    if (this.composer) return;
    const { renderer, scene, camera } = this.view3d;
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    // Ambient occlusion: the soft darkening where walls meet the ground, in corners and under
    // cars, which is most of what makes a scene look solid instead of flat.
    const ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 2.2, scale: 1.15, samples: 12, distanceFallOff: 0.6, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    ao.blendIntensity = 0.9;
    // Half resolution: AO is soft anyway, and at full size it cost ~12 ms a frame on a Retina Mac.
    const aoSize = ao.setSize.bind(ao);
    ao.setSize = (width: number, height: number) => aoSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
    composer.addPass(ao);
    // Bloom from a quarter-size picture (its blur hides the difference; ~6 ms → ~2 ms).
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 4, size.y / 4), 0.22, 0.4, 1.25);
    const bloomSize = bloom.setSize.bind(bloom);
    bloom.setSize = (width: number, height: number) => bloomSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
    composer.addPass(bloom);
    this.cinema = new ShaderPass(CINEMA_SHADER);
    composer.addPass(this.cinema);
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
    this.introLeft = INTRO_S;
    this.introAngle = this.rig.yaw + Math.PI * 0.85;
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
      // Space on foot: a jump (about 0.6 m with the game's gravity). In vehicles it stays the handbrake.
      if (this.input.consumeJump() && !player.vehicle && !player.riding && player.seat === null && !player.emote) player.body.jump(5.2);
      player.update(dt, this.input.moveX, this.input.moveY, this.rig.yaw, groundAt);
      if (this.driveMesh) {
        this.driveMesh.position.set(player.x, player.y, player.z);
        this.driveMesh.rotation.set(player.bodyPitch, player.heading, player.lean + player.bodyRoll);
        this.carLights.update(player.rideSpeed, player.brake, player.handbrake, this.atmosphere.night);
      }
      this.updateDriveHint();
      const riding = player.vehicle;
      // Tyres: skid marks, smoke and screech when sliding, drifting, braking hard or launching.
      {
        const speed = Math.abs(player.rideSpeed);
        let skid = 0;
        if (riding && player.body.grounded) {
          skid = Math.max(
            Math.min(1, player.slip * 1.3),
            player.handbrake && speed > 4 ? 0.75 : 0,
            // Hard braking only when you brake (a bump into another car also slows you sharply).
            player.brake > 0.5 && player.longAccel < -6 && speed > 6 ? Math.min(1, (-player.longAccel - 6) / 5) : 0,
            // A launch leaves light marks but no smoke (smoke starts above 0.2).
            player.throttle > 0.8 && speed > 0.5 && speed < 5 && player.longAccel > 6 && riding.maxSpeed > 30 ? 0.18 : 0,
          );
        }
        const wheels: { x: number; y: number; z: number }[] = [];
        if (riding) {
          const fx = -Math.sin(player.heading);
          const fz = -Math.cos(player.heading);
          const back = riding.wheelbase * 0.5;
          const side = riding.leans ? 0 : riding.radius * 0.85;
          const bx = player.x - fx * back;
          const bz = player.z - fz * back;
          if (side === 0) wheels.push({ x: bx, y: player.y, z: bz });
          else wheels.push({ x: bx - fz * side, y: player.y, z: bz + fx * side }, { x: bx + fz * side, y: player.y, z: bz - fx * side });
        }
        const [vx, vz] = player.velocity;
        const size = this.view3d.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.tyreFx.setViewport(size.y, this.view3d.camera.fov);
        this.tyreFx.setLight(new THREE.Color(1, 1, 1).multiplyScalar(1 - this.atmosphere.night * 0.75));
        // Wet roads: tyres slide on water instead of smoking and leave hardly any rubber.
        // ...and throw up spray behind them at speed.
        const spray = this.interior ? 0 : THREE.MathUtils.smoothstep(this.wetness, 0.1, 0.6) * THREE.MathUtils.smoothstep(Math.abs(player.rideSpeed), 5, 25);
        this.tyreFx.update(dt, wheels, skid * (1 - 0.8 * this.wetness), vx, vz, spray);
        this.sound.skid(skid);
      }
      this.sound.engine(riding ? engineRpm(riding, Math.abs(player.rideSpeed)) : 0, !riding ? 'none' : riding.code === 1 ? 'electric' : 'engine', player.throttle);
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

      // Driving camera, tuned for the feeling of speed (like racing games):
      // - it swings in behind you (unless you just dragged the view) and drops a little lower;
      // - the field of view opens with real speed (km/h, not the vehicle's share), plus a kick
      //   when you floor it; the camera lags back as you accelerate and pushes in as you brake;
      // - a little road shake that grows with speed, and speed lines at the screen edges.
      const camera = this.view3d.camera;
      const vehicle = player.vehicle;
      const kmh = vehicle ? Math.abs(player.rideSpeed) * 3.6 : 0;
      const fast = Math.min(1, kmh / 260);
      const ease = fast * (2 - fast); // fast at first, then levelling off
      const dragged = now - this.lastDragAt < 1500;
      if (player.riding && Math.abs(player.rideSpeed) > 1 && !dragged) {
        const behind = player.rideSpeed >= 0 ? player.heading : player.heading + Math.PI;
        this.rig.yaw += Math.atan2(Math.sin(behind - this.rig.yaw), Math.cos(behind - this.rig.yaw)) * Math.min(1, dt * (2.5 + fast * 2));
        const pitch = -0.27 + ease * 0.09;
        this.rig.pitch += (pitch - this.rig.pitch) * Math.min(1, dt * 1.5);
      }
      const lagTarget = vehicle ? Math.max(-0.7, Math.min(1.1, player.longAccel * 0.09)) : 0;
      this.cameraLag += (lagTarget - this.cameraLag) * Math.min(1, dt * 3);
      this.rig.distance = this.photo ? this.photoDistance : (vehicle ? vehicle.cameraDistance : inside ? 3.4 : 5.2) + ease * 1.4 + this.cameraLag;
      const kick = vehicle ? Math.max(0, Math.min(5, player.longAccel * 0.45)) * player.throttle : 0;
      const fov = Game.BASE_FOV + ease * 20 + kick;
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
        camera.updateProjectionMatrix();
      }

      const body = player.body.collider;
      this.rig.update(player.x, player.y, player.z, dt, (ox, oy, oz, dx, dy, dz, max) => physics.castRay(ox, oy, oz, dx, dy, dz, max, body), groundAt);
      if (vehicle && kmh > 5) {
        // Road shake: a few mixed sine waves (no randomness, so it never jerks), more when sliding.
        const t = now / 1000;
        const amount = (0.004 + 0.03 * fast * fast) * (1 + player.slip * 1.5) * (vehicle.leans ? 0.7 : 1);
        camera.position.x += (Math.sin(t * 37.1) + Math.sin(t * 23.7) * 0.6) * amount;
        camera.position.y += (Math.sin(t * 41.3) * 0.8 + Math.sin(t * 17.9) * 0.5) * amount;
      }
      this.speedLines.update(vehicle ? kmh : 0, dt);
      this.cinemaKmh = kmh;
      this.introShot(player, dt);
      this.updateStreet(player, now);
      this.rainView.update(dt, this.interior ? 0 : this.rain, this.view3d.camera, this.atmosphere.sky.uniforms.uHorizon.value);
      const ground = this.world?.terrain;
      if (ground) {
        const view = this.view3d.renderer.getDrawingBufferSize(SPLASH_VIEW);
        this.splashes.setViewport(view.y, this.view3d.camera.fov);
        this.world?.setViewport(view.y, this.view3d.camera.fov);
        // Footsteps splash on wet ground: one splash per step, at the left or right foot.
        const walking = !player.vehicle && !player.riding && player.body.grounded && player.speed > 0.6 && !this.interior;
        if (walking && this.wetness > 0.3) {
          const before = Math.floor(this.stepClock);
          this.stepClock += dt * player.speed / 0.65;
          if (Math.floor(this.stepClock) !== before) {
            const facing = player.avatar.facing;
            const side = Math.floor(this.stepClock) % 2 === 0 ? 0.12 : -0.12;
            const fx = player.x + Math.cos(facing) * side - Math.sin(facing) * 0.15;
            const fz = player.z - Math.sin(facing) * side - Math.cos(facing) * 0.15;
            this.splashes.splashAt(fx, heightAt(ground, fx, fz) + 0.12, fz, this.wetness > 0.6 ? 4 : 2);
          }
        }
        // Roads sit a few centimetres above the ground: splashes a little higher, so they show on them.
        this.splashes.update(dt, this.interior ? 0 : this.rain, player.x, player.z, (x, z) => heightAt(ground, x, z) + 0.12, this.atmosphere.sky.uniforms.uHorizon.value);
      }
      this.sound.ambience(dt, this.atmosphere.night, this.interior !== null, vehicle ? kmh : 0, this.rain);

      if (this.governor.frame(dtMs, this.benchmarking) === 'down') {
        const index = QUALITY_LEVELS.indexOf(this.level);
        if (index > 0) this.setQuality(QUALITY_LEVELS[index - 1]);
        else this.benchmarking = false;
      }
    }

    this.atmosphere.override = this.hourSlider ?? cycleHour(Date.now());
    // Real weather when we have it (eased in over ~20 s), else our own rain spells; ?rain= wins.
    const wantRain = this.rainOverride ?? (this.realWeather ? this.realWeather.rain : rainAt(Date.now()));
    this.rain = this.rainOverride !== null ? wantRain : this.rain + (wantRain - this.rain) * Math.min(1, dt / 20);
    this.atmosphere.rain = this.rain;
    this.atmosphere.cloud = this.realWeather?.cloud ?? 0.25;
    this.atmosphere.update(dt, this.view3d.camera);
    this.updateLightning(now, dt);
    this.wetness = this.rain > this.wetness ? this.wetness + (this.rain - this.wetness) * Math.min(1, dt / 6) : Math.max(this.rain, this.wetness - dt / 240);
    world?.setRain(this.rain, this.wetness);
    const skyU = this.atmosphere.sky.uniforms;
    if (this.reflections.update(skyU.uSunDir.value, skyU.uSunColor.value, skyU.uTop.value, skyU.uHorizon.value, this.atmosphere.night, this.rain)) {
      this.streetLife?.setReflections(this.reflections.texture);
    }
    // A rainbow when the rain stops while the sun is up but not high (the bow sits 42° from the
    // point opposite the sun, so a high sun puts it below the horizon).
    this.recentRain = Math.max(this.rain, this.recentRain - dt / 180);
    const sunY = this.atmosphere.sky.uniforms.uSunDir.value.y;
    this.atmosphere.sky.uniforms.uRainbow.value =
      THREE.MathUtils.smoothstep(this.recentRain, 0.25, 0.5) *
      (1 - THREE.MathUtils.smoothstep(this.rain, 0.12, 0.35)) *
      THREE.MathUtils.smoothstep(sunY, 0.03, 0.12) *
      (1 - THREE.MathUtils.smoothstep(sunY, 0.55, 0.7)) *
      (1 - this.atmosphere.night) *
      (1 - this.atmosphere.cloud * 0.7);
    // Eyes adjusting after a doorway (exposure eases back to normal over about 2 s).
    this.adapt += (1 - this.adapt) * Math.min(1, dt * 1.5);
    this.view3d.renderer.toneMappingExposure = BASE_EXPOSURE * this.adapt;
    // Cloud shadows by day (not indoors, not on Low); fewer in rain, when the sky is one grey sheet.
    const day = 1 - THREE.MathUtils.smoothstep(this.atmosphere.night, 0.1, 0.6);
    const cloudStrength = this.interior || this.level === 'low' ? 0 : 0.72 * day * (1 - this.rain) * (1 - this.atmosphere.mist);
    this.clouds.update(this.view3d.renderer, Date.now(), cloudStrength, this.atmosphere.cloud);
    // Your character looks where the camera looks (on foot; the head turns only within reach,
    // so looking back at your own face does not twist it).
    if (player) {
      const onFoot = !player.vehicle && !player.riding && player.emote === 0 && !this.introLeft;
      if (onFoot) {
        const dir = this.view3d.camera.getWorldDirection(LOOK_DIR);
        player.avatar.lookAt(LOOK_POINT.set(player.x + dir.x * 10, player.y + 1.55 + dir.y * 10, player.z + dir.z * 10));
      } else player.avatar.lookAt(null);
    }
    // Realistic people: a rim of sky light (none indoors) and the sky's reflections.
    PEOPLE_RIM.copy(skyU.uHorizon.value).multiplyScalar(this.interior ? 0 : 0.55 * (1 - this.atmosphere.night * 0.4));
    setPeopleLight(PEOPLE_RIM, this.reflections.texture, this.interior ? 1 : this.atmosphere.night, this.interior ? 0 : this.rain);
    if (this.interior) {
      // Indoors: lit by the room's lamps, not the sun (same lights, other strengths — no shader rebuild).
      this.view3d.sun.intensity = 0.7;
      this.view3d.ambient.intensity = 2.6;
    }
    world?.setNight(this.atmosphere.night);
    world?.setLightDir(this.atmosphere.lightDir);
    world?.setSunDir(skyU.uSunDir.value);
    world?.setSky(skyU.uTop.value, skyU.uHorizon.value);
    this.streetLife?.setNight(this.atmosphere.night);
    this.traffic?.setNight(this.interior ? 0 : this.atmosphere.night, this.wetness); // wet roads keep spraying after the rain
    setHeadlightHaze(this.interior ? 0 : this.atmosphere.night, this.interior ? 0 : this.rain, this.interior ? 0 : this.atmosphere.mist, dt);
    this.walkers?.setWorld(this.atmosphere.night, this.rain);
    this.birds?.setWorld(this.atmosphere.night, this.rain);
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
        this.waiting?.update(dt);
        this.birds?.setGround(player.y);
        this.birds?.update(seconds, player.x, player.z);
      }
      world?.updateShadowTrees(player.x, player.z, QUALITY[this.level].shadowSize > 0 ? QUALITY[this.level].shadowRange : 0);
      // Birds on the wires let you come within 6 m on foot; traffic-speed or a horn scares them sooner.
      const scare = this.hornOn ? 18 : player.vehicle || player.riding ? 6 + Math.min(10, Math.abs(player.rideSpeed) * 0.6) : 6;
      world?.updateNear(dt, player.x, player.z, scare);
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
    if (this.composer) {
      this.updateCinema(now);
      this.composer.render(dt);
    }
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
      `game time ${this.clockText()}${this.hourSlider === null ? '' : ' (slider)'} · night ${this.atmosphere.night.toFixed(2)}`,
      `net ${this.netStatus} · ping ${Math.round(this.net?.rtt ?? 0)} ms · others ${this.remotes.count} · draw delay ${Math.round(this.remotes.clock.delay)} ms`,
      `${ready.info.id} · pack ${Math.round((ready.info.downloadBytes || ready.info.packBytes) / 1024)} KB · ready in ${(this.timeToPlayMs / 1000).toFixed(1)} s`,
    ];
  }

  /** For the browser console while developing. */
  get debug(): Record<string, unknown> {
    return { player: this.player, rig: this.rig, physics: this.physics, input: this.input, streamer: this.streamer, governor: this.governor, scene: this.view3d.scene };
  }
}
