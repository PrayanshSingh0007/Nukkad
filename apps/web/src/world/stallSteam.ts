import * as THREE from 'three';

/**
 * Steam and cooking smoke over street carts: about four carts in ten have a steel pot on the
 * counter (boiled peanuts, corn, chai) sending up soft wisps that rise, drift with the air,
 * swell and fade over a few seconds. Worked out entirely on the graphics card (one draw call of points; the
 * ambient-occlusion pass skips points). Lit by the day, and warm from the stall's bulb at night.
 */
const PUFFS = 12;
const LIFE_S = 3.4;

export class StallSteam {
  readonly points: THREE.Points;
  /** The steaming pots on the counters (one draw call). */
  readonly pots: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;

  /** stalls: [x, y, z, angle] per stall (the customer side faces the street). */
  constructor(stalls: Float32Array, time: { value: number }) {
    const spots: number[] = [];
    const seeds: number[] = [];
    const potAt: number[] = [];
    for (let i = 0; i < stalls.length / 4; i++) {
      const [x, y, z, angle] = [stalls[i * 4], stalls[i * 4 + 1], stalls[i * 4 + 2], stalls[i * 4 + 3]];
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      const pick = h - Math.floor(h);
      if (pick > 0.42) continue;
      // The kettle or pan sits towards the back of the counter.
      const back = 0.25;
      const ex = x + Math.sin(angle) * back;
      const ez = z + Math.cos(angle) * back;
      potAt.push(ex, y + 1.17, ez);
      for (let k = 0; k < PUFFS; k++) {
        spots.push(ex, y + 1.43, ez);
        seeds.push(k / PUFFS + pick * 3.1, Math.random(), pick < 0.18 ? 1 : 0); // phase, wobble, smoke (frying) or steam
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(spots, 3));
    geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 3));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: time, uScale: { value: 800 }, uLight: { value: new THREE.Color(0.9, 0.9, 0.92) } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uScale;
        attribute vec3 aSeed;
        varying float vAlpha;
        varying float vSeed;
        varying float vSmoke;
        void main() {
          float t = fract(uTime / ${LIFE_S.toFixed(1)} + aSeed.x);
          float w = aSeed.y * 6.283;
          // Rising, curling and drifting downwind as it goes.
          vec3 p = position + vec3(sin(w + t * 3.0) * 0.14 * t + t * 0.5, t * 1.6, cos(w + t * 2.3) * 0.14 * t + t * 0.25);
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * view;
          float d = -view.z;
          vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - t) * (1.0 - smoothstep(45.0, 70.0, d));
          vSeed = aSeed.y;
          vSmoke = aSeed.z;
          gl_PointSize = vAlpha < 0.003 ? 0.0 : uScale * (0.2 + 0.7 * t) / max(0.5, d);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying float vAlpha;
        varying float vSeed;
        varying float vSmoke;
        float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float lump = sNoise(q * 4.0 + vSeed * 17.0) * 0.6 + sNoise(q * 9.0 - vSeed * 11.0) * 0.4;
          float a = smoothstep(0.5, 0.0, length(q) + (lump - 0.45) * 0.35) * vAlpha * (vSmoke > 0.5 ? 0.4 : 0.34);
          if (a < 0.004) discard;
          // Steam is white; frying smoke a little blue-grey.
          vec3 c = uLight * (vSmoke > 0.5 ? vec3(0.78, 0.8, 0.86) : vec3(1.0));
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    // A steel pot with a lip and a lid ajar on each steaming cart.
    const pot = mergePot();
    this.pots = new THREE.InstancedMesh(pot, new THREE.MeshStandardMaterial({ color: 0xaeb3ba, metalness: 0.3, roughness: 0.4 }), Math.max(1, potAt.length / 3));
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < potAt.length / 3; i++) this.pots.setMatrixAt(i, matrix.makeTranslation(potAt[i * 3], potAt[i * 3 + 1], potAt[i * 3 + 2]));
    this.pots.count = potAt.length / 3;
    this.pots.castShadow = true;
  }

  /** The light the steam catches (daylight, or warm bulbs at night). */
  setLight(colour: THREE.Color): void {
    this.material.uniforms.uLight.value.copy(colour);
  }

  /** Sprite size: call when the screen size or field of view changes. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
    this.pots.geometry.dispose();
    (this.pots.material as THREE.Material).dispose();
    this.pots.removeFromParent();
  }
}

/** A pot 0.3 m across and 0.24 m tall, its base at the origin, with a lip and a lid. */
function mergePot(): THREE.BufferGeometry {
  const parts = [
    new THREE.CylinderGeometry(0.15, 0.13, 0.24, 14, 1, false).translate(0, 0.12, 0),
    new THREE.TorusGeometry(0.15, 0.012, 4, 14).rotateX(Math.PI / 2).translate(0, 0.24, 0),
    new THREE.CylinderGeometry(0.14, 0.15, 0.03, 14).translate(0.03, 0.26, 0).rotateZ(0.08),
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  for (const part of parts) {
    const flat = part.index ? part.toNonIndexed() : part;
    positions.push(...(flat.getAttribute('position').array as Float32Array));
    normals.push(...(flat.getAttribute('normal').array as Float32Array));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}
