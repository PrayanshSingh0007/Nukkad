import * as THREE from 'three';
import { VEHICLE_HALF, VEHICLE_HEIGHT, VEHICLE_KINDS, heightAt, trafficPose } from '@nukkad/worldgen';
import type { TerrainGrid, TrafficRoute } from '@nukkad/worldgen';
import type { SolidBox } from './streetLifeView.ts';
import { TrafficDrivers } from './trafficDrivers.ts';
import { WetReflections } from './wetReflections.ts';
import { HeadlightCones } from './headlightCones.ts';

type ModelSource = (name: string, light: boolean) => { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] } | null;

const STOP_AHEAD_M = 9; // traffic stops when you stand this close in front of it
/** The space a vehicle keeps behind the one ahead of it in its lane (bumper to bumper), metres. */
const GAP_M = 2.2;
/** Two-wheelers have one headlight in the middle. */
const ONE_LAMP = new Set(['two_wheeler', 'motorbike', 'scooter']);

/** A soft round glow (for lamps) and a beam that fades away from the car (for the road). */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
function beamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  const along = c.createLinearGradient(0, 128, 0, 0); // bright at the car (bottom), gone far ahead
  along.addColorStop(0, 'rgba(255,255,255,0.0)');
  along.addColorStop(0.08, 'rgba(255,255,255,0.9)');
  along.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = along;
  c.fillRect(0, 0, 64, 128);
  // Soft sides.
  c.globalCompositeOperation = 'destination-in';
  const across = c.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.3, 'rgba(0,0,0,1)');
  across.addColorStop(0.7, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = across;
  c.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(canvas);
}
const SOLID_COUNT = 5; // the nearest moving vehicles are solid
/** Vehicles closer than this are drawn with their full model (further ones with the light one). */
const FULL_MODEL_M = 40;
/** Head and tail lights are mirrored in a wet road within this distance. */
const WET_LIGHTS_M = 110;
/** Reused for each cone's place and size. */
const CONE_AT = new THREE.Vector3();
const CONE_SCALE = new THREE.Vector3();
/** Headlight light in the air is drawn within this distance. */
const CONES_M = 90;
/** Mesh keys: kind for the light version, kind + FULL for the full one. */
const FULL = 100;

interface Lane {
  route: TrafficRoute;
  /** Metres this vehicle is behind its timetable because it stopped for someone (only on this screen). */
  delay: number;
  x: number;
  z: number;
  heading: number;
  /** Height of the vehicle's wheels (ground, or the flyover deck). */
  y: number;
}

/**
 * Moving traffic. Positions come from the shared clock, so all friends see the same
 * vehicles. A vehicle waits when you stand or drive right in front of it (that wait only
 * happens on your screen). One draw call per vehicle type; at night three more for all the
 * headlights, tail lights and the beams they throw on the road.
 */
export class TrafficView {
  readonly group = new THREE.Group();
  private readonly lanes: Lane[];
  private readonly meshes = new Map<number, THREE.InstancedMesh>();
  private readonly models: ModelSource;
  private readonly paint: (name: string, variant: number) => THREE.Color | null;
  private readonly terrain: TerrainGrid;
  private radius = 120;
  /** Night lights: headlights, tail lights (glowing points) and beams on the road ahead. */
  private night = 0;
  private readonly heads: THREE.Points;
  private readonly tails: THREE.Points;
  private readonly headMaterial: THREE.PointsMaterial;
  private readonly tailMaterial: THREE.PointsMaterial;
  private readonly beams: THREE.InstancedMesh;
  private readonly beamMaterial: THREE.MeshBasicMaterial;
  /** Head and tail lights mirrored in the wet road. */
  private readonly wet: WetReflections;
  /** Headlight light in rainy or misty air. */
  private readonly cones: HeadlightCones;
  private readonly coneMatrix = new THREE.Matrix4();
  /** Someone at the wheel (or on the seat) of every moving vehicle. */
  private readonly drivers: TrafficDrivers;

