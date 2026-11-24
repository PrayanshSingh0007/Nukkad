import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, makeRng } from '@nukkad/shared';
import type { Door, InteriorKind } from '@nukkad/worldgen';

/**
 * The inside of a building, built on this device as you walk up to its front door, right where
 * the building stands: the doorway in the wall opens and you just walk in (no button, no
 * loading), see the street behind you through it, and walk out again. Friends who go in are in
 * the same place and see each other. Everything is boxes merged into ONE mesh with the light
 * baked into the colours (no extra lights = no shader rebuild, cheap on phones), plus solid
 * boxes for physics.
 */

/** The inside's walls stand this far in from the outside of the building. */
const INSET = 0.03;

export interface Solid {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  rotation: number;
  /** Tipped up about its own x axis (radians; + raises its far end): an escalator's slope. */
  pitch?: number;
}

export interface Interior {
  door: Door;
  group: THREE.Group;
  /** Floor height (world), and the room's world transform. */
  floorY: number;
  solids: Solid[];
  /** Chairs, sofas and benches (world position; facing = the avatar's facing angle). */
  seats: { x: number; y: number; z: number; facing: number }[];
  /** The doorway cut in the building's wall: centre on the ground, facing, half width, height, depth into the wall. */
  hole: { x: number; y: number; z: number; face: number; half: number; top: number; depth: number };
  /** Inside the room. */
  contains(x: number, y: number, z: number): boolean;
  /** In the doorway (or just in front of it): the building's outer wall must let you through here. */
  doorway(x: number, y: number, z: number): boolean;
  /** The roof cut away over the stair hut (world centre, yaw, half sizes), if the stairs go up to the roof. */
  roofHole: { x: number; y: number; z: number; yaw: number; hx: number; hy: number; hz: number } | null;
  /** Over the building's footprint (on its roof, say): keep it open while you are up there. */
  covers(x: number, z: number): boolean;
  /** Malls: the escalator you are standing on carries you (world velocity, m/s), or null. */
  escalatorAt(x: number, y: number, z: number): { x: number; y: number; z: number } | null;
  /** Moving parts (escalator steps): call every frame while it is open. */
  update(dt: number): void;
  /** Apartment blocks: the lift (null elsewhere), and its solid boxes now (world). */
  lift: Lift | null;
  liftSolids(): Solid[];
  /** A world point in the room's own frame (x across, y up from the ground floor, z in). */
  local(x: number, y: number, z: number): THREE.Vector3;
  dispose(): void;
}

type Rgb = [number, number, number];
const hex = (value: string): Rgb => {
  const c = new THREE.Color(value);
  return [c.r, c.g, c.b];
};

/** Collects boxes in the room's own frame: x across (door at x = 0), z inward from the door wall, y up from the floor. */
class Room {
  readonly parts: THREE.BufferGeometry[] = [];
  readonly solids: { x: number; y: number; z: number; hx: number; hy: number; hz: number; pitch?: number }[] = [];
  /** Places to sit: room-frame position and which way a sitter faces along z (+1 / -1). */
  readonly seats: { x: number; z: number; dz: 1 | -1; y?: number }[] = [];

  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly rng: () => number;
  /** The doorway: its middle across the room (x), half width and height. */
  readonly doorX: number;
  readonly doorHalf: number;
  readonly doorTop: number;
  /** While the shell is built (walls, floor): nothing is kept out of the way in. */
  structural = false;
  /** The floor being built (apartment blocks have many): its height, for the baked light. */
  baseY = 0;
  /** Added to every box's height (furnishing an upper floor with the usual pieces). */
  oy = 0;
  /** The shell leaves its ceiling out (a house whose stairs go on up through it to the roof). */
  skipCeiling = false;
  /** The top of the ground floor's rooms (inner walls stop here; lower than h in a two-floor house). */
  floorTop = 0;
  /** Areas furniture must keep out of below height y1 (the foot and run of a house's stairs). */
  readonly keep: { x0: number; x1: number; z0: number; z1: number; y1: number }[] = [];

  constructor(w: number, d: number, h: number, rng: () => number, doorX = 0, doorHalf = 0.6, doorTop = 2.2) {
    this.w = w;
    this.d = d;
    this.h = h;
    this.rng = rng;
    this.doorX = doorX;
    this.doorHalf = doorHalf;
    this.doorTop = doorTop;
    this.floorTop = h;
  }

  /** The way in stays clear: furniture that would stand in it is left out. */
  private inTheWay(x0: number, y0: number, y1: number, z0: number, x1: number, z1: number): boolean {
    if (this.structural || y1 <= 0.05) return false;
    for (const k of this.keep) if (Math.min(x0, x1) < k.x1 && Math.max(x0, x1) > k.x0 && Math.min(z0, z1) < k.z1 && Math.max(z0, z1) > k.z0 && Math.min(y0, y1) < k.y1) return true;
    if (y0 > 2.4) return false;
    const a = this.doorX - this.doorHalf - 0.45;
    const b = this.doorX + this.doorHalf + 0.45;
    return Math.min(x0, x1) < b && Math.max(x0, x1) > a && Math.min(z0, z1) < 2.6; // an entry hall behind the door stays clear
  }

  /** A box from (x0, y0, z0) to (x1, y1, z1). `solid` = you bump into it. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string | Rgb, solid = false, glow = false): void {
    y0 += this.oy;
    y1 += this.oy;
    if (this.inTheWay(x0, Math.min(y0, y1), Math.max(y0, y1), z0, x1, z1)) return;
    const sx = Math.abs(x1 - x0);
    const sy = Math.abs(y1 - y0);
    const sz = Math.abs(z1 - z0);
    if (sx < 0.001 || sy < 0.001 || sz < 0.001) return;
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    g.translate(cx, cy, cz);
    g.deleteAttribute('uv');
    const base = typeof color === 'string' ? hex(color) : color;
    const normal = g.getAttribute('normal');
    const position = g.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      // Baked light: lamps in the ceiling, so tops are brightest, undersides darkest,
      // and everything gets a little darker near the floor and the walls.
      let light = 1;
      if (!glow) {
        const ny = normal.getY(i);
        const nx = Math.abs(normal.getX(i));
        light = ny > 0.5 ? 1 : ny < -0.5 ? 0.62 : nx > 0.5 ? 0.8 : 0.88;
        const y = position.getY(i);
        light *= 0.84 + 0.16 * Math.min(1, Math.max(0, y - this.baseY) / 1.2);
        const edge = Math.min(position.getX(i) + this.w / 2, this.w / 2 - position.getX(i), position.getZ(i), this.d - position.getZ(i));
        light *= 0.86 + 0.14 * Math.min(1, Math.max(0, edge) / 2);
      }
      const k = glow ? 1 : light * 0.8;
      colors.set([base[0] * k, base[1] * k, base[2] * k], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    if (solid) this.solids.push({ x: cx, y: cy, z: cz, hx: sx / 2, hy: sy / 2, hz: sz / 2 });
  }

  /** A thin picture on a wall/floor: same as a box, never solid. */
  panel(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string | Rgb, glow = false): void {
    this.box(x0, y0, z0, x1, y1, z1, color, false, glow);
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)];
  }
}

const T = 0.2; // wall thickness

/** Floor, walls, ceiling lights and the way out — the same for every room. */
function shell(r: Room, floor: [string, string], wall: string, tiles = 1): void {
  r.structural = true;
  const { w, d, h } = r;
  // Checked floor tiles (two shades), then walls and ceiling.
  const nx = Math.max(1, Math.round(w / tiles));
  const nz = Math.max(1, Math.round(d / tiles));
  const tw = w / nx;
  const td = d / nz;
  if (nx * nz <= 900) {
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) r.panel(-w / 2 + i * tw, -0.05, k * td, -w / 2 + (i + 1) * tw - 0.01, 0, (k + 1) * td - 0.01, floor[(i + k) % 2]);
  } else r.panel(-w / 2, -0.05, 0, w / 2, 0, d, floor[0]);
  r.box(-w / 2 - T, -0.6, -T, w / 2 + T, -0.05, d + T, '#a39d92', true); // solid floor slab (shows as grout between tiles)
  r.box(-w / 2 - T, 0, -T, -w / 2, h, d + T, wall, true);
  r.box(w / 2, 0, -T, w / 2 + T, h, d + T, wall, true);
  r.box(-w / 2, 0, d, w / 2, h, d + T, wall, true);
  // The door wall, with the doorway in it (where the building's own door is).
  const dx0 = r.doorX - r.doorHalf;
  const dx1 = r.doorX + r.doorHalf;
  r.box(-w / 2, 0, -T, dx0, h, 0, wall, true);
  r.box(dx1, 0, -T, w / 2, h, 0, wall, true);
  r.box(dx0, r.doorTop, -T, dx1, h, 0, wall, true);
  if (!r.skipCeiling) r.box(-w / 2 - T, h, -T, w / 2 + T, h + 0.2, d + T, '#f3f1ec', true); // ceiling
  // Skirting.
  r.panel(-w / 2, 0, d - 0.02, w / 2, 0.1, d, '#8b8378');
  r.panel(-w / 2, 0, 0.0, -w / 2 + 0.02, 0.1, d, '#8b8378');
  r.panel(w / 2 - 0.02, 0, 0, w / 2, 0.1, d, '#8b8378');
  // Ceiling lamps every ~4 m (glowing panels).
  for (let x = -w / 2 + 2; x < w / 2 - 1; x += 4) for (let z = 2; z < d - 1; z += 4) r.panel(x - 0.5, h - 0.03, z - 0.25, x + 0.5, h, z + 0.25, '#ffffff', true);
  doorway(r);
  r.structural = false;
}

/**
 * The doorway: a frame round it, the door itself swung open against the wall (a wooden door)
 * or a green EXIT sign above it (a glass shop door, slid away), and a doormat.
 */
function doorway(r: Room): void {
  const dx0 = r.doorX - r.doorHalf;
  const dx1 = r.doorX + r.doorHalf;
  const h = r.h;
  r.panel(dx0 - 0.1, 0, 0, dx0, r.doorTop + 0.1, 0.03, '#d8d0bf');
  r.panel(dx1, 0, 0, dx1 + 0.1, r.doorTop + 0.1, 0.03, '#d8d0bf');
  r.panel(dx0, r.doorTop, 0, dx1, r.doorTop + 0.1, 0.03, '#d8d0bf');
  r.panel(dx0, r.doorTop - 0.02, -T, dx1, r.doorTop, 0, '#d8d0bf');
  r.panel(dx0, 0, -T, dx0 + 0.02, r.doorTop, 0, '#d8d0bf');
  r.panel(dx1 - 0.02, 0, -T, dx1, r.doorTop, 0, '#d8d0bf');
  if (r.doorHalf < 0.9) r.panel(dx0 - 0.06, 0.01, 0.04, dx0 - 0.01, r.doorTop - 0.03, 0.04 + 2 * r.doorHalf - 0.08, '#5c3d2a');
  else if (r.doorTop + 0.36 < h) r.panel(r.doorX - 0.3, r.doorTop + 0.16, 0, r.doorX + 0.3, r.doorTop + 0.34, 0.05, '#1fa35a', true);
  r.panel(dx0 + 0.05, 0, 0.1, dx1 - 0.05, 0.01, 1.0, '#7a4b3a');
}

/** Windows: bright panels on the side walls (daylight look). */
function windows(r: Room, every = 3.2, sill = 0.9, top = 2.3): void {
  for (let z = 1.5; z < r.d - 1; z += every) {
    r.panel(-r.w / 2, sill, z, -r.w / 2 + 0.03, top, z + 1.4, '#d9ecf7', true);
    r.panel(r.w / 2 - 0.03, sill, z, r.w / 2, top, z + 1.4, '#d9ecf7', true);
  }
}

function plant(r: Room, x: number, z: number, big = false): void {
  const s = big ? 1.4 : 1;
  r.box(x - 0.2 * s, 0, z - 0.2 * s, x + 0.2 * s, 0.45 * s, z + 0.2 * s, '#b0674a', true);
  r.box(x - 0.32 * s, 0.45 * s, z - 0.32 * s, x + 0.32 * s, 1.1 * s, z + 0.32 * s, '#3f8a44');
  r.box(x - 0.22 * s, 1.1 * s, z - 0.22 * s, x + 0.22 * s, 1.4 * s, z + 0.22 * s, '#4f9d50');
}

function chair(r: Room, x: number, z: number, facing: 1 | -1, color: string): void {
  r.seats.push({ x, z, dz: facing === 1 ? -1 : 1, y: r.oy });
  r.box(x - 0.22, 0, z - 0.22, x + 0.22, 0.45, z + 0.22, color, true);
  r.box(x - 0.22, 0.45, z + facing * 0.18, x + 0.22, 0.95, z + facing * 0.22, color);
}

function table(r: Room, x: number, z: number, w: number, d: number, color: string, h = 0.75): void {
  r.box(x - w / 2, h - 0.05, z - d / 2, x + w / 2, h, z + d / 2, color, true);
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    r.box(x + a * (w / 2 - 0.06) - 0.03, 0, z + b * (d / 2 - 0.06) - 0.03, x + a * (w / 2 - 0.06) + 0.03, h - 0.05, z + b * (d / 2 - 0.06) + 0.03, '#3b3632', true);
}

const PRODUCT = ['#d9433b', '#f2b134', '#3f8fd2', '#58b368', '#f07f2f', '#8e5bc7', '#f1f1ea', '#e85d9a', '#2e7d6b', '#c49a5a'];

function shelves(r: Room, x0: number, x1: number, z: number, height = 1.8): void {
  r.box(x0, 0, z - 0.35, x1, height, z + 0.35, '#c9ccd0', true);
  for (let level = 0.25; level < height - 0.1; level += 0.42) {
    for (const side of [-1, 1]) {
      let x = x0 + 0.05;
      while (x < x1 - 0.2) {
        const bw = 0.12 + r.rng() * 0.18;
        const bh = 0.15 + r.rng() * 0.2;
        r.panel(x, level, side > 0 ? z + 0.35 : z - 0.45, x + bw - 0.02, level + bh, side > 0 ? z + 0.45 : z - 0.35, r.pick(PRODUCT));
        x += bw;
      }
    }
  }
}

function counter(r: Room, x: number, z: number, w: number, color = '#9a7b5a'): void {
  r.box(x - w / 2, 0, z - 0.35, x + w / 2, 1.0, z + 0.35, color, true);
  r.panel(x - w / 2 - 0.03, 1.0, z - 0.4, x + w / 2 + 0.03, 1.05, z + 0.4, '#e9e4da');
}

// ---------- One layout per kind. All are friendly, everyday Bengaluru places. ----------

function home(r: Room): void {
  shell(r, ['#d8c9ad', '#cfbfa2'], r.pick(['#f1e9dc', '#e6eef0', '#f3e4d4', '#e9f0e3']), 0.6);
  windows(r, 3.5);
  const { w, d } = r;
  // The living room and kitchen go on the side away from the door, so the way in stays free.
  const L = r.doorX > 0 ? -1 : 1;
  const rack = r.doorX - L * (r.doorHalf + 0.5);
  r.box(rack - 0.2, 0, 0.1, rack + 0.2, 0.9, 0.5, '#7b5a40', true); // shoe rack by the door
  // Living room (front half): sofa, coffee table, TV wall, rug.
  const lz = Math.min(d * 0.45, 5);
  const cx = L * (w / 4 + 0.2);
  r.panel(cx + -1.4, 0.001, lz - 1.4, cx + 1.4, 0.012, lz + 0.6, r.pick(['#a8463a', '#3e5f8a', '#7a5c2e']));
  r.box(cx + -1.3, 0, lz + 0.6, cx + 1.3, 0.45, lz + 1.4, '#6d7c8c', true); // sofa seat
  for (const sx of [-0.8, 0, 0.8]) r.seats.push({ x: cx + sx, z: lz + 0.85, dz: -1 });
  r.box(cx + -1.3, 0.45, lz + 1.15, cx + 1.3, 0.95, lz + 1.4, '#64727f'); // back
  r.box(cx + -1.45, 0, lz + 0.6, cx + -1.3, 0.65, lz + 1.4, '#64727f', true);
  r.box(cx + 1.3, 0, lz + 0.6, cx + 1.45, 0.65, lz + 1.4, '#64727f', true);
  table(r, cx, lz - 0.3, 1.0, 0.55, '#8a6544', 0.42);
  r.box(cx + -1.1, 0, lz - 2.3, cx + 1.1, 0.5, lz - 1.9, '#5b4636', true); // TV unit
  r.panel(cx + -0.8, 0.8, lz - 2.2, cx + 0.8, 1.6, lz - 2.15, '#15181d'); // TV
  plant(r, L * (w / 2 - 0.6), 1.0);
  // Kitchen along the side wall behind the living room: counter, stove, fridge.
  const K = (a: number): number => L * (w / 2 - 0.35 + a);
  if (d > 6) {
    r.box(K(-0.3), 0, lz + 2.5, K(0.35), 0.9, lz + 5, '#d6d0c4', true);
    r.panel(K(-0.32), 0.9, lz + 2.5, K(0.35), 0.94, lz + 5, '#3a3a3a');
    r.panel(K(-0.25), 0.94, lz + 3, K(0.2), 0.96, lz + 3.6, '#202020'); // stove
    r.box(K(-0.35), 0, lz + 5.1, K(0.35), 1.8, lz + 5.8, '#e4e6e8', true); // fridge
  }
  // Dining table.
  if (w > 6 && d > 7) {
    table(r, -L * w / 4, lz + 3.3, 1.4, 0.8, '#7c5a3c');
    for (const s of [-1, 1] as const) {
      chair(r, -L * w / 4 - 0.35, lz + 3.3 + s * 0.7, s, '#6a4c33');
      chair(r, -L * w / 4 + 0.35, lz + 3.3 + s * 0.7, s, '#6a4c33');
    }
  }
  // Bedroom at the back behind a partition with a doorway.
  if (d > 9) {
    const bz = d - 4.2;
    r.box(-w / 2, 0, bz, -0.6, r.floorTop, bz + 0.12, '#ece4d8', true);
    r.box(0.6, 0, bz, w / 2, r.floorTop, bz + 0.12, '#ece4d8', true);
    r.box(-1, 0, d - 2.3, 1, 0.5, d - 0.1, '#e9e2d5', true); // bed
    r.panel(-1, 0.5, d - 2.3, 1, 0.56, d - 0.1, r.pick(['#4b6ea8', '#b55a7a', '#5e9a72']));
    r.box(-1.05, 0, d - 0.2, 1.05, 1.1, d - 0.05, '#6b4a33', true); // headboard
    r.box(-w / 2 + 0.05, 0, d - 2, -w / 2 + 0.65, 2.1, d - 0.1, '#8a6a4c', true); // wardrobe
  }
  // A small prayer shelf with a lamp (common in Bengaluru homes).
  r.panel(-w / 2 + 0.02, 1.3, 1.6, -w / 2 + 0.3, 1.34, 2.2, '#7b5a40');
  r.panel(-w / 2 + 0.1, 1.34, 1.85, -w / 2 + 0.16, 1.42, 1.95, '#ffcf6b', true);
}

