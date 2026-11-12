import * as THREE from 'three';
import { makeRng, randomLook } from '@nukkad/shared';
import { heightAt, trafficPose } from '@nukkad/worldgen';
import type { TerrainGrid, TrafficRoute } from '@nukkad/worldgen';
import { buildAvatarGeometry } from '../player/avatar/avatarModel.ts';

const LOOKS = 8;
const WAIT_AHEAD_M = 1.6;

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
}

export class PedestrianView {
  readonly group = new THREE.Group();
  private readonly walkers: Walker[];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly terrain: TerrainGrid;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly time = { value: 0 };
  private radius = 70;

  constructor(routes: TrafficRoute[], terrain: TerrainGrid) {
    this.walkers = routes.map((route) => ({ route, delay: 0 }));
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
      const mesh = new THREE.InstancedMesh(buildAvatarGeometry(randomLook(random), true), this.material, capacity);
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

  /** Moves everyone to `seconds` on the shared clock; people wait for a moment if you block them. */
  update(dt: number, seconds: number, px: number, pz: number): void {
    this.time.value = seconds % 3600;
    const counts = new Array<number>(LOOKS).fill(0);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const walker of this.walkers) {
      const route = walker.route;
      let pose = trafficPose(route, seconds * route.speed - walker.delay);
      if (Math.hypot(pose.x - px, pose.z - pz) > this.radius) continue;
      const ahead = (px - pose.x) * -Math.sin(pose.heading) + (pz - pose.z) * -Math.cos(pose.heading);
      if (ahead > 0 && ahead < WAIT_AHEAD_M && Math.hypot(pose.x - px, pose.z - pz) < WAIT_AHEAD_M) {
        walker.delay += route.speed * dt;
        pose = trafficPose(route, seconds * route.speed - walker.delay);
      }
      const mesh = this.meshes[route.kind % LOOKS];
      const i = counts[route.kind % LOOKS];
      if (i >= mesh.instanceMatrix.count) continue;
      rotation.setFromAxisAngle(up, pose.heading);
      mesh.setMatrixAt(i, matrix.compose(position.set(pose.x, heightAt(this.terrain, pose.x, pose.z), pose.z), rotation, one));
      counts[route.kind % LOOKS] = i + 1;
    }
    this.meshes.forEach((mesh, look) => {
      mesh.count = counts[look];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