  constructor(routes: TrafficRoute[], terrain: TerrainGrid, models: ModelSource, paint: (name: string, variant: number) => THREE.Color | null) {
    this.lanes = routes.map((route) => ({ route, delay: 0, x: 0, y: 0, z: 0, heading: 0 }));
    this.terrain = terrain;
    this.models = models;
    this.paint = paint;
    const glow = glowTexture();
    const points = (color: THREE.Color, size: number): [THREE.Points, THREE.PointsMaterial] => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, routes.length) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setDrawRange(0, 0);
      const material = new THREE.PointsMaterial({ map: glow, color, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
      const object = new THREE.Points(geometry, material);
      object.frustumCulled = false;
      object.visible = false;
      object.renderOrder = 3;
      this.group.add(object);
      return [object, material];
    };
    [this.heads, this.headMaterial] = points(new THREE.Color(3.2, 3.0, 2.6), 0.5);
    [this.tails, this.tailMaterial] = points(new THREE.Color(2.6, 0.18, 0.1), 0.34);
    this.beamMaterial = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff1d6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
    const beam = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    this.beams = new THREE.InstancedMesh(beam, this.beamMaterial, Math.max(1, routes.length));
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    this.beams.visible = false;
    this.group.add(this.beams);
    this.wet = new WetReflections(Math.max(1, routes.length) * 4);
    this.group.add(this.wet.mesh);
    this.cones = new HeadlightCones(Math.max(1, routes.length) * 2);
    this.group.add(this.cones.mesh);
    this.drivers = new TrafficDrivers(routes.length);
    this.group.add(this.drivers.group);
  }

  /** 0 = day … 1 = night (lights on from dusk); rain makes the beams on the wet road stronger. */
  setNight(night: number, rain = 0): void {
    this.night = night;
    const on = night > 0.15;
    this.heads.visible = this.tails.visible = this.beams.visible = on;
    this.headMaterial.opacity = this.tailMaterial.opacity = Math.min(1, night * 1.3);
    this.beamMaterial.opacity = night * (0.32 + 0.3 * rain);
    this.wet.setLevel(night, rain);
  }

