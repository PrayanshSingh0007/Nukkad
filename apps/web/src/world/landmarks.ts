import * as THREE from 'three';
import { makeProjector } from '@nukkad/shared';
import { type Door, type TerrainGrid, heightAt } from '@nukkad/worldgen';

/**
 * Landmarks: a few real buildings given their own look, from the owner's photos (shapes and
 * colours only — no pictures, map data or logos copied in).
 *
 * GEAR Innovative International School (Gear School Road, off the Outer Ring Road): on the front
 * of its main block a big arch of blue glass rises above the roof in a dark grey rim, with a
 * barrel vault of glass behind it; under it a terracotta band carries the school's name in white
 * letters; the cream front has tall white pillars with open verandas and railings on every floor,
 * and a blue glass stair tower at the corner.
 */

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

class Parts {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];

  tri(a: number[], b: number[], c: number[], ca: Rgb, cb: Rgb = ca, cc: Rgb = ca): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    [
      [a, ca],
      [b, cb],
      [c, cc],
    ].forEach(([p, col]) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(col[0], col[1], col[2]);
    });
  }

  quad(a: number[], b: number[], c: number[], d: number[], colour: Rgb, top?: Rgb): void {
    const t = top ?? colour;
    this.tri(a, b, c, colour, colour, t);
    this.tri(a, c, d, colour, t, t);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A building front's own frame: s along the wall (0 = its middle), y up, o out of the wall. */
class Front {
  readonly length: number;
  private readonly mx: number;
  private readonly mz: number;
  private readonly ux: number;
  private readonly uz: number;
  private readonly nx: number;
  private readonly nz: number;

  /** The wall from (ax, az) to (bx, bz), its outside towards (sin face, cos face). */
  constructor(ax: number, az: number, bx: number, bz: number, face: number) {
    this.length = Math.hypot(bx - ax, bz - az);
    this.mx = (ax + bx) / 2;
    this.mz = (az + bz) / 2;
    this.ux = (bx - ax) / this.length;
    this.uz = (bz - az) / this.length;
    this.nx = Math.sin(face);
    this.nz = Math.cos(face);
  }

  at(s: number, y: number, o: number): number[] {
    return [this.mx + this.ux * s + this.nx * o, y, this.mz + this.uz * s + this.nz * o];
  }

  /** A box in the front's frame. */
  box(parts: Parts, s0: number, y0: number, o0: number, s1: number, y1: number, o1: number, colour: Rgb): void {
    const c = [
      this.at(s0, y0, o0),
      this.at(s1, y0, o0),
      this.at(s1, y0, o1),
      this.at(s0, y0, o1),
      this.at(s0, y1, o0),
      this.at(s1, y1, o0),
      this.at(s1, y1, o1),
      this.at(s0, y1, o1),
    ];
    // Wind each face so it looks out whichever way the wall runs.
    const faces = [
      [4, 5, 6, 7],
      [0, 3, 2, 1],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    const centre = this.at((s0 + s1) / 2, (y0 + y1) / 2, (o0 + o1) / 2);
    for (const [a, b, cc, d] of faces) {
      const p = [c[a], c[b], c[cc], c[d]];
      const ux = p[1][0] - p[0][0];
      const uy = p[1][1] - p[0][1];
      const uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0];
      const vy = p[2][1] - p[0][1];
      const vz = p[2][2] - p[0][2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const fc = [(p[0][0] + p[2][0]) / 2 - centre[0], (p[0][1] + p[2][1]) / 2 - centre[1], (p[0][2] + p[2][2]) / 2 - centre[2]];
      if (n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] < 0) parts.quad(p[0], p[3], p[2], p[1], colour);
      else parts.quad(p[0], p[1], p[2], p[3], colour);
    }
  }
}

function nameBoard(lines: [string, string]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 256;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.clearRect(0, 0, 2048, 256);
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '600 120px Georgia, "Times New Roman", serif';
  c.fillText(lines[0], 1024, 100);
  c.font = '500 54px Georgia, "Times New Roman", serif';
  c.fillText(lines[1], 1024, 205);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The main block's front: its south wall, facing the campus gate and the turf ground, between
 * these two corners of the building on the map (OpenStreetMap way 343629936), and the middle of
 * the block. (The east wall faces tall flats a few metres away; the gate is to the south.)
 */
const GEAR_FRONT = { a: [12.9170976, 77.6969778], b: [12.9169966, 77.6975278], middle: [12.91746, 77.6972] } as const;

function gearFront(door: Door, origin: { lat: number; lng: number }, terrain: TerrainGrid, group: THREE.Group, disposables: { dispose(): void }[]): void {
  const projector = makeProjector(origin.lat, origin.lng); // the game's own map projection
  const local = ([lat, lng]: readonly [number, number]): [number, number] => projector.toLocal(lat, lng);
  const [ax, az] = local(GEAR_FRONT.a);
  const [bx, bz] = local(GEAR_FRONT.b);
  const [mx, mz] = local(GEAR_FRONT.middle);
  // Outside = away from the middle of the block.
  let nx = -(bz - az);
  let nz = bx - ax;
  if (nx * ((ax + bx) / 2 - mx) + nz * ((az + bz) / 2 - mz) < 0) {
    nx = -nx;
    nz = -nz;
  }
  const face = Math.atan2(nx, nz);
  const front = new Front(ax, az, bx, bz, face);
  // The door may be on another part of the block: only use the front if it is close by.
  if (Math.hypot(door.x - (ax + bx) / 2, door.z - (az + bz) / 2) > 80) return;
  const L = front.length;
  if (L < 12) return;
  // The ground along the front (the site slopes): the lowest of it; the roof is the building's.
  let low = Infinity;
  for (let s = -L / 2; s <= L / 2; s += 4) {
    const p = front.at(s, 0, 1.5);
    low = Math.min(low, heightAt(terrain, p[0], p[2]));
  }
  const ground = low - 0.3;
  const top = Math.max(door.top, low + 6);
  const floors = Math.max(2, Math.round((top - low) / 3.3));
  const storey = (top - low) / floors;
  const solid = new Parts();
  const glass = new Parts();
  const white = rgb('#f4f2ec');
  const cream = rgb('#e8d8b0');
  const rail = rgb('#2b2d30');
  const terracotta = rgb('#93472b');
  const rim = rgb('#3d4248');
  const blueLow = rgb('#2a55a8');
  const blueHigh = rgb('#6d9be0');

  // Tall white pillars along the front, and a veranda slab with a railing on every upper floor.
  const bays = Math.max(3, Math.round(L / 4.2));
  for (let i = 0; i <= bays; i++) {
    const s = -L / 2 + 0.6 + ((L - 1.2) * i) / bays;
    front.box(solid, s - 0.24, ground, 0, s + 0.24, top - 0.2, 0.55, white);
  }
  for (let f = 1; f < floors; f++) {
    const y = low + f * storey;
    front.box(solid, -L / 2 + 0.4, y - 0.18, 0, L / 2 - 0.4, y, 0.95, cream);
    front.box(solid, -L / 2 + 0.4, y + 0.85, 0.9, L / 2 - 0.4, y + 0.92, 0.95, rail);
    for (let s = -L / 2 + 0.6; s < L / 2 - 0.5; s += 0.5) front.box(solid, s - 0.02, y, 0.91, s + 0.02, y + 0.85, 0.94, rail);
  }
  // The terracotta band along the top, the name on it.
  const bandW = Math.min(L - 1, 46);
  front.box(solid, -bandW / 2, top - 0.3, -0.2, bandW / 2, top + 1.6, 0.7, terracotta);
  const boardW = Math.min(bandW * 0.9, 30);
  const texture = nameBoard(['GEAR Innovative Intl. School', 'Multiple Intelligences & Talents Development Gurukul']);
  const boardMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardW / 8), boardMaterial);
  const at = front.at(0, top + 0.65, 0.72);
  board.position.set(at[0], at[1], at[2]);
  board.rotation.y = face;
  group.add(board);
  disposables.push(board.geometry, boardMaterial, texture);

  // The arch: a circular segment of blue glass above the band, in a thick dark rim, with mullions,
  // and a barrel vault of glass running back into the roof.
  const span = Math.min(L * 0.82, 40);
  const rise = span * 0.34;
  const base = top + 1.6;
  const radius = (span * span) / 4 / (2 * rise) + rise / 2;
  const cy = base + rise - radius;
  const arcY = (s: number): number => cy + Math.sqrt(Math.max(0, radius * radius - s * s));
  const steps = 48;
  const depth = Math.min(10, L * 0.35);
  for (let i = 0; i < steps; i++) {
    const s0 = -span / 2 + (span * i) / steps;
    const s1 = -span / 2 + (span * (i + 1)) / steps;
    const y0 = arcY(s0);
    const y1 = arcY(s1);
    const t0 = (y0 - base) / rise;
    const t1 = (y1 - base) / rise;
    const mix = (t: number): Rgb => [blueLow[0] + (blueHigh[0] - blueLow[0]) * t, blueLow[1] + (blueHigh[1] - blueLow[1]) * t, blueLow[2] + (blueHigh[2] - blueLow[2]) * t];
    // Front glass (both sides drawn by the material).
    glass.tri(front.at(s0, base, 0.3), front.at(s1, base, 0.3), front.at(s1, y1, 0.3), blueLow, blueLow, mix(t1));
    glass.tri(front.at(s0, base, 0.3), front.at(s1, y1, 0.3), front.at(s0, y0, 0.3), blueLow, mix(t1), mix(t0));
    // The vault running back.
    glass.quad(front.at(s0, y0, 0.3), front.at(s1, y1, 0.3), front.at(s1, y1, -depth), front.at(s0, y0, -depth), mix(Math.max(t0, t1)));
    // The rim: a curved slab round the top of the arch.
    const r0 = [front.at(s0, y0, 0.85), front.at(s1, y1, 0.85)];
    const out = (s: number, y: number, k: number): number[] => {
      const dx = s;
      const dy = y - cy;
      const l = Math.hypot(dx, dy) || 1;
      return front.at(s + (dx / l) * k, y + (dy / l) * k, 0.85);
    };
    const o0 = out(s0, y0, 0.9);
    const o1 = out(s1, y1, 0.9);
    solid.quad(r0[0], r0[1], o1, o0, rim);
    const back0 = out(s0, y0, 0.9);
    back0[0] -= Math.sin(face) * (depth + 1.1);
    back0[2] -= Math.cos(face) * (depth + 1.1);
    const back1 = out(s1, y1, 0.9);
    back1[0] -= Math.sin(face) * (depth + 1.1);
    back1[2] -= Math.cos(face) * (depth + 1.1);
    solid.quad(o0, o1, back1, back0, rim);
  }
  // Mullions: upright every 2.2 m, across every 1.6 m.
  for (let s = -span / 2 + 2.2; s < span / 2 - 0.5; s += 2.2) front.box(solid, s - 0.06, base, 0.3, s + 0.06, arcY(s), 0.42, rim);
  for (let y = base + 1.6; y < base + rise - 0.4; y += 1.6) {
    const half = Math.sqrt(Math.max(0, radius * radius - (y - cy) * (y - cy)));
    front.box(solid, -half, y - 0.05, 0.3, half, y + 0.05, 0.42, rim);
  }
  // The blue glass stair tower at the corner.
  const tower = Math.min(3.2, L * 0.12);
  const ts = -L / 2 + 0.3;
  for (const [s0, s1, o0, o1] of [
    [ts, ts + tower, 0.55, 0.6],
    [ts, ts + 0.05, -0.2, 0.6],
    [ts + tower - 0.05, ts + tower, -0.2, 0.6],
  ]) {
    const a = front.at(s0, ground, o0);
    const b = front.at(s1, ground, o1);
    glass.quad(a, [b[0], ground, b[2]], [b[0], top + 1.2, b[2]], [a[0], top + 1.2, a[2]], blueLow, blueHigh);
  }
  for (let y = ground + storey; y < top + 1.2; y += storey) front.box(solid, ts, y - 0.06, 0.52, ts + tower, y + 0.06, 0.62, rim);

  const solidGeometry = solid.geometry();
  const solidMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const solidMesh = new THREE.Mesh(solidGeometry, solidMaterial);
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  const glassGeometry = glass.geometry();
  const glassMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x9fc4ff, shininess: 90, side: THREE.DoubleSide, emissive: 0x081830 });
  const glassMesh = new THREE.Mesh(glassGeometry, glassMaterial);
  glassMesh.castShadow = true;
  group.add(solidMesh, glassMesh);
  disposables.push(solidGeometry, solidMaterial, glassGeometry, glassMaterial);
}

export class Landmarks {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(doors: Door[], origin: { lat: number; lng: number }, terrain: TerrainGrid) {
    const gear = doors.find((door) => /gear innovative/i.test(door.name ?? ''));
    if (gear) gearFront(gear, origin, terrain, this.group, this.disposables);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
