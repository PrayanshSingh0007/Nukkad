import * as THREE from 'three';
import { localHour, skyDirection, sunPosition } from '@nukkad/shared';

/** The hour shown before the game clock takes over (and in tests). */
export const DAY_HOUR = 16;

/**
 * The game's own day, so you see morning, afternoon, sunset and night go by. It comes from the
 * wall clock, so everyone sees the same time. Game hours per real minute:
 * - 6:00–16:00 at 1 (10 minutes of day);
 * - 16:00–19:00 at 0.5 (6 minutes of golden hour, sunset and dusk — the best light);
 * - 19:00–6:00 at 3 (about 3½ minutes of night).
 */
const DAY_PARTS: [from: number, to: number, hoursPerMinute: number][] = [
  [6, 16, 1],
  [16, 19, 0.5],
  [19, 30, 3],
];
const CYCLE_MINUTES = DAY_PARTS.reduce((sum, [from, to, rate]) => sum + (to - from) / rate, 0);
export function cycleHour(ms: number): number {
  let p = (ms / 60000) % CYCLE_MINUTES;
  for (const [from, to, rate] of DAY_PARTS) {
    const minutes = (to - from) / rate;
    if (p < minutes) return (from + p * rate) % 24;
    p -= minutes;
  }
  return 6;
}

/** "Morning", "Afternoon", "Evening" or "Night" for an hour of the day. */
export function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 16.5) return 'Afternoon';
  if (hour >= 16.5 && hour < 19.5) return 'Evening';
  return 'Night';
}
import { Sky } from './sky.ts';

/**
 * Day and night for the place's REAL local time (PLAN §11 Phase 5): the sun and moon
 * move, the sky, fog and light change colour, and `night` (0 day … 1 night) switches on
 * street lights and windows. Everyone in a room sees the same sky, because it depends
 * only on the place and the clock.
 */
interface Look {
  /** Sun elevation in degrees where this look applies. */
  at: number;
  top: THREE.Color;
  horizon: THREE.Color;
  light: THREE.Color;
  lightPower: number;
  ambientSky: THREE.Color;
  ambientGround: THREE.Color;
  ambientPower: number;
}

const look = (at: number, top: string, horizon: string, light: string, lightPower: number, sky: string, ground: string, ambientPower: number): Look => ({
  at,
  top: new THREE.Color(top),
  horizon: new THREE.Color(horizon),
  light: new THREE.Color(light),
  lightPower,
  ambientSky: new THREE.Color(sky),
  ambientGround: new THREE.Color(ground),
  ambientPower,
});

/** From deep night to full day, by sun elevation. Light at night comes from the moon. */
const LOOKS: Look[] = [
  look(-18, '#060b1a', '#16203a', '#9db2f2', 0.6, '#3a4a78', '#262a38', 0.95),
  look(-8, '#0b1430', '#26304f', '#a3b6f2', 0.6, '#42507c', '#2a2c38', 1.0),
  look(-2, '#25386a', '#c97a62', '#ff9a66', 0.55, '#6c7aa0', '#40383a', 1.1),
  look(4, '#4f78bf', '#f2b98c', '#ffb072', 2.0, '#9fb2dc', '#6e6152', 1.15),
  // Day: a strong warm sun against a softer, cooler sky fill, so lit walls and shade read clearly.
  look(15, '#4f8ad8', '#e6ddcc', '#ffd9a8', 3.2, '#b9cdf2', '#7d705c', 1.5),
  look(40, '#4787dc', '#dde0dd', '#ffeccf', 3.4, '#c3d6f7', '#857a66', 1.6),
];

function lookAt(elevationDeg: number): Look {
  if (elevationDeg <= LOOKS[0].at) return LOOKS[0];
  for (let i = 1; i < LOOKS.length; i++) {
    const a = LOOKS[i - 1];
    const b = LOOKS[i];
    if (elevationDeg <= b.at) {
      const k = (elevationDeg - a.at) / (b.at - a.at);
      return {
        at: elevationDeg,
        top: a.top.clone().lerp(b.top, k),
        horizon: a.horizon.clone().lerp(b.horizon, k),
        light: a.light.clone().lerp(b.light, k),
        lightPower: a.lightPower + (b.lightPower - a.lightPower) * k,
        ambientSky: a.ambientSky.clone().lerp(b.ambientSky, k),
        ambientGround: a.ambientGround.clone().lerp(b.ambientGround, k),
        ambientPower: a.ambientPower + (b.ambientPower - a.ambientPower) * k,
      };
    }
  }
  return LOOKS[LOOKS.length - 1];
}