function supermarket(r: Room): void {
  shell(r, ['#e9ebe8', '#dfe2df'], '#f4f4f1', 0.6);
  const { w, d } = r;
  // Checkout counters near the entrance.
  for (let x = -w / 2 + 2; x < w / 2 - 2; x += 2.6) {
    if (x > -1.8 && x < 1.4) continue; // a clear way in from the door
    r.box(x, 0, 2.2, x + 0.6, 0.9, 3.6, '#4f5a66', true);
    r.panel(x + 0.1, 0.9, 2.4, x + 0.5, 1.2, 2.6, '#1c1f24');
  }
  // Aisles of shelves.
  // Aisles of shelves, with a wide centre aisle straight from the entrance to the fridges.
  for (let z = 5; z < d - 2.5; z += 2.6) {
    shelves(r, -w / 2 + 1.5, -1.3, z);
    shelves(r, 1.3, w / 2 - 1.5, z);
  }
  // Fridges along the back wall.
  r.box(-w / 2 + 0.5, 0, d - 0.9, w / 2 - 0.5, 2.1, d - 0.05, '#cfe6f2', true);
  for (let x = -w / 2 + 0.7; x < w / 2 - 0.8; x += 0.8) r.panel(x, 0.2, d - 0.95, x + 0.6, 1.9, d - 0.9, '#9fc3d6', true);
  // Section boards hanging from the ceiling.
  for (let z = 6; z < d - 3; z += 5.2) r.panel(-1.2, r.h - 0.9, z, 1.2, r.h - 0.5, z + 0.05, r.pick(['#2e8b57', '#d9433b', '#f2b134']), true);
}

function mall(r: Room): void {
  shell(r, ['#e8e2d6', '#d9d2c4'], '#f3efe7', 1.2);
  const { w, d, h } = r;
  // Shop fronts along the side walls: glass with a coloured fascia.
  for (const side of [-1, 1]) {
    for (let z = 2; z < d - 3; z += 6) {
      const x = side * (w / 2 - 0.05);
      r.panel(x - 0.04 * side, 0, z, x, 3.2, z + 5.4, '#9bc2d1', true);
      r.panel(x - 0.08 * side, 3.3, z, x, 4.0, z + 5.4, r.pick(['#c0392b', '#2c3e50', '#16a085', '#8e44ad', '#d35400', '#2980b9']), true);
    }
  }
  // Centre: fountain, benches, plants, an information kiosk.
  const cz = d / 2;
  r.box(-2, 0, cz - 2, 2, 0.45, cz + 2, '#cfc6b6', true);
  r.panel(-1.7, 0.45, cz - 1.7, 1.7, 0.47, cz + 1.7, '#5fb2d6', true);
  r.box(-0.3, 0.45, cz - 0.3, 0.3, 1.6, cz + 0.3, '#d9d2c4', true);
  for (const s of [-1, 1]) {
    r.box(s * 4 - 1, 0, cz - 0.3, s * 4 + 1, 0.45, cz + 0.3, '#8a6a4c', true);
    r.seats.push({ x: s * 4 - 0.5, z: cz, dz: -1 }, { x: s * 4 + 0.5, z: cz, dz: 1 });
    plant(r, s * 4, cz + 2.5, true);
    plant(r, s * 4, cz - 2.5, true);
  }
  counter(r, 5, 4, 2.4, '#3d5a73');
  // Upper floor balcony band (decor) and a skylight strip.
  r.panel(-w / 2, h * 0.55, 0, w / 2, h * 0.55 + 0.3, 0.1, '#d9d2c4');
  r.panel(-1.5, h - 0.02, 2, 1.5, h, d - 2, '#eaf6ff', true);
}

function showroom(r: Room): void {
  shell(r, ['#d9dde0', '#cfd3d6'], '#f2f3f4', 1.2);
  const { w, d } = r;
  // Raised display stands (the cars are added on top, see CAR_SPOTS).
  for (let i = 0; i < 3; i++) {
    const z = 4 + i * ((d - 6) / 3);
    r.box(-2.6, 0, z, 2.6, 0.12, z + 4.4, '#e9ecef', true);
    r.box(-2.0, 0.12, z + 1.2, 2.0, 1.4, z + 3.2, '#e9ecef', true); // (hidden by the car standing on it)
  }
  r.box(w / 2 - 3.5, 0, 2, w / 2 - 0.8, 1.05, 2.8, '#2d3640', true); // reception
  r.panel(w / 2 - 3.4, 1.05, 2, w / 2 - 0.9, 1.08, 2.8, '#e9ecef');
  chair(r, w / 2 - 2.2, 3.3, 1, '#20262c');
  plant(r, -w / 2 + 0.8, 1.2, true);
  windows(r, 2.2, 0.2, 3.4);
}

function school(r: Room): void {
  shell(r, ['#cfc6b0', '#c5bca5'], '#f0ead6', 0.6);
  windows(r, 2.6);
  const { w, d } = r;
  r.panel(-2, 0.9, d - 0.06, 2, 2.1, d - 0.02, '#2f4f3a'); // blackboard
  r.panel(-2.1, 0.85, d - 0.08, 2.1, 0.9, d - 0.02, '#a88b5f');
  table(r, 0, d - 1.8, 1.4, 0.7, '#7b5a40');
  // Rows of desks with benches, facing the board.
  for (let z = 2; z < d - 3.2; z += 1.4) {
    for (let x = -w / 2 + 1; x < w / 2 - 1.3; x += 1.6) {
      if (x + 1.2 > -0.7 && x < 0.7) continue;
      r.box(x, 0.7, z + 0.35, x + 1.2, 0.75, z + 0.85, '#8a6a4c', true);
      r.box(x + 0.05, 0, z + 0.4, x + 0.1, 0.7, z + 0.8, '#3b3632');
      r.box(x + 1.1, 0, z + 0.4, x + 1.15, 0.7, z + 0.8, '#3b3632');
      r.box(x, 0, z, x + 1.2, 0.42, z + 0.25, '#7a5c40', true); // bench
      r.seats.push({ x: x + 0.3, z: z + 0.1, dz: 1 }, { x: x + 0.9, z: z + 0.1, dz: 1 });
    }
  }
  // Ceiling fans.
  for (let z = 3; z < d - 2; z += 4) {
    r.box(-0.05, r.h - 0.4, z - 0.05, 0.05, r.h, z + 0.05, '#555');
    r.panel(-0.7, r.h - 0.42, z - 0.06, 0.7, r.h - 0.4, z + 0.06, '#7a7a7a');
    r.panel(-0.06, r.h - 0.42, z - 0.7, 0.06, r.h - 0.4, z + 0.7, '#7a7a7a');
  }
}

function office(r: Room): void {
  shell(r, ['#8f9aa3', '#86919a'], '#eef0f2', 0.6);
  windows(r, 2.2, 0.8, 2.6);
  const { w, d } = r;
  counter(r, w / 4 + 0.5, 2.6, 2.6, '#2f3e4c'); // reception
  for (let z = 5; z < d - 1.5; z += 2.4) {
    for (let x = -w / 2 + 1; x < w / 2 - 1.6; x += 2.2) {
      if (x + 1.6 > -0.8 && x < 0.8) continue;
      table(r, x + 0.75, z, 1.5, 0.75, '#e6e1d6');
      r.panel(x + 0.5, 0.75, z + 0.05, x + 1.0, 1.1, z + 0.08, '#15181d'); // monitor
      chair(r, x + 0.75, z - 0.65, -1, '#2b2f36');
    }
  }
  r.box(-w / 2 + 0.3, 0, 1.2, -w / 2 + 0.7, 1.2, 1.6, '#cfe3f0', true); // water cooler
  plant(r, w / 2 - 0.7, 1.2);
}

function food(r: Room): void {
  shell(r, ['#b98a5e', '#ad7f55'], r.pick(['#f6e3c4', '#f1d6c8', '#e9ecd8']), 0.5);
  windows(r, 3);
  const { w, d } = r;
  counter(r, 0, d - 1.4, Math.min(w - 2, 5), '#7a4b2f');
  r.panel(-2, 1.7, d - 0.06, 2, 2.5, d - 0.02, '#2c2c2c'); // menu board
  for (let k = 0; k < 4; k++) r.panel(-1.8 + k, 1.8, d - 0.07, -1.1 + k, 2.4, d - 0.06, '#f2e2b0', true);
  for (let z = 2.2; z < d - 3; z += 2) {
    for (let x = -w / 2 + 1.3; x < w / 2 - 1; x += 2.2) {
      if (Math.abs(x) < 1.3) continue;
      table(r, x, z, 0.8, 0.8, '#d8cbb5');
      chair(r, x, z - 0.65, -1, '#a0522d');
      chair(r, x, z + 0.65, 1, '#a0522d');
    }
  }
}

function shop(r: Room): void {
  shell(r, ['#e2ddd2', '#d8d2c6'], r.pick(['#f5f1e8', '#eaf2f4', '#f6ece4']), 0.6);
  const { w, d } = r;
  counter(r, 0, d - 1.2, Math.min(w - 1.5, 3.5));
  // Wall shelves full of goods on both sides, a rack in the middle.
  for (const side of [-1, 1]) {
    r.box(side * (w / 2 - 0.25) - 0.25, 0, 1.5, side * (w / 2 - 0.25) + 0.25, 2.2, d - 2.4, '#c9b79c', true);
    for (let z = 1.6; z < d - 2.6; z += 0.35)
      for (let y = 0.3; y < 2.1; y += 0.45) r.panel(side * (w / 2 - 0.52) - 0.02, y, z, side * (w / 2 - 0.5), y + 0.3, z + 0.28, r.pick(PRODUCT));
  }
  if (w > 5 && d > 6) shelves(r, -1.2, 1.2, d / 2, 1.4);
}

function worship(r: Room): void {
  shell(r, ['#efe6d2', '#e6dcc6'], '#f6eedd', 0.8);
  const { w, d } = r;
  r.panel(-w / 2 + 1, 0.001, 1.5, w / 2 - 1, 0.012, d - 3, '#9b2d2d'); // long carpet
  r.box(-2, 0, d - 2.2, 2, 0.6, d - 0.3, '#d9c7a0', true); // raised platform
  r.panel(-1.2, 0.6, d - 1.2, 1.2, 2.6, d - 0.35, '#c99a3d', true); // plain golden arch (no figure)
  for (const s of [-1.5, 1.5]) r.box(s - 0.1, 0.6, d - 1.6, s + 0.1, 1.4, d - 1.4, '#ffcf6b', false, true); // lamps
  for (let z = 2; z < d - 3; z += 3) for (const s of [-1, 1]) r.box(s * (w / 2 - 1.2) - 0.25, 0, z, s * (w / 2 - 1.2) + 0.25, r.h, z + 0.5, '#e9dcc0', true); // pillars
}

function hotel(r: Room): void {
  shell(r, ['#c8b48f', '#bda883'], '#f2e8d6', 0.9);
  const { w, d } = r;
  counter(r, 0, d - 1.6, 3.5, '#5a3d2b');
  for (const s of [-1, 1]) {
    r.box(s * (w / 4) - 1, 0, 3, s * (w / 4) + 1, 0.45, 3.8, '#7a2e2e', true);
    r.seats.push({ x: s * (w / 4) - 0.5, z: 3.25, dz: -1 }, { x: s * (w / 4) + 0.5, z: 3.25, dz: -1 });
    r.box(s * (w / 4) - 1, 0.45, 3.6, s * (w / 4) + 1, 0.9, 3.8, '#6a2828');
    plant(r, s * (w / 2 - 0.8), 1.2, true);
  }
  table(r, 0, 3.4, 1.2, 0.6, '#3a2a20', 0.42);
}

function clinic(r: Room): void {
  shell(r, ['#e6eef0', '#dde6e8'], '#f6fafb', 0.6);
  const { w, d } = r;
  counter(r, w / 4 + 0.4, 2.6, 2.4, '#4b8fb3');
  for (let x = -w / 2 + 0.8; x < w / 2 - 0.8; x += 0.6) chair(r, x, d - 1.2, 1, '#4b8fb3');
  r.panel(-0.3, 2.1, d - 0.06, 0.3, 2.3, d - 0.02, '#2fa86b', true); // green cross board (plain)
  r.panel(-0.1, 1.9, d - 0.07, 0.1, 2.5, d - 0.06, '#2fa86b', true);
}

function gym(r: Room): void {
  shell(r, ['#2f3236', '#383b40'], '#d9dde0', 1);
  const { w, d } = r;
  for (let z = 2.5; z < d - 1.5; z += 2.4) {
    for (let x = -w / 2 + 1.2; x < w / 2 - 1.2; x += 2.4) {
      if (Math.abs(x) < 1.1) continue;
      r.box(x - 0.35, 0, z - 0.9, x + 0.35, 0.3, z + 0.9, '#1d1f22', true); // treadmill / bench
      r.box(x - 0.3, 0.3, z + 0.6, x + 0.3, 1.3, z + 0.7, '#5a5f66');
    }
  }
  r.panel(-w / 2 + 0.02, 0.4, 1.5, -w / 2 + 0.05, 2.2, d - 1.5, '#b8d8e8', true); // mirror wall
}

function warehouse(r: Room): void {
  shell(r, ['#9a9a96', '#90908c'], '#c8c6c0', 2);
  const { w, d } = r;
  for (let z = 3; z < d - 2; z += 3.2) {
    r.box(-w / 2 + 1, 0, z, -1.2, 0.12, z + 1.2, '#b98a4a', true);
    r.box(1.2, 0, z, w / 2 - 1, 0.12, z + 1.2, '#b98a4a', true);
    for (let x = -w / 2 + 1.2; x < w / 2 - 1.6; x += 1.4) if (Math.abs(x + 0.6) > 1.6) r.box(x, 0.12, z + 0.1, x + 1.2, 0.12 + 0.6 + r.rng() * 0.9, z + 1.1, r.pick(['#b8936a', '#a67c52', '#c9a77c']), true);
  }
}

const LAYOUTS: Record<InteriorKind, { build: (r: Room) => void; height: number; min: [number, number]; max: [number, number] }> = {
  home: { build: home, height: 3, min: [7, 8], max: [12, 13] },
  supermarket: { build: supermarket, height: 4, min: [12, 14], max: [30, 30] },
  mall: { build: mall, height: 7, min: [24, 30], max: [40, 48] },
  showroom: { build: showroom, height: 5, min: [14, 16], max: [22, 24] },
  school: { build: school, height: 3.6, min: [9, 10], max: [12, 14] },
  office: { build: office, height: 3.2, min: [9, 10], max: [20, 20] },
  food: { build: food, height: 3.4, min: [7, 8], max: [14, 14] },
  shop: { build: shop, height: 3.4, min: [5, 6], max: [10, 12] },
  worship: { build: worship, height: 5, min: [8, 10], max: [16, 20] },
  hotel: { build: hotel, height: 4.2, min: [12, 12], max: [18, 16] },
  clinic: { build: clinic, height: 3.2, min: [7, 8], max: [12, 12] },
  gym: { build: gym, height: 3.8, min: [10, 10], max: [16, 18] },
  warehouse: { build: warehouse, height: 6, min: [12, 12], max: [24, 24] },
};

/** What to call a place inside when the map has no name for it. */
export const INTERIOR_NAMES: Record<InteriorKind, string> = {
  home: 'a home',
  supermarket: 'a supermarket',
  mall: 'a mall',
  showroom: 'a car showroom',
  school: 'a classroom',
  office: 'an office',
  food: 'a restaurant',
  shop: 'a shop',
  worship: 'a place of worship',
  hotel: 'a hotel lobby',
  clinic: 'a clinic',
  gym: 'a gym',
  warehouse: 'a warehouse',
};

