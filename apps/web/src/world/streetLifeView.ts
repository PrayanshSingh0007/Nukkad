import * as THREE from 'three';
import { STALL_STRIDE, STOP_STRIDE, TANK_STRIDE, VEHICLE_HALF, VEHICLE_HEIGHT, VEHICLE_KINDS, VEHICLE_STRIDE } from '@nukkad/worldgen';
import type { PropSet } from '@nukkad/worldgen';
import { loadModel, loadTexturedModel } from './models.ts';
import type { TexturedFit } from './models.ts';
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
/**
 * Body colours for the premade models (only the body texels change, see bodyPaint in models.ts).
 * Pure white keeps the model's own paint.
 */
const BODY_PAINTS: Record<string, THREE.Color[]> = Object.fromEntries(
  Object.entries({
    auto: ['#ffffff', '#1f7a3a', '#2a8d46', '#ffffff', '#18262b', '#1f7a3a', '#2b6f8f', '#ffffff'],
    two_wheeler: ['#ffffff', '#a8231c', '#2f5aa8', '#e6e4dc', '#1b1d20', '#8a8f96', '#c79a3b', '#2f7f7a'],
    motorbike: ['#ffffff', '#151617', '#5c1820', '#3d4b2c', '#1f2f55', '#8a8f96', '#151617', '#ffffff'],
    bus: ['#ffffff', '#2f7a3a', '#a8231c', '#ffffff', '#3a3f8f', '#ffffff', '#2f7a3a', '#ffffff'],
  }).map(([name, hexes]) => [name, hexes.map((hex) => new THREE.Color(hex))]),
);

/** A vehicle standing on the street, as found by `nearestVehicle`. */
export interface ParkedVehicle {
  kind: { name: string };
  index: number;
  item: Item;
}

interface Item {
  x: number;
  y: number;
  z: number;
  rotation: number;
  variant: number;
}

interface Kind {
  name: string;
  /** Kenney model file, when this kind uses a textured model instead of a code model. */
  textured?: { path: string; fit: TexturedFit };
  /** Own material (textured models); otherwise the shared vehicle material. */
  material?: THREE.MeshStandardMaterial[];
  items: Item[];
  /** Half sizes for the solid box (0 = you can walk through it). */
  half: [number, number, number];
  mesh: THREE.InstancedMesh | null;
  /** Invisible copies of only the nearest ones, to cast sun shadows (layer 1). */
  shadow: THREE.InstancedMesh | null;
}

const MAX_SHOWN = 60; // per kind, nearest first

/**
 * Cars use Kenney's Car Kit (CC0) — two looks per type, picked by the car's colour variant.
 * Autos, two-wheelers, buses, carts and bus stops keep our own code models.
 */
const KENNEY: Record<string, { files: string[]; width: number }> = {
  hatchback: { files: ['hatchback-sports'], width: 1.7 },
  sedan: { files: ['sedan', 'sedan-sports'], width: 1.78 },
  suv: { files: ['suv', 'suv-luxury'], width: 1.88 },
  taxi: { files: ['taxi'], width: 1.75 },
  van: { files: ['van'], width: 1.8 },
  ambulance: { files: ['ambulance'], width: 2.0 },
  truck: { files: ['truck'], width: 2.1 },
  delivery: { files: ['delivery'], width: 2.1 },
};
/**
 * Indian vehicles from Sketchfab (CC-BY, credited in CREDITS.md), scaled to real lengths.
 * `turn` makes the front face -z like the Kenney cars.
 */
