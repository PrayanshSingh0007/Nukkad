import * as THREE from 'three';

/**
 * Skid marks and tyre smoke for the vehicle you drive.
 *
 * Skid marks: a strip of dark rubber laid behind each rear tyre while it slides, brakes hard,
 * drifts or spins up on a launch. One dynamic mesh, used as a ring buffer of quads, so old
 * marks are replaced by new ones (about 300 m of marks in total, shared by both tyres). They sit a few millimetres
 * above the road and never write depth, so they never flicker.
 *
 * Smoke: soft round puffs (one draw call, a ring buffer of points) that start small at the
 * tyre, swell, drift up and back, and fade over about two seconds.
 */
const MAX_SEGMENTS = 900;
const MARK_WIDTH = 0.24;
const MIN_STEP = 0.35; // metres between mark points
const MAX_PUFFS = 220;

interface Track {
  x: number;
  y: number;
  z: number;
  /** Was the tyre marking last frame? (a gap starts a new strip) */
  on: boolean;
}

export class TyreFx {
  readonly group = new THREE.Group();
  private readonly marks: THREE.Mesh;
  private readonly markPos: Float32Array;
  private readonly markAlpha: Float32Array;
  private nextSegment = 0;
  private readonly tracks: Track[] = [
    { x: 0, y: 0, z: 0, on: false },
    { x: 0, y: 0, z: 0, on: false },
  ];

  private readonly smoke: THREE.Points;
  private readonly puffPos: Float32Array;
  private readonly puffData: Float32Array; // age, life, size, seed
  private readonly puffVel: Float32Array;
  private nextPuff = 0;
  private emitCarry = 0;

