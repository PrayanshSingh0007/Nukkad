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