const SKETCHFAB: Record<string, TexturedFit> = {
  auto: { length: 2.7, turn: 0, paint: { hue: 155, range: 22, minSat: 0.2, ref: 0.047 } },
  two_wheeler: { length: 1.8, turn: 0, paint: { hue: 150, range: 25, minSat: 0.1, ref: 0.286 } },
  motorbike: { length: 2.15, turn: Math.PI, paint: { hue: 358, range: 18, minSat: 0.35, ref: 0.041 } },
  bus: { length: 11.2, turn: Math.PI, paint: { hue: 205, range: 20, minSat: 0.2, ref: 0.071 } },
};
/** Our own Blender models (tools/blender/vehicles.py) are the fallback if a download is missing. */
const BLENDER_MODELS = new Set(['auto', 'two_wheeler', 'bus', 'motorbike']);
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
    // One kind per model file: each vehicle type may have several looks.
    const byType: Kind[][] = VEHICLE_KINDS.map((name, index) => {
      const [hw, hl] = VEHICLE_HALF[index];
      const half: [number, number, number] = [hw, VEHICLE_HEIGHT[index] / 2, hl];
      const sketchfab = SKETCHFAB[name];
      if (sketchfab) return [{ name, textured: { path: `/models/sketchfab/${name}.glb`, fit: sketchfab }, items: [], half, mesh: null, shadow: null }];
      const kenney = KENNEY[name];
      if (!kenney) return [{ name, items: [], half, mesh: null, shadow: null }];
      return kenney.files.map((file) => ({ name, textured: { path: `/models/kenney/${file}.glb`, fit: { width: kenney.width, turn: Math.PI } }, items: [], half: [...half] as [number, number, number], mesh: null, shadow: null }));
    });
    for (const kinds of byType) this.kinds.push(...kinds);
    for (let i = 0; i < props.vehicles.length; i += VEHICLE_STRIDE) {
      const v = props.vehicles;
      const looks = byType[v[i + 4]];
      looks[v[i + 5] % looks.length].items.push({ x: v[i], y: v[i + 1], z: v[i + 2], rotation: v[i + 3], variant: v[i + 5] });
    }
    const simple = (name: string, data: Float32Array, stride: number, half: [number, number, number]): void => {
      const items: Item[] = [];
      for (let i = 0; i < data.length; i += stride) items.push({ x: data[i], y: data[i + 1], z: data[i + 2], rotation: data[i + 3], variant: 0 });
      this.kinds.push({ name, items, half, mesh: null, shadow: null });
    };
    simple('stall', props.stalls, STALL_STRIDE, [1.0, 1.1, 0.7]);
    simple('bus_stop', props.stops, STOP_STRIDE, [0, 0, 0]);
    simple('water_tank', props.tanks, TANK_STRIDE, [0, 0, 0]);
    for (const kind of this.kinds) {
      if (kind.items.length === 0) continue;
      const ready = kind.textured
        ? loadTexturedModel(kind.textured.path, kind.textured.fit).then((model) => {
            if (!model) return BLENDER_MODELS.has(kind.name) ? loadModel(kind.name) : streetModel(kind.name); // fall back to our own model
            for (const m of model.material) m.envMap = this.material.envMap;
            kind.material = model.material;
            kind.half = [model.halfWidth, kind.half[1], model.halfLength];
            return model.geometry;
          })
        : // Our own Blender models win; the built-in-code shapes are the fallback.
          (BLENDER_MODELS.has(kind.name) ? loadModel(kind.name) : Promise.resolve(null)).then((made) => made ?? streetModel(kind.name) ?? loadModel(kind.name));
      void ready.then((geometry) => {
        if (!geometry) return;
        const material = kind.material ?? this.material;
        const mesh = new THREE.InstancedMesh(geometry, material, Math.min(MAX_SHOWN, kind.items.length));
        mesh.count = 0;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // copies move around; the set is small anyway
        kind.mesh = mesh;
        const shadow = new THREE.InstancedMesh(geometry, material, Math.min(24, kind.items.length));
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
        const paint = this.paintOf(kind, item.variant);
        if (paint) mesh.setColorAt(i, paint);
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
    this.material.envMapIntensity = 0.1 + 0.3 * (1 - night); // gentle: the studio reflection washes colours out
    // Kenney's light colours already look bright; their reflections are kept softer.
    for (const kind of this.kinds) for (const m of kind.material ?? []) m.envMapIntensity = this.material.envMapIntensity * 1.2;
  }

  /** The nearest parked vehicle within `reach` metres whose model is loaded, or null. */
  nearestVehicle(x: number, z: number, reach: number): ParkedVehicle | null {
    let best: ParkedVehicle | null = null;
    let bestDistance = reach;
    for (const kind of this.kinds) {
      if (!kind.mesh || !(VEHICLE_KINDS as readonly string[]).includes(kind.name)) continue;
      kind.items.forEach((item, index) => {
        const d = Math.hypot(item.x - x, item.z - z);
        if (d < bestDistance) {
          bestDistance = d;
          best = { kind, index, item };
        }
      });
    }
    return best;
  }

  /** Takes a vehicle off the street (you are driving it now). */
  take(parked: ParkedVehicle): void {
    const kind = parked.kind as Kind;
    kind.items.splice(kind.items.indexOf(parked.item), 1);
    this.lastAt = null;
  }

  /** Parks a vehicle where you left it. */
  park(parked: ParkedVehicle, x: number, y: number, z: number, heading: number): void {
    const kind = parked.kind as Kind;
    kind.items.push({ ...parked.item, x, y, z, rotation: heading });
    this.lastAt = null;
  }

  /** Geometry and material to draw the vehicle you are driving. */
  modelOf(parked: ParkedVehicle): { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; paint: THREE.Color | null } | null {
    const kind = parked.kind as Kind;
    if (!kind.mesh) return null;
    const paint = this.paintOf(kind, parked.item.variant);
    return { geometry: kind.mesh.geometry, material: kind.material ?? this.material, paint };
  }

  /** The first loaded model of a vehicle type (to show friends' vehicles). */
  /** The colour a copy is drawn in: null = the model's own colours. */
  private paintOf(kind: Kind, variant: number): THREE.Color | null {
    if (kind.material) return kind.textured?.fit.paint ? BODY_PAINTS[kind.name][variant % 8] : null;
    return NO_PAINT.has(kind.name) ? PAINTS[0] : PAINTS[variant % PAINTS.length];
  }

  /** Colour for a moving vehicle of this type (traffic), or null to keep the model's own. */
  paintFor(name: string, variant: number): THREE.Color | null {
    const kind = this.kinds.find((k) => k.name === name && k.mesh);
    return kind ? this.paintOf(kind, variant) : null;
  }

  modelByName(name: string): { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] } | null {
    const kind = this.kinds.find((k) => k.name === name && k.mesh);
    return kind?.mesh ? { geometry: kind.mesh.geometry, material: kind.material ?? this.material } : null;
  }

  dispose(): void {
    for (const kind of this.kinds) kind.mesh?.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