  constructor() {
    // ---- Skid marks
    const geometry = new THREE.BufferGeometry();
    this.markPos = new Float32Array(MAX_SEGMENTS * 4 * 3);
    this.markAlpha = new Float32Array(MAX_SEGMENTS * 4);
    const index = new Uint16Array(MAX_SEGMENTS * 6);
    for (let s = 0; s < MAX_SEGMENTS; s++) {
      const v = s * 4;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], s * 6);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.markAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const markMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = aAlpha;
          vWorld = position;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          // Rubber is not even: a little grain along the strip.
          float grain = 0.75 + 0.25 * h(floor(vWorld.xz * 18.0));
          gl_FragColor = vec4(vec3(0.035, 0.034, 0.033), vAlpha * grain);
          #include <fog_fragment>
        }`,
    });
    this.marks = new THREE.Mesh(geometry, markMaterial);
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    this.group.add(this.marks);

    // ---- Smoke
    const smokeGeometry = new THREE.BufferGeometry();
    this.puffPos = new Float32Array(MAX_PUFFS * 3);
    this.puffData = new Float32Array(MAX_PUFFS * 4);
    this.puffVel = new Float32Array(MAX_PUFFS * 3);
    for (let i = 0; i < MAX_PUFFS; i++) this.puffData[i * 4 + 1] = 1; // life 1, age 0 → set dead below
    for (let i = 0; i < MAX_PUFFS; i++) this.puffData[i * 4] = 99;
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(this.puffPos, 3).setUsage(THREE.DynamicDrawUsage));
    smokeGeometry.setAttribute('aData', new THREE.BufferAttribute(this.puffData, 4).setUsage(THREE.DynamicDrawUsage));
    const smokeMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: /* glsl */ `
        attribute vec4 aData; // age, life, size, seed
        uniform float uScale;
        varying float vFade;
        varying float vSeed;
        #include <fog_pars_vertex>
        void main() {
          float t = clamp(aData.x / aData.y, 0.0, 1.0);
          vFade = (1.0 - t) * smoothstep(0.0, 0.08, t) * step(aData.x, aData.y);
          vSeed = aData.w;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float size = aData.z * (0.5 + 2.6 * sqrt(t));
          gl_PointSize = size * uScale / max(0.5, -mvPosition.z);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying float vFade;
        varying float vSeed;
        #include <fog_pars_fragment>
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = length(q);
          // A soft, lumpy puff: radial falloff broken up by noise.
          float lump = n(q * 5.0 + vSeed * 13.0) * 0.5 + n(q * 11.0 - vSeed * 7.0) * 0.25;
          float a = smoothstep(0.5, 0.05, r + (lump - 0.35) * 0.35) * vFade * 0.42;
          if (a < 0.004) discard;
          vec3 c = mix(vec3(0.62, 0.62, 0.63), vec3(0.92, 0.92, 0.93), 0.6 - q.y) * uLight;
          gl_FragColor = vec4(c, a);
          #include <fog_fragment>
        }`,
    });
    this.smoke = new THREE.Points(smokeGeometry, smokeMaterial);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 2;
    this.group.add(this.smoke);
  }

  /** Point size scale: call when the screen size or field of view changes. */
  setViewport(heightPx: number, fovDeg: number): void {
    (this.smoke.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** Smoke picks up the daylight colour (darker at night). */
  setLight(color: THREE.Color): void {
    (this.smoke.material as THREE.ShaderMaterial).uniforms.uLight.value.copy(color);
  }

  /**
   * One frame. `wheels` = world positions of the rear tyres (one for bikes), `amount` = how hard
   * they are sliding (0–1), `vx, vz` = the vehicle's velocity (smoke is left behind in the air).
   */
  update(dt: number, wheels: { x: number; y: number; z: number }[], amount: number, vx: number, vz: number): void {
    const marking = amount > 0.12;
    let marksChanged = false;
    wheels.forEach((w, i) => {
      const track = this.tracks[i];
      if (!track) return;
      if (!marking) {
        track.on = false;
        return;
      }
      if (!track.on) {
        Object.assign(track, { x: w.x, y: w.y, z: w.z, on: true });
        return;
      }
      const dx = w.x - track.x;
      const dz = w.z - track.z;
      const step = Math.hypot(dx, dz);
      if (step < MIN_STEP) return;
      if (step > 6) {
        Object.assign(track, { x: w.x, y: w.y, z: w.z });
        return;
      }
      // A quad from the last point to this one.
      const px = (-dz / step) * MARK_WIDTH * 0.5;
      const pz = (dx / step) * MARK_WIDTH * 0.5;
      const s = this.nextSegment;
      this.nextSegment = (this.nextSegment + 1) % MAX_SEGMENTS;
      const lift = 0.025;
      this.markPos.set(
        [track.x - px, track.y + lift, track.z - pz, track.x + px, track.y + lift, track.z + pz, w.x + px, w.y + lift, w.z + pz, w.x - px, w.y + lift, w.z - pz],
        s * 12,
      );
      const alpha = Math.min(0.85, 0.25 + amount * 0.7);
      this.markAlpha.set([alpha, alpha, alpha, alpha], s * 4);
      Object.assign(track, { x: w.x, y: w.y, z: w.z });
      marksChanged = true;
    });
    if (marksChanged) {
      const g = this.marks.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    }

    // Smoke: new puffs at the tyres, more the harder they slide.
    if (amount > 0.2 && wheels.length > 0) {
      this.emitCarry += dt * (10 + 55 * amount) * wheels.length;
      while (this.emitCarry >= 1) {
        this.emitCarry -= 1;
        const w = wheels[this.nextPuff % wheels.length];
        const i = this.nextPuff;
        this.nextPuff = (this.nextPuff + 1) % MAX_PUFFS;
        this.puffPos.set([w.x + (Math.random() - 0.5) * 0.3, w.y + 0.25, w.z + (Math.random() - 0.5) * 0.3], i * 3);
        // A little of the car's speed, plus a spread and a slow rise.
        this.puffVel.set([vx * 0.12 + (Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 0.7, vz * 0.12 + (Math.random() - 0.5) * 1.6], i * 3);
        this.puffData.set([0, 1.6 + Math.random() * 1.0, 0.7 + amount * 0.9, Math.random()], i * 4);
      }
    } else this.emitCarry = 0;
    let alive = false;
    for (let i = 0; i < MAX_PUFFS; i++) {
      const d = i * 4;
      if (this.puffData[d] > this.puffData[d + 1]) continue;
      alive = true;
      this.puffData[d] += dt;
      const drag = Math.exp(-dt * 1.4);
      this.puffVel[i * 3] *= drag;
      this.puffVel[i * 3 + 2] *= drag;
      this.puffVel[i * 3 + 1] = this.puffVel[i * 3 + 1] * drag + 0.25 * dt;
      this.puffPos[i * 3] += this.puffVel[i * 3] * dt;
      this.puffPos[i * 3 + 1] += this.puffVel[i * 3 + 1] * dt;
      this.puffPos[i * 3 + 2] += this.puffVel[i * 3 + 2] * dt;
    }
    if (alive || amount > 0.2) {
      const g = this.smoke.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aData') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.marks.geometry.dispose();
    (this.marks.material as THREE.Material).dispose();
    this.smoke.geometry.dispose();
    (this.smoke.material as THREE.Material).dispose();
  }
}