/** Spots for display cars in a showroom (room frame), filled by the caller with real car models. */
export function carSpots(interior: Interior): { x: number; z: number; heading: number }[] {
  const d = (interior.group.userData.d as number) ?? 16;
  return [0, 1, 2].map((i) => {
    const local = new THREE.Vector3(0, 0, 4 + i * ((d - 6) / 3) + 2.2).applyMatrix4(interior.group.matrixWorld);
    return { x: local.x, z: local.z, heading: interior.group.rotation.y + Math.PI / 2 + (i % 2 ? 0.4 : -0.4) };
  });
}

const material = new THREE.MeshBasicMaterial({ vertexColors: true });

// ---------- Apartment blocks: a lobby, a corridor on every floor, stairs and a lift ----------

/** Where the lift runs, in the room frame (x across, z in, y up from the ground floor). */
export interface LiftShaft {
  /** The car's floor area. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The doors are in the wall from x = x1 to x1 + 0.15, centred on z = doorZ. */
  doorZ: number;
  storey: number;
  floors: number;
}

const STAIR_STONE = '#cfc8bb';
const RAIL = '#3d3a36';
const FLAT_FLOORS: [string, string][] = [
  ['#c9a77c', '#bf9d72'],
  ['#ddd6c8', '#d2cbbc'],
  ['#b88b5e', '#ad8055'],
  ['#e6e0d2', '#dbd4c5'],
];
const CORRIDOR_TILES: [string, string] = ['#d9d4c8', '#cfc9bc'];
const SHOES = ['#2b2b2b', '#8a3b2e', '#c9a13b', '#3b5f8a', '#d8d2c6', '#6b4a33', '#b5476a'];
const RANGOLI = ['#e4572e', '#f2b134', '#ffffff', '#d6338a', '#3f8fd2', '#58b368'];

/** Checked floor tiles over a rectangle, the top at the floor (y = 0, plus the room's offset). */
function tiles(r: Room, x0: number, x1: number, z0: number, z1: number, colours: [string, string], size: number): void {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  const nx = Math.max(1, Math.round((b - a) / size));
  const nz = Math.max(1, Math.round((z1 - z0) / size));
  if (nx * nz > 500) {
    r.panel(a, -0.05, z0, b, 0, z1, colours[0]);
    return;
  }
  const tw = (b - a) / nx;
  const td = (z1 - z0) / nz;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) r.panel(a + i * tw, -0.05, z0 + k * td, a + (i + 1) * tw - 0.01, 0, z0 + (k + 1) * td - 0.01, colours[(i + k) % 2]);
}

/**
 * A window in a wall: a dark frame, bright glass and a cross bar. `axis` = the wall's normal;
 * `at` = the wall's inner face; `into` = which way the room is (+1 / −1); a0..a1 along the wall.
 */
function wallWindow(r: Room, axis: 'x' | 'z', at: number, into: 1 | -1, a0: number, a1: number, y0: number, y1: number): void {
  const put = (t0: number, t1: number, b0: number, b1: number, c0: number, c1: number, colour: string, glow = false): void => {
    if (axis === 'x') r.panel(at + into * t0, c0, b0, at + into * t1, c1, b1, colour, glow);
    else r.panel(b0, c0, at + into * t0, b1, c1, at + into * t1, colour, glow);
  };
  put(0, 0.015, a0 + 0.06, a1 - 0.06, y0 + 0.06, y1 - 0.06, '#cfe2ee', true);
  const frame = '#55595d';
  put(0, 0.035, a0, a1, y0, y0 + 0.07, frame);
  put(0, 0.035, a0, a1, y1 - 0.07, y1, frame);
  put(0, 0.035, a0, a0 + 0.07, y0, y1, frame);
  put(0, 0.035, a1 - 0.07, a1, y0, y1, frame);
  const mid = (a0 + a1) / 2;
  put(0, 0.03, mid - 0.025, mid + 0.025, y0, y1, frame);
  const bar = y0 + (y1 - y0) * 0.62;
  put(0, 0.03, a0, a1, bar - 0.025, bar + 0.025, frame);
}

/** A wall along z (x0..x1 thick) from za to zb, from y up `height`, with doorways (z ranges, 2.1 m high) cut in it. */
function wallAlongZ(r: Room, x0: number, x1: number, za: number, zb: number, y: number, height: number, colour: string, gaps: [number, number][]): void {
  let z = za;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g1 <= za || g0 >= zb) continue;
    if (g0 > z) r.box(x0, y, z, x1, y + height, g0, colour, true);
    r.box(x0, y + 2.1, Math.max(g0, za), x1, y + height, Math.min(g1, zb), colour, true);
    z = g1;
  }
  if (z < zb) r.box(x0, y, z, x1, y + height, zb, colour, true);
}

/** One open flat, furnished: living room by the window, dining table and kitchen by the door. */
function furnishFlat(r: Room, side: -1 | 1, xo: number, xc: number, z0: number, z1: number, y: number, doorZ: number, ceiling: number): void {
  const into = side < 0 ? 1 : -1; // from the outer wall towards the corridor
  const X = (a: number): number => xo + into * a;
  const width = Math.abs(xc - xo);
  const length = z1 - z0;
  r.structural = false;
  r.oy = y;
  r.baseY = y;
  tiles(r, xo, xc, z0, z1, r.pick(FLAT_FLOORS), 0.75);
  for (let z = z0 + 0.7; z + 1.3 < z1 - 0.4; z += 2.4) wallWindow(r, 'x', xo, into, z, z + 1.3, 0.9, 2.2);
  // Sofa against the front partition, facing in; coffee table, rug and TV opposite.
  const a0 = 0.45;
  const a1 = Math.min(width - 1.0, 2.8);
  if (a1 - a0 > 1.3) {
    const sofa = r.pick(['#6d7c8c', '#8a5a44', '#5f7a5a', '#7a6a8a']);
    r.box(X(a0), 0, z0 + 0.1, X(a1), 0.42, z0 + 0.9, sofa, true);
    r.box(X(a0), 0.42, z0 + 0.1, X(a1), 0.92, z0 + 0.36, sofa);
    for (let a = a0 + 0.45; a < a1 - 0.3; a += 0.8) r.seats.push({ x: X(a), z: z0 + 0.7, dz: 1, y });
    const mid = (a0 + a1) / 2;
    r.panel(X(a0 - 0.15), 0.001, z0 + 1.0, X(a1 + 0.15), 0.012, z0 + 2.5, r.pick(['#a8463a', '#3e5f8a', '#7a5c2e', '#4f7a5a']));
    table(r, X(mid), z0 + 1.65, 0.9, 0.5, '#8a6544', 0.42);
    if (length > 4.3) {
      r.box(X(a0), 0, z1 - 0.5, X(a1), 0.5, z1 - 0.1, '#5b4636', true);
      r.panel(X(mid - 0.65), 0.75, z1 - 0.36, X(mid + 0.65), 1.5, z1 - 0.32, '#15181d');
    }
    // Family photos on the wall over the sofa.
    r.panel(X(a0 + 0.3), 1.35, z0 + 0.075, X(a0 + 0.75), 1.75, z0 + 0.09, '#6b4a33');
    r.panel(X(a0 + 0.95), 1.45, z0 + 0.075, X(a0 + 1.3), 1.8, z0 + 0.09, '#8a6a4c');
  }
  // Dining table nearer the corridor.
  if (width > 4.3 && length > 4.2) {
    const a = width - 1.5;
    const z = z0 + length * 0.55;
    table(r, X(a), z, 1.2, 0.75, '#7c5a3c');
    chair(r, X(a), z - 0.65, -1, '#6a4c33');
    chair(r, X(a), z + 0.65, 1, '#6a4c33');
  }
  // Kitchen counter along the corridor wall, and a fridge in the corner.
  if (doorZ - 0.75 - (z0 + 0.15) > 1.0) {
    r.box(X(width - 0.62), 0, z0 + 0.15, X(width - 0.05), 0.9, doorZ - 0.75, '#d6d0c4', true);
    r.panel(X(width - 0.64), 0.9, z0 + 0.15, X(width - 0.05), 0.94, doorZ - 0.75, '#3a3a3a');
    r.panel(X(width - 0.55), 0.94, z0 + 0.4, X(width - 0.12), 0.96, z0 + 0.9, '#202020');
  }
  if (z1 - 0.85 > doorZ + 0.75) r.box(X(width - 0.7), 0, z1 - 0.8, X(width - 0.05), 1.8, z1 - 0.12, '#e4e6e8', true);
  plant(r, X(0.4), z1 - 0.5);
  // A small prayer shelf with a lamp, and the ceiling light.
  r.panel(X(width * 0.5 - 0.3), 1.3, z1 - 0.1, X(width * 0.5 + 0.3), 1.34, z1 - 0.075, '#7b5a40');
  r.panel(X(width * 0.5 - 0.04), 1.34, z1 - 0.1, X(width * 0.5 + 0.04), 1.42, z1 - 0.09, '#ffcf6b', true);
  r.panel(X(width * 0.5 - 0.5), ceiling - y - 0.02, z0 + length / 2 - 0.3, X(width * 0.5 + 0.5), ceiling - y, z0 + length / 2 + 0.3, '#ffffff', true);
  r.oy = 0;
}

/** A shut flat door seen from the corridor: door, number plate, doormat, shoes, sometimes a rangoli. */
function shutFlat(r: Room, face: number, toward: 1 | -1, doorZ: number, y: number): void {
  r.structural = false;
  r.oy = y;
  const at = (t0: number, t1: number): [number, number] => [face + toward * t0, face + toward * t1];
  const [d0, d1] = at(0, 0.03);
  r.panel(d0, 0, doorZ - 0.48, d1, 2.05, doorZ + 0.48, r.pick(['#5c3d2a', '#6b4a33', '#7b5a40', '#4a3426']));
  const [p0, p1] = at(0.03, 0.045);
  r.panel(p0, 1.55, doorZ - 0.09, p1, 1.67, doorZ + 0.09, '#c9b06a');
  r.panel(p0, 0.95, doorZ + 0.3, p1, 1.08, doorZ + 0.36, '#c9b06a');
  const [m0, m1] = at(0.05, 0.6);
  if (r.rng() < 0.35) {
    // A rangoli: coloured squares, one inside the other.
    const [k0, k1] = at(0.65, 1.35);
    const c = (k0 + k1) / 2;
    for (let i = 0; i < 4; i++) {
      const s = 0.34 - i * 0.08;
      r.panel(c - s, 0.001 + i * 0.002, doorZ - s, c + s, 0.003 + i * 0.002, doorZ + s, r.pick(RANGOLI));
    }
  }
  r.panel(m0, 0.001, doorZ - 0.45, m1, 0.012, doorZ + 0.45, r.pick(['#7a4b3a', '#4b5e7a', '#7a6a3a']));
  // Shoes and slippers left outside, by the door.
  const pairs = 1 + Math.floor(r.rng() * 3);
  for (let i = 0; i < pairs; i++) {
    const [s0, s1] = at(0.12 + i * 0.22, 0.22 + i * 0.22);
    const z = doorZ + 0.6 + r.rng() * 0.2;
    const colour = r.pick(SHOES);
    r.panel(s0, 0, z, s1, 0.07, z + 0.11, colour);
    r.panel(s0, 0, z + 0.14, s1, 0.07, z + 0.25, colour);
  }
  r.oy = 0;
}

/** What a many-floored building is: an apartment block, an office block, or a hotel. */
type BlockKind = 'flats' | 'office' | 'hotel' | 'school' | 'clinic';

/** A ceiling fan (every Indian home has them): a hub and three blades, just under the ceiling. */
function ceilingFan(r: Room, x: number, z: number, ceiling: number): void {
  r.panel(x - 0.02, ceiling - 0.3, z - 0.02, x + 0.02, ceiling, z + 0.02, '#8d9296');
  r.panel(x - 0.11, ceiling - 0.38, z - 0.11, x + 0.11, ceiling - 0.3, z + 0.11, '#e9e6df');
  r.panel(x + 0.1, ceiling - 0.35, z - 0.06, x + 0.68, ceiling - 0.33, z + 0.06, '#d8d2c6');
  for (const a of [2.094, 4.189]) {
    const cx = x + Math.cos(a) * 0.39;
    const cz = z + Math.sin(a) * 0.39;
    r.panel(cx - 0.2, ceiling - 0.35, cz - 0.2, cx + 0.2, ceiling - 0.33, cz + 0.2, '#d8d2c6');
  }
}

/** An office floor's open plan on one side of the aisle: rows of shared desks with monitors and chairs, a pantry, plants, a whiteboard. */
function furnishOffice(r: Room, xo: number, xc: number, z0: number, z1: number, y: number, ceiling: number): void {
  const into = xo < xc ? 1 : -1;
  const X = (a: number): number => xo + into * a;
  const width = Math.abs(xc - xo);
  r.structural = false;
  r.oy = y;
  r.baseY = y;
  for (let z = z0 + 0.6; z + 1.6 < z1 - 0.3; z += 2.4) wallWindow(r, 'x', xo, into, z, z + 1.6, 0.8, 2.3);
  const a0 = 0.7;
  const a1 = width - 0.9;
  if (a1 - a0 >= 1.4) {
    for (let z = z0 + 1.1; z + 1.4 + 1.0 < z1 - 1.2; z += 3.7) {
      r.box(X(a0), 0.7, z, X(a1), 0.74, z + 1.4, '#e9e6df', true);
      r.box(X(a0), 0, z + 0.1, X(a0 + 0.05), 0.7, z + 1.3, '#7d8288', true);
      r.box(X(a1 - 0.05), 0, z + 0.1, X(a1), 0.7, z + 1.3, '#7d8288', true);
      r.panel(X(a0), 0.74, z + 0.68, X(a1), 1.08, z + 0.72, '#6f8fa8');
      for (let a = a0 + 0.6; a < a1 - 0.3; a += 1.2) {
        for (const [screen, keys] of [
          [z + 0.5, z + 0.18],
          [z + 0.87, z + 1.07],
        ]) {
          r.panel(X(a - 0.28), 0.88, screen, X(a + 0.28), 1.22, screen + 0.03, '#1a1d21');
          r.panel(X(a - 0.24), 0.92, screen - 0.003, X(a + 0.24), 1.18, screen + 0.033, r.pick(['#2f4b66', '#24384f', '#3a5a3a', '#4a3f66']), true);
          r.panel(X(a - 0.03), 0.74, screen + 0.03, X(a + 0.03), 0.88, screen + 0.06, '#3a3d40');
          r.panel(X(a - 0.2), 0.74, keys, X(a + 0.2), 0.755, keys + 0.14, '#2b2e31');
        }
        chair(r, X(a), z - 0.45, -1, '#2b2f35');
        chair(r, X(a), z + 1.85, 1, '#2b2f35');
      }
    }
  }
  // Pantry at the back by the window: a counter, a coffee machine, a water cooler.
  if (z1 - z0 > 5) {
    r.box(X(0.05), 0, z1 - 1.9, X(0.65), 0.9, z1 - 0.2, '#d6d0c4', true);
    r.panel(X(0.15), 0.9, z1 - 1.6, X(0.45), 1.25, z1 - 1.3, '#2b2e31');
    r.box(X(0.8), 0, z1 - 0.55, X(1.15), 1.05, z1 - 0.2, '#e9eef2', true);
    r.panel(X(0.86), 1.05, z1 - 0.5, X(1.09), 1.4, z1 - 0.25, '#9fd0ea', true);
  }
  // A whiteboard on the back wall, plants at the corners.
  if (width > 3.4) r.panel(X(width * 0.5 - 0.9), 1.0, z1 - 0.02, X(width * 0.5 + 0.9), 2.0, z1, '#fbfbf9', true);
  plant(r, X(0.4), z0 + 0.5, true);
  plant(r, X(width - 0.5), z1 - 0.5);
  for (let a = 1.2; a < width - 0.6; a += 2.4) for (let z = z0 + 1.2; z < z1 - 0.6; z += 2.4) r.panel(X(a - 0.5), ceiling - y - 0.02, z - 0.25, X(a + 0.5), ceiling - y, z + 0.25, '#ffffff', true);
  r.oy = 0;
}

