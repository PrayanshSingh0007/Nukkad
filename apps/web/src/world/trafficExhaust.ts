import * as THREE from 'three';

/**
 * Exhaust from the traffic near you. Buses and lorries cough a dark puff of diesel smoke as they
 * pull away, and idle a thin grey haze while they wait. Autos leave a light blue-grey trail. On
 * cool misty mornings every engine breathes white vapour. Soft round puffs that grow, rise and
 * drift back as they thin out. One draw call of points.
 */
const PUFFS = 420;

/** What comes out of the pipe: colour (0 near black … 1 white), opacity, size from → to (m), life (s), how fast it rises (warm air, m/s²). */
export const SMOKE = {
  /** Diesel pulling away: dark and thick. */
  heavy: { shade: 0.14, opacity: 1.25, from: 0.45, to: 3.0, life: 4.5, rise: 0.75 },
  /** Diesel idling or cruising: a thin grey haze. */
  diesel: { shade: 0.45, opacity: 0.24, from: 0.16, to: 1.0, life: 2.3, rise: 0.35 },
  /** An auto's two-stroke: light blue-grey. */
  auto: { shade: 0.8, opacity: 0.22, from: 0.12, to: 0.9, life: 2, rise: 0.25 },
  /** A cold engine's white vapour. */
  vapour: { shade: 1, opacity: 0.26, from: 0.1, to: 0.75, life: 1.6, rise: 0.4 },
} as const;
export type Smoke = (typeof SMOKE)[keyof typeof SMOKE];

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  smoke: Smoke;
  strength: number;
  seed: number;
}

export class TrafficExhaust {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly puffs: Puff[] = [];
  private next = 0;
  private readonly position = new Float32Array(PUFFS * 3);
  private readonly data = new Float32Array(PUFFS * 4); // size (m), alpha, shade, seed
  private live = 0;

  constructor() {
    for (let i = 0; i < PUFFS; i++) this.puffs.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 99, smoke: SMOKE.diesel, strength: 0, seed: Math.random() });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aPuff', new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 800 }, uLight: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        uniform float uScale;
        attribute vec4 aPuff;
        varying vec4 vPuff;
        varying float vNear;
        void main() {
          vPuff = aPuff;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float d = -mvPosition.z;
          // Puffs right at the camera fade out instead of filling the screen.
          vNear = smoothstep(0.8, 2.6, d);
          gl_PointSize = aPuff.y <= 0.0 ? 0.0 : min(320.0, uScale * aPuff.x / max(0.3, d));
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform vec3 uLight;
        varying vec4 vPuff;
        varying float vNear;
        float exHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float exNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(exHash(i), exHash(i + vec2(1.0, 0.0)), f.x), mix(exHash(i + vec2(0.0, 1.0)), exHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = length(q) * 2.0;
          if (r > 1.0) discard;
          // A billowing puff: soft round body broken up by lumps (its own pattern per puff).
          float a = vPuff.w * 6.283;
          vec2 p = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
          float lumps = exNoise(p * 4.5 + vPuff.w * 31.0) * 0.6 + exNoise(p * 9.0 - vPuff.w * 17.0) * 0.4;
          // A ragged outline, not a disc: the lumps push the edge in and out.
          float edge = clamp(r * (0.78 + 0.5 * (1.0 - lumps)), 0.0, 1.0);
          float body = 1.0 - edge * edge;
          body *= body;
          float alpha = vPuff.y * body * (0.45 + 1.1 * lumps) * vNear;
          if (alpha < 0.004) discard;
          // Dark diesel to white vapour; the top of each puff a little lighter (lit from above).
          // (Linear values: soot is very dark; the shade is squared so mid shades stay grey.)
          vec3 colour = mix(vec3(0.01, 0.01, 0.011), vec3(0.78, 0.8, 0.85), vPuff.z * vPuff.z);
          colour *= uLight * (0.82 + 0.36 * (0.5 - gl_PointCoord.y));
          gl_FragColor = vec4(colour, min(alpha, 0.85));
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** The light on the smoke (dim at night). */
  setLight(light: THREE.Color): void {
    this.material.uniforms.uLight.value.copy(light);
  }

  /**
   * One puff out of a pipe at (x, y, z): `back` is the vehicle's backward direction (bx, bz) and
   * (vx, vz) its velocity; the puff leaves with a little of both.
   */
  emit(x: number, y: number, z: number, bx: number, bz: number, vx: number, vz: number, smoke: Smoke, strength = 1): void {
    const puff = this.puffs[this.next];
    this.next = (this.next + 1) % PUFFS;
    const jet = 0.9 + Math.random() * 0.8;
    puff.x = x;
    puff.y = y;
    puff.z = z;
    puff.vx = vx * 0.3 + bx * jet + (Math.random() - 0.5) * 0.4;
    puff.vz = vz * 0.3 + bz * jet + (Math.random() - 0.5) * 0.4;
    puff.vy = smoke.rise + Math.random() * 0.4;
    puff.age = 0;
    puff.smoke = smoke;
    puff.strength = strength;
    puff.seed = Math.random();
  }

  update(dt: number): void {
    const drag = Math.exp(-1.8 * dt);
    let live = 0;
    for (let i = 0; i < PUFFS; i++) {
      const puff = this.puffs[i];
      const smoke = puff.smoke;
      if (puff.age >= smoke.life) {
        if (this.data[i * 4 + 1] !== 0) this.data[i * 4 + 1] = 0;
        continue;
      }
      puff.age += dt;
      const t = Math.min(1, puff.age / smoke.life);
      // Slowing to the air's pace, rising as it is warm, drifting on a light breeze.
      puff.vx = puff.vx * drag + 0.25 * dt;
      puff.vz = puff.vz * drag + 0.12 * dt;
      puff.vy = puff.vy * drag + smoke.rise * dt * (1 - t);
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.z += puff.vz * dt;
      // Grows quickly at first, then slowly; thins out as it grows.
      const size = smoke.from + (smoke.to - smoke.from) * Math.sqrt(t);
      const alpha = smoke.opacity * puff.strength * Math.min(1, puff.age * 12) * Math.pow(1 - t, 1.6);
      this.position.set([puff.x, puff.y, puff.z], i * 3);
      this.data.set([size, alpha, smoke.shade, puff.seed], i * 4);
      live++;
    }
    this.live = live;
    this.points.visible = live > 0;
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aPuff') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Puffs in the air now (for checks). */
  get count(): number {
    return this.live;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
