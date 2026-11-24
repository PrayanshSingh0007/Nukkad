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
  readonly solids: { x: number; y: number; z: number; hx: number; hy: number; hz: number }[] = [];
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

  constructor(w: number, d: number, h: number, rng: () => number, doorX = 0, doorHalf = 0.6, doorTop = 2.2) {
    this.w = w;
    this.d = d;
    this.h = h;
    this.rng = rng;
    this.doorX = doorX;
    this.doorHalf = doorHalf;
    this.doorTop = doorTop;
  }

  /** The way in stays clear: furniture that would stand in it is left out. */
  private inTheWay(x0: number, y0: number, y1: number, z0: number, x1: number, z1: number): boolean {
    if (this.structural || y1 <= 0.05 || y0 > 2.4) return false;
    const a = this.doorX - this.doorHalf - 0.35;
    const b = this.doorX + this.doorHalf + 0.35;
    return Math.min(x0, x1) < b && Math.max(x0, x1) > a && Math.min(z0, z1) < 1.7;
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
  r.box(-w / 2 - T, h, -T, w / 2 + T, h + 0.2, d + T, '#f3f1ec', true); // ceiling
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
  r.box(-0.9, 0, 0.3, -0.5, 0.9, 0.9, '#7b5a40', true); // shoe rack by the door
  // Living room (front half): sofa, coffee table, TV wall, rug.
  const lz = Math.min(d * 0.45, 5);
  const cx = -(w / 4 + 0.2); // the living room sits to the left, the way in stays free
  r.panel(cx + -1.4, 0.001, lz - 1.4, cx + 1.4, 0.012, lz + 0.6, r.pick(['#a8463a', '#3e5f8a', '#7a5c2e']));
  r.box(cx + -1.3, 0, lz + 0.6, cx + 1.3, 0.45, lz + 1.4, '#6d7c8c', true); // sofa seat
  for (const sx of [-0.8, 0, 0.8]) r.seats.push({ x: cx + sx, z: lz + 0.85, dz: -1 });
  r.box(cx + -1.3, 0.45, lz + 1.15, cx + 1.3, 0.95, lz + 1.4, '#64727f'); // back
  r.box(cx + -1.45, 0, lz + 0.6, cx + -1.3, 0.65, lz + 1.4, '#64727f', true);
  r.box(cx + 1.3, 0, lz + 0.6, cx + 1.45, 0.65, lz + 1.4, '#64727f', true);
  table(r, cx, lz - 0.3, 1.0, 0.55, '#8a6544', 0.42);
  r.box(cx + -1.1, 0, lz - 2.3, cx + 1.1, 0.5, lz - 1.9, '#5b4636', true); // TV unit
  r.panel(cx + -0.8, 0.8, lz - 2.2, cx + 0.8, 1.6, lz - 2.15, '#15181d'); // TV
  plant(r, w / 2 - 0.6, 1.0);
  // Kitchen along one side wall: counter, stove, fridge.
  const kx = w / 2 - 0.35;
  if (d > 6) {
    r.box(kx - 0.3, 0, lz + 2.5, kx + 0.35, 0.9, lz + 5, '#d6d0c4', true);
    r.panel(kx - 0.32, 0.9, lz + 2.5, kx + 0.35, 0.94, lz + 5, '#3a3a3a');
    r.panel(kx - 0.25, 0.94, lz + 3, kx + 0.2, 0.96, lz + 3.6, '#202020'); // stove
    r.box(kx - 0.35, 0, lz + 5.1, kx + 0.35, 1.8, lz + 5.8, '#e4e6e8', true); // fridge
  }
  // Dining table.
  if (w > 6 && d > 7) {
    table(r, -w / 4, lz + 3.3, 1.4, 0.8, '#7c5a3c');
    for (const s of [-1, 1] as const) {
      chair(r, -w / 4 - 0.35, lz + 3.3 + s * 0.7, s, '#6a4c33');
      chair(r, -w / 4 + 0.35, lz + 3.3 + s * 0.7, s, '#6a4c33');
    }
  }
  // Bedroom at the back behind a partition with a doorway.
  if (d > 9) {
    const bz = d - 4.2;
    r.box(-w / 2, 0, bz, -0.6, r.h, bz + 0.12, '#ece4d8', true);
    r.box(0.6, 0, bz, w / 2, r.h, bz + 0.12, '#ece4d8', true);
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

/**
 * An apartment block, every floor of it: a lobby on the ground floor (letterboxes, a security
 * desk), a corridor up the middle of each floor with the flats' doors (one flat on each floor is
 * open and furnished), switchback stairs with a landing between floors, and a lift shaft whose
 * car runs up and down (see `Lift`). Returns the shaft and where each floor's sign goes.
 */
function apartments(r: Room, storeys: number, storey: number): { shaft: LiftShaft; signs: { x: number; y: number; z: number; floor: number }[] } {
  const { w, d } = r;
  const H = storeys * storey;
  const wall = r.pick(['#efe7d8', '#e9e4da', '#f2ece0', '#e8ede6']);
  const inner = '#ece6da';
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
  r.box(-w / 2 - T, H, -T, w / 2 + T, H + 0.2, d + T, '#f3f1ec', true);
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
    if (k === 0) tiles(r, -w / 2, w / 2, 0, d, CORRIDOR_TILES, 1.0);
    else {
      tiles(r, c0, c1, 0, d, CORRIDOR_TILES, 0.9);
      tiles(r, c1, s1, coreZ, stairZ, CORRIDOR_TILES, 0.9);
    }
    r.oy = 0;

    // Flats on both sides of the corridor (behind a lobby on the ground floor).
    const zs = k === 0 ? 3.4 : 0;
    const room = coreZ - zs >= 3;
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
      const n = Math.max(1, Math.floor((coreZ - zs) / 5));
      const length = (coreZ - zs) / n;
      const pick = Math.floor(r.rng() * n);
      // Back wall (towards the core), the front wall facing the lobby, and partitions.
      r.box(xo, y, coreZ - 0.15, xc, y + tall, coreZ, inner, true);
      if (zs > 0) r.box(xo, y, zs - 0.15, xc, y + tall, zs, inner, true);
      for (let i = 1; i < n; i++) r.box(xo, y, zs + i * length - 0.075, xc, y + tall, zs + i * length + 0.075, inner, true);
      for (let i = 0; i < n; i++) {
        const z = zs + (i + 0.5) * length;
        if (side === openSide && i === pick) {
          (side < 0 ? leftGaps : rightGaps).push([z - 0.5, z + 0.5]);
          open.push({ side, xo, xc, z0: zs + i * length + (i > 0 ? 0.075 : 0), z1: zs + (i + 1) * length - (i < n - 1 ? 0.075 : 0.15), z });
        } else shut.push({ face: side < 0 ? c0 : c1, toward: side < 0 ? 1 : -1, z });
      }
    }
    // The corridor's walls: the left one runs to the back (the lift doors are in it); the right
    // one stops at the stairs. Where a side has no flats the wall closes it off (the ground
    // floor's lobby stays open).
    const leftFrom = leftFlats ? zs : k === 0 ? coreZ : 0;
    const rightFrom = rightFlats ? zs : k === 0 ? coreZ : 0;
    wallAlongZ(r, c0 - 0.15, c0, leftFrom, d, y, tall, inner, leftGaps);
    if (rightFrom < coreZ) wallAlongZ(r, c1, c1 + 0.15, rightFrom, coreZ, y, tall, inner, rightGaps);
    if (k === 0 && !leftFlats) r.box(-w / 2, y, coreZ - 0.15, c0 - 0.15, y + tall, coreZ, inner, true);
    if (k === 0 && !rightFlats) r.box(c1, y, coreZ - 0.15, w / 2, y + tall, coreZ, inner, true);
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
    if (k < storeys - 1) {
      const steps = 9;
      const rise = storey / (2 * steps);
      const run = (landZ - stairZ) / steps;
      for (let i = 0; i < steps; i++) {
        const ta = y + (i + 1) * rise;
        r.box(s0, Math.max(y, ta - 0.28), stairZ + i * run, sm - 0.06, ta, stairZ + (i + 1) * run, STAIR_STONE, true);
        const tb = y + storey / 2 + (i + 1) * rise;
        r.box(sm + 0.06, tb - 0.28, landZ - (i + 1) * run, s1, tb, landZ - i * run, STAIR_STONE, true);
        // Handrail along the outer wall.
        r.panel(s1 - 0.06, tb + 0.85, landZ - (i + 1) * run, s1 - 0.02, tb + 0.9, landZ - i * run, RAIL);
      }
      r.box(s0, y + storey / 2 - 0.25, landZ, s1, y + storey / 2, d, STAIR_STONE, true);
      r.box(sm - 0.06, y, stairZ, sm + 0.06, y + storey, landZ, inner, true); // between the flights
      r.panel(sm - 0.07, y + storey - 0.05, stairZ, sm + 0.07, y + storey, landZ, RAIL);
      if (k === 0) r.box(sm + 0.06, 0, stairZ, s1, storey / 2 - 0.3, landZ, inner, true); // nobody walks under the first flight
      r.panel(sm - 0.4, y + storey / 2 + 2.3, landZ + 0.3, sm + 0.4, y + storey / 2 + 2.32, d - 0.3, '#ffffff', true); // landing light
    } else {
      // Top floor: a railing where the last flight came up.
      r.box(s0, y, stairZ, sm, y + 1.0, stairZ + 0.06, RAIL, true);
    }
    // Corridor lights, and a window at its front end (upper floors).
    for (let z = 1.5; z < d - 0.5; z += 3) r.panel(c0 + 0.6, ceiling - 0.02, z - 0.2, c1 - 0.6, ceiling, z + 0.2, '#ffffff', true);
    if (k > 0) wallWindow(r, 'z', 0, 1, c0 + 0.25, c1 - 0.25, y + 0.9, y + 2.2);
    // The flats: shut doors with shoes outside; one open and furnished.
    for (const s of shut) shutFlat(r, s.face, s.toward, s.z, y);
    for (const f of open) furnishFlat(r, f.side, f.xo, f.xc, f.z0, f.z1, y, f.z, ceiling);
    r.structural = true;
    if (k === 0) {
      // The lobby: letterboxes, a security desk with a chair, a notice board, a plant.
      r.structural = false;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 3; j++) {
          r.panel(-w / 2, 1.0 + j * 0.24, 0.9 + i * 0.36, -w / 2 + 0.14, 1.2 + j * 0.24, 1.22 + i * 0.36, '#8f969c');
          r.panel(-w / 2 + 0.14, 1.12 + j * 0.24, 0.98 + i * 0.36, -w / 2 + 0.15, 1.14 + j * 0.24, 1.14 + i * 0.36, '#2a2c2e');
        }
      counter(r, w / 2 - 1.1, 2.4, 1.4, '#7a5c40');
      chair(r, w / 2 - 1.1, 3.05, 1, '#2f4f6f');
      r.panel(w / 2 - 0.03, 1.2, 0.6, w / 2, 1.9, 1.5, '#b08a5a');
      for (let i = 0; i < 3; i++) r.panel(w / 2 - 0.04, 1.35 + (i % 2) * 0.2, 0.7 + i * 0.25, w / 2 - 0.03, 1.6 + (i % 2) * 0.2, 0.9 + i * 0.25, '#f4f1e8');
      plant(r, -w / 2 + 0.5, 3.0, true);
      for (let x = -w / 2 + 1.5; x < w / 2 - 1; x += 3) r.panel(x - 0.4, ceiling - 0.02, 1.4, x + 0.4, ceiling, 1.9, '#ffffff', true);
    }
  }
  r.structural = false;
  r.baseY = 0;
  return { shaft: { x0: L0, x1: L1, z0: Z0, z1: Z1, doorZ, storey, floors: storeys }, signs };
}

