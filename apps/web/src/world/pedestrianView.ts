import * as THREE from 'three';
import { makeRng, randomLook } from '@nukkad/shared';
import { heightAt, trafficPose } from '@nukkad/worldgen';
import type { TerrainGrid, TrafficRoute } from '@nukkad/worldgen';
import type { AvatarLook } from '@nukkad/shared';
import { buildAvatarGeometry } from '../player/avatar/avatarModel.ts';
import { Person, peopleReady } from '../player/avatar/people.ts';
import { ROCKETBOX_AVATARS, RocketboxPerson, loadRocketbox, rocketboxReady } from '../player/avatar/rocketbox.ts';

const LOOKS = 8;
const WAIT_AHEAD_M = 1.6;
/** People closer than this become full 3D people (up to the quality level's limit). */
const NEAR_M = 28;

/**
 * Bengaluru street life: people walking along the streets. Like traffic, positions come from
 * the shared clock (friends see the same people). Each look is ONE instanced mesh of a light
 * avatar (~1,000 triangles); the graphics card swings arms and legs, so there are no bones.
 */
const WALK_GLSL = /* glsl */ `
  float nkPhase = uTime * 5.4 + instanceMatrix[3].x * 0.71 + instanceMatrix[3].z * 1.37;
  float nkSwing = sin(nkPhase);
  int nkBone = int(skinIndex.x + 0.5);
  float nkAngle = 0.0;
  float nkPivot = 0.0;
  if (nkBone == 7 || nkBone == 9) { nkAngle = nkSwing * 0.55; nkPivot = 0.92; }
  else if (nkBone == 8 || nkBone == 10) { nkAngle = -nkSwing * 0.55; nkPivot = 0.92; }
  else if (nkBone == 3 || nkBone == 5) { nkAngle = -nkSwing * 0.45; nkPivot = 1.42; }
  else if (nkBone == 4 || nkBone == 6) { nkAngle = nkSwing * 0.45; nkPivot = 1.42; }
  float nkY = transformed.y - nkPivot;
  float nkC = cos(nkAngle);
  float nkS = sin(nkAngle);
  if (nkAngle != 0.0) {
    transformed.y = nkPivot + nkY * nkC - transformed.z * nkS;
    transformed.z = nkY * nkS + transformed.z * nkC;
  }
  transformed.y += abs(cos(nkPhase)) * 0.03;
`;

interface Walker {
  route: TrafficRoute;
  delay: number;
  /** Seconds left of stopping to look at someone who honked, and where the horn was. */
  startled: number;
  lookX: number;
  lookZ: number;
  /** 0–1, fixed per walker: who stays indoors first when it rains or gets late. */
  keen: number;
}

/** How long people stop and stare after a horn, seconds, and how far away they hear it. */
const STARTLE_S = 1.8;
const HORN_HEARD_M = 16;

export class PedestrianView {
  readonly group = new THREE.Group();
  private readonly walkers: Walker[];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly terrain: TerrainGrid;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly time = { value: 0 };
  private radius = 70;
  private readonly looks: AvatarLook[] = [];
  /** Up close, the nearest few walkers are real 3D people (a small pool, reused). */
  private nearLimit = 0;
  private readonly pool: { person: Person | RocketboxPerson; walker: number; seen: boolean }[] = [];