/** A hotel room, door open: a made double bed, bedside lamps, a desk, an armchair by the window, a TV, a wardrobe, a luggage rack. */
function furnishHotelRoom(r: Room, side: -1 | 1, xo: number, xc: number, z0: number, z1: number, y: number, doorZ: number, ceiling: number): void {
  const into = side < 0 ? 1 : -1;
  const X = (a: number): number => xo + into * a;
  const width = Math.abs(xc - xo);
  const length = z1 - z0;
  r.structural = false;
  r.oy = y;
  r.baseY = y;
  r.panel(xo, -0.05, z0, xc, 0, z1, r.pick(['#8c6f55', '#6f5a7a', '#7a6248']));
  for (let z = z0 + 0.6; z + 1.4 < z1 - 0.3; z += 2.4) wallWindow(r, 'x', xo, into, z, z + 1.4, 0.7, 2.3);
  // The bed, head against the far wall.
  if (length > 3.2 && width > 2.6) {
    const b0 = Math.min(Math.max(0.7, (width - 1.6) / 2 - 0.3), width - 2.3);
    const b1 = b0 + 1.6;
    r.box(X(b0 - 0.1), 0, z1 - 0.13, X(b1 + 0.1), 1.25, z1 - 0.05, '#5a3c28', true); // headboard
    r.box(X(b0), 0, z1 - 2.15, X(b1), 0.5, z1 - 0.13, '#e9e2d5', true);
    r.panel(X(b0), 0.5, z1 - 2.15, X(b1), 0.6, z1 - 0.4, '#f8f7f3');
    r.panel(X(b0), 0.6, z1 - 1.0, X(b1), 0.62, z1 - 0.7, r.pick(['#8a2c3a', '#2c4a7a', '#7a6a2c'])); // runner
    r.panel(X(b0 + 0.15), 0.58, z1 - 0.45, X(b0 + 0.75), 0.72, z1 - 0.15, '#ffffff');
    r.panel(X(b1 - 0.75), 0.58, z1 - 0.45, X(b1 - 0.15), 0.72, z1 - 0.15, '#ffffff');
    for (const a of [b0 - 0.55, b1 + 0.1]) {
      r.box(X(a), 0, z1 - 0.55, X(a + 0.45), 0.55, z1 - 0.12, '#5a3c28', true);
      r.panel(X(a + 0.12), 0.55, z1 - 0.4, X(a + 0.33), 0.9, z1 - 0.2, '#ffe2a8', true); // lamp
    }
    // TV on the opposite wall.
    r.panel(X((b0 + b1) / 2 - 0.55), 1.0, z0 + 0.02, X((b0 + b1) / 2 + 0.55), 1.62, z0 + 0.05, '#15181d');
  }
  // Desk and chair under the window end, an armchair, a wardrobe and luggage rack by the door.
  table(r, X(0.45), z0 + 1.0, 0.6, 1.1, '#6b4a33');
  chair(r, X(0.95), z0 + 1.0, -1, '#5a3c28');
  if (length > 4.2) {
    r.box(X(0.2), 0, z0 + 2.1, X(0.9), 0.42, z0 + 2.8, '#a8463a', true);
    r.box(X(0.2), 0.42, z0 + 2.1, X(0.4), 0.95, z0 + 2.8, '#8a3a30');
  }
  if (doorZ - 0.7 - (z0 + 0.1) > 0.9) r.box(X(width - 0.65), 0, z0 + 0.1, X(width - 0.05), 2.1, doorZ - 0.7, '#6b4a33', true);
  if (z1 - 0.2 - (doorZ + 0.7) > 0.8) {
    r.box(X(width - 0.6), 0.42, doorZ + 0.75, X(width - 0.1), 0.46, doorZ + 1.45, '#c9b06a', true);
    r.box(X(width - 0.6), 0.46, doorZ + 0.8, X(width - 0.15), 0.8, doorZ + 1.35, r.pick(['#2b3b5a', '#5a2b2b', '#2b2b2b']));
  }
  r.panel(X(width * 0.5 - 0.4), ceiling - y - 0.02, z0 + length / 2 - 0.4, X(width * 0.5 + 0.4), ceiling - y, z0 + length / 2 + 0.4, '#fff3dc', true);
  r.oy = 0;
}

/** A shut hotel room door from the corridor: number plate, key-card reader, sometimes a do-not-disturb tag. */
function shutRoom(r: Room, face: number, toward: 1 | -1, doorZ: number, y: number): void {
  r.structural = false;
  r.oy = y;
  const at = (t0: number, t1: number): [number, number] => [face + toward * t0, face + toward * t1];
  const [d0, d1] = at(0, 0.03);
  r.panel(d0, 0, doorZ - 0.48, d1, 2.1, doorZ + 0.48, '#4a3426');
  const [p0, p1] = at(0.03, 0.045);
  r.panel(p0, 1.6, doorZ - 0.1, p1, 1.72, doorZ + 0.1, '#c9b06a');
  r.panel(p0, 1.05, doorZ + 0.3, p1, 1.2, doorZ + 0.38, '#1d1f22');
  r.panel(at(0.045, 0.05)[0], 1.17, doorZ + 0.33, at(0.045, 0.05)[1], 1.19, doorZ + 0.35, r.rng() < 0.85 ? '#3fdc6a' : '#ff4a3a', true);
  if (r.rng() < 0.25) r.panel(p0, 0.82, doorZ + 0.25, p1, 1.02, doorZ + 0.37, '#c8323a');
  r.oy = 0;
}

/** The ground floor's lobby for an office: reception, sofas, a coloured wall, plants. */
function officeLobby(r: Room, w: number, ceiling: number): void {
  r.structural = false;
  // The desk goes on the side away from the doorway (mirrored when the door is on the right).
  const side = r.doorX > 0 ? -1 : 1;
  const M = (x: number): number => side * x;
  counter(r, M(w / 2 - 1.7), 2.1, 2.4, '#e8e4dc');
  chair(r, M(w / 2 - 1.7), 2.8, 1, '#2b2f35');
  r.panel(M(w / 2 - 0.03), 0.6, 0.6, M(w / 2), 2.6, 3.2, '#2e6f9e');
  r.panel(M(w / 2 - 0.04), 1.5, 1.2, M(w / 2 - 0.03), 1.9, 2.6, '#f2f2ee', true);
  for (const z of [1.9, 2.9]) {
    r.box(M(-w / 2 + 0.15), 0, z - 0.4, M(-w / 2 + 0.95), 0.42, z + 0.4, '#3b4a5a', true);
    r.box(M(-w / 2 + 0.15), 0.42, z - 0.4, M(-w / 2 + 0.4), 0.85, z + 0.4, '#334150');
    r.seats.push({ x: M(-w / 2 + 0.6), z, dz: 1 });
  }
  plant(r, M(-w / 2 + 0.5), 0.6, true);
  plant(r, M(w / 2 - 0.5), 3.2, true);
  for (let x = -w / 2 + 1.2; x < w / 2 - 0.6; x += 2.4) r.panel(x - 0.5, ceiling - 0.02, 1.2, x + 0.5, ceiling, 1.7, '#ffffff', true);
}

/** The ground floor's lobby for a hotel: front desk with a bell and a key rack, sofas on a rug, a luggage trolley, a chandelier. */
function hotelLobby(r: Room, w: number, ceiling: number): void {
  r.structural = false;
  // The desk goes on the side away from the doorway (mirrored when the door is on the right).
  const side = r.doorX > 0 ? -1 : 1;
  const M = (x: number): number => side * x;
  counter(r, M(w / 2 - 1.7), 2.3, 2.6, '#5a3c28');
  r.panel(M(w / 2 - 1.2), 1.05, 2.1, M(w / 2 - 1.1), 1.12, 2.2, '#e0c060', true); // bell
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 3; j++) r.panel(M(w / 2 - 0.03), 1.3 + j * 0.25, 1.4 + i * 0.3, M(w / 2), 1.5 + j * 0.25, 1.6 + i * 0.3, '#7b5a40');
  r.panel(M(-w / 2 + 0.3), 0.001, 1.0, M(-w / 2 + 3.0), 0.012, 3.2, '#7a2c2c');
  for (const z of [1.4, 2.8]) {
    r.box(M(-w / 2 + 0.2), 0, z - 0.45, M(-w / 2 + 1.0), 0.42, z + 0.45, '#c9a77c', true);
    r.box(M(-w / 2 + 0.2), 0.42, z - 0.45, M(-w / 2 + 0.45), 0.9, z + 0.45, '#b8956a');
    r.seats.push({ x: M(-w / 2 + 0.65), z, dz: 1 });
  }
  table(r, M(-w / 2 + 1.7), 2.1, 0.7, 0.7, '#5a3c28', 0.45);
  // A brass luggage trolley.
  const tx = M(w / 2 - 0.8);
  r.box(tx - 0.35, 0.1, 3.0, tx + 0.35, 0.16, 3.25, '#a8463a', true);
  for (const dx of [-0.33, 0.33]) r.panel(tx + dx - 0.02, 0.16, 3.1, tx + dx + 0.02, 1.7, 3.14, '#d9b84a');
  r.panel(tx - 0.35, 1.66, 3.1, tx + 0.35, 1.7, 3.14, '#d9b84a');
  plant(r, M(-w / 2 + 0.5), 0.5, true);
  // The chandelier: a cluster of warm lights.
  for (const [dx, dz] of [
    [0, 0],
    [0.35, 0],
    [-0.35, 0],
    [0, 0.35],
    [0, -0.35],
  ])
    r.panel(dx - 0.08, ceiling - 0.5, 1.8 + dz - 0.08, dx + 0.08, ceiling - 0.34, 1.8 + dz + 0.08, '#ffe2a8', true);
  r.panel(-0.02, ceiling - 0.34, 1.78, 0.02, ceiling, 1.82, '#c9b06a');
}

/**
 * A two-floor house: the usual ground floor, a straight staircase up one side wall (closed
 * underneath, a wooden balustrade), and bedrooms upstairs with ceiling fans. `storey` = floor to floor.
 */
function twoFloorHouse(r: Room, storey: number, roofY: number | null = null): StairHut | null {
  const { w, d } = r;
  const sw = 0.95;
  const left = r.doorX <= 0; // the stairs go up the door's side (the living room is on the other)
  const xa = left ? -w / 2 : w / 2 - sw;
  const xb = xa + sw;
  const inner = left ? xb : xa;
  const steps = Math.max(12, Math.round(storey / 0.18));
  const rise = storey / steps;
  const run = Math.min(0.27, (d - 2.6) / steps);
  const z1 = d - (roofY !== null ? 1.15 : 0.75); // a deeper landing when a door to the roof opens off it
  const z0 = z1 - steps * run;
  // Ground-floor furniture keeps out of the stairs and their foot.
  r.keep.push({ x0: left ? -w / 2 : xa - 0.9, x1: left ? xb + 0.9 : w / 2, z0: z0 - 1.0, z1: d, y1: storey - 0.3 });
  r.floorTop = storey;
  r.skipCeiling = roofY !== null;
  home(r);
  const H = r.h;
  // Over the stairs to the roof the ceiling is open (the stair hut is above).
  const zh0 = z0 + 0.6;
  if (roofY !== null) {
    r.structural = true;
    r.box(-w / 2 - T, H, -T, w / 2 + T, H + 0.2, zh0, '#f3f1ec', true);
    if (left) r.box(xb, H, zh0, w / 2 + T, H + 0.2, d + T, '#f3f1ec', true);
    else r.box(-w / 2 - T, H, zh0, xa, H + 0.2, d + T, '#f3f1ec', true);
  }
  r.structural = true;
  // The floor between the two storeys, with the stair opening.
  const y = storey;
  const slab = (x0: number, x1: number, za: number, zb: number): void => r.box(x0, y - 0.25, za, x1, y - 0.05, zb, '#efede8', true);
  slab(-w / 2, w / 2, 0, z0);
  slab(-w / 2, w / 2, z1, d);
  if (left) slab(xb, w / 2, z0, z1);
  else slab(-w / 2, xa, z0, z1);
  // The steps, solid underneath; the balustrade up their open side.
  for (let i = 0; i < steps; i++) {
    const top = (i + 1) * rise;
    r.box(xa, 0, z0 + i * run, xb, top, z0 + (i + 1) * run, '#b98a5e', true);
    r.box(inner - (left ? 0 : 0.05), 0, z0 + i * run, inner + (left ? 0.05 : 0), top + 0.9, z0 + (i + 1) * run, '#e9e2d5', true);
    r.panel(inner - (left ? 0.01 : 0.06), top + 0.9, z0 + i * run, inner + (left ? 0.06 : 0.01), top + 0.95, z0 + (i + 1) * run, '#5a3c28');
  }
  if (roofY === null) {
    // Upstairs: railings round the opening.
    r.box(inner - (left ? 0 : 0.05), y, z0, inner + (left ? 0.05 : 0), y + 1.0, z1, '#e9e2d5', true);
    r.box(xa, y, z0 - 0.05, xb, y + 1.0, z0, '#e9e2d5', true);
    r.panel(inner - 0.03, y + 1.0, z0 - 0.05, inner + 0.03, y + 1.05, z1, '#5a3c28');
  } else {
    // A second flight right above the first, up to the roof (thin steps: headroom below), with
    // its own balustrade; you walk round to its foot at the front.
    const rise2 = (roofY - storey) / steps;
    for (let i = 0; i < steps; i++) {
      const top = storey + (i + 1) * rise2;
      r.box(xa, top - 0.28, z0 + i * run, xb, top, z0 + (i + 1) * run, '#b98a5e', true);
      r.box(inner - (left ? 0 : 0.05), y, z0 + i * run, inner + (left ? 0.05 : 0), top + 0.9, z0 + (i + 1) * run, '#e9e2d5', true);
      r.panel(inner - (left ? 0.01 : 0.06), top + 0.9, z0 + i * run, inner + (left ? 0.06 : 0.01), top + 0.95, z0 + (i + 1) * run, '#5a3c28');
    }
  }
  // Ground-floor lights under the new floor.
  for (let x = -w / 2 + 2; x < w / 2 - 1; x += 4) for (let z = 2; z < d - 1; z += 4) r.panel(x - 0.5, y - 0.27, z - 0.25, x + 0.5, y - 0.25, z + 0.25, '#ffffff', true);
  // Upstairs floor, windows, and a bedroom wall across the middle with a doorway.
  r.structural = false;
  r.oy = y;
  r.baseY = y;
  const floorSides: [number, number][] = left ? [[xb, w / 2]] : [[-w / 2, xa]];
  for (const [a, b] of floorSides) tiles(r, a, b, 0, d, ['#b88b5e', '#ad8055'], 0.75);
  tiles(r, xa, xb, z1, d, ['#b88b5e', '#ad8055'], 0.75);
  tiles(r, xa, xb, 0, z0 - 0.05, ['#b88b5e', '#ad8055'], 0.75);
  for (let z = 1.2; z + 1.3 < d - 0.6; z += 3) {
    wallWindow(r, 'x', -w / 2, 1, z, z + 1.3, 0.9, 2.2);
    wallWindow(r, 'x', w / 2, -1, z, z + 1.3, 0.9, 2.2);
  }
  r.oy = 0;
  r.structural = true;
  const bz = Math.max(3, d * 0.45);
  const room0 = left ? xb + 0.05 : -w / 2;
  const room1 = left ? w / 2 : xa - 0.05;
  if (bz < z0 - 0.3 && room1 - room0 > 2.6) {
    const gap = (room0 + room1) / 2;
    r.box(room0, y, bz - 0.06, gap - 0.5, y + storey, bz + 0.06, r.pick(['#f1e9dc', '#e6eef0', '#f3e4d4']), true);
    r.box(gap + 0.5, y, bz - 0.06, room1, y + storey, bz + 0.06, '#f1e9dc', true);
    r.box(gap - 0.5, y + 2.1, bz - 0.06, gap + 0.5, y + storey, bz + 0.06, '#f1e9dc', true);
  }
  r.structural = false;
  r.oy = y;
  // The bedroom at the back: bed, side tables, wardrobe, a fan; a study at the front.
  const bw = Math.min(1.6, room1 - room0 - 1.4);
  if (bw > 1.0) {
    const bx0 = left ? room1 - 0.6 - bw : room0 + 0.6;
    r.box(bx0 - 0.05, 0, d - 0.12, bx0 + bw + 0.05, 1.1, d - 0.05, '#6b4a33', true);
    r.box(bx0, 0, d - 2.2, bx0 + bw, 0.5, d - 0.12, '#e9e2d5', true);
    r.panel(bx0, 0.5, d - 2.2, bx0 + bw, 0.57, d - 0.4, r.pick(['#4b6ea8', '#b55a7a', '#5e9a72', '#c98a3a']));
    r.panel(bx0 + 0.1, 0.55, d - 0.45, bx0 + bw - 0.1, 0.68, d - 0.15, '#ffffff');
    r.box(bx0 - 0.5, 0, d - 0.5, bx0 - 0.05, 0.5, d - 0.1, '#7b5a40', true);
    r.panel(bx0 - 0.4, 0.5, d - 0.4, bx0 - 0.2, 0.8, d - 0.2, '#ffe2a8', true);
  }
  const wardX = left ? room0 + 0.05 : room1 - 0.65;
  if (d - 2.6 > bz + 0.4) r.box(wardX, 0, bz + 0.3, wardX + 0.6, 2.1, bz + 1.6, '#8a6a4c', true);
  table(r, (room0 + room1) / 2, 0.75, 1.2, 0.6, '#7c5a3c');
  chair(r, (room0 + room1) / 2, 1.35, 1, '#6a4c33');
  plant(r, left ? room1 - 0.4 : room0 + 0.4, 0.5);
  ceilingFan(r, (room0 + room1) / 2, (bz + d) / 2, storey);
  ceilingFan(r, (room0 + room1) / 2, bz / 2, storey);
  r.oy = 0;
  r.baseY = 0;
  if (roofY === null) return null;
  // The stair hut on the roof, over the top of the second flight; its door opens off the landing.
  const hut: StairHut = { x0: left ? -w / 2 - 0.15 : xa - 0.15, x1: left ? xb + 0.15 : w / 2 + 0.15, z0: zh0 - 0.15, z1: d + T, roof: roofY, top: roofY + 2.65 };
  stairHut(r, hut, H, '#e9e2d5', { side: left ? 'x1' : 'x0', a: z1 + 0.1, b: d - 0.08 }, [[xa, xb, z1, d]]);
  r.structural = false;
  return hut;
}

