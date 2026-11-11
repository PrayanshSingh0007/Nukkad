import * as THREE from 'three';
import { localHour, skyDirection, sunPosition } from '@nukkad/shared';
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
  look(-18, '#050914', '#121a30', '#8fa6e8', 0.35, '#2a3656', '#141820', 0.45),
  look(-8, '#0b1430', '#26304f', '#9fb2f0', 0.35, '#34405e', '#1a1c24', 0.55),
  look(-2, '#25386a', '#c97a62', '#ff9a66', 0.4, '#6c7aa0', '#40383a', 0.9),
  look(4, '#4f78bf', '#f2b98c', '#ffb072', 1.6, '#b8c4e0', '#6e6152', 1.5),
  look(15, '#5d93da', '#cfe1f2', '#ffe6c4', 2.3, '#d6e4fa', '#8a8070', 1.9),
  look(40, '#4f8fe0', '#c8e2f8', '#fff4e3', 2.6, '#dcebff', '#8f8672', 2.1),
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
  /** Hours on the place's clock to show instead of now (debug slider and, later, photo mode). */
  override: number | null = null;
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
    u.uTop.value.copy(l.top);
    u.uHorizon.value.copy(l.horizon);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(l.light).multiplyScalar(degrees > -3 ? 1 : 0);
    u.uMoonDir.value.copy(moonDir);
    u.uNight.value = this.night;

    this.fog.color.copy(l.horizon);
    this.sun.color.copy(l.light);
    this.sun.intensity = l.lightPower;
    this.sun.position.copy(degrees > -4 ? sunDir : moonDir);
    this.ambient.color.copy(l.ambientSky);
    this.ambient.groundColor.copy(l.ambientGround);
    this.ambient.intensity = l.ambientPower;
  }

  dispose(): void {
    this.sky.dispose();
  }
}
