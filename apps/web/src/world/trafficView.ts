import * as THREE from 'three';
import { VEHICLE_HALF, VEHICLE_HEIGHT, VEHICLE_KINDS, heightAt, trafficPose } from '@nukkad/worldgen';
import type { TerrainGrid, TrafficRoute } from '@nukkad/worldgen';
import type { SolidBox } from './streetLifeView.ts';

type ModelSource = (name: string) => { geometry: THREE.BufferGeometry; material: THREE.Material } | null;

const PAINTS = ['#f2f2f0', '#b9bcc0', '#b3261e', '#2f5aa8', '#1d1f22', '#6b6f75', '#7a1f2b', '#2f7f7a'].map((hex) => new THREE.Color(hex));
const STOP_AHEAD_M = 9; // traffic stops when you stand this close in front of it
const SOLID_COUNT = 5; // the nearest moving vehicles are solid

interface Lane {
  route: TrafficRoute;
  /** Metres this vehicle is behind its timetable because it stopped for someone (only on this screen). */
  delay: number;
  x: number;
  z: number;
  heading: number;
}

/**
 * Moving traffic. Positions come from the shared clock, so all friends see the same
 * vehicles. A vehicle waits when you stand or drive right in front of it (that wait only
 * happens on your screen). One draw call per vehicle type.
 */
export class TrafficView {
  readonly group = new THREE.Group();
  private readonly lanes: Lane[];
  private readonly meshes = new Map<number, THREE.InstancedMesh>();
  private readonly models: ModelSource;
  private readonly paintable: (material: THREE.Material) => boolean;
  private readonly terrain: TerrainGrid;
  private radius = 120;

  constructor(routes: TrafficRoute[], terrain: TerrainGrid, models: ModelSource, paintable: (material: THREE.Material) => boolean) {
    this.lanes = routes.map((route) => ({ route, delay: 0, x: 0, z: 0, heading: 0 }));
    this.terrain = terrain;
    this.models = models;
    this.paintable = paintable;
  }

  get count(): number {
    return this.lanes.length;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  /** Creates the mesh for a vehicle type once its model has loaded. */
  private meshFor(kind: number): THREE.InstancedMesh | null {
    let mesh = this.meshes.get(kind);
    if (mesh) return mesh;
    const model = this.models(VEHICLE_KINDS[kind]);
    if (!model) return null;
    const capacity = this.lanes.filter((lane) => lane.route.kind === kind).length;
    mesh = new THREE.InstancedMesh(model.geometry, model.material, Math.max(1, capacity));
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.meshes.set(kind, mesh);
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Moves everything to `seconds` on the shared clock. (px, pz) is you: traffic waits for you.
   * Returns solid boxes for the vehicles closest to you.
   */
  update(dt: number, seconds: number, px: number, pz: number): SolidBox[] {
    const counts = new Map<number, number>();
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const near: { lane: Lane; d: number }[] = [];

    for (const lane of this.lanes) {
      const route = lane.route;
      let pose = trafficPose(route, seconds * route.speed - lane.delay);
      // Wait while someone is right in front, in this lane.
      const fx = -Math.sin(pose.heading);
      const fz = -Math.cos(pose.heading);
      const ahead = (px - pose.x) * fx + (pz - pose.z) * fz;
      const side = Math.abs((px - pose.x) * -fz + (pz - pose.z) * fx);
      if (ahead > 0 && ahead < STOP_AHEAD_M && side < 1.8) {
        lane.delay += route.speed * dt;
        pose = trafficPose(route, seconds * route.speed - lane.delay);
      }
      lane.x = pose.x;
      lane.z = pose.z;
      lane.heading = pose.heading;
      const d = Math.hypot(pose.x - px, pose.z - pz);
      if (d > this.radius) continue;
      near.push({ lane, d });
      const mesh = this.meshFor(route.kind);
      if (!mesh) continue;
      const i = counts.get(route.kind) ?? 0;
      if (i >= mesh.instanceMatrix.count) continue;
      rotation.setFromAxisAngle(up, pose.heading);
      mesh.setMatrixAt(i, matrix.compose(position.set(pose.x, heightAt(this.terrain, pose.x, pose.z), pose.z), rotation, one));
      if (this.paintable(mesh.material as THREE.Material) && !['auto', 'bus', 'taxi', 'ambulance'].includes(VEHICLE_KINDS[route.kind])) {
        mesh.setColorAt(i, PAINTS[route.variant % PAINTS.length]);
      }
      counts.set(route.kind, i + 1);
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    near.sort((a, b) => a.d - b.d);
    return near.slice(0, SOLID_COUNT).map(({ lane }) => {
      const [hw, hl] = VEHICLE_HALF[lane.route.kind];
      const hy = VEHICLE_HEIGHT[lane.route.kind] / 2;
      return { x: lane.x, y: heightAt(this.terrain, lane.x, lane.z) + hy, z: lane.z, hx: hw, hy, hz: hl, rotation: lane.heading };
    });
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.group.removeFromParent();
  }
}