  constructor(routes: TrafficRoute[], terrain: TerrainGrid) {
    this.walkers = routes.map((route, index) => ({ route, delay: 0, startled: 0, lookX: 0, lookZ: 0, keen: ((index * 2654435761) >>> 0) / 4294967296 }));
    void loadRocketbox(); // realistic people for the nearest walkers, when they arrive
    this.terrain = terrain;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 skinIndex;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WALK_GLSL}`);
    };
    this.material.customProgramCacheKey = () => 'nukkad-walkers-1';
    const random = makeRng(routes.length * 7919 + 17);
    for (let look = 0; look < LOOKS; look++) {
      const capacity = Math.max(1, routes.filter((r) => r.kind === look).length);
      const style = randomLook(random);
      this.looks.push(style);
      const mesh = new THREE.InstancedMesh(buildAvatarGeometry(style, true), this.material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  get count(): number {
    return this.walkers.length;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  /**
   * The street follows the world, like the NPCs in an "NPC brain" design (no AI model needed):
   * in rain, and late at night, fewer people are out (the keenest stay). Seeded per walker, so
   * every player sees the same people out.
   */
  setWorld(night: number, rain: number): void {
    const wet = THREE.MathUtils.smoothstep(rain, 0.3, 0.75);
    const late = THREE.MathUtils.smoothstep(night, 0.55, 0.95);
    this.presence = Math.max(0.22, 1 - 0.6 * wet - 0.5 * late);
  }
  private presence = 1;
  /** The shared clock at the last update, seconds. */
  private lastSeconds = 0;

  /** Someone honked at (x, z): people close by stop, turn to look and complain for a moment. */
  honk(x: number, z: number): void {
    const seconds = this.lastSeconds;
    for (const walker of this.walkers) {
      const pose = trafficPose(walker.route, seconds * walker.route.speed - walker.delay);
      if (Math.hypot(pose.x - x, pose.z - z) > HORN_HEARD_M) continue;
      walker.startled = STARTLE_S;
      walker.lookX = x;
      walker.lookZ = z;
    }
  }

  /** How many of the nearest walkers may be full 3D people (0 on Low). */
  setNearLimit(count: number): void {
    this.nearLimit = count;
    while (this.pool.length > count) this.pool.pop()?.person.dispose();
  }

  /** Moves everyone to `seconds` on the shared clock; people wait for a moment if you block them. */
  update(dt: number, seconds: number, px: number, pz: number): void {
    this.time.value = seconds % 3600;
    this.lastSeconds = seconds;
    const counts = new Array<number>(LOOKS).fill(0);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    // The nearest few become real 3D people; the rest are the light instanced crowd.
    const rocketbox = this.nearLimit > 0 ? rocketboxReady() : null;
    const assets = this.nearLimit > 0 ? peopleReady() : null;
    const near: { index: number; d: number }[] = [];
    if (assets || rocketbox) {
      this.walkers.forEach((walker, index) => {
        if (walker.keen > this.presence) return; // stayed in (rain, night)
        const pose = trafficPose(walker.route, seconds * walker.route.speed - walker.delay);
        const d = Math.hypot(pose.x - px, pose.z - pz);
        if (d < NEAR_M) near.push({ index, d });
      });
      near.sort((a, b) => a.d - b.d);
      near.length = Math.min(near.length, this.nearLimit);
    }
    const nearSet = new Set(near.map((n) => n.index));
    for (const slot of this.pool) slot.seen = false;
    for (const slot of this.pool) if (nearSet.has(slot.walker)) slot.seen = true;
    for (const { index } of near) {
      if (this.pool.some((slot) => slot.walker === index && slot.seen)) continue;
      const route = this.walkers[index].route;
      if (rocketbox) {
        // Each walker is always the same Rocketbox person (by route), seeded height.
        const avatar = route.kind % ROCKETBOX_AVATARS.length;
        let slot = this.pool.find((s) => !s.seen && s.person instanceof RocketboxPerson && s.person.avatar === avatar);
        if (!slot) {
          const free = this.pool.find((s) => !s.seen);
          if (free || this.pool.length < this.nearLimit) {
            const person = new RocketboxPerson(rocketbox, avatar, ((index * 2654435761) >>> 0) / 4294967296);
            this.group.add(person.root);
            if (free) {
              free.person.dispose();
              free.person = person;
              slot = free;
            } else {
              slot = { person, walker: -1, seen: false };
              this.pool.push(slot);
            }
          }
        }
        if (!slot) continue;
        slot.walker = index;
        slot.seen = true;
        continue;
      }
      let slot = this.pool.find((s) => !s.seen);
      if (!slot && assets && this.pool.length < this.nearLimit) {
        const look = this.looks[this.pool.length % LOOKS];
        slot = { person: new Person(assets, look), walker: -1, seen: false };
        this.group.add(slot.person.root);
        this.pool.push(slot);
      }
      if (!slot || !(slot.person instanceof Person)) continue;
      slot.walker = index;
      slot.seen = true;
      slot.person.setLook(this.looks[route.kind % LOOKS]); // same colours as their crowd version
    }
    for (const slot of this.pool) slot.person.root.visible = slot.seen;

    this.walkers.forEach((walker, index) => {
      if (walker.keen > this.presence) return; // stayed in (rain, night)
      const route = walker.route;
      let pose = trafficPose(route, seconds * route.speed - walker.delay);
      if (Math.hypot(pose.x - px, pose.z - pz) > this.radius) return;
      // Startled by a horn: stand still for a moment.
      if (walker.startled > 0) {
        walker.startled -= dt;
        walker.delay += route.speed * dt;
        pose = trafficPose(route, seconds * route.speed - walker.delay);
      }
      const ahead = (px - pose.x) * -Math.sin(pose.heading) + (pz - pose.z) * -Math.cos(pose.heading);
      let waiting = false;
      if (ahead > 0 && ahead < WAIT_AHEAD_M && Math.hypot(pose.x - px, pose.z - pz) < WAIT_AHEAD_M) {
        walker.delay += route.speed * dt;
        pose = trafficPose(route, seconds * route.speed - walker.delay);
        waiting = true;
      }
      const slot = nearSet.has(index) ? this.pool.find((s) => s.walker === index && s.seen) : undefined;
      if (slot) {
        slot.person.root.position.set(pose.x, heightAt(this.terrain, pose.x, pose.z), pose.z);
        const startled = walker.startled > 0;
        // Turn to face whoever honked (the person's front is −z, so heading = atan2(−dx, −dz)).
        slot.person.root.rotation.y = startled ? Math.atan2(-(walker.lookX - pose.x), -(walker.lookZ - pose.z)) : pose.heading;
        if (slot.person instanceof RocketboxPerson) slot.person.update(dt, waiting || startled ? 0 : route.speed, startled ? 4 : 0);
        else slot.person.update(dt, waiting || startled ? 0 : route.speed, true, null, startled ? 4 : 0);
        return;
      }
      const mesh = this.meshes[route.kind % LOOKS];
      const i = counts[route.kind % LOOKS];
      if (i >= mesh.instanceMatrix.count) return;
      rotation.setFromAxisAngle(up, pose.heading);
      mesh.setMatrixAt(i, matrix.compose(position.set(pose.x, heightAt(this.terrain, pose.x, pose.z), pose.z), rotation, one));
      counts[route.kind % LOOKS] = i + 1;
    });
    this.meshes.forEach((mesh, look) => {
      mesh.count = counts[look];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    for (const slot of this.pool) slot.person.dispose();
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
