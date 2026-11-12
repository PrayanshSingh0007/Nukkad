import * as THREE from 'three';
import { STALL_STRIDE, STOP_STRIDE, VEHICLE_HALF, VEHICLE_HEIGHT, VEHICLE_KINDS, VEHICLE_STRIDE } from '@nukkad/worldgen';
import type { PropSet } from '@nukkad/worldgen';
import { loadModel } from './models.ts';
import { createVehicleMaterial, streetModel } from './vehicleModels.ts';

/** A solid box for the physics: centre, half sizes, turn around the up axis. */
export interface SolidBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  rotation: number;
}

/** Car body colours (the "Paint" parts of a model). Autos and buses keep their own colours. */
const PAINTS = ['#f2f2f0', '#b9bcc0', '#b3261e', '#2f5aa8', '#1d1f22', '#6b6f75', '#7a1f2b', '#2f7f7a'].map((hex) => new THREE.Color(hex));
const NO_PAINT = new Set(['auto', 'bus']);

interface Item {
  x: number;
  y: number;
  z: number;
  rotation: number;
  variant: number;
}

interface Kind {
  name: string;
  items: Item[];
  /** Half sizes for the solid box (0 = you can walk through it). */
  half: [number, number, number];
  mesh: THREE.InstancedMesh | null;
  /** Invisible copies of only the nearest ones, to cast sun shadows (layer 1). */
  shadow: THREE.InstancedMesh | null;
}

const MAX_SHOWN = 90; // per kind, nearest first
const SOLID_RADIUS = 30;

/**
 * Parked vehicles, stalls and bus stops. There can be thousands in an area, so only the
 * ones near you are drawn (one draw call per model) and only the closest are solid.
 * Both lists are refreshed when you have moved 8 m.
 */
export class StreetLifeView {
  readonly group = new THREE.Group();
  private readonly kinds: Kind[] = [];
  readonly material: THREE.MeshStandardMaterial;
  private radius = 80;
  private shadowRadius = 0;
  private lastAt: [number, number] | null = null;

  constructor(props: PropSet, envMap: THREE.Texture | null) {
    this.material = createVehicleMaterial(envMap);
    VEHICLE_KINDS.forEach((name, index) => {
      const [hw, hl] = VEHICLE_HALF[index];
      this.kinds.push({ name, items: [], half: [hw, VEHICLE_HEIGHT[index] / 2, hl], mesh: null, shadow: null });
    });
    for (let i = 0; i < props.vehicles.length; i += VEHICLE_STRIDE) {
      const v = props.vehicles;
      this.kinds[v[i + 4]].items.push({ x: v[i], y: v[i + 1], z: v[i + 2], rotation: v[i + 3], variant: v[i + 5] });
    }
    const simple = (name: string, data: Float32Array, stride: number, half: [number, number, number]): void => {
      const items: Item[] = [];
      for (let i = 0; i < data.length; i += stride) items.push({ x: data[i], y: data[i + 1], z: data[i + 2], rotation: data[i + 3], variant: 0 });
      this.kinds.push({ name, items, half, mesh: null, shadow: null });
    };
    simple('stall', props.stalls, STALL_STRIDE, [1.0, 1.1, 0.7]);
    simple('bus_stop', props.stops, STOP_STRIDE, [0, 0, 0]);
    for (const kind of this.kinds) {
      if (kind.items.length === 0) continue;
      // Built-in code models first; a .glb in public/models/ is only used for names we can't build.
      const built = streetModel(kind.name);
      void (built ? Promise.resolve(built) : loadModel(kind.name)).then((geometry) => {
        if (!geometry) return;
        const mesh = new THREE.InstancedMesh(geometry, this.material, Math.min(MAX_SHOWN, kind.items.length));
        mesh.count = 0;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // copies move around; the set is small anyway
        kind.mesh = mesh;
        const shadow = new THREE.InstancedMesh(geometry, this.material, Math.min(24, kind.items.length));
        shadow.count = 0;
        shadow.castShadow = true;
        shadow.frustumCulled = false;
        shadow.layers.set(1);
        kind.shadow = shadow;
        this.group.add(mesh, shadow);
        this.lastAt = null; // fill it on the next update
      });
    }
  }

  /** How far away parked things are still drawn (by quality level). */
  setRadius(radius: number, shadowRadius = 0): void {
    this.radius = radius;
    this.shadowRadius = shadowRadius;
    this.lastAt = null;
  }

  get shown(): number {
    return this.kinds.reduce((sum, kind) => sum + (kind.mesh?.count ?? 0), 0);
  }

  /**
   * Refills what is drawn around (x, z). Returns the solid boxes near you when they
   * changed, otherwise null.
   */
  update(x: number, z: number): SolidBox[] | null {
    if (this.lastAt && Math.hypot(this.lastAt[0] - x, this.lastAt[1] - z) < 8) return null;
    this.lastAt = [x, z];
    const solids: SolidBox[] = [];
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const position = new THREE.Vector3();
    for (const kind of this.kinds) {
      const near = kind.items
        .map((item) => ({ item, d: Math.hypot(item.x - x, item.z - z) }))
        .filter((entry) => entry.d < this.radius)
        .sort((a, b) => a.d - b.d);
      if (kind.half[0] > 0 && kind.mesh) { // never an invisible wall: solid only once the model is drawn
        for (const { item, d } of near) {
          if (d > SOLID_RADIUS) break;
          solids.push({ x: item.x, y: item.y + kind.half[1], z: item.z, hx: kind.half[0], hy: kind.half[1], hz: kind.half[2], rotation: item.rotation });
        }
      }
      const mesh = kind.mesh;
      if (!mesh) continue;
      const shown = Math.min(near.length, mesh.instanceMatrix.count);
      for (let i = 0; i < shown; i++) {
        const item = near[i].item;
        rotation.setFromAxisAngle(up, item.rotation);
        mesh.setMatrixAt(i, matrix.compose(position.set(item.x, item.y, item.z), rotation, one));
        mesh.setColorAt(i, NO_PAINT.has(kind.name) ? PAINTS[0] : PAINTS[item.variant % PAINTS.length]);
      }
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
      const shadow = kind.shadow;
      if (shadow) {
        let casting = 0;
        while (casting < shown && casting < shadow.instanceMatrix.count && near[casting].d < this.shadowRadius) {
          mesh.getMatrixAt(casting, matrix);
          shadow.setMatrixAt(casting, matrix);
          casting++;
        }
        shadow.count = casting;
        shadow.instanceMatrix.needsUpdate = true;
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return solids;
  }

  /** Reflections are dimmer at night. */
  setNight(night: number): void {
    this.material.envMapIntensity = 0.15 + 0.85 * (1 - night);
  }

  dispose(): void {
    for (const kind of this.kinds) kind.mesh?.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