/**
 * An apartment block, every floor of it: a lobby on the ground floor (letterboxes, a security
 * desk), a corridor up the middle of each floor with the flats' doors (one flat on each floor is
 * open and furnished), switchback stairs with a landing between floors, and a lift shaft whose
 * car runs up and down (see `Lift`). Returns the shaft and where each floor's sign goes.
 */
/** A classroom, door open: a blackboard and the teacher's desk at the front, rows of two-seater benches facing it, charts at the back, fans. */
function furnishClassroom(r: Room, side: -1 | 1, xo: number, xc: number, z0: number, z1: number, y: number, doorZ: number, ceiling: number): void {
  const into = side < 0 ? 1 : -1;
  const X = (a: number): number => xo + into * a;
  const width = Math.abs(xc - xo);
  const length = z1 - z0;
  r.structural = false;
  r.oy = y;
  r.baseY = y;
  r.panel(xo, -0.05, z0, xc, 0, z1, '#cdbf9f');
  for (let z = z0 + 0.8; z + 1.4 < z1 - 0.3; z += 2.2) wallWindow(r, 'x', xo, into, z, z + 1.4, 0.9, 2.3);
  // The blackboard on the front wall, a wooden frame, a chalk ledge; the teacher's desk and chair.
  const bw = Math.min(3.2, width - 1.2);
  const bc = width / 2;
  r.panel(X(bc - bw / 2 - 0.06), 0.84, z0 + 0.02, X(bc + bw / 2 + 0.06), 2.16, z0 + 0.04, '#6b4a33');
  r.panel(X(bc - bw / 2), 0.9, z0 + 0.04, X(bc + bw / 2), 2.1, z0 + 0.05, '#23412f');
  r.panel(X(bc - bw / 2), 0.88, z0 + 0.04, X(bc + bw / 2), 0.9, z0 + 0.12, '#d8d2c6');
  for (let i = 0; i < 3; i++) r.panel(X(bc - bw / 2 + 0.3 + i * 0.5), 1.6 - i * 0.1, z0 + 0.05, X(bc - bw / 2 + 0.7 + i * 0.5), 1.62 - i * 0.1, z0 + 0.052, '#e9e6df', true); // chalk writing
  table(r, X(bc), z0 + 1.1, 1.2, 0.6, '#7c5a3c');
  chair(r, X(bc), z0 + 0.55, -1, '#6a4c33');
  // Benches in rows: a desk and a seat for two, facing the board.
  for (let z = z0 + 2.3; z + 0.9 < z1 - 0.5; z += 1.15) {
    for (let a = 0.5; a + 1.2 < width - 0.9; a += 1.6) {
      r.box(X(a), 0.68, z, X(a + 1.2), 0.72, z + 0.45, '#8a6544', true);
      r.box(X(a), 0, z + 0.02, X(a + 0.05), 0.68, z + 0.43, '#5a4636', true);
      r.box(X(a + 1.15), 0, z + 0.02, X(a + 1.2), 0.68, z + 0.43, '#5a4636', true);
      r.box(X(a), 0.42, z + 0.55, X(a + 1.2), 0.46, z + 0.85, '#8a6544', true);
      r.panel(X(a), 0.46, z + 0.82, X(a + 1.2), 0.8, z + 0.86, '#8a6544');
      r.seats.push({ x: X(a + 0.3), z: z + 0.7, dz: -1, y }, { x: X(a + 0.9), z: z + 0.7, dz: -1, y });
      if (r.rng() < 0.5) r.panel(X(a + 0.2), 0.72, z + 0.1, X(a + 0.5), 0.75, z + 0.32, r.pick(['#d9433b', '#3f8fd2', '#f2b134', '#58b368'])); // a notebook
    }
  }
  // Charts on the back wall, a cupboard, two fans.
  for (let i = 0; i < 3 && 0.6 + i * 1.1 + 0.8 < width; i++) r.panel(X(0.6 + i * 1.1), 1.2, z1 - 0.02, X(1.4 + i * 1.1), 1.9, z1, r.pick(['#f2d36b', '#9fd0ea', '#f2a7c3', '#b8e0a0']), true);
  if (doorZ - 0.6 - (z0 + 0.3) > 0.9) r.box(X(width - 0.5), 0, z0 + 0.3, X(width - 0.05), 1.8, doorZ - 0.6, '#7b6a52', true);
  ceilingFan(r, X(width / 2), z0 + length * 0.33, ceiling - y);
  ceilingFan(r, X(width / 2), z0 + length * 0.7, ceiling - y);
  r.oy = 0;
}

/** A doctor's room, door open: desk with a computer and chairs, an examination bed with a curtain, a sink, a cabinet, an eye chart. */
function furnishClinicRoom(r: Room, side: -1 | 1, xo: number, xc: number, z0: number, z1: number, y: number, doorZ: number, ceiling: number): void {
  const into = side < 0 ? 1 : -1;
  const X = (a: number): number => xo + into * a;
  const width = Math.abs(xc - xo);
  const length = z1 - z0;
  r.structural = false;
  r.oy = y;
  r.baseY = y;
  r.panel(xo, -0.05, z0, xc, 0, z1, '#e3ebe8');
  for (let z = z0 + 0.6; z + 1.3 < z1 - 0.3; z += 2.4) wallWindow(r, 'x', xo, into, z, z + 1.3, 0.9, 2.2);
  // The doctor's desk by the window: computer, papers; the doctor's chair and two for patients.
  table(r, X(1.2), z0 + 1.2, 1.3, 0.7, '#d6d0c4');
  r.panel(X(1.0), 0.75, z0 + 1.0, X(1.45), 1.08, z0 + 1.03, '#1a1d21');
  r.panel(X(1.04), 0.79, z0 + 0.995, X(1.41), 1.04, z0 + 1.0, '#cfe6f2', true);
  r.panel(X(1.5), 0.75, z0 + 1.2, X(1.75), 0.76, z0 + 1.45, '#f4f1e8');
  chair(r, X(1.2), z0 + 0.55, -1, '#2b2f35');
  chair(r, X(0.9), z0 + 1.85, 1, '#3b6e8a');
  chair(r, X(1.5), z0 + 1.85, 1, '#3b6e8a');
  // The examination bed against the far wall, a step, the curtain on its rail.
  if (length > 3.6 && width > 2.4) {
    r.box(X(0.2), 0, z1 - 0.9, X(2.0), 0.7, z1 - 0.2, '#8a9aa0', true);
    r.panel(X(0.2), 0.7, z1 - 0.9, X(2.0), 0.78, z1 - 0.2, '#3f8f8a');
    r.panel(X(0.2), 0.78, z1 - 0.85, X(0.45), 0.86, z1 - 0.25, '#f4f1e8'); // pillow
    r.box(X(0.9), 0, z1 - 1.25, X(1.3), 0.2, z1 - 0.95, '#8d9296', true);
    r.panel(X(0.1), 2.2, z1 - 1.45, X(2.2), 2.23, z1 - 1.42, '#8d9296'); // rail
    r.panel(X(0.1), 0.25, z1 - 1.45, X(0.9), 2.2, z1 - 1.43, '#a9d3e6'); // curtain, half drawn
  }
  // Sink and mirror by the door, a white cabinet, an eye chart, a weighing scale.
  if (doorZ - 0.7 - (z0 + 0.2) > 0.6) {
    r.box(X(width - 0.5), 0, z0 + 0.3, X(width - 0.05), 0.85, z0 + 0.8, '#f4f6f7', true);
    r.panel(X(width - 0.04), 1.2, z0 + 0.35, X(width - 0.02), 1.8, z0 + 0.75, '#dde8ee', true);
  }
  if (z1 - 0.2 - (doorZ + 0.7) > 0.7) r.box(X(width - 0.45), 0, doorZ + 0.75, X(width - 0.05), 1.9, z1 - 0.2, '#f4f6f7', true);
  r.panel(X(2.4), 1.1, z0 + 0.02, X(2.9), 1.8, z0 + 0.03, '#fbfbf9', true);
  for (let i = 0; i < 6; i++) r.panel(X(2.65 - 0.2 + i * 0.03), 1.7 - i * 0.1, z0 + 0.031, X(2.65 + 0.2 - i * 0.03), 1.74 - i * 0.1, z0 + 0.032, '#1d1f22');
  r.panel(X(0.3), 0, z0 + 2.2, X(0.6), 0.06, z0 + 2.5, '#8d9296');
  r.panel(X(width * 0.5 - 0.5), ceiling - y - 0.02, z0 + length / 2 - 0.3, X(width * 0.5 + 0.5), ceiling - y, z0 + length / 2 + 0.3, '#ffffff', true);
  r.oy = 0;
}

/** A shut door on a school or clinic corridor: painted door with a little window and a plate. */
function shutPlainDoor(r: Room, face: number, toward: 1 | -1, doorZ: number, y: number, colour: string): void {
  r.structural = false;
  r.oy = y;
  const at = (t0: number, t1: number): [number, number] => [face + toward * t0, face + toward * t1];
  const [d0, d1] = at(0, 0.03);
  r.panel(d0, 0, doorZ - 0.48, d1, 2.1, doorZ + 0.48, colour);
  const [g0, g1] = at(0.03, 0.035);
  r.panel(g0, 1.3, doorZ - 0.15, g1, 1.75, doorZ + 0.15, '#9fbccc', true);
  r.panel(g0, 1.85, doorZ - 0.2, g1, 1.97, doorZ + 0.2, '#f4f1e8');
  r.panel(g0, 0.95, doorZ + 0.32, g1, 1.02, doorZ + 0.42, '#8d9296');
  r.oy = 0;
}

/** A school's front hall: the office counter, a trophy cabinet, a notice board, a bench, plants. */
function schoolLobby(r: Room, w: number, ceiling: number): void {
  r.structural = false;
  const side = r.doorX > 0 ? -1 : 1;
  const M = (x: number): number => side * x;
  counter(r, M(w / 2 - 1.6), 2.2, 2.2, '#7a5c40');
  chair(r, M(w / 2 - 1.6), 2.85, 1, '#2f4f6f');
  // The trophy cabinet: a wooden case with glass, gold cups inside.
  r.box(M(-w / 2 + 0.05), 0, 0.6, M(-w / 2 + 0.5), 1.9, 2.6, '#6b4a33', true);
  r.panel(M(-w / 2 + 0.5), 0.3, 0.7, M(-w / 2 + 0.52), 1.8, 2.5, '#9fbccc', true);
  for (let i = 0; i < 4; i++) r.panel(M(-w / 2 + 0.2), 1.0 + (i % 2) * 0.45, 0.9 + i * 0.4, M(-w / 2 + 0.35), 1.25 + (i % 2) * 0.45, 1.05 + i * 0.4, '#e0b84a', true);
  // Notice board with papers, a long bench, plants.
  r.panel(M(w / 2 - 0.03), 1.2, 0.5, M(w / 2), 2.0, 1.6, '#b08a5a');
  for (let i = 0; i < 4; i++) r.panel(M(w / 2 - 0.04), 1.3 + (i % 2) * 0.3, 0.6 + i * 0.25, M(w / 2 - 0.03), 1.55 + (i % 2) * 0.3, 0.8 + i * 0.25, r.pick(['#f4f1e8', '#f2d36b', '#9fd0ea']));
  r.box(M(-w / 2 + 0.7), 0, 3.0, M(-w / 2 + 2.5), 0.45, 3.3, '#8a6544', true);
  r.seats.push({ x: M(-w / 2 + 1.2), z: 3.15, dz: -1 }, { x: M(-w / 2 + 2.0), z: 3.15, dz: -1 });
  plant(r, M(w / 2 - 0.5), 3.1, true);
  for (let x = -w / 2 + 1.2; x < w / 2 - 0.6; x += 2.4) r.panel(x - 0.5, ceiling - 0.02, 1.2, x + 0.5, ceiling, 1.7, '#ffffff', true);
}

/** A clinic's waiting hall: reception, rows of waiting chairs, a pharmacy counter with medicine shelves, a water cooler, a TV. */
function clinicLobby(r: Room, w: number, ceiling: number): void {
  r.structural = false;
  const side = r.doorX > 0 ? -1 : 1;
  const M = (x: number): number => side * x;
  counter(r, M(w / 2 - 1.6), 2.1, 2.2, '#e8e4dc');
  chair(r, M(w / 2 - 1.6), 2.75, 1, '#2b2f35');
  r.panel(M(w / 2 - 0.03), 2.0, 1.4, M(w / 2), 2.3, 2.8, '#2e8f6a', true); // the clinic's green sign band
  // Rows of joined waiting chairs.
  for (const z of [1.2, 2.3]) {
    r.box(M(-w / 2 + 0.4), 0.42, z - 0.22, M(-w / 2 + 2.6), 0.46, z + 0.22, '#3b6e8a', true);
    r.box(M(-w / 2 + 0.4), 0, z - 0.05, M(-w / 2 + 2.6), 0.42, z + 0.05, '#8d9296', true);
    r.panel(M(-w / 2 + 0.4), 0.46, z + 0.18, M(-w / 2 + 2.6), 0.85, z + 0.22, '#3b6e8a');
    for (let a = 0.7; a < 2.5; a += 0.6) r.seats.push({ x: M(-w / 2 + a), z, dz: -1 });
  }
  // Pharmacy along the side wall: shelves of medicine boxes behind a counter.
  shelves(r, M(-w / 2 + 0.3), M(-w / 2 + 2.4), 3.0, 1.9);
  r.box(M(-w / 2 + 2.6), 0.6, 2.9, M(-w / 2 + 3.0), 1.6, 3.2, '#e9eef2', true); // water cooler
  r.panel(M(-w / 2 + 2.65), 1.6, 2.95, M(-w / 2 + 2.95), 1.95, 3.15, '#9fd0ea', true);
  r.panel(M(w / 2 - 0.03), 1.6, 0.4, M(w / 2), 2.1, 1.2, '#15181d'); // TV
  plant(r, M(w / 2 - 0.5), 3.2);
  for (let x = -w / 2 + 1.2; x < w / 2 - 0.6; x += 2.4) r.panel(x - 0.5, ceiling - 0.02, 1.2, x + 0.5, ceiling, 1.7, '#ffffff', true);
}

/** A stair hut on the roof (room frame): its rectangle and the top of its roof; the stairs come up inside it. */
export interface StairHut {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The roof you step out onto (room frame), and the top of the hut. */
  roof: number;
  top: number;
}

/** The hut's walls, door, roof and light, and the floor you arrive on. `door` = which wall the door is in and where along it. */
function stairHut(r: Room, hut: StairHut, from: number, wall: string, door: { side: 'x0' | 'x1' | 'z0'; a: number; b: number }, floors: [number, number, number, number][]): void {
  const { x0, x1, z0, z1, roof } = hut;
  const top = roof + 2.5;
  r.structural = true;
  const wallZ = (za: number, zb: number, x: number, gap: [number, number] | null): void => {
    if (!gap) {
      r.box(x, from, za, x + 0.15, top, zb, wall, true);
      return;
    }
    r.box(x, from, za, x + 0.15, top, gap[0], wall, true);
    r.box(x, from, gap[1], x + 0.15, top, zb, wall, true);
    r.box(x, roof + 2.1, gap[0], x + 0.15, top, gap[1], wall, true);
  };
  wallZ(z0, z1, x0, door.side === 'x0' ? [door.a, door.b] : null);
  wallZ(z0, z1, x1 - 0.15, door.side === 'x1' ? [door.a, door.b] : null);
  if (door.side === 'z0') {
    r.box(x0, from, z0, door.a, top, z0 + 0.15, wall, true);
    r.box(door.b, from, z0, x1, top, z0 + 0.15, wall, true);
    r.box(door.a, roof + 2.1, z0, door.b, top, z0 + 0.15, wall, true);
  } else r.box(x0, from, z0, x1, top, z0 + 0.15, wall, true);
  r.box(x0, from, z1 - 0.15, x1, top, z1, wall, true);
  r.box(x0 - 0.1, top, z0 - 0.1, x1 + 0.1, top + 0.15, z1 + 0.1, '#d8d2c6', true);
  for (const [fx0, fx1, fz0, fz1] of floors) r.box(fx0, roof - 0.25, fz0, fx1, roof, fz1, '#bdb6aa', true);
  r.panel((x0 + x1) / 2 - 0.3, top - 0.03, (z0 + z1) / 2 - 0.2, (x0 + x1) / 2 + 0.3, top, (z0 + z1) / 2 + 0.2, '#ffffff', true);
  // The door frame, and the steel door swung open against the inside.
  r.structural = false;
  if (door.side === 'z0') {
    r.panel(door.a - 0.08, roof, z0 - 0.02, door.a, roof + 2.18, z0, '#5d6266');
    r.panel(door.b, roof, z0 - 0.02, door.b + 0.08, roof + 2.18, z0, '#5d6266');
    r.panel(door.a - 0.08, roof + 2.1, z0 - 0.02, door.b + 0.08, roof + 2.18, z0, '#5d6266');
  } else {
    const x = door.side === 'x0' ? x0 : x1;
    const out = door.side === 'x0' ? -1 : 1;
    r.panel(x, roof, door.a - 0.08, x + out * 0.02, roof + 2.18, door.a, '#5d6266');
    r.panel(x, roof, door.b, x + out * 0.02, roof + 2.18, door.b + 0.08, '#5d6266');
    r.panel(x, roof + 2.1, door.a - 0.08, x + out * 0.02, roof + 2.18, door.b + 0.08, '#5d6266');
  }
  r.structural = true;
}

