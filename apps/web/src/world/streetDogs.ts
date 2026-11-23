import * as THREE from 'three';
import { type TerrainGrid, heightAt } from '@nukkad/worldgen';

/**
 * Street dogs, as on every Bengaluru street: lean Indian pariah dogs (tan, fawn, ginger, brown,
 * black, some with white chests and socks) living round the bus stops and food carts. Most sleep
 * curled up on the pavement and lift their heads as you walk past; some wander up and down
 * their patch, sniffing, stopping to look at you and wagging. Come at them fast (running, on a
 * vehicle, the horn) and they get up and trot off a few metres, then settle again. In the rain
 * they lie down.
 *
 * Two instanced meshes (standing, curled up) built here from simple shapes; legs, head, tail and
 * breathing move in the vertex shader. Only dogs near you are drawn and updated.
 */
const NEAR_M = 70;
const COATS = [0xb3854f, 0xc49a62, 0xa15f2c, 0x5a3c26, 0x1f1b18, 0xd2c09c, 0x7b6852, 0xb3854f, 0xc49a62];

type Mode = 'sleep' | 'rest' | 'stand' | 'sniff' | 'walk' | 'flee';

interface Dog {
  homeX: number;
  homeZ: number;
  /** Along the street, and away from the road (unit vectors): where the dog may go. */
  alongX: number;
  alongZ: number;
  awayX: number;
  awayZ: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  mode: Mode;
  timer: number;
  tx: number;
  tz: number;
  speed: number;
  /** Gait cycle (0–1 repeating), how much it is trotting (0–1), head pitch, tail wag. */
  phase: number;
  gait: number;
  pitch: number;
  wag: number;
  coat: THREE.Color;
  white: number;
  wanders: boolean;
  seed: number;
}

// ---------- the shapes ----------

interface Piece {
  geometry: THREE.BufferGeometry;
  part: number;
  pivot: [number, number];
  white: WhiteFn;
}

const UP = new THREE.Vector3(0, 1, 0);

function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number, seg = 12): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7))).scale(rx, ry, rz).translate(x, y, z);
}

/** A tapered limb from a to b (radius ra at a, rb at b), with a round joint at a. */
function limb(a: [number, number, number], b: [number, number, number], ra: number, rb: number): THREE.BufferGeometry[] {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const length = dir.length();
  const cylinder = new THREE.CylinderGeometry(rb, ra, length, 8, 1, true);
  cylinder.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  cylinder.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return [cylinder, ellipsoid(a[0], a[1], a[2], ra, ra, ra, 8)];
}

function ear(x: number, y: number, z: number, tiltZ: number, tiltX: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(0.03, 0.085, 6).scale(1, 1, 0.45).rotateX(tiltX).rotateZ(tiltZ).translate(x, y, z);
}

function tube(points: [number, number, number][], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, 12, radius, 6, false);
}

type WhiteFn = (x: number, y: number, z: number) => number;
const none: WhiteFn = () => 0;
const always = (value: number): WhiteFn => () => value;