const LIFT_DOOR = new THREE.MeshBasicMaterial({ color: 0xb4bbc1 });

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
    if (this.state === 'open' || this.state === 'opening') this.state = 'closing';
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
      else if (this.state === 'idle' || this.state === 'closing') this.state = 'opening';
    }
    switch (this.state) {
      case 'idle':
        if (this.target !== null && this.target !== this.at) this.state = 'moving';
        else if (this.target === this.at) {
          this.target = null;
          this.state = 'opening';
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
  // Homes of three floors or more are apartment blocks (when there is room for a corridor,
  // stairs and a lift): every floor is built, up to 12, no wider or deeper than 30 m.
  const block = door.kind === 'home' && door.floors >= 3 && door.right - door.left >= 6.4 && door.depth - 2 * T - INSET >= 8.5;
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
  const apartmentBlock = block && w >= 6.4 && d >= 8.5;
  const storeys = apartmentBlock ? Math.min(door.floors, 12) : 1;
  const storey = apartmentBlock ? Math.max(2.8, Math.min(3.6, (door.top - floorY - 0.4) / door.floors)) : 0;
  const height = apartmentBlock ? storeys * storey : Math.max(2.5, Math.min(layout.height, door.top - floorY - 0.35));
  const room = new Room(w, d, height, rng, -centre, half, doorTop);
  let lift: Lift | null = null;
  const extras: THREE.Object3D[] = [];
  const signMaterials: THREE.MeshBasicMaterial[] = [];
  const signGeometry = new THREE.PlaneGeometry(0.9, 0.55).rotateY(Math.PI / 2);
  if (apartmentBlock) {
    const plan = apartments(room, storeys, storey);
    lift = new Lift(plan.shaft);
    extras.push(lift.group);
    for (const sign of plan.signs) {
      const signMaterial = floorSign(sign.floor);
      signMaterials.push(signMaterial);
      const plate = new THREE.Mesh(signGeometry, signMaterial);
      plate.position.set(sign.x, sign.y, sign.z);
      extras.push(plate);
    }
  } else layout.build(room);
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
    return { x: p.x, y: p.y, z: p.z, hx: s.hx, hy: s.hy, hz: s.hz, rotation: group.rotation.y };
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
    contains(x, y, z) {
      const p = local(x, y, z);
      return Math.abs(p.x) < w / 2 && p.z > 0 && p.z < d && p.y > -1 && p.y < height + 0.5;
    },
    doorway(x, y, z) {
      const p = local(x, y, z);
      return Math.abs(p.x + centre) < half && p.z > -T - 1.1 && p.z < 0.6 && p.y > -1 && p.y < doorTop;
    },
    dispose() {
      geometry.dispose();
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