function apartments(r: Room, storeys: number, storey: number, kind: BlockKind = 'flats', roofY: number | null = null): { shaft: LiftShaft; signs: { x: number; y: number; z: number; floor: number }[]; hut: StairHut | null } {
  const { w, d } = r;
  const H = storeys * storey;
  const wall = { office: '#eef0f2', hotel: '#efe3cf', school: '#f1ead2', clinic: '#eef4f2', flats: r.pick(['#efe7d8', '#e9e4da', '#f2ece0', '#e8ede6']) }[kind];
  const inner = { office: '#e9ecef', hotel: '#eadcc4', school: '#efe4c4', clinic: '#e6efec', flats: '#ece6da' }[kind];
  // Floors: corridor tiles in flats, blue-grey carpet tiles in offices, a deep red carpet in hotels.
  const floorTiles: [string, string] = { office: ['#5d6a78', '#56626f'], hotel: ['#6e2a2a', '#64262a'], school: ['#c9c1ab', '#bdb59f'], clinic: ['#dfe6e4', '#d4dcda'], flats: CORRIDOR_TILES }[kind] as [string, string];
  const concrete = '#9c9a95';
  const cw = 1.8;
  const c0 = Math.min(Math.max(r.doorX - cw / 2, -w / 2 + 2.0), w / 2 - 2.55 - cw);
  const c1 = c0 + cw;
  const coreZ = d - 5.6; // a metre of floor in front of the stairs
  const stairZ = d - 4.6;
  const landZ = d - 1.3;
  const s0 = c1 + 0.06;
  const s1 = c1 + 2.4;
  const sm = (s0 + s1) / 2;
  const L0 = c0 - 1.85;
  const L1 = c0 - 0.15;
  const Z0 = d - 2.25;
  const Z1 = d - 0.35;
  const doorZ = (Z0 + Z1) / 2;
  const signs: { x: number; y: number; z: number; floor: number }[] = [];

  r.structural = true;
  // Ground slab, outer walls all the way up (the doorway on the ground floor), roof ceiling.
  r.box(-w / 2 - T, -0.6, -T, w / 2 + T, -0.05, d + T, '#a39d92', true);
  r.box(-w / 2 - T, 0, -T, -w / 2, H, d + T, wall, true);
  r.box(w / 2, 0, -T, w / 2 + T, H, d + T, wall, true);
  r.box(-w / 2, 0, d, w / 2, H, d + T, wall, true);
  const dx0 = r.doorX - r.doorHalf;
  const dx1 = r.doorX + r.doorHalf;
  r.box(-w / 2, 0, -T, dx0, H, 0, wall, true);
  r.box(dx1, 0, -T, w / 2, H, 0, wall, true);
  r.box(dx0, r.doorTop, -T, dx1, H, 0, wall, true);
  // The top ceiling, with the stairwell open above it when the stairs go on up to the roof.
  const sOpen = c1 + 0.06;
  if (roofY !== null) {
    r.box(-w / 2 - T, H, -T, w / 2 + T, H + 0.2, d - 4.6, '#f3f1ec', true);
    r.box(-w / 2 - T, H, d - 4.6, sOpen, H + 0.2, d + T, '#f3f1ec', true);
    r.box(c1 + 2.4, H, d - 4.6, w / 2 + T, H + 0.2, d + T, '#f3f1ec', true);
  } else r.box(-w / 2 - T, H, -T, w / 2 + T, H + 0.2, d + T, '#f3f1ec', true);
  doorway(r);
  // The lift shaft (bare concrete inside) and the stairwell's outer wall, full height.
  r.box(c0 - 2.0, 0, Z0 - 0.15, L0, H, d, concrete, true);
  r.box(L0, 0, Z0 - 0.15, L1, H, Z0, concrete, true);
  r.box(L0, 0, Z1, L1, H, d, concrete, true);
  r.box(s1, 0, coreZ, s1 + 0.15, H, d, inner, true);

  for (let k = 0; k < storeys; k++) {
    const y = k * storey;
    const ceiling = k < storeys - 1 ? (k + 1) * storey - 0.25 : H;
    const tall = ceiling - y + 0.25;
    r.baseY = y;
    r.oy = 0;
    r.structural = true;
    if (k > 0) {
      // The floor slab, with holes for the stairs and the lift.
      const slab = (x0: number, x1: number, z0: number, z1: number): void => r.box(x0, y - 0.25, z0, x1, y - 0.05, z1, '#efede8', true);
      slab(-w / 2, w / 2, 0, stairZ);
      slab(-w / 2, L0, stairZ, d);
      slab(L1, c1 + 0.06, stairZ, d);
      slab(s1, w / 2, stairZ, d);
      slab(L0, L1, stairZ, Z0);
      slab(L0, L1, Z1, d);
    }
    // Floor tiles where you walk: the whole ground floor; the corridor and stair landing above.
    r.oy = y;
    if (k === 0) tiles(r, -w / 2, w / 2, 0, d, kind === 'hotel' ? ['#d9cdb5', '#cfc2a8'] : CORRIDOR_TILES, 1.0);
    else {
      if (kind === 'office') tiles(r, -w / 2, w / 2, 0, coreZ, floorTiles, 0.9);
      tiles(r, c0, c1, 0, d, floorTiles, 0.9);
      tiles(r, c1, s1, coreZ, stairZ, floorTiles, 0.9);
    }
    r.oy = 0;

    // Flats on both sides of the corridor (behind a lobby on the ground floor).
    const zs = k === 0 ? 3.4 : 0;
    const room = coreZ - zs >= 3 && kind !== 'office';
    const leftFlats = room && c0 - 0.15 + w / 2 >= 2.6;
    const rightFlats = room && w / 2 - (c1 + 0.15) >= 2.6;
    const sides: (-1 | 1)[] = [];
    if (leftFlats) sides.push(-1);
    if (rightFlats) sides.push(1);
    const openSide = sides.length > 0 ? sides[Math.floor(r.rng() * sides.length)] : 0;
    const leftGaps: [number, number][] = [[doorZ - 0.55, doorZ + 0.55]];
    const rightGaps: [number, number][] = [];
    const shut: { face: number; toward: 1 | -1; z: number }[] = [];
    const open: { side: -1 | 1; xo: number; xc: number; z0: number; z1: number; z: number }[] = [];
    for (const side of [-1, 1] as const) {
      const has = side < 0 ? leftFlats : rightFlats;
      const xo = side < 0 ? -w / 2 : w / 2;
      const xc = side < 0 ? c0 - 0.15 : c1 + 0.15;
      if (!has) continue;
      const n = Math.max(1, Math.floor((coreZ - zs) / { hotel: 4.2, school: 7, clinic: 4.5, flats: 5, office: 5 }[kind]));
      const length = (coreZ - zs) / n;
      const pick = Math.floor(r.rng() * n);
      // Back wall (towards the core), the front wall facing the lobby, and partitions.
      r.box(xo, y, coreZ - 0.15, xc, y + tall, coreZ, inner, true);
      if (zs > 0) r.box(xo, y, zs - 0.15, xc, y + tall, zs, inner, true);
      for (let i = 1; i < n; i++) r.box(xo, y, zs + i * length - 0.075, xc, y + tall, zs + i * length + 0.075, inner, true);
      for (let i = 0; i < n; i++) {
        const z = zs + (i + 0.5) * length;
        // Schools and clinics have a room open on each side; flats and hotels one per floor.
        if ((side === openSide || kind === 'school' || kind === 'clinic') && i === pick) {
          (side < 0 ? leftGaps : rightGaps).push([z - 0.5, z + 0.5]);
          open.push({ side, xo, xc, z0: zs + i * length + (i > 0 ? 0.075 : 0), z1: zs + (i + 1) * length - (i < n - 1 ? 0.075 : 0.15), z });
        } else shut.push({ face: side < 0 ? c0 : c1, toward: side < 0 ? 1 : -1, z });
      }
    }
    // The corridor's walls: the left one runs to the back (the lift doors are in it); the right
    // one stops at the stairs. Where a side has no flats the wall closes it off (the ground
    // floor's lobby stays open).
    const leftFrom = leftFlats ? zs : k === 0 || kind === 'office' ? coreZ : 0;
    const rightFrom = rightFlats ? zs : k === 0 || kind === 'office' ? coreZ : 0;
    wallAlongZ(r, c0 - 0.15, c0, leftFrom, d, y, tall, inner, leftGaps);
    if (rightFrom < coreZ) wallAlongZ(r, c1, c1 + 0.15, rightFrom, coreZ, y, tall, inner, rightGaps);
    if ((k === 0 || kind === 'office') && !leftFlats) r.box(-w / 2, y, coreZ - 0.15, c0 - 0.15, y + tall, coreZ, inner, true);
    if ((k === 0 || kind === 'office') && !rightFlats) r.box(c1, y, coreZ - 0.15, w / 2, y + tall, coreZ, inner, true);
    // The stairwell's side towards the corridor is walled, so nobody steps off a flight.
    r.box(c1, y, stairZ, s0, y + tall, d, inner, true);
    // Lift: the indicator over the doors, the call button, a frame.
    r.panel(c0, y + 2.18, doorZ - 0.16, c0 + 0.02, y + 2.32, doorZ + 0.16, '#ffb347', true);
    r.panel(c0, y + 1.0, doorZ + 0.72, c0 + 0.02, y + 1.22, doorZ + 0.84, '#8d9296');
    r.panel(c0 + 0.02, y + 1.08, doorZ + 0.76, c0 + 0.03, y + 1.14, doorZ + 0.8, '#ffcf6b', true);
    r.panel(c0, y, doorZ - 0.62, c0 + 0.03, y + 2.16, doorZ - 0.55, '#8d9296');
    r.panel(c0, y, doorZ + 0.55, c0 + 0.03, y + 2.16, doorZ + 0.62, '#8d9296');
    r.panel(c0, y + 2.1, doorZ - 0.62, c0 + 0.03, y + 2.16, doorZ + 0.62, '#8d9296');
    signs.push({ x: c0 + 0.012, y: y + 1.5, z: doorZ - 1.35, floor: k });
    // Stairs up to the next floor: a flight going back, a landing, a flight coming forward.
    const climb = k < storeys - 1 ? storey : roofY !== null ? roofY - y : 0;
    if (climb > 0) {
      const steps = 9;
      const rise = climb / (2 * steps);
      const run = (landZ - stairZ) / steps;
      for (let i = 0; i < steps; i++) {
        const ta = y + (i + 1) * rise;
        r.box(s0, Math.max(y, ta - 0.28), stairZ + i * run, sm - 0.06, ta, stairZ + (i + 1) * run, STAIR_STONE, true);
        const tb = y + storey / 2 + (i + 1) * rise;
        r.box(sm + 0.06, tb - 0.28, landZ - (i + 1) * run, s1, tb, landZ - i * run, STAIR_STONE, true);
        // Handrail along the outer wall.
        r.panel(s1 - 0.06, tb + 0.85, landZ - (i + 1) * run, s1 - 0.02, tb + 0.9, landZ - i * run, RAIL);
      }
      r.box(s0, y + climb / 2 - 0.25, landZ, s1, y + climb / 2, d, STAIR_STONE, true);
      r.box(sm - 0.06, y, stairZ, sm + 0.06, y + climb, landZ, inner, true); // between the flights
      r.panel(sm - 0.07, y + climb - 0.05, stairZ, sm + 0.07, y + climb, landZ, RAIL);
      if (k === 0) r.box(sm + 0.06, 0, stairZ, s1, climb / 2 - 0.3, landZ, inner, true); // nobody walks under the first flight
      r.panel(sm - 0.4, y + climb / 2 + 2.3, landZ + 0.3, sm + 0.4, y + climb / 2 + 2.32, d - 0.3, '#ffffff', true); // landing light
    } else {
      // Top floor: a railing where the last flight came up.
      r.box(s0, y, stairZ, sm, y + 1.0, stairZ + 0.06, RAIL, true);
    }
    // Corridor lights, and a window at its front end (upper floors).
    for (let z = 1.5; z < d - 0.5; z += 3) r.panel(c0 + 0.6, ceiling - 0.02, z - 0.2, c1 - 0.6, ceiling, z + 0.2, '#ffffff', true);
    if (k > 0) wallWindow(r, 'z', 0, 1, c0 + 0.25, c1 - 0.25, y + 0.9, y + 2.2);
    // Flats: shut doors with shoes outside, one open and furnished. Hotel: numbered doors, one
    // room open. Offices: open plan either side of the aisle.
    for (const u of shut) {
      if (kind === 'hotel') shutRoom(r, u.face, u.toward, u.z, y);
      else if (kind === 'school') shutPlainDoor(r, u.face, u.toward, u.z, y, '#3f6e4a');
      else if (kind === 'clinic') shutPlainDoor(r, u.face, u.toward, u.z, y, '#f4f6f7');
      else shutFlat(r, u.face, u.toward, u.z, y);
    }
    const furnish = { hotel: furnishHotelRoom, school: furnishClassroom, clinic: furnishClinicRoom, flats: furnishFlat, office: furnishFlat }[kind];
    for (const f of open) furnish(r, f.side, f.xo, f.xc, f.z0, f.z1, y, f.z, ceiling);
    if (kind === 'office') {
      const from = k === 0 ? 3.6 : 0.1;
      if (c0 - 0.15 + w / 2 >= 2.6) furnishOffice(r, -w / 2, c0 - 0.15, from, coreZ - 0.15, y, ceiling);
      if (w / 2 - (c1 + 0.15) >= 2.6) furnishOffice(r, w / 2, c1 + 0.15, from, coreZ - 0.15, y, ceiling);
    }
    r.structural = true;
    if (k === 0 && kind === 'office') officeLobby(r, w, ceiling);
    else if (k === 0 && kind === 'hotel') hotelLobby(r, w, ceiling);
    else if (k === 0 && kind === 'school') schoolLobby(r, w, ceiling);
    else if (k === 0 && kind === 'clinic') clinicLobby(r, w, ceiling);
    else if (k === 0) {
      // The lobby: letterboxes, a security desk with a chair, a notice board, a plant.
      r.structural = false;
      const side = r.doorX > 0 ? -1 : 1;
      const M = (x: number): number => side * x;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 3; j++) {
          r.panel(-w / 2, 1.0 + j * 0.24, 0.9 + i * 0.36, M(-w / 2 + 0.14), 1.2 + j * 0.24, 1.22 + i * 0.36, '#8f969c');
          r.panel(M(-w / 2 + 0.14), 1.12 + j * 0.24, 0.98 + i * 0.36, M(-w / 2 + 0.15), 1.14 + j * 0.24, 1.14 + i * 0.36, '#2a2c2e');
        }
      counter(r, M(w / 2 - 1.1), 2.4, 1.4, '#7a5c40');
      chair(r, M(w / 2 - 1.1), 3.05, 1, '#2f4f6f');
      r.panel(M(w / 2 - 0.03), 1.2, 0.6, M(w / 2), 1.9, 1.5, '#b08a5a');
      for (let i = 0; i < 3; i++) r.panel(M(w / 2 - 0.04), 1.35 + (i % 2) * 0.2, 0.7 + i * 0.25, M(w / 2 - 0.03), 1.6 + (i % 2) * 0.2, 0.9 + i * 0.25, '#f4f1e8');
      plant(r, M(-w / 2 + 0.5), 3.0, true);
      for (let x = -w / 2 + 1.5; x < w / 2 - 1; x += 3) r.panel(x - 0.4, ceiling - 0.02, 1.4, x + 0.4, ceiling, 1.9, '#ffffff', true);
    }
  }
  // Up on the roof: a stair hut round the top of the stairs, its door facing the front.
  let hut: StairHut | null = null;
  if (roofY !== null) {
    hut = { x0: c1, x1: s1 + 0.15, z0: coreZ - 0.15, z1: d + T, roof: roofY, top: roofY + 2.65 };
    stairHut(r, hut, H, wall, { side: 'z0', a: sm + 0.1, b: s1 - 0.1 }, [[sOpen, s1, coreZ, stairZ]]);
    // A railing over the last flight's opening.
    r.box(s0, roofY, stairZ, sm, roofY + 1.0, stairZ + 0.06, RAIL, true);
  }
  r.structural = false;
  r.baseY = 0;
  return { shaft: { x0: L0, x1: L1, z0: Z0, z1: Z1, doorZ, storey, floors: storeys }, signs, hut };
}

// ---------- Malls of many floors: an atrium with escalators, shops all round, a food court ----------

/** One escalator (room frame): its width (x0..x1), where its bottom is (z0, y0), its steps, and which way it runs (+1 up towards +z, −1 down). */
export interface Escalator {
  x0: number;
  x1: number;
  z0: number;
  y0: number;
  steps: number;
  rise: number;
  run: number;
  dir: 1 | -1;
}

const SHOP_SIGNS = ['#c0392b', '#2c3e50', '#16a085', '#8e44ad', '#d35400', '#2980b9', '#e84393', '#00897b', '#f39c12'];
const SARIS = ['#c2185b', '#f57c00', '#7b1fa2', '#00897b', '#fbc02d', '#d32f2f', '#1976d2', '#388e3c'];