function build(pieces: Piece[]): THREE.BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const part: number[] = [];
  const pivot: number[] = [];
  const white: number[] = [];
  for (const piece of pieces) {
    const flat = piece.geometry.index ? piece.geometry.toNonIndexed() : piece.geometry;
    const p = flat.getAttribute('position');
    const n = flat.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      position.push(x, y, z);
      normal.push(n.getX(i), n.getY(i), n.getZ(i));
      part.push(piece.part);
      pivot.push(piece.pivot[0], piece.pivot[1]);
      white.push(piece.white(x, y, z));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geometry.setAttribute('aPivot', new THREE.Float32BufferAttribute(pivot, 2));
  geometry.setAttribute('aWhite', new THREE.Float32BufferAttribute(white, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Parts: 0 body, 1–4 legs (front left, front right, back left, back right), 5 head and neck, 6 tail. */
function standingDog(): THREE.BufferGeometry {
  // An Indian pariah dog: about half a metre at the shoulder, a deep chest, a tucked-up waist,
  // a wedge-shaped head on a short thick neck, upright ears and a tail curled over the back.
  const head = (geometry: THREE.BufferGeometry, white: WhiteFn = none): Piece => ({ geometry, part: 5, pivot: [0.5, -0.27], white });
  const body = (geometry: THREE.BufferGeometry, white: WhiteFn = none): Piece => ({ geometry, part: 0, pivot: [0, 0], white });
  const pieces: Piece[] = [
    body(ellipsoid(0, 0.43, 0, 0.118, 0.13, 0.3, 16), (_x, y) => (y < 0.33 ? 0.55 : 0)),
    body(ellipsoid(0, 0.41, -0.17, 0.13, 0.175, 0.17, 14), (_x, y, z) => (y < 0.3 ? 0.45 : y < 0.43 && z < -0.25 ? 0.3 : 0)),
    body(ellipsoid(-0.06, 0.44, -0.19, 0.05, 0.1, 0.08, 10)),
    body(ellipsoid(0.06, 0.44, -0.19, 0.05, 0.1, 0.08, 10)),
    body(ellipsoid(0, 0.44, 0.2, 0.115, 0.13, 0.15, 12)),
    // Neck: short and thick, with a ruff of fur where it meets the shoulders.
    ...limb([0, 0.5, -0.27], [0, 0.62, -0.37], 0.085, 0.07).map((g) => head(g, (_x, y, z) => (y < 0.56 && z < -0.32 ? 0.35 : 0))),
    head(ellipsoid(0, 0.53, -0.3, 0.088, 0.1, 0.1, 12), (_x, y, z) => (y < 0.5 && z < -0.33 ? 0.35 : 0)),
    // Head: a broad skull and cheeks narrowing to the muzzle.
    head(ellipsoid(0, 0.665, -0.42, 0.088, 0.085, 0.105, 14)),
    head(ellipsoid(0, 0.635, -0.455, 0.078, 0.06, 0.08, 12), (_x, y) => (y < 0.61 ? 0.35 : 0)),
    ...limb([0, 0.645, -0.49], [0, 0.618, -0.6], 0.052, 0.034).map((g) => head(g, (_x, y) => (y < 0.62 ? 0.4 : 0.15))),
    head(ellipsoid(0, 0.6, -0.535, 0.04, 0.026, 0.06, 10), always(0.45)),
    head(ellipsoid(0, 0.622, -0.604, 0.024, 0.019, 0.017, 8), always(-1)),
    head(ellipsoid(-0.041, 0.685, -0.5, 0.013, 0.012, 0.01, 6), always(-1)),
    head(ellipsoid(0.041, 0.685, -0.5, 0.013, 0.012, 0.01, 6), always(-1)),
    head(ear(-0.05, 0.765, -0.405, 0.3, -0.12)),
    head(ear(0.05, 0.765, -0.405, -0.3, -0.12)),
  ];
  // Legs: front pair under the chest, back pair with muscled thighs and the hock bent back.
  for (const [side, partId] of [
    [-0.068, 1],
    [0.068, 2],
  ] as const) {
    const leg = (geometry: THREE.BufferGeometry, white: WhiteFn = none): Piece => ({ geometry, part: partId, pivot: [0.42, -0.2], white });
    pieces.push(...limb([side, 0.42, -0.19], [side, 0.19, -0.21], 0.05, 0.034).map((g) => leg(g)));
    pieces.push(...limb([side, 0.19, -0.21], [side, 0.035, -0.22], 0.028, 0.023).map((g) => leg(g, always(0.18))));
    pieces.push(leg(ellipsoid(side, 0.021, -0.24, 0.03, 0.021, 0.04, 8), always(0.6)));
  }
  for (const [side, partId] of [
    [-0.072, 3],
    [0.072, 4],
  ] as const) {
    const leg = (geometry: THREE.BufferGeometry, white: WhiteFn = none): Piece => ({ geometry, part: partId, pivot: [0.44, 0.22], white });
    pieces.push(leg(ellipsoid(side * 1.1, 0.38, 0.23, 0.055, 0.1, 0.085, 10)));
    pieces.push(...limb([side, 0.44, 0.2], [side, 0.23, 0.29], 0.07, 0.038).map((g) => leg(g)));
    pieces.push(...limb([side, 0.23, 0.29], [side, 0.035, 0.25], 0.028, 0.022).map((g) => leg(g, always(0.18))));
    pieces.push(leg(ellipsoid(side, 0.021, 0.235, 0.029, 0.021, 0.038, 8), always(0.6)));
  }
  // The tail curls up over the back, its tip often pale.
  pieces.push({ geometry: tube([[0, 0.5, 0.33], [0, 0.6, 0.42], [0, 0.71, 0.41], [0, 0.75, 0.33], [0, 0.715, 0.26]], 0.03), part: 6, pivot: [0.52, 0.34], white: (_x, y, z) => (z < 0.3 && y < 0.74 ? 0.6 : 0) });
  return build(pieces);
}

/** Curled up asleep: chin on the front paws, back legs tucked, tail round the side. Parts: 0 body, 5 head, 6 tail. */
function lyingDog(): THREE.BufferGeometry {
  const head = (geometry: THREE.BufferGeometry, white: WhiteFn = none): Piece => ({ geometry, part: 5, pivot: [0.17, -0.26], white });
  const body = (geometry: THREE.BufferGeometry, white: WhiteFn = none): Piece => ({ geometry, part: 0, pivot: [0, 0], white });
  const pieces: Piece[] = [
    body(ellipsoid(0.02, 0.15, 0, 0.165, 0.15, 0.33, 16).rotateY(0.12)),
    body(ellipsoid(-0.03, 0.15, -0.2, 0.145, 0.135, 0.15, 12), (_x, y, z) => (y < 0.1 && z < -0.12 ? 0.4 : 0)),
    body(ellipsoid(0.07, 0.14, 0.2, 0.155, 0.135, 0.15, 12)),
    body(ellipsoid(0.17, 0.075, 0.12, 0.06, 0.06, 0.15, 8)),
    body(ellipsoid(0.15, 0.025, -0.03, 0.029, 0.021, 0.045, 8), always(0.6)),
    ...limb([-0.08, 0.05, -0.22], [-0.1, 0.03, -0.44], 0.034, 0.026).map((g) => body(g, always(0.18))),
    ...limb([0.04, 0.05, -0.24], [0.02, 0.03, -0.46], 0.034, 0.026).map((g) => body(g, always(0.18))),
    body(ellipsoid(-0.1, 0.022, -0.465, 0.029, 0.021, 0.04, 8), always(0.6)),
    body(ellipsoid(0.02, 0.022, -0.485, 0.029, 0.021, 0.04, 8), always(0.6)),
    ...limb([-0.03, 0.17, -0.26], [-0.06, 0.155, -0.35], 0.08, 0.068).map((g) => head(g, (_x, y) => (y < 0.12 ? 0.35 : 0))),
    head(ellipsoid(-0.066, 0.128, -0.41, 0.088, 0.083, 0.1, 14)),
    head(ellipsoid(-0.07, 0.102, -0.44, 0.076, 0.056, 0.075, 12), (_x, y) => (y < 0.08 ? 0.35 : 0)),
    ...limb([-0.072, 0.108, -0.48], [-0.078, 0.088, -0.57], 0.05, 0.033).map((g) => head(g, (_x, y) => (y < 0.09 ? 0.4 : 0.15))),
    head(ellipsoid(-0.079, 0.09, -0.575, 0.023, 0.018, 0.016, 8), always(-1)),
    head(ear(-0.115, 0.19, -0.38, 0.5, 1.0)),
    head(ear(-0.02, 0.19, -0.38, -0.5, 1.0)),
  ];
  pieces.push({ geometry: tube([[0.12, 0.1, 0.32], [0.02, 0.055, 0.42], [-0.13, 0.04, 0.38], [-0.2, 0.04, 0.26]], 0.028), part: 6, pivot: [0.08, 0.33], white: (x) => (x < -0.16 ? 0.6 : 0) });
  return build(pieces);
}

// ---------- drawing ----------

const time = { value: 0 };
/** 0–1: how wet their fur is (darker in the rain). */
const wet = { value: 0 };

function dogMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDogTime = time;
    shader.uniforms.uDogWet = wet;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDogTime;
        attribute float aPart;
        attribute vec2 aPivot;
        attribute float aWhite;
        attribute vec4 aAnim;
        attribute float aCoatW;
        varying float vDogWhite;
        varying float vDogCoatW;
        varying vec3 vDogPos;
        varying vec3 vDogN;
        mat3 dogRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
        mat3 dogRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
        // aAnim: gait phase (0–1), trotting (0–1), head pitch (rad, + up), tail wag (0–1).
        mat3 dogPose() {
          float phase = aAnim.x * 6.2832;
          if (aPart > 0.5 && aPart < 4.5) {
            // Trot: front left with back right, front right with back left.
            float off = (aPart < 1.5 || aPart > 3.5) ? 0.0 : 3.1416;
            return dogRotX(sin(phase + off) * 0.6 * aAnim.y);
          }
          if (aPart > 4.5 && aPart < 5.5) return dogRotX(aAnim.z + 0.04 * aAnim.y * sin(phase * 2.0));
          if (aPart > 5.5) return dogRotY(sin(uDogTime * 9.0 + aAnim.x * 40.0) * 0.5 * aAnim.w);
          return mat3(1.0);
        }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        objectNormal = dogPose() * objectNormal;
        vDogN = objectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 pivot = vec3(0.0, aPivot.x, aPivot.y);
          transformed = dogPose() * (transformed - pivot) + pivot;
          // Breathing: the ribs swell and settle (slower asleep); a little bob in the trot.
          if (aPart < 0.5) {
            float breath = 1.0 + 0.028 * sin(uDogTime * (2.0 + 1.5 * aAnim.y) + aAnim.x * 6.283) * (1.0 - 0.6 * aAnim.y);
            transformed.x *= breath;
            transformed.y = mix(transformed.y, transformed.y * breath, 0.5);
          }
          transformed.y += aAnim.y * 0.018 * sin(aAnim.x * 12.566);
          vDogWhite = aWhite;
          vDogCoatW = aCoatW;
          vDogPos = transformed;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vDogWhite;
        varying float vDogCoatW;
        varying vec3 vDogPos;
        varying vec3 vDogN;
        uniform float uDogWet;
        float dogHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float dogNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dogHash(i), dogHash(i + vec3(1, 0, 0)), f.x), mix(dogHash(i + vec3(0, 1, 0)), dogHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(dogHash(i + vec3(0, 0, 1)), dogHash(i + vec3(1, 0, 1)), f.x), mix(dogHash(i + vec3(0, 1, 1)), dogHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vDogN);
          vec3 coat = diffuseColor.rgb;
          // Fur, not plastic: a darker saddle along the back, a paler belly and throat, uneven
          // patches, and fine streaks running along the body.
          coat *= mix(1.0, 0.68, smoothstep(0.25, 0.95, n.y));
          coat = mix(coat, coat * 1.3 + 0.015, smoothstep(0.15, 0.85, -n.y) * 0.65);
          coat *= 0.86 + 0.28 * dogNoise(vDogPos * 9.0);
          coat *= 0.93 + 0.14 * dogNoise(vec3(vDogPos.x * 70.0, vDogPos.y * 70.0, vDogPos.z * 12.0));
          // Creamy (not bright white) chest, socks, muzzle and tail tip on some dogs.
          float markings = vDogCoatW > 0.01 ? smoothstep(1.0 - vDogCoatW - 0.07, 1.0 - vDogCoatW + 0.07, vDogWhite) : 0.0;
          vec3 cream = vec3(0.56, 0.47, 0.33) * (0.9 + 0.2 * dogNoise(vDogPos * 14.0));
          diffuseColor.rgb = mix(coat, cream, markings * 0.9);
          // A dark nose and eyes on every dog.
          // Wet fur goes darker.
          diffuseColor.rgb *= 1.0 - 0.3 * uDogWet;
          if (vDogWhite < -0.5) diffuseColor.rgb = vec3(0.018, 0.016, 0.015);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Soft fur catches the light at its edges.
        diffuseColor.rgb *= 1.0 + 0.4 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0) * step(-0.5, vDogWhite);`,
      );
  };
  material.customProgramCacheKey = () => 'nukkad-street-dog-2';
  return material;
}

class DogMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly coatW: THREE.InstancedBufferAttribute;
  private used = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.coatW = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aAnim', this.anim);
    geometry.setAttribute('aCoatW', this.coatW);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.used = 0;
  }

  add(dog: Dog): void {
    const i = this.used++;
    this.rotation.setFromAxisAngle(UP, dog.heading);
    this.mesh.setMatrixAt(i, this.matrix.compose(this.position.set(dog.x, dog.y, dog.z), this.rotation, this.one));
    this.mesh.setColorAt(i, dog.coat);
    this.anim.setXYZW(i, dog.phase, dog.gait, dog.pitch, dog.wag);
    this.coatW.setX(i, dog.white);
  }

  commit(): void {
    this.mesh.count = this.used;
    this.mesh.visible = this.used > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.coatW.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

// ---------- behaviour ----------

export class StreetDogs {
  readonly group = new THREE.Group();
  private readonly dogs: Dog[] = [];
  private readonly standing: DogMesh;
  private readonly lying: DogMesh;
  private readonly material = dogMaterial();
  private readonly terrain: TerrainGrid;
  private rain = 0;

  /**
   * spots: [x, y, z, awayX, awayZ, kind] per place (kind 0 a bus stop, 1 a cart, 2 a bench), with the
   * direction away from the road. Dogs live at about half of them: beside a shelter (not in
   * it), or between a cart and its shopfront.
   */
  constructor(spots: number[], terrain: TerrainGrid) {
    this.terrain = terrain;
    for (let s = 0; s < spots.length; s += 6) {
      const [sx, , sz, ax, az, kind] = spots.slice(s, s + 6);
      const r = (salt: number): number => {
        const v = Math.sin(sx * 12.9898 + sz * 78.233 + salt * 37.719) * 43758.5453;
        return v - Math.floor(v);
      };
      if (r(1) > (kind === 2 ? 0.3 : 0.5)) continue;
      const count = r(2) < 0.25 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const side = r(3 + k) < 0.5 ? -1 : 1;
        const along = kind === 0 ? side * (2.6 + r(4 + k) * 2) : kind === 1 ? (r(4 + k) - 0.5) * 5 : (r(4 + k) - 0.5) * 2.4;
        const away = kind === 0 ? 0.3 + r(5 + k) * 1.1 : kind === 1 ? 0.9 + r(5 + k) * 0.7 : 0.8 + r(5 + k) * 0.6;
        const x = sx - az * along + ax * away;
        const z = sz + ax * along + az * away;
        const coat = new THREE.Color(COATS[Math.floor(r(7 + k) * COATS.length)]);
        // A little variety in every coat.
        coat.multiplyScalar(0.85 + r(9 + k) * 0.3);
        const wanders = r(11 + k) < 0.4;
        this.dogs.push({
          homeX: x,
          homeZ: z,
          alongX: -az,
          alongZ: ax,
          awayX: ax,
          awayZ: az,
          x,
          y: heightAt(terrain, x, z),
          z,
          heading: r(13 + k) * Math.PI * 2,
          mode: wanders ? 'stand' : 'sleep',
          timer: r(15 + k) * 6,
          tx: x,
          tz: z,
          speed: 0,
          phase: r(17 + k),
          gait: 0,
          pitch: 0,
          wag: 0,
          coat,
          white: r(19 + k) < 0.55 ? 0.25 + r(21 + k) * 0.6 : 0,
          wanders,
          seed: r(23 + k),
        });
      }
    }
    const capacity = Math.max(1, this.dogs.length);
    this.standing = new DogMesh(standingDog(), this.material, capacity);
    this.lying = new DogMesh(lyingDog(), this.material, capacity);
    this.group.add(this.standing.mesh, this.lying.mesh);
  }

  get count(): number {
    return this.dogs.length;
  }

  /** rain falling now (dogs lie down in it) and how wet things are (their fur stays dark a while). */
  setRain(rain: number, wetness = rain): void {
    this.rain = rain;
    wet.value = Math.min(1, wetness * 1.2);
  }

  /** A spot for a dog to go: somewhere on its stretch of pavement, off the road. */
  private wanderTarget(dog: Dog, awayFromX?: number, awayFromZ?: number): void {
    let best = -1;
    for (let t = 0; t < 6; t++) {
      const along = (Math.random() - 0.5) * 12;
      const away = 0.3 + Math.random() * 1.4;
      const x = dog.homeX + dog.alongX * along + dog.awayX * (away - 0.9);
      const z = dog.homeZ + dog.alongZ * along + dog.awayZ * (away - 0.9);
      const score = awayFromX === undefined || awayFromZ === undefined ? Math.random() : Math.hypot(x - awayFromX, z - awayFromZ);
      if (score > best) {
        best = score;
        dog.tx = x;
        dog.tz = z;
      }
    }
  }

  /** (x, z) is you; scare = how close you can come before they move off (bigger on a vehicle, with the horn). */
  update(dt: number, px: number, pz: number, scare: number): void {
    time.value = (time.value + dt) % 1000;
    this.standing.begin();
    this.lying.begin();
    const startle = scare * 0.45;
    const onFoot = scare <= 6.01;
    for (const dog of this.dogs) {
      if (Math.abs(dog.x - px) > NEAR_M || Math.abs(dog.z - pz) > NEAR_M) continue;
      const you = Math.hypot(px - dog.x, pz - dog.z);
      dog.timer -= dt;
      let gaitTo = 0;
      let pitchTo = 0;
      let wagTo = 0;
      let speed = 0;
      const startled = you < startle && dog.mode !== 'flee';
      if (startled) {
        dog.mode = 'flee';
        this.wanderTarget(dog, px, pz);
      }
      switch (dog.mode) {
        case 'sleep':
          if (you < 4.5) {
            dog.mode = 'rest';
            dog.timer = 4 + Math.random() * 5;
          } else if (dog.wanders && dog.timer < 0 && this.rain < 0.3) {
            dog.mode = 'stand';
            dog.timer = 2 + Math.random() * 3;
          }
          break;
        case 'rest':
          // Head up, watching you; the tail thumps a little.
          pitchTo = 0.45;
          wagTo = 0.25;
          if (dog.timer < 0 && you > 5) {
            dog.mode = 'sleep';
            dog.timer = 20 + Math.random() * 40;
          }
          break;
        case 'stand': {
          pitchTo = 0.08;
          wagTo = 0.15;
          // Friendly: someone on foot close by gets looked at, and a wag.
          if (onFoot && you < 5) {
            const want = Math.atan2(-(px - dog.x), -(pz - dog.z));
            dog.heading += Math.atan2(Math.sin(want - dog.heading), Math.cos(want - dog.heading)) * Math.min(1, dt * 3);
            pitchTo = 0.2;
            wagTo = 1;
          }
          if (dog.timer < 0) {
            const pick = Math.random();
            if (this.rain > 0.3 || pick < 0.15) {
              dog.mode = 'rest';
              dog.timer = 8 + Math.random() * 10;
            } else if (pick < 0.55) {
              dog.mode = 'sniff';
              dog.timer = 2 + Math.random() * 2.5;
            } else {
              dog.mode = 'walk';
              this.wanderTarget(dog);
              dog.timer = 12;
            }
          }
          break;
        }
        case 'sniff':
          pitchTo = -1;
          wagTo = 0.1;
          if (dog.timer < 0) {
            dog.mode = 'stand';
            dog.timer = 1.5 + Math.random() * 3;
          }
          break;
        case 'walk':
        case 'flee': {
          const fleeing = dog.mode === 'flee';
          speed = fleeing ? 2.3 : 1.05;
          gaitTo = fleeing ? 1 : 0.6;
          pitchTo = fleeing ? 0.05 : -0.15;
          wagTo = fleeing ? 0 : 0.3;
          const dx = dog.tx - dog.x;
          const dz = dog.tz - dog.z;
          const left = Math.hypot(dx, dz);
          if (left < 0.25 || dog.timer < -12) {
            speed = 0;
            dog.mode = 'stand';
            dog.timer = fleeing ? 3 + Math.random() * 2 : 2 + Math.random() * 3;
            // Disturbed dogs settle down again once they have moved off.
            if (fleeing && !dog.wanders) {
              dog.mode = 'rest';
              dog.timer = 6 + Math.random() * 6;
            }
            break;
          }
          const want = Math.atan2(-dx, -dz);
          const turn = Math.atan2(Math.sin(want - dog.heading), Math.cos(want - dog.heading));
          dog.heading += Math.sign(turn) * Math.min(Math.abs(turn), dt * 4);
          // Slow down while turning hard; a dog walks where it faces.
          const go = speed * Math.max(0.2, Math.cos(turn)) * dt;
          dog.x -= Math.sin(dog.heading) * go;
          dog.z -= Math.cos(dog.heading) * go;
          dog.y = heightAt(this.terrain, dog.x, dog.z);
          break;
        }
      }
      const ease = Math.min(1, dt * 5);
      dog.gait += (gaitTo - dog.gait) * ease;
      dog.pitch += (pitchTo - dog.pitch) * Math.min(1, dt * 3);
      dog.wag += (wagTo - dog.wag) * ease;
      // The gait cycle: about 0.75 m a stride walking, 1.1 m trotting.
      if (speed > 0) dog.phase = (dog.phase + (dt * speed) / (gaitTo > 0.8 ? 1.1 : 0.75)) % 1;
      const lying = dog.mode === 'sleep' || dog.mode === 'rest';
      (lying ? this.lying : this.standing).add(dog);
    }
    this.standing.commit();
    this.lying.commit();
  }

  dispose(): void {
    this.standing.dispose();
    this.lying.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
