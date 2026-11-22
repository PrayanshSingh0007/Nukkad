import * as THREE from 'three';

/**
 * Weather from the wall clock, so everyone sees the same sky: time is cut into 7-minute
 * stretches and about one in three is rainy (some drizzle, some downpour), each fading in over
 * a minute and a half from the one before.
 */
const SLOT_MS = 7 * 60_000;
const FADE_MS = 90_000;

function slotRain(slot: number): number {
  const h = (n: number): number => {
    const x = Math.sin(slot * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return h(1) < 0.34 ? 0.45 + 0.55 * h(2) : 0;
}

/** How hard it rains at this moment, 0 (dry) to 1 (downpour). */
export function rainAt(ms: number): number {
  const slot = Math.floor(ms / SLOT_MS);
  const into = ms - slot * SLOT_MS;
  const t = Math.min(1, into / FADE_MS);
  return THREE.MathUtils.lerp(slotRain(slot - 1), slotRain(slot), t * t * (3 - 2 * t));
}

const DROPS = 7000;
const BOX = new THREE.Vector3(34, 22, 34);

/**
 * Falling rain around the camera: thin streaks (lines, one draw call) that fall in a box
 * following the camera, slanted by the wind. The drops stay put in the world as you move and
 * wrap around at the box's edges, so the rain never slides with you. The heavier the rain, the
 * more of them are drawn.
 */
export class RainView {
  readonly lines: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const drop = new Float32Array(DROPS * 2 * 4);
    const end = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const values = [Math.random(), Math.random(), Math.random(), Math.random()];
      drop.set(values, i * 8);
      drop.set(values, i * 8 + 4);
      end[i * 2 + 1] = 1;
    }
    const geometry = new THREE.BufferGeometry();
    // Positions are made in the shader; this attribute only gives three.js a vertex count.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
    geometry.setAttribute('aDrop', new THREE.BufferAttribute(drop, 4));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uRain: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2(1.2, 0.6) },
        uColor: { value: new THREE.Color(0.8, 0.82, 0.86) },
        uBox: { value: BOX },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uRain;
        uniform vec3 uCenter;
        uniform vec2 uWind;
        uniform vec3 uBox;
        attribute vec4 aDrop; // x, z place in the box, fall phase, speed / which drops show
        attribute float aEnd;  // 0 = head of the streak, 1 = tail
        varying float vAlpha;
        void main() {
          float speed = 8.5 + aDrop.w * 4.0;
          vec3 p;
          p.x = uCenter.x + (fract(aDrop.x - uCenter.x / uBox.x) - 0.5) * uBox.x;
          p.z = uCenter.z + (fract(aDrop.y * 7.31 - uCenter.z / uBox.z) - 0.5) * uBox.z;
          float fall = fract(aDrop.z - uTime * speed / uBox.y);
          p.y = uCenter.y - uBox.y * 0.35 + fall * uBox.y;
          vec3 v = normalize(vec3(uWind.x, -speed, uWind.y));
          p -= v * aEnd * (0.7 + speed * 0.05);
          // Lighter rain draws fewer drops (a stable subset, so nothing flickers).
          float shown = step(fract(aDrop.w * 13.7 + aDrop.x * 3.1), uRain);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vAlpha = shown * smoothstep(0.5, 2.0, d) * (1.0 - smoothstep(12.0, 17.0, d)) * (1.0 - aEnd * 0.7);
          gl_Position = projectionMatrix * mv;
          if (shown < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(uColor, vAlpha * 0.85);
        }`,
    });
    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    this.lines.visible = false;
  }

  /** `rain` 0–1; `light` = the sky's brightness (rain is lit by it). */
  update(dt: number, rain: number, camera: THREE.Camera, light: THREE.Color): void {
    this.lines.visible = rain > 0.02;
    if (!this.lines.visible) return;
    const u = this.material.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 1000;
    u.uRain.value = rain;
    u.uCenter.value.copy(camera.position);
    u.uColor.value.copy(light).multiplyScalar(1.3).addScalar(0.2);
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}

const SPLASHES = 700;
const SPLASH_RADIUS_M = 22;

/**
 * Raindrops hitting the ground around you: tiny crowns of droplets that jump up and out and a
 * ring that spreads, each gone in a third of a second, scattered over the ground near the
 * player (about one per square metre per second in a downpour). One draw call of points.
 */
export class RainSplashes {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly position: Float32Array;
  /** Per splash: age (s), life (s), seed. */
  private readonly data: Float32Array;
  private carry = 0;
  private next = 0;

  constructor() {
    this.position = new Float32Array(SPLASHES * 3);
    this.data = new Float32Array(SPLASHES * 3);
    for (let i = 0; i < SPLASHES; i++) this.data.set([1, 0, Math.random()], i * 3); // all dead
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSplash', new THREE.BufferAttribute(this.data, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color(0.8, 0.82, 0.86) }, uRain: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 aSplash;
        varying float vT;
        varying float vSeed;
        void main() {
          vT = aSplash.y > 0.0 ? aSplash.x / aSplash.y : 1.0;
          vSeed = aSplash.z;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * view;
          // Sprites 0.34 m across; nothing for dead splashes.
          gl_PointSize = vT >= 1.0 ? 0.0 : uScale * 0.34 / max(0.5, -view.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uRain;
        varying float vT;
        varying float vSeed;
        void main() {
          // Sprite space: x −0.5…0.5, y 0 at the ground (bottom) … 1 at the top.
          vec2 q = vec2(gl_PointCoord.x - 0.5, 1.0 - gl_PointCoord.y);
          float t = vT;
          float a = 0.0;
          // A ring on the ground, seen at a slant (flat ellipse), spreading out.
          vec2 e = vec2(q.x / (0.12 + 0.36 * t), (q.y - 0.12) / (0.03 + 0.08 * t));
          a += smoothstep(0.25, 0.0, abs(length(e) - 1.0)) * (1.0 - t) * 0.4;
          // A few droplets jumping up and out at random, then falling back.
          for (int k = 0; k < 4; k++) {
            float r1 = fract(sin(vSeed * 91.7 + float(k) * 17.3) * 4375.85);
            float r2 = fract(sin(vSeed * 37.1 + float(k) * 53.9) * 2731.17);
            if (r2 < 0.25) continue; // not every crown has four
            float side = (r1 - 0.5) * 2.0;
            vec2 drop = vec2(side * 0.34 * t, 0.12 + (0.25 + 0.75 * r2) * t * (1.0 - t) * 1.7);
            a += smoothstep(0.04, 0.012, length(q - drop)) * (1.0 - t) * 0.8;
          }
          a *= uRain;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, min(1.0, a) * 0.85);
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
    // The ambient-occlusion pass hides points already (they never get dark rims).
  }

  /** Sprite size: call when the screen size or field of view changes. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * rain 0–1; (x, z) = where the player is; groundAt = the ground's height there (splashes sit on
   * it); light = the sky's brightness.
   */
  update(dt: number, rain: number, x: number, z: number, groundAt: (x: number, z: number) => number, light: THREE.Color): void {
    const raining = rain > 0.05;
    if (raining) {
      this.carry += dt * 1500 * rain;
      while (this.carry >= 1) {
        this.carry -= 1;
        const i = this.next;
        this.next = (this.next + 1) % SPLASHES;
        // Evenly over a disc around the player.
        const r = Math.sqrt(Math.random()) * SPLASH_RADIUS_M;
        const angle = Math.random() * Math.PI * 2;
        const sx = x + Math.cos(angle) * r;
        const sz = z + Math.sin(angle) * r;
        this.position.set([sx, groundAt(sx, sz) + 0.02, sz], i * 3);
        this.data.set([0, 0.22 + Math.random() * 0.14, Math.random()], i * 3);
      }
    } else this.carry = 0;
    let alive = false;
    for (let i = 0; i < SPLASHES; i++) {
      if (this.data[i * 3] >= this.data[i * 3 + 1]) continue;
      this.data[i * 3] += dt;
      alive = true;
    }
    this.points.visible = alive;
    if (!alive) return;
    const u = this.material.uniforms;
    u.uRain.value = 0.35 + 0.65 * rain;
    u.uColor.value.copy(light).multiplyScalar(1.2).addScalar(0.25);
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSplash') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