/** One shop, its front open to the walkway at x = front (the shop runs from the outer wall at xo). */
function mallShop(r: Room, xo: number, front: number, z0: number, z1: number, y: number, ceiling: number): void {
  const into = xo < front ? 1 : -1;
  const X = (a: number): number => xo + into * a;
  const depth = Math.abs(front - xo);
  const kind = r.pick(['clothes', 'saris', 'shoes', 'phones', 'books', 'cafe'] as const);
  r.structural = true;
  r.oy = y;
  // The front: a glass shopfront either side of a wide opening, a lit sign band with a made-up logo.
  const open0 = z0 + (z1 - z0) * 0.25;
  const open1 = z1 - (z1 - z0) * 0.25;
  r.box(X(depth - 0.06), 0, z0, X(depth), 2.9, open0, '#9bc2d1', true);
  r.box(X(depth - 0.06), 0, open1, X(depth), 2.9, z1, '#9bc2d1', true);
  r.box(X(depth - 0.1), 2.9, z0, X(depth), ceiling - y, z1, '#e9e4da', true);
  const sign = r.pick(SHOP_SIGNS);
  r.panel(X(depth), 3.0, z0 + 0.3, X(depth + 0.04), 3.6, z1 - 0.3, sign, true);
  const mid = (z0 + z1) / 2;
  r.panel(X(depth + 0.04), 3.1, mid - 0.25, X(depth + 0.05), 3.5, mid + 0.25, '#fbfbf9', true);
  r.panel(X(depth + 0.05), 3.2, mid - 0.12, X(depth + 0.06), 3.4, mid + 0.12, sign, true);
  r.structural = false;
  r.panel(X(0), -0.05, z0, X(depth - 0.06), 0, z1, kind === 'cafe' ? '#8a6544' : '#efe9de');
  for (let a = 1; a < depth - 0.5; a += 2.2) r.panel(X(a - 0.5), ceiling - y - 0.02, mid - 0.4, X(a + 0.5), ceiling - y, mid + 0.4, '#ffffff', true);
  // A till by the front.
  counter(r, X(depth - 1.0), z0 + 0.6, 1.0, '#e8e4dc');
  if (kind === 'clothes' || kind === 'saris') {
    for (let a = 1.2; a < depth - 1.4; a += 1.6) {
      r.panel(X(a - 0.02), 1.5, z0 + 0.8, X(a + 0.02), 1.54, z1 - 0.8, '#8d9296');
      for (let z = z0 + 1.0; z < z1 - 1.0; z += 0.25) r.panel(X(a - 0.2), kind === 'saris' ? 0.25 : 0.65, z, X(a + 0.2), 1.5, z + 0.05, r.pick(kind === 'saris' ? SARIS : PRODUCT));
    }
    r.panel(X(0.02), 0.4, mid - 0.5, X(0.04), 2.0, mid + 0.5, '#dde8ee', true); // mirror
  } else if (kind === 'shoes') {
    for (let level = 0.3; level < 2.2; level += 0.35) {
      r.panel(X(0), level, z0 + 0.3, X(0.35), level + 0.03, z1 - 0.3, '#e9e4da');
      for (let z = z0 + 0.4; z < z1 - 0.5; z += 0.32) r.panel(X(0.05), level + 0.03, z, X(0.3), level + 0.13, z + 0.22, r.pick(SHOES));
    }
    r.box(X(1.4), 0, mid - 0.8, X(1.8), 0.45, mid + 0.8, '#c9a77c', true);
    r.seats.push({ x: X(1.6), z: mid, dz: 1, y });
  } else if (kind === 'phones') {
    r.panel(X(0.02), 0.9, z0 + 0.5, X(0.05), 2.4, z1 - 0.5, '#1d3a5a', true); // a big screen wall
    for (let a = 1.4; a < depth - 1.6; a += 1.8) {
      table(r, X(a), mid, 0.8, Math.max(1.2, z1 - z0 - 2.4), '#f4f6f7', 0.9);
      for (let z = mid - (z1 - z0 - 2.6) / 2; z < mid + (z1 - z0 - 2.6) / 2; z += 0.35) r.panel(X(a - 0.1), 0.9, z, X(a + 0.1), 0.92, z + 0.18, '#1a1d21');
    }
  } else if (kind === 'books') {
    for (let a = 1.0; a < depth - 1.2; a += 1.5) shelves(r, X(a - 0.0), X(a + 0.01), mid, 1.6);
    for (let z = z0 + 0.3; z < z1 - 0.4; z += 0.9) shelves(r, X(0.05), X(0.5), z + 0.35, 2.0);
  } else {
    counter(r, X(0.6), mid, Math.max(1.5, z1 - z0 - 2.0), '#5a3c28');
    r.panel(X(0.02), 1.6, mid - 0.8, X(0.04), 2.4, mid + 0.8, '#1d1f22'); // menu board
    for (let a = 2.0; a < depth - 1.0; a += 1.6) {
      table(r, X(a), mid, 0.7, 0.7, '#e9e4da');
      chair(r, X(a), mid - 0.6, -1, '#5a3c28');
      chair(r, X(a), mid + 0.6, 1, '#5a3c28');
    }
  }
  r.oy = 0;
  r.structural = true;
}

/**
 * A mall of many floors. In the middle an atrium open through every floor, with an up and a
 * down escalator crossing it between each pair of floors (each starts on the gallery before
 * the atrium and lands on the gallery past it). Galleries with railings round it; shops along
 * both sides on every floor; benches and kiosks; a skylight over the atrium; a food court on
 * the top floor. Returns the escalators (their steps move and carry you).
 */
function mallBlock(r: Room, storeys: number, storey: number): Escalator[] {
  const { w, d } = r;
  const H = storeys * storey;
  const wall = '#f3efe7';
  const n = Math.ceil(storey / 0.2);
  const rise = storey / n;
  const run = rise * 1.732; // 30°
  const L = n * run;
  const az0 = Math.max(6, (d - (L - 2)) / 2);
  const az1 = az0 + L - 2;
  const vx = 3.2; // the atrium is 6.4 m across
  const escalators: Escalator[] = [];
  r.structural = true;
  // Ground slab, outer walls (the entrance in front), the roof ceiling with a skylight.
  r.box(-w / 2 - T, -0.6, -T, w / 2 + T, -0.05, d + T, '#a39d92', true);
  r.box(-w / 2 - T, 0, -T, -w / 2, H, d + T, wall, true);
  r.box(w / 2, 0, -T, w / 2 + T, H, d + T, wall, true);
  r.box(-w / 2, 0, d, w / 2, H, d + T, wall, true);
  const dx0 = r.doorX - r.doorHalf;
  const dx1 = r.doorX + r.doorHalf;
  r.box(-w / 2, 0, -T, dx0, H, 0, wall, true);
  r.box(dx1, 0, -T, w / 2, H, 0, wall, true);
  r.box(dx0, r.doorTop, -T, dx1, H, 0, wall, true);
  r.box(-w / 2 - T, H, -T, w / 2 + T, H + 0.2, d + T, '#f3f1ec', true);
  r.panel(-vx + 0.3, H - 0.03, az0 + 0.3, vx - 0.3, H, az1 - 0.3, '#eaf6ff', true);
  doorway(r);
  const sd = Math.min(7, w / 2 - vx - 3.5); // shop depth
  for (let k = 0; k < storeys; k++) {
    const y = k * storey;
    const ceiling = k < storeys - 1 ? (k + 1) * storey - 0.25 : H;
    r.baseY = y;
    r.structural = true;
    if (k > 0) {
      // The gallery floor round the atrium.
      const slab = (x0: number, x1: number, z0: number, z1: number): void => r.box(x0, y - 0.25, z0, x1, y - 0.05, z1, '#efede8', true);
      slab(-w / 2, w / 2, 0, az0);
      // Past the atrium the escalators come up through the floor: an opening over them.
      slab(-w / 2, -1.45, az1, az1 + 1);
      slab(1.45, w / 2, az1, az1 + 1);
      slab(-w / 2, w / 2, az1 + 1, d);
      slab(-w / 2, -vx, az0, az1);
      slab(vx, w / 2, az0, az1);
      // Railings round the atrium (glass, a steel rail on top), open where the escalators meet the floor.
      const rail = (x0: number, x1: number, z0: number, z1: number): void => {
        r.box(x0, y, z0, x1, y + 1.05, z1, '#b9d6e2', true);
        r.panel(x0 - 0.02, y + 1.05, z0 - 0.02, x1 + 0.02, y + 1.1, z1 + 0.02, '#8d9296');
      };
      const gap = 1.45;
      if (k < storeys - 1) {
        rail(-vx, -gap, az0 - 0.06, az0);
        rail(gap, vx, az0 - 0.06, az0);
      } else rail(-vx, vx, az0 - 0.06, az0);
      rail(-vx, -gap, az1, az1 + 0.06);
      rail(gap, vx, az1, az1 + 0.06);
      rail(-vx - 0.06, -vx, az0, az1);
      rail(vx, vx + 0.06, az0, az1);
    }
    // Polished floor tiles.
    r.oy = y;
    r.structural = false;
    if (k === 0) tiles(r, -w / 2, w / 2, 0, d, ['#e8e2d6', '#d9d2c4'], 1.2);
    else {
      tiles(r, -w / 2, w / 2, 0, az0, ['#e8e2d6', '#d9d2c4'], 1.2);
      tiles(r, -w / 2, w / 2, az1, d, ['#e8e2d6', '#d9d2c4'], 1.2);
      tiles(r, -w / 2, -vx, az0, az1, ['#e8e2d6', '#d9d2c4'], 1.2);
      tiles(r, vx, w / 2, az0, az1, ['#e8e2d6', '#d9d2c4'], 1.2);
    }
    // Ceiling lights over the walkways.
    for (let x = -w / 2 + 2; x < w / 2 - 1; x += 4)
      for (let z = 2; z < d - 1; z += 4) if (Math.abs(x) > vx + 0.5 || z < az0 - 0.5 || z > az1 + 0.5) r.panel(x - 0.5, ceiling - y - 0.02, z - 0.5, x + 0.5, ceiling - y, z + 0.5, '#ffffff', true);
    r.oy = 0;
    // Shops along both sides (behind an entrance plaza on the ground floor).
    if (sd >= 3.5) {
      const from = k === 0 ? 4 : 0.2;
      const count = Math.max(1, Math.floor((d - 0.4 - from) / 6));
      const length = (d - 0.4 - from) / count;
      for (const side of [-1, 1] as const) {
        const xo = side * (w / 2);
        const front = side * (w / 2 - sd);
        r.structural = true;
        for (let i = 0; i <= count; i++) r.box(xo, y, from + i * length - 0.08, front, y + (ceiling - y), from + i * length + 0.08, wall, true);
        for (let i = 0; i < count; i++) mallShop(r, xo, front, from + i * length + 0.08, from + (i + 1) * length - 0.08, y, ceiling);
      }
    }
    // The escalators up to the next floor: an up and a down side by side, with a divider and sides.
    if (k < storeys - 1) {
      for (const [x0, x1, dir] of [
        [-1.35, -0.15, 1],
        [0.15, 1.35, -1],
      ] as const) {
        escalators.push({ x0, x1, z0: az0 - 1, y0: y, steps: n, rise, run, dir });
        // Underfoot a smooth slope (invisible: the moving steps are drawn on it), so standing still
        // it carries you up or down; glass sides with black handrails.
        const slope = Math.atan2(storey, L);
        const along = Math.hypot(storey, L);
        r.solids.push({ x: (x0 + x1) / 2, y: y + storey / 2 - 0.15 / Math.cos(slope), z: az0 - 1 + L / 2, hx: (x1 - x0) / 2, hy: 0.15, hz: along / 2, pitch: slope });
        for (let i = 0; i < n; i++) {
          const top = y + (i + 1) * rise;
          const z = az0 - 1 + i * run;
          for (const [s0, s1] of [
            [x0 - 0.1, x0],
            [x1, x1 + 0.1],
          ]) {
            r.box(s0, top - 0.5, z, s1, top + 0.95, z + run, '#b9d6e2', true);
            r.panel(s0 - 0.02, top + 0.95, z, s1 + 0.02, top + 1.0, z + run, '#1d1f22');
          }
        }
        // The underside: a brushed steel truss.
        r.structural = true;
        for (let i = 0; i < n; i++) r.panel(x0, y + i * rise - 0.6, az0 - 1 + i * run, x1, y + (i + 1) * rise - 0.4, az0 - 1 + (i + 1) * run, '#9aa1a7');
        r.panel(x0, y - 0.01, az0 - 1.6, x1, y + 0.01, az0 - 1, '#7d8288'); // the landing plates
        r.panel(x0, y + storey - 0.01, az1 + 1, x1, y + storey + 0.01, az1 + 1.6, '#7d8288');
      }
    }
    // Benches by the atrium, a kiosk on the ground floor, plants.
    r.structural = false;
    r.oy = y;
    for (const s of [-1, 1]) {
      r.box(s * (vx + 0.6) - 0.25, 0, (az0 + az1) / 2 - 1, s * (vx + 0.6) + 0.25, 0.45, (az0 + az1) / 2 + 1, '#8a6a4c', true);
      r.seats.push({ x: s * (vx + 0.6), z: (az0 + az1) / 2 - 0.5, dz: 1, y }, { x: s * (vx + 0.6), z: (az0 + az1) / 2 + 0.5, dz: 1, y });
      plant(r, s * (vx + 0.7), az0 - 0.6, true);
    }
    if (k === 0) {
      counter(r, -vx - 2, az1 + 3, 1.6, '#3d5a73');
      r.panel(-vx - 2.8, 2.2, az1 + 2.6, -vx - 1.2, 2.25, az1 + 3.4, '#f39c12', true);
    }
    // The food court on the top floor: food counters along the back wall, tables in front.
    if (k === storeys - 1 && d - (az1 + 1.6) > 7) {
      for (let x = -w / 2 + sd + 1; x + 3.4 < w / 2 - sd - 0.5; x += 4) {
        r.box(x, 0, d - 1.6, x + 3.4, 1.0, d - 0.9, '#e8e4dc', true);
        r.panel(x, 2.6, d - 0.25, x + 3.4, 3.3, d - 0.22, r.pick(SHOP_SIGNS), true);
        r.panel(x + 0.4, 1.4, d - 0.22, x + 3.0, 2.3, d - 0.2, '#1d1f22');
      }
      for (let x = -w / 2 + sd + 1.5; x < w / 2 - sd - 1; x += 2.2)
        for (let z = az1 + 3; z < d - 3; z += 2.2) {
          table(r, x, z, 0.9, 0.9, '#f4f6f7');
          chair(r, x, z - 0.7, -1, r.pick(['#d35400', '#16a085', '#2980b9']));
          chair(r, x, z + 0.7, 1, r.pick(['#d35400', '#16a085', '#2980b9']));
        }
    }
    r.oy = 0;
  }
  r.structural = false;
  r.baseY = 0;
  return escalators;
}

const LIFT_DOOR = new THREE.MeshBasicMaterial({ color: 0xb4bbc1 });
/** Escalator steps: dark grooved metal. */
const TREAD = new THREE.MeshBasicMaterial({ color: 0x4a4d52 });
const TREAD_MATRIX = new THREE.Matrix4();
const TREAD_AT = new THREE.Vector3();
const TREAD_TURN = new THREE.Quaternion();
const TREAD_SIZE = new THREE.Vector3();

/**
 * The lift: a car that runs up and down its shaft, and a pair of sliding doors on every floor.
 * Walk up to the doors and it comes to your floor and opens; step in and pick a floor (the
 * floor panel on screen, or 0–9); the doors close, it goes, and opens there. Positions are in
 * the room frame; the car and doors are drawn in the inside's group.
 */
export class Lift {
  readonly group = new THREE.Group();
  readonly shaft: LiftShaft;
  /** The car's floor height (room frame), the floor it is at, and where it is going. */
  y = 0;
  at = 0;
  target: number | null = null;
  state: 'idle' | 'opening' | 'open' | 'closing' | 'moving' = 'idle';
  /** The solid boxes changed (doors opened or shut, the car came or went): refresh the physics. */
  changed = true;
  /** Sounds since the last look: the chime on arriving, the doors starting to slide (at which floor). */
  readonly sounds: { kind: 'ding' | 'doors'; floor: number }[] = [];
  private open = 0;
  private wait = 0;
  private speed = 0;
  private key = '';
  private readonly car: THREE.Mesh;
  private readonly doors: THREE.Mesh[] = [];
  private readonly panel = new THREE.BoxGeometry(0.05, 2.1, 0.56);