  get count(): number {
    return this.lanes.length;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  /** Creates the mesh for a vehicle type (full or light model) once its model has loaded. */
  private meshFor(kind: number, full = false): THREE.InstancedMesh | null {
    const key = full ? kind + FULL : kind;
    let mesh = this.meshes.get(key);
    if (mesh) return mesh;
    const model = this.models(VEHICLE_KINDS[kind], !full);
    if (!model) return null;
    const all = this.lanes.filter((lane) => lane.route.kind === kind).length;
    const capacity = full ? Math.min(all, 16) : all;
    mesh = new THREE.InstancedMesh(model.geometry, model.material, Math.max(1, capacity));
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.meshes.set(key, mesh);
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Moves everything to `seconds` on the shared clock. (px, pz) is you: traffic waits for you.
   * Returns solid boxes for the vehicles closest to you.
   */
  update(dt: number, seconds: number, px: number, pz: number, py = Number.NaN): SolidBox[] {
    const counts = new Map<number, number>();
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const scale = new THREE.Vector3();
    const near: { lane: Lane; d: number }[] = [];
    const lightsOn = this.night > 0.15;
    const headPos = (this.heads.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const tailPos = (this.tails.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let heads = 0;
    this.wet.begin();
    this.cones.begin();
    let beams = 0;
    this.drivers.begin();

    // Vehicles near you (positions from last frame), for keeping a gap to the one in front.
    const around = this.lanes.filter((lane) => Math.abs(lane.x - px) < this.radius + 20 && Math.abs(lane.z - pz) < this.radius + 20);
    for (const lane of this.lanes) {
      const route = lane.route;
      let pose = trafficPose(route, seconds * route.speed - lane.delay);
      // Car-following: different routes share roads, so a vehicle waits while another is just
      // ahead in its lane, going the same way (traffic queues instead of overlapping).
      if (Math.abs(pose.x - px) < this.radius && Math.abs(pose.z - pz) < this.radius) {
        const ax = -Math.sin(pose.heading);
        const az = -Math.cos(pose.heading);
        for (const other of around) {
          if (other === lane) continue;
          const dx = other.x - pose.x;
          const dz = other.z - pose.z;
          const ahead = dx * ax + dz * az;
          const gap = (VEHICLE_HALF[route.kind]?.[1] ?? 2) + (VEHICLE_HALF[other.route.kind]?.[1] ?? 2) + GAP_M;
          if (ahead <= 0.5 || ahead > gap) continue;
          if (Math.abs(dx * -az + dz * ax) > 1.6 || Math.cos(other.heading - pose.heading) < 0.6) continue;
          lane.delay += route.speed * dt;
          pose = trafficPose(route, seconds * route.speed - lane.delay);
          break;
        }
      }
      // Wait while someone is right in front, in this lane.
      const fx = -Math.sin(pose.heading);
      const fz = -Math.cos(pose.heading);
      const ahead = (px - pose.x) * fx + (pz - pose.z) * fz;
      const side = Math.abs((px - pose.x) * -fz + (pz - pose.z) * fx);
      const wheels = heightAt(this.terrain, pose.x, pose.z) + (pose.rise > 0.05 ? pose.rise + 0.1 : 0);
      const sameLevel = Number.isNaN(py) || Math.abs(py - wheels) < 3; // not for someone under a flyover
      if (ahead > 0 && ahead < STOP_AHEAD_M && side < 1.8 && sameLevel) {
        lane.delay += route.speed * dt;
        pose = trafficPose(route, seconds * route.speed - lane.delay);
      }
      lane.x = pose.x;
      lane.z = pose.z;
      lane.heading = pose.heading;
      lane.y = heightAt(this.terrain, pose.x, pose.z) + (pose.rise > 0.05 ? pose.rise + 0.1 : 0);
      const d = Math.hypot(pose.x - px, pose.z - pz);
      if (d > this.radius) continue;
      near.push({ lane, d });
      // Close by: the full model (if there is room in its mesh), else the light one.
      const fullMesh = d < FULL_MODEL_M ? this.meshFor(route.kind, true) : null;
      const useFull = fullMesh !== null && (counts.get(route.kind + FULL) ?? 0) < fullMesh.instanceMatrix.count;
      const key = useFull ? route.kind + FULL : route.kind;
      const mesh = useFull ? fullMesh : this.meshFor(route.kind);
      if (!mesh) continue;
      const i = counts.get(key) ?? 0;
      if (i >= mesh.instanceMatrix.count) continue;
      rotation.setFromAxisAngle(up, pose.heading);
      mesh.setMatrixAt(i, matrix.compose(position.set(pose.x, lane.y, pose.z), rotation, one));
      this.drivers.place(route.kind, route.variant * 7 + Math.round(route.speed * 13), matrix);
      const name = VEHICLE_KINDS[route.kind];
      const paint = name === 'taxi' || name === 'ambulance' ? null : this.paint(name, route.variant);
      if (paint) mesh.setColorAt(i, paint);
      counts.set(key, i + 1);
      if (lightsOn) {
        // Lamps at the front (−z is forward) and back corners, a beam on the road ahead.
        const [hw, hl] = VEHICLE_HALF[route.kind];
        const single = ONE_LAMP.has(name);
        const lampY = lane.y + (single ? 0.95 : Math.min(0.85, VEHICLE_HEIGHT[route.kind] * 0.38));
        const fx2 = -Math.sin(pose.heading);
        const fz2 = -Math.cos(pose.heading);
        const sx = -fz2;
        const sz = fx2;
        for (const side of single ? [0] : [-0.72, 0.72]) {
          headPos.set([pose.x + fx2 * hl + sx * hw * side, lampY, pose.z + fz2 * hl + sz * hw * side], heads * 3);
          tailPos.set([pose.x - fx2 * hl + sx * hw * side, lampY, pose.z - fz2 * hl + sz * hw * side], heads * 3);
          if (d < CONES_M) {
            const size = single ? 0.75 : 1;
            this.cones.add(this.coneMatrix.compose(CONE_AT.set(headPos[heads * 3], lampY, headPos[heads * 3 + 2]), rotation, CONE_SCALE.set(size, size, size)));
          }
          // In the wet road: white from the headlights, red from the tail lights.
          if (d < WET_LIGHTS_M) {
            this.wet.set(headPos[heads * 3], lane.y, headPos[heads * 3 + 2], lampY - lane.y, 2.4, 2.25, 1.95, 0.24);
            this.wet.set(tailPos[heads * 3], lane.y, tailPos[heads * 3 + 2], lampY - lane.y, 2.1, 0.14, 0.07, 0.2);
          }
          heads++;
        }
        const width = single ? 2.6 : 4.4;
        this.beams.setMatrixAt(beams++, matrix.compose(position.set(pose.x + fx2 * hl, lane.y + 0.12, pose.z + fz2 * hl), rotation, scale.set(width, 1, single ? 10 : 15)));
      }
    }
    if (lightsOn) {
      for (const [points, used] of [
        [this.heads, heads],
        [this.tails, heads],
      ] as const) {
        points.geometry.setDrawRange(0, used);
        (points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
      this.beams.count = beams;
      this.beams.instanceMatrix.needsUpdate = true;
    }
    this.wet.commit();
    this.cones.commit();
    this.drivers.end();
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    near.sort((a, b) => a.d - b.d);
    return near.slice(0, SOLID_COUNT).map(({ lane }) => {
      const [hw, hl] = VEHICLE_HALF[lane.route.kind];
      const hy = VEHICLE_HEIGHT[lane.route.kind] / 2;
      return { x: lane.x, y: lane.y + hy, z: lane.z, hx: hw, hy, hz: hl, rotation: lane.heading };
    });
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose();
    for (const points of [this.heads, this.tails]) points.geometry.dispose();
    this.headMaterial.dispose();
    this.tailMaterial.dispose();
    this.wet.dispose();
    this.cones.dispose();
    this.beams.dispose();
    this.beamMaterial.dispose();
    this.drivers.dispose();
    this.group.removeFromParent();
  }
}
