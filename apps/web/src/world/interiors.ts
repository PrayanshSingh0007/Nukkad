import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, makeRng } from '@nukkad/shared';
import type { Door, InteriorKind } from '@nukkad/worldgen';

/**
 * The inside of a building, built on this device when you walk through its front door.
 * Like most open-world games, the inside is its own room (placed deep under the building,
 * so friends who go through the same door end up in the same room and see each other).
 * Everything is boxes merged into ONE mesh with the light baked into the colours
 * (no extra lights = no shader rebuild, cheap on phones), plus solid boxes for physics.
 */

/** How far below the street the insides are, metres (each building a little different, so neighbours never overlap). */
export const INTERIOR_DEPTH = 60;

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
  /** Where you appear inside, and which way you face. */
  spawn: { x: number; z: number; heading: number };
  /** Inside if (x, z) is within the room (used to show friends who are in here too). */
  contains(x: number, y: number, z: number): boolean;
  /** Near the way out. */
  nearExit(x: number, z: number): boolean;
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
  readonly seats: { x: number; z: number; dz: 1 | -1 }[] = [];

  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly rng: () => number;

  constructor(w: number, d: number, h: number, rng: () => number) {
    this.w = w;
    this.d = d;
    this.h = h;
    this.rng = rng;
  }

  /** A box from (x0, y0, z0) to (x1, y1, z1). `solid` = you bump into it. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string | Rgb, solid = false, glow = false): void {
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
        light *= 0.84 + 0.16 * Math.min(1, y / 1.2);
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
  const { w, d, h } = r;
  // Checked floor tiles (two shades), then walls and ceiling.
  const nx = Math.max(1, Math.round(w / tiles));
  const nz = Math.max(1, Math.round(d / tiles));
  const tw = w / nx;
  const td = d / nz;
  if (nx * nz <= 900) {
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) r.panel(-w / 2 + i * tw, -0.05, k * td, -w / 2 + (i + 1) * tw - 0.01, 0, (k + 1) * td - 0.01, floor[(i + k) % 2]);
  } else r.panel(-w / 2, -0.05, 0, w / 2, 0, d, floor[0]);
  r.box(-w / 2 - 1, -0.6, -1, w / 2 + 1, -0.05, d + 1, '#a39d92', true); // solid floor slab (shows as grout between tiles)
  r.box(-w / 2 - T, 0, -T, -w / 2, h, d + T, wall, true);
  r.box(w / 2, 0, -T, w / 2 + T, h, d + T, wall, true);
  r.box(-w / 2, 0, d, w / 2, h, d + T, wall, true);
  r.box(-w / 2, 0, -T, w / 2, h, 0, wall, true); // door wall
  r.box(-w / 2 - T, h, -T, w / 2 + T, h + 0.2, d + T, '#f3f1ec', true); // ceiling
  // Skirting.
  r.panel(-w / 2, 0, d - 0.02, w / 2, 0.1, d, '#8b8378');
  r.panel(-w / 2, 0, 0.0, -w / 2 + 0.02, 0.1, d, '#8b8378');
  r.panel(w / 2 - 0.02, 0, 0, w / 2, 0.1, d, '#8b8378');
  // Ceiling lamps every ~4 m (glowing panels).
  for (let x = -w / 2 + 2; x < w / 2 - 1; x += 4) for (let z = 2; z < d - 1; z += 4) r.panel(x - 0.5, h - 0.03, z - 0.25, x + 0.5, h, z + 0.25, '#ffffff', true);
  // The way out: a door in the door wall with a green EXIT strip above it.
  r.panel(-0.6, 0, 0, 0.6, 2.2, 0.04, '#5c3d2a');
  r.panel(-0.65, 2.2, 0, 0.65, 2.3, 0.05, '#d8d0bf');
  r.panel(-0.3, 2.42, 0, 0.3, 2.6, 0.05, '#1fa35a', true);
  r.panel(-0.6, 0, 0.1, 0.6, 0.01, 1.0, '#7a4b3a'); // doormat
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
  r.seats.push({ x, z, dz: facing === 1 ? -1 : 1 });
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

export function buildInterior(door: Door): Interior {
  const layout = LAYOUTS[door.kind];
  const w = Math.min(layout.max[0], Math.max(layout.min[0], Math.round(door.w)));
  const d = Math.min(layout.max[1], Math.max(layout.min[1], Math.round(door.d)));
  const rng = makeRng(hash32(door.id, 4242));
  const room = new Room(w, d, layout.height, rng);
  layout.build(room);
  const geometry = mergeGeometries(room.parts);
  for (const part of room.parts) part.dispose();
  const mesh = new THREE.Mesh(geometry, material);

  const floorY = door.y - INTERIOR_DEPTH - (hash32(door.id, 7) % 6) * 8;
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(door.x, floorY, door.z);
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
  const spawnAt = toWorld(0, 0, 2.6);
  const seats = room.seats.map((s) => {
    const p = toWorld(s.x, 0, s.z);
    return { x: p.x, y: floorY, z: p.z, facing: s.dz === -1 ? group.rotation.y : group.rotation.y + Math.PI };
  });
  return {
    door,
    group,
    floorY,
    solids,
    seats,
    spawn: { x: spawnAt.x, z: spawnAt.z, heading: door.face + Math.PI },
    contains(x, y, z) {
      const p = local(x, y, z);
      return Math.abs(p.x) < w / 2 + 0.5 && p.z > -0.5 && p.z < d + 0.5 && p.y > -1 && p.y < layout.height + 1;
    },
    nearExit(x, z) {
      const p = local(x, floorY, z);
      return Math.abs(p.x) < 1.6 && p.z < 2.1;
    },
    dispose() {
      geometry.dispose();
      group.removeFromParent();
    },
  };
}