  constructor(shaft: LiftShaft) {
    this.shaft = shaft;
    const r = new Room(1, 1, 1, () => 0.5);
    r.structural = true;
    const { x0, x1, z0, z1 } = shaft;
    r.box(x0, -0.1, z0, x1, 0, z1, '#4f5256');
    r.box(x0, 0, z0, x0 + 0.04, 2.3, z1, '#c3c8cc');
    r.panel(x0 + 0.04, 0.9, z0 + 0.25, x0 + 0.05, 2.1, z1 - 0.25, '#dde4e8', true); // mirror
    r.box(x0, 0, z0, x1, 2.3, z0 + 0.04, '#c3c8cc');
    r.box(x0, 0, z1 - 0.04, x1, 2.3, z1, '#c3c8cc');
    r.box(x0, 2.3, z0, x1, 2.36, z1, '#d7dbde');
    r.panel(x0 + 0.3, 2.28, z0 + 0.4, x1 - 0.3, 2.3, z1 - 0.4, '#ffffff', true);
    r.panel(x0 + 0.05, 0.88, z0 + 0.3, x0 + 0.09, 0.92, z1 - 0.3, '#8d9296'); // handrail
    r.panel(x1 - 0.3, 0.95, z0 + 0.04, x1 - 0.1, 1.45, z0 + 0.06, '#2a2c2e'); // button panel
    for (let i = 0; i < 5; i++) r.panel(x1 - 0.23, 1.0 + i * 0.08, z0 + 0.06, x1 - 0.17, 1.05 + i * 0.08, z0 + 0.065, '#ffcf6b', true);
    const geometry = mergeGeometries(r.parts);
    for (const part of r.parts) part.dispose();
    this.car = new THREE.Mesh(geometry, material);
    this.group.add(this.car);
    for (let k = 0; k < shaft.floors; k++)
      for (const side of [-1, 1]) {
        const door = new THREE.Mesh(this.panel, LIFT_DOOR);
        door.position.set(x1 + 0.075, k * shaft.storey + 1.05, shaft.doorZ + side * 0.275);
        this.doors.push(door);
        this.group.add(door);
      }
  }

  /** Standing in the car (room frame). */
  inCar(p: THREE.Vector3): boolean {
    const s = this.shaft;
    return p.x > s.x0 && p.x < s.x1 + 0.05 && p.z > s.z0 && p.z < s.z1 && Math.abs(p.y - this.y) < 1.2;
  }

  floorOf(y: number): number {
    return Math.max(0, Math.min(this.shaft.floors - 1, Math.round(y / this.shaft.storey)));
  }

  /** Go to this floor (from inside the car). */
  choose(floor: number): void {
    if (floor < 0 || floor >= this.shaft.floors) return;
    if (floor === this.at && this.state !== 'moving' && this.state !== 'closing') return;
    this.target = floor;
    if (this.state === 'open' || this.state === 'opening') {
      this.state = 'closing';
      this.sounds.push({ kind: 'doors', floor: this.at });
    }
  }

  /** p = you (room frame), or null when you are not in the building. */
  update(dt: number, p: THREE.Vector3 | null): void {
    const s = this.shaft;
    const inside = p !== null && this.inCar(p);
    const floor = p ? this.floorOf(p.y) : -1;
    // Waiting at the doors on your floor: the lift comes to you.
    const waiting = p !== null && !inside && Math.abs(p.y - floor * s.storey) < 1.2 && p.x > s.x1 && p.x < s.x1 + 2.7 && Math.abs(p.z - s.doorZ) < 1.6;
    if (waiting && this.target === null) {
      if (floor !== this.at) this.target = floor;
      else if (this.state === 'idle' || this.state === 'closing') {
        if (this.state === 'idle') this.sounds.push({ kind: 'doors', floor: this.at });
        this.state = 'opening';
      }
    }
    switch (this.state) {
      case 'idle':
        if (this.target !== null && this.target !== this.at) this.state = 'moving';
        else if (this.target === this.at) {
          this.target = null;
          this.state = 'opening';
          this.sounds.push({ kind: 'doors', floor: this.at });
        }
        break;
      case 'opening':
        this.open = Math.min(1, this.open + dt / 0.9);
        if (this.open >= 1) {
          this.state = 'open';
          this.wait = 0;
        }
        break;
      case 'open':
        if (this.target !== null && this.target !== this.at) this.state = 'closing';
        else if (inside || waiting) this.wait = 0;
        else if ((this.wait += dt) > 4) this.state = 'closing';
        if (this.state === 'closing') this.sounds.push({ kind: 'doors', floor: this.at });
        break;
      case 'closing':
        if (this.target === null && (waiting || inside)) {
          this.state = 'opening';
          break;
        }
        this.open = Math.max(0, this.open - dt / 0.9);
        if (this.open <= 0) this.state = this.target !== null && this.target !== this.at ? 'moving' : 'idle';
        break;
      case 'moving': {
        const goal = (this.target ?? this.at) * s.storey;
        const left = goal - this.y;
        this.speed = Math.min(2.4, this.speed + 1.6 * dt, Math.sqrt(2 * 1.6 * Math.abs(left)) + 0.05);
        this.y += Math.sign(left) * Math.min(Math.abs(left), this.speed * dt);
        if (Math.abs(goal - this.y) < 0.002) {
          this.y = goal;
          this.at = this.target ?? this.at;
          this.target = null;
          this.speed = 0;
          this.state = 'opening';
          this.sounds.push({ kind: 'ding', floor: this.at }, { kind: 'doors', floor: this.at });
        }
        break;
      }
    }
    // The car and the doors.
    this.car.position.y = this.y;
    for (let k = 0; k < s.floors; k++) {
      const amount = k === this.at && this.state !== 'moving' ? this.open : 0;
      this.doors[k * 2].position.z = s.doorZ - 0.275 - 0.5 * amount;
      this.doors[k * 2 + 1].position.z = s.doorZ + 0.275 + 0.5 * amount;
    }
    const key = `${this.state === 'moving' ? 'm' : this.at}:${this.open > 0.5 ? 1 : 0}`;
    if (key !== this.key) {
      this.key = key;
      this.changed = true;
    }
  }

  /** Solid boxes (room frame): the car's floor while it stands at a floor, and every shut door. */
  solids(): { x: number; y: number; z: number; hx: number; hy: number; hz: number }[] {
    const s = this.shaft;
    const out: { x: number; y: number; z: number; hx: number; hy: number; hz: number }[] = [];
    if (this.state !== 'moving') out.push({ x: (s.x0 + s.x1) / 2, y: this.y - 0.1, z: (s.z0 + s.z1) / 2, hx: (s.x1 - s.x0) / 2, hy: 0.1, hz: (s.z1 - s.z0) / 2 });
    for (let k = 0; k < s.floors; k++) {
      if (k === this.at && this.state !== 'moving' && this.open > 0.5) continue;
      out.push({ x: s.x1 + 0.075, y: k * s.storey + 1.05, z: s.doorZ, hx: 0.075, hy: 1.05, hz: 0.55 });
    }
    return out;
  }

  dispose(): void {
    this.car.geometry.dispose();
    this.panel.dispose();
  }
}

/** A floor's sign by the lift: the number big, "FLOOR" and ಮಹಡಿ (Kannada) beside it. */
function floorSign(floor: number): THREE.MeshBasicMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 156;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = '#24507a';
  c.fillRect(0, 0, 256, 156);
  c.strokeStyle = '#f2f2ee';
  c.lineWidth = 6;
  c.strokeRect(8, 8, 240, 140);
  c.fillStyle = '#f2f2ee';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = 'bold 96px sans-serif';
  c.fillText(floor === 0 ? 'G' : String(floor), 80, 82);
  c.font = 'bold 28px sans-serif';
  c.fillText('FLOOR', 184, 62);
  c.font = '26px sans-serif';
  c.fillText('ಮಹಡಿ', 184, 102);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
}

/**
 * Builds the inside of a building where it stands: a room that fits inside its walls (no
 * bigger than its kind's largest), its doorway exactly where the building's door is, under its
 * roof. `ground` gives the ground height (the floor sits on the highest ground under the room).
 * Null when the building is too awkward a shape to go into.
 */
export function buildInterior(door: Door, ground: (x: number, z: number) => number): Interior | null {
  if (door.depth <= 0) return null;
  const layout = LAYOUTS[door.kind];
  const half = door.wide ? 1.2 : 0.55;
  const doorTop = door.wide ? 2.6 : 2.15;
  // Buildings of many floors are built whole (when there is room for a corridor, stairs and a
  // lift): apartment blocks (homes of 3+ floors), office blocks and hotels (2+), up to 12
  // floors and no wider or deeper than 30 m. Two-floor houses get stairs up to bedrooms.
  const blockKind: BlockKind | null =
    door.kind === 'home' && door.floors >= 3
      ? 'flats'
      : door.floors >= 2 && (door.kind === 'office' || door.kind === 'hotel' || door.kind === 'school' || door.kind === 'clinic')
        ? door.kind
        : null;
  const block = blockKind !== null && door.right - door.left >= 6.4 && door.depth - 2 * T - INSET >= 8.5;
  const twoFloors = door.kind === 'home' && door.floors === 2 && door.right - door.left >= 5 && door.depth - 2 * T - INSET >= 6.8;
  const most = block ? [30, 30] : layout.max;
  // Across: as wide as the building allows, keeping the doorway inside.
  let left = door.left;
  let right = door.right;
  if (right - left > most[0]) {
    let a = -most[0] / 2;
    let b = most[0] / 2;
    if (a < left) {
      b += left - a;
      a = left;
    }
    if (b > right) {
      a -= b - right;
      b = right;
    }
    left = a;
    right = b;
  }
  const w = right - left;
  const d = Math.min(door.depth, most[1]) - T - INSET - T;
  if (w < 2.2 || d < 2.2) return null;
  const centre = (left + right) / 2;
  // The walls along the door wall and into the building (world).
  const nx = Math.sin(door.face);
  const nz = Math.cos(door.face);
  const ux = -nz;
  const uz = nx;
  // The floor: on the highest ground under the room (so the ground never shows through it).
  let floorY = door.y;
  for (let u = left; u <= right + 0.01; u += Math.max(1, w / 6)) {
    for (let v = 0.5; v <= d + 0.01; v += Math.max(1, d / 6)) floorY = Math.max(floorY, ground(door.x + ux * u - nx * v, door.z + uz * u - nz * v));
  }
  floorY = Math.min(floorY, door.y + 0.35) + 0.03;
  const rng = makeRng(hash32(door.id, 4242));
  let escalatorTime = 0;
  const apartmentBlock = block && w >= 6.4 && d >= 8.5;
  // Malls of two floors or more: an atrium with escalators (when there is room for one).
  const mallStorey = door.kind === 'mall' && door.floors >= 2 ? Math.max(3.6, Math.min(5.5, (door.top - floorY - 0.4) / door.floors)) : 0;
  const mallFloors = mallStorey > 0 && w >= 20 && d >= mallStorey * 1.732 + 9;
  const house = !apartmentBlock && twoFloors && w >= 5 && d >= 6.8;
  const storeys = apartmentBlock ? Math.min(door.floors, 12) : house ? 2 : mallFloors ? Math.min(door.floors, 5) : 1;
  const storey = apartmentBlock || house ? Math.max(2.5, Math.min(3.6, (door.top - floorY - 0.4) / door.floors)) : 0;
  const height = apartmentBlock || house ? storeys * storey : mallFloors ? storeys * mallStorey : Math.max(2.5, Math.min(layout.height, door.top - floorY - 0.35));
  const room = new Room(w, d, height, rng, -centre, half, doorTop);
  let lift: Lift | null = null;
  const extras: THREE.Object3D[] = [];
  const signMaterials: THREE.MeshBasicMaterial[] = [];
  const signGeometry = new THREE.PlaneGeometry(0.9, 0.55).rotateY(Math.PI / 2);
  // The roof (room frame): the stairs go on up to it when every floor is built.
  const roofY = door.top - floorY;
  const roofed = roofY - height >= 0.2 && roofY - height < 1.5 && (house || (apartmentBlock && storeys === door.floors));
  let hut: StairHut | null = null;
  let escalators: Escalator[] = [];
  if (apartmentBlock) {
    const plan = apartments(room, storeys, storey, blockKind ?? 'flats', roofed ? roofY : null);
    hut = plan.hut;
    lift = new Lift(plan.shaft);
    extras.push(lift.group);
    for (const sign of plan.signs) {
      const signMaterial = floorSign(sign.floor);
      signMaterials.push(signMaterial);
      const plate = new THREE.Mesh(signGeometry, signMaterial);
      plate.position.set(sign.x, sign.y, sign.z);
      extras.push(plate);
    }
  } else if (house) hut = twoFloorHouse(room, storey, roofed ? roofY : null);
  else if (mallFloors) escalators = mallBlock(room, storeys, mallStorey);
  else layout.build(room);
  // The escalators' moving steps: one instanced mesh, slid along every frame.
  let treads: THREE.InstancedMesh | null = null;
  if (escalators.length > 0) {
    const count = escalators.reduce((sum, e) => sum + e.steps, 0);
    treads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), TREAD, count);
    treads.frustumCulled = false;
    extras.push(treads);
  }
  const geometry = mergeGeometries(room.parts);
  for (const part of room.parts) part.dispose();
  const mesh = new THREE.Mesh(geometry, material);

  const group = new THREE.Group();
  group.add(mesh, ...extras);
  // Room frame: x across (= along the door wall), z into the building; its door wall stands
  // just inside the building's own wall.
  const inward = T + INSET;
  group.position.set(door.x + ux * centre - nx * inward, floorY, door.z + uz * centre - nz * inward);
  group.rotation.y = door.face + Math.PI; // local +z points into the building
  group.userData.d = d;
  group.updateMatrixWorld(true);

  const toWorld = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld);
  const solids: Solid[] = room.solids.map((s) => {
    const p = toWorld(s.x, s.y, s.z);
    return { x: p.x, y: p.y, z: p.z, hx: s.hx, hy: s.hy, hz: s.hz, rotation: group.rotation.y, pitch: s.pitch };
  });
  const inverse = group.matrixWorld.clone().invert();
  const local = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(inverse);
  const seats = room.seats.map((s) => {
    const p = toWorld(s.x, 0, s.z);
    return { x: p.x, y: floorY + (s.y ?? 0), z: p.z, facing: s.dz === -1 ? group.rotation.y : group.rotation.y + Math.PI };
  });
  return {
    door,
    group,
    floorY,
    solids,
    seats,
    lift,
    local,
    liftSolids() {
      return (lift?.solids() ?? []).map((s) => {
        const p = toWorld(s.x, s.y, s.z);
        return { x: p.x, y: p.y, z: p.z, hx: s.hx, hy: s.hy, hz: s.hz, rotation: group.rotation.y };
      });
    },
    hole: { x: door.x, y: door.y, z: door.z, face: door.face, half: half + 0.03, top: doorTop + 0.04, depth: inward + 0.06 },
    roofHole: hut
      ? (() => {
          const c = toWorld((hut.x0 + hut.x1) / 2, hut.roof, (hut.z0 + hut.z1) / 2);
          return { x: c.x, y: c.y, z: c.z, yaw: group.rotation.y, hx: (hut.x1 - hut.x0) / 2 - 0.16, hy: 0.6, hz: (hut.z1 - hut.z0) / 2 - 0.16 };
        })()
      : null,
    escalatorAt(x, y, z) {
      if (escalators.length === 0) return null;
      const p = local(x, y, z);
      for (const e of escalators) {
        if (p.x < e.x0 || p.x > e.x1 || p.z < e.z0 - 0.2 || p.z > e.z0 + e.steps * e.run + 0.2) continue;
        const surface = e.y0 + Math.max(0, Math.min(e.steps, (p.z - e.z0) / e.run + 1)) * e.rise;
        if (Math.abs(p.y - surface) > 0.7) continue;
        const speed = 0.55 * e.dir;
        // Up or down only along the slope itself; level for the last bit at either end.
        const onSlope = p.z > e.z0 && p.z < e.z0 + e.steps * e.run;
        return { x: Math.sin(group.rotation.y) * speed, y: onSlope ? (speed * e.rise) / e.run : 0, z: Math.cos(group.rotation.y) * speed };
      }
      return null;
    },
    update(dt) {
      if (!treads) return;
      escalatorTime += dt;
      let i = 0;
      for (const e of escalators) {
        const span = e.steps * e.run;
        for (let k = 0; k < e.steps; k++) {
          const along = (((k * e.run + e.dir * escalatorTime * 0.55) % span) + span) % span;
          const top = e.y0 + (along / e.run + 1) * e.rise;
          TREAD_MATRIX.compose(TREAD_AT.set((e.x0 + e.x1) / 2, top - e.rise / 2, e.z0 + along + e.run / 2), TREAD_TURN, TREAD_SIZE.set(e.x1 - e.x0 - 0.04, e.rise, e.run - 0.02));
          treads.setMatrixAt(i++, TREAD_MATRIX);
        }
      }
      treads.instanceMatrix.needsUpdate = true;
    },
    covers(x, z) {
      const p = local(x, floorY, z);
      return Math.abs(p.x) < w / 2 + 1 && p.z > -1 && p.z < d + 1;
    },
    contains(x, y, z) {
      const p = local(x, y, z);
      const inHut = hut !== null && p.x > hut.x0 && p.x < hut.x1 && p.z > hut.z0 && p.z < hut.z1 && p.y < hut.top;
      return Math.abs(p.x) < w / 2 && p.z > 0 && p.z < d && p.y > -1 && (p.y < height + 0.1 || inHut);
    },
    doorway(x, y, z) {
      const p = local(x, y, z);
      return Math.abs(p.x + centre) < half && p.z > -T - 1.1 && p.z < 0.6 && p.y > -1 && p.y < doorTop;
    },
    dispose() {
      geometry.dispose();
      treads?.geometry.dispose();
      lift?.dispose();
      signGeometry.dispose();
      for (const m of signMaterials) {
        m.map?.dispose();
        m.dispose();
      }
      group.removeFromParent();
    },
  };
}
