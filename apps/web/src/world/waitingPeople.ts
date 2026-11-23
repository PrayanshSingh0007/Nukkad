import * as THREE from 'three';
import { makeRng, randomLook } from '@nukkad/shared';
import { buildAvatarGeometry } from '../player/avatar/avatarModel.ts';
import { OUTFIT_COLORS } from '@nukkad/shared';
import { ROCKETBOX_AVATARS, RocketboxPerson, loadRocketbox, rocketboxReady } from '../player/avatar/rocketbox.ts';
import { umbrellaColour } from '../player/avatar/umbrella.ts';

/** Within this distance the nearest few become realistic people (sitting, standing, chatting). */
const NEAR_M = 22;

interface Placement {
  pose: Pose;
  look: number;
  matrix: THREE.Matrix4;
  /** The light figure standing in for them (hidden while a realistic person is there). */
  mesh: THREE.InstancedMesh | null;
  index: number;
  /** Seeded 0–1: who chats, which person, top colour. */
  seed: number;
}

/**
 * People waiting at bus stops — one to four at each shelter, some sitting on the bench, some
 * standing at the front, a few turned to look down the road for their bus — and standing
 * round the steaming carts (a chai break). The light crowd figures, posed by the graphics card (sitting: thighs forward, knees down), swaying a little
 * as they wait. One draw call per look and pose; seeded, so everyone sees the same people.
 */
const LOOKS = 6;
const HIP_Y = 0.92; // the light avatar's hip joint height (avatarModel JOINTS)
const BENCH_Y = 0.5;

type Pose = 'stand' | 'sit';
const POSES: Record<Pose, { thigh: number; knee: number; shoulder: number; elbow: number }> = {
  stand: { thigh: 0, knee: 0, shoulder: 0.08, elbow: 0.15 },
  sit: { thigh: 1.5, knee: -1.45, shoulder: 0.25, elbow: 0.7 },
};

const POSE_PARS = /* glsl */ `
  uniform vec4 uPose; // thigh, knee, shoulder, elbow
  uniform float uTime;
  attribute vec4 skinIndex;
  vec3 wpTurn(vec3 p, float pivotY, float a) {
    float c = cos(a);
    float s = sin(a);
    float y = p.y - pivotY;
    return vec3(p.x, pivotY + y * c - p.z * s, y * s + p.z * c);
  }
  vec3 wpPose(vec3 p, int b, bool normal, float sway) {
    float hip = normal ? 0.0 : 0.92;
    float knee = normal ? 0.0 : 0.5;
    float shoulder = normal ? 0.0 : 1.42;
    float elbow = normal ? 0.0 : 1.15;
    float waist = normal ? 0.0 : 0.94;
    if (b == 7 || b == 8) p = wpTurn(p, hip, uPose.x);
    else if (b == 9 || b == 10) { p = wpTurn(p, knee, uPose.y); p = wpTurn(p, hip, uPose.x); }
    else if (b == 3 || b == 4) { p = wpTurn(p, shoulder, uPose.z); p = wpTurn(p, waist, sway); }
    else if (b == 5 || b == 6) { p = wpTurn(p, elbow, uPose.w); p = wpTurn(p, shoulder, uPose.z); p = wpTurn(p, waist, sway); }
    else if (b == 1 || b == 2 || b == 11) p = wpTurn(p, waist, sway);
    return p;
  }
`;