export class Atmosphere {
  readonly sky = new Sky();
  /** 0 = day … 1 = night. */
  night = 0;
  /** The place's local clock, for the overlay. */
  clock = '';
  /** Direction the light comes from (sun by day, moon by night), unit length. */
  readonly lightDir = new THREE.Vector3(0, 2, 0);
  /** 0 = dry … 1 = downpour; set by the game from the weather. */
  rain = 0;
  private baseAmbient = 1;
  private readonly grey = new THREE.Color();
  /**
   * Hours on the place's clock to show instead of now. The game sets it every frame from its
   * own day (`cycleHour`) or the debug slider. null = follow the real local time.
   */
  override: number | null = DAY_HOUR;
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private lat = 0;
  private lng = 0;
  private timeZone = 'UTC';
  private elapsed = Infinity;

  constructor(scene: THREE.Scene, sun: THREE.DirectionalLight, ambient: THREE.HemisphereLight) {
    this.sun = sun;
    this.ambient = ambient;
    this.fog = scene.fog as THREE.Fog;
    scene.background = null;
    scene.add(this.sky.mesh);
  }

  setPlace(lat: number, lng: number, timeZone: string): void {
    this.lat = lat;
    this.lng = lng;
    this.timeZone = timeZone;
    this.elapsed = Infinity;
  }

  /** The moment to draw: now, or now moved to the chosen hour on the place's clock. */
  private moment(): Date {
    const now = new Date();
    if (this.override === null) return now;
    const shift = this.override - localHour(now, this.timeZone);
    return new Date(now.getTime() + shift * 3_600_000);
  }

  /** Call every frame; the sky is recalculated twice a second (the sun moves slowly). */
  update(dt: number, camera: THREE.Camera): void {
    this.sky.follow(camera);
    this.elapsed += dt;
    if (this.elapsed < 0.5) return;
    this.elapsed = 0;

    const date = this.moment();
    const hour = localHour(date, this.timeZone);
    this.clock = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')} ${this.timeZone}`;
    const { elevation, azimuth } = sunPosition(date, this.lat, this.lng);
    const sunDir = new THREE.Vector3(...skyDirection(elevation, azimuth));
    // The moon is placed roughly opposite the sun (good enough for a light source).
    const moonDir = new THREE.Vector3(...skyDirection(Math.max(0.35, -elevation), azimuth + Math.PI));
    const degrees = THREE.MathUtils.radToDeg(elevation);
    const l = lookAt(degrees);
    this.night = THREE.MathUtils.smoothstep(-degrees, -2, 6);

    const u = this.sky.uniforms;
    // Rain: an overcast grey sky (its colours also tint the fog and every reflection).
    const r = this.rain;
    const overcastTop = this.grey.setRGB(0.36, 0.39, 0.44).multiplyScalar(1 - this.night * 0.88);
    u.uTop.value.copy(l.top).lerp(overcastTop, r * 0.8);
    const overcastHorizon = this.grey.setRGB(0.55, 0.57, 0.6).multiplyScalar(1 - this.night * 0.85);
    u.uHorizon.value.copy(l.horizon).lerp(overcastHorizon, r * 0.75);
    u.uRain.value = r;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(l.light).multiplyScalar(degrees > -3 ? 1 : 0);
    u.uMoonDir.value.copy(moonDir);
    u.uNight.value = this.night;

    this.fog.color.copy(u.uHorizon.value);
    this.sun.color.copy(l.light);
    this.sun.intensity = l.lightPower * (1 - r * 0.72);
    this.lightDir.copy(degrees > -4 ? sunDir : moonDir);
    // Very low light would make endless shadows; lift it a little.
    if (this.lightDir.y < 0.25) this.lightDir.setY(0.25).normalize();
    this.ambient.color.copy(l.ambientSky).lerp(this.grey.setRGB(0.7, 0.73, 0.78), r * 0.6);
    this.ambient.groundColor.copy(l.ambientGround);
    this.ambient.intensity = l.ambientPower * (1 - r * 0.2);
    this.baseAmbient = this.ambient.intensity;
  }

  /** Lightning (0–1, per frame): a flash in the clouds that lights the whole street. */
  flash(amount: number): void {
    this.sky.uniforms.uFlash.value = amount;
    this.ambient.intensity = this.baseAmbient + amount * 4;
  }

  dispose(): void {
    this.sky.dispose();
  }
}