export class WaitingPeople {
  readonly group = new THREE.Group();
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private readonly time = { value: 0 };
  private readonly placements: Placement[] = [];
  /** Realistic people up close: which placement each one stands in for. */
  private readonly pool: { person: RocketboxPerson; at: number }[] = [];
  private nearLimit = 4;
  private searchIn = 0;
  private rain = 0;
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  /**
   * stops: [x, y, z, angle] per bus shelter (its open side, the model's +z, faces the road);
   * carts: [x, ground y, z] per steaming cart.
   */
  constructor(stops: Float32Array, carts: Float32Array = new Float32Array(0)) {
    const random = makeRng(9091);
    const geometries = Array.from({ length: LOOKS }, () => buildAvatarGeometry(randomLook(random), true));
    const places: Record<Pose, THREE.Matrix4[][]> = { stand: geometries.map(() => []), sit: geometries.map(() => []) };
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < stops.length / 4; i++) {
      const [x, y, z, angle] = [stops[i * 4], stops[i * 4 + 1], stops[i * 4 + 2], stops[i * 4 + 3]];
      const r = (salt: number): number => {
        const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
        return v - Math.floor(v);
      };
      const people = 1 + Math.floor(r(1) * 4);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Local (shelter) → world.
      const place = (lx: number, ly: number, lz: number, facing: number): THREE.Matrix4 => {
        at.set(x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos);
        turn.setFromAxisAngle(up, angle + facing);
        return matrix.clone().compose(at, turn, one);
      };
      for (let k = 0; k < people; k++) {
        const look = Math.floor(r(10 + k) * LOOKS);
        const sitting = r(20 + k) < 0.5;
        if (sitting) {
          // On the bench (seat 0.48 m up at the back), facing the road (+z: turn half round).
          const lx = -1.0 + (k + r(30 + k) * 0.6) * 0.65;
          const m = place(Math.min(1.0, lx), BENCH_Y - HIP_Y, -0.32, Math.PI);
          places.sit[look].push(m);
          this.placements.push({ pose: 'sit', look, matrix: m, mesh: null, index: places.sit[look].length - 1, seed: r(90 + k) });
        } else {
          // Standing under the front edge, most facing the road, some looking along it.
          const lx = (r(40 + k) - 0.5) * 3.2;
          const facing = Math.PI + (r(50 + k) < 0.35 ? (r(60 + k) < 0.5 ? 1.2 : -1.2) : (r(70 + k) - 0.5) * 0.6);
          const m = place(lx, 0, 0.35 + r(80 + k) * 0.5, facing);
          places.stand[look].push(m);
          this.placements.push({ pose: 'stand', look, matrix: m, mesh: null, index: places.stand[look].length - 1, seed: r(90 + k) });
        }
      }
    }
    // Round the carts: two to four standing in a loose ring, facing the cart.
    for (let i = 0; i < carts.length / 3; i++) {
      const [x, y, z] = [carts[i * 3], carts[i * 3 + 1], carts[i * 3 + 2]];
      const r = (salt: number): number => {
        const v = Math.sin(x * 37.1 + z * 11.7 + salt * 5.3) * 43758.5453;
        return v - Math.floor(v);
      };
      const people = 2 + Math.floor(r(1) * 3);
      for (let k = 0; k < people; k++) {
        const around = r(10 + k) * Math.PI * 2;
        const distance = 1.1 + r(20 + k) * 0.5;
        const px = x + Math.sin(around) * distance;
        const pz = z + Math.cos(around) * distance;
        // Facing the cart (people face −z: heading = atan2(−dx, −dz) towards it).
        const facing = Math.atan2(-(x - px), -(z - pz)) + (r(30 + k) - 0.5) * 0.5;
        turn.setFromAxisAngle(up, facing);
        const look = Math.floor(r(40 + k) * LOOKS);
        const m = matrix.clone().compose(at.set(px, y, pz), turn, one);
        places.stand[look].push(m);
        this.placements.push({ pose: 'stand', look, matrix: m, mesh: null, index: places.stand[look].length - 1, seed: r(50 + k) });
      }
    }
    for (const pose of ['stand', 'sit'] as const) {
      const angles = POSES[pose];
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uPose = { value: new THREE.Vector4(angles.thigh, angles.knee, angles.shoulder, angles.elbow) };
        shader.uniforms.uTime = this.time;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${POSE_PARS}`)
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
            float wpSway = sin(uTime * 0.7 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z) * 0.025;
            objectNormal = wpPose(objectNormal, int(skinIndex.x + 0.5), true, wpSway);`,
          )
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = wpPose(transformed, int(skinIndex.x + 0.5), false, wpSway);');
      };
      material.customProgramCacheKey = () => `nukkad-waiting-${pose}-1`;
      this.materials.push(material);
      places[pose].forEach((list, look) => {
        if (list.length === 0) return;
        const mesh = new THREE.InstancedMesh(geometries[look], material, list.length);
        list.forEach((m, i) => mesh.setMatrixAt(i, m));
        for (const p of this.placements) if (p.pose === pose && p.look === look) p.mesh = mesh;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = false; // the shadow pass would draw them unposed (standing)
        mesh.receiveShadow = true;
        this.group.add(mesh);
      });
    }
  }

  /** How many realistic people may stand in up close (the quality's near-people budget). */
  setNearLimit(limit: number): void {
    this.nearLimit = limit;
    if (limit > 0) void loadRocketbox();
  }

  setRain(rain: number): void {
    this.rain = rain;
  }

  /** (x, z) = you. */
  update(dt: number, x: number, z: number): void {
    this.time.value = (this.time.value + dt) % 1000;
    const assets = this.nearLimit > 0 ? rocketboxReady() : null;
    this.searchIn -= dt;
    if (assets && this.searchIn <= 0) {
      this.searchIn = 0.5;
      const near = this.placements
        .map((p, i) => ({ i, d: Math.hypot(p.matrix.elements[12] - x, p.matrix.elements[14] - z) }))
        .filter((n) => n.d < NEAR_M)
        .sort((a, b) => a.d - b.d)
        .slice(0, this.nearLimit)
        .map((n) => n.i);
      // Give back the light figures of those no longer near; free their realistic people.
      for (const slot of this.pool) {
        if (slot.at >= 0 && !near.includes(slot.at)) {
          this.show(slot.at, true);
          slot.at = -1;
          slot.person.root.visible = false;
        }
      }
      for (const i of near) {
        if (this.pool.some((slot) => slot.at === i)) continue;
        const p = this.placements[i];
        // Neighbours are different people: spread by their place in the list as well as the seed.
        const avatar = (i * 3 + Math.floor(p.seed * 8)) % ROCKETBOX_AVATARS.length;
        let slot = this.pool.find((s) => s.at < 0 && s.person.avatar === avatar) ?? null;
        if (!slot) {
          const person = new RocketboxPerson(assets, avatar, p.seed);
          this.group.add(person.root);
          const free = this.pool.find((s) => s.at < 0);
          if (free) {
            free.person.dispose();
            free.person = person;
            slot = free;
          } else {
            slot = { person, at: -1 };
            this.pool.push(slot);
          }
        }
        slot.at = i;
        const dye = (p.seed * 7.13) % 1;
        slot.person.setTint(dye < 0.34 ? 0 : 1 + Math.floor(((dye - 0.34) / 0.66) * OUTFIT_COLORS.length));
        slot.person.setUmbrella(p.pose === 'stand' && (p.seed * 3.7) % 1 < 0.8 ? umbrellaColour((p.seed * 5.3) % 1) : null);
        // Stand where the light figure stood (seated ones: on the ground below the bench seat).
        const e = p.matrix.elements;
        slot.person.root.position.set(e[12], e[13] - (p.pose === 'sit' ? BENCH_Y - HIP_Y : 0), e[14]);
        slot.person.root.quaternion.setFromRotationMatrix(p.matrix);
        slot.person.root.visible = true;
        this.show(i, false);
      }
    }
    for (const slot of this.pool) {
      if (slot.at < 0) continue;
      const p = this.placements[slot.at];
      // Sitting on the bench; standing ones chat or just wait (in the rain they keep their umbrella up).
      const chatting = p.pose === 'stand' && this.rain < 0.15 && (p.seed * 11.1) % 1 < 0.4;
      slot.person.update(dt, 0, p.pose === 'sit' ? 3 : chatting ? 4 : 0);
    }
  }

  private show(i: number, visible: boolean): void {
    const p = this.placements[i];
    if (!p.mesh) return;
    p.mesh.setMatrixAt(p.index, visible ? p.matrix : this.hidden);
    p.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const slot of this.pool) slot.person.dispose();
    this.group.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (mesh.isInstancedMesh) mesh.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
