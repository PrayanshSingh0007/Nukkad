import * as THREE from 'three';
import { makeProjector } from '@nukkad/shared';
import { type Door, type TerrainGrid, fitRoom, heightAt, pointInRing } from '@nukkad/worldgen';
import { setOpenCut, withDoorHole } from './materials.ts';

/**
 * Landmarks: a few real buildings given their own look, from the owner's photos and words (shapes
 * and colours only — no pictures, map data or logos copied in).
 *
 * GEAR Innovative International School (Gear School Road, off the Outer Ring Road), its main block:
 * - On the road side (north, facing the front courts), at the end you reach first from the road,
 *   a big arch of blue glass rises above the roof in a dark grey rim, with a barrel vault of glass
 *   behind it; under it a terracotta band with the school's name in white, and entrance 1 with a
 *   canopy. The cream front has tall white pillars and a veranda with railings; a blue glass stair
 *   tower stands at the road corner. The ground between the front and the courts is paved: it is
 *   the way in to entrance 1.
 * - On the side facing Kumari Amaranthine Apartment (east), entrance 2: a hall completely open to
 *   the air, a wide flight of stairs going up to the first floor, covered by a big blue glass dome.
 *   (On the map it is the small block sticking out of that wall, where the school drive ends.)
 */

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/** A solid box for the physics: centre, half sizes, turned by `rotation` (and tipped by `pitch`). */
export interface LandmarkSolid {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  rotation: number;
  pitch?: number;
}

class Parts {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];

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

  /** a, b along the bottom; c above b, d above a. `top` colours c and d. */
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
    if (this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** A wall's own frame: s along the wall (0 = its middle), y up, o out of the wall. */
class Front {
  readonly length: number;
  readonly face: number;
  /** The wall's two ends (x, z). */
  readonly ends: [number, number, number, number];
  private readonly mx: number;
  private readonly mz: number;
  private readonly ux: number;
  private readonly uz: number;
  private readonly nx: number;
  private readonly nz: number;

  /** The wall from (ax, az) to (bx, bz), its outside towards (sin face, cos face). */
  constructor(ax: number, az: number, bx: number, bz: number, face: number) {
    this.length = Math.hypot(bx - ax, bz - az);
    this.face = face;
    this.ends = [ax, az, bx, bz];
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

  /** A map point in this frame. */
  local(x: number, z: number): { s: number; o: number } {
    const dx = x - this.mx;
    const dz = z - this.mz;
    return { s: dx * this.ux + dz * this.uz, o: dx * this.nx + dz * this.nz };
  }

  /** A box in the front's frame (drawn two-sided, so any winding shows). */
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
    const faces = [
      [4, 5, 6, 7],
      [0, 3, 2, 1],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    for (const [a, b, cc, d] of faces) parts.quad(c[a], c[b], c[cc], c[d], colour);
  }

  /** The same box as a solid for the physics. */
  solid(list: LandmarkSolid[], s0: number, y0: number, o0: number, s1: number, y1: number, o1: number): void {
    const c = this.at((s0 + s1) / 2, (y0 + y1) / 2, (o0 + o1) / 2);
    list.push({ x: c[0], y: c[1], z: c[2], hx: Math.abs(s1 - s0) / 2, hy: Math.abs(y1 - y0) / 2, hz: Math.abs(o1 - o0) / 2, rotation: this.face });
  }

  /** A round column (12 sides) standing at (s, o). */
  column(parts: Parts, s: number, o: number, r: number, y0: number, y1: number, colour: Rgb): void {
    const sides = 12;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      parts.quad(
        this.at(s + r * Math.cos(a0), y0, o + r * Math.sin(a0)),
        this.at(s + r * Math.cos(a1), y0, o + r * Math.sin(a1)),
        this.at(s + r * Math.cos(a1), y1, o + r * Math.sin(a1)),
        this.at(s + r * Math.cos(a0), y1, o + r * Math.sin(a0)),
        colour,
      );
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
  c.fillText(lines[0], 1024, 100, 2000);
  c.font = '500 54px Georgia, "Times New Roman", serif';
  c.fillText(lines[1], 1024, 205, 2000);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Concrete pavers in a running bond: mostly grey, some brick red, a little worn and stained. */
function paverTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = '#57534d';
  c.fillRect(0, 0, 512, 512);
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = 0; row < 16; row++) {
    for (let k = -1; k < 8; k++) {
      const x = k * 64 + (row % 2) * 32;
      const shade = 0.86 + random() * 0.24;
      const red = random() < 0.12;
      const [r, g, b] = red ? [146, 92, 72] : [170, 165, 156];
      c.fillStyle = `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`;
      c.fillRect(x + 1.5, row * 32 + 1.5, 61, 29);
    }
  }
  // Wear: soft darker patches (footfall, rain stains) that tile without a seam.
  for (let i = 0; i < 40; i++) {
    const x = random() * 512;
    const y = random() * 512;
    const r = 14 + random() * 50;
    for (const [dx, dy] of [
      [0, 0],
      [-512, 0],
      [0, -512],
      [-512, -512],
    ]) {
      const gradient = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gradient.addColorStop(0, 'rgba(40,36,30,0.16)');
      gradient.addColorStop(1, 'rgba(40,36,30,0)');
      c.fillStyle = gradient;
      c.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** OpenStreetMap way 343629936, GEAR's main block: its corners (lat, lng), going round. */
const GEAR_OUTLINE: readonly (readonly [number, number])[] = [
  [12.9170976, 77.6969778], // 0 south-west
  [12.9169966, 77.6975278], // 1 south-east
  [12.9173698, 77.6975999], // 2 entrance 2 (the open hall): its south side, at the main wall
  [12.917357, 77.6976695], // 3 the hall's south-east corner
  [12.917435, 77.6976845], // 4 the hall's north-east corner
  [12.917448, 77.6976141], // 5 the hall's north side, at the main wall
  [12.9177176, 77.6976625], // 6 north-east (the road corner)
  [12.9178173, 77.6971169], // 7 north-west
];
const GEAR_NAME = /gear innovative/i;
/** Entrance 1 and the arch: this far back from the road corner, metres (middle of the arch). */
const GEAR_ARCH_FROM_CORNER = 17;

interface GearPlan {
  ring: number[];
  /** The building's own ground: the lowest ground at its corners (as the world builds it). */
  base: number;
  /** The road front (north wall, west → east), and the open hall's frame (+s = north, o = east). */
  front: Front;
  hall: Front;
  hallU: number;
  hallV: number;
}

function gearPlan(origin: { lat: number; lng: number }, terrain: TerrainGrid): GearPlan {
  const projector = makeProjector(origin.lat, origin.lng); // the game's own map projection
  const pts = GEAR_OUTLINE.map(([lat, lng]) => projector.toLocal(lat, lng));
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x / pts.length;
    cz += z / pts.length;
  }
  // The face of the wall a → b that looks away from the middle of the block.
  const outward = (a: readonly number[], b: readonly number[]): number => {
    let nx = -(b[1] - a[1]);
    let nz = b[0] - a[0];
    if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return Math.atan2(nx, nz);
  };
  const front = new Front(pts[7][0], pts[7][1], pts[6][0], pts[6][1], outward(pts[7], pts[6]));
  const hall = new Front(pts[2][0], pts[2][1], pts[5][0], pts[5][1], outward(pts[2], pts[5]));
  const hallV = Math.min(hall.local(pts[3][0], pts[3][1]).o, hall.local(pts[4][0], pts[4][1]).o);
  let base = Infinity;
  for (const [x, z] of pts) base = Math.min(base, heightAt(terrain, x, z));
  return { ring: pts.flat(), base, front, hall, hallU: hall.length / 2, hallV };
}

/** Is this door GEAR's, on this very block (not a namesake far away)? */
function isGear(door: Door, plan: GearPlan): boolean {
  const [ax, az, bx, bz] = plan.front.ends;
  return GEAR_NAME.test(door.name ?? '') && Math.hypot(door.x - (ax + bx) / 2, door.z - (az + bz) / 2) < 120;
}

/** A landmark building's own floor count (its door keeps only the floors above the door's ground). */
const landmarkFloors = new Map<number, number>();

/**
 * Puts a landmark's walk-in door where the real main entrance is (GEAR: entrance 1, under the
 * arch on the road front), with the inside fitted behind it. Call before doors are looked up.
 */
export function placeLandmarkDoors(doors: Door[], origin: { lat: number; lng: number }, terrain: TerrainGrid): void {
  const door = doors.find((d) => GEAR_NAME.test(d.name ?? ''));
  if (!door) return;
  const plan = gearPlan(origin, terrain);
  if (!isGear(door, plan)) return;
  const { front, ring } = plan;
  const s = front.length / 2 - GEAR_ARCH_FROM_CORNER;
  const [x, , z] = front.at(s, 0, 0);
  const nx = Math.sin(front.face);
  const nz = Math.cos(front.face);
  const ux = -nz;
  const uz = nx;
  let minU = Infinity;
  let maxU = -Infinity;
  let depth = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const dx = ring[i] - x;
    const dz = ring[i + 1] - z;
    const u = dx * ux + dz * uz;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    depth = Math.max(depth, -(dx * nx + dz * nz));
  }
  const room = fitRoom(ring, x, z, nx, nz, minU, maxU, depth);
  const wall = front.ends.map((v) => Math.round(v * 100) / 100) as [number, number, number, number];
  // The building's floors count from its lowest ground; the inside has those above the door.
  const floors = landmarkFloors.get(door.id) ?? door.floors;
  landmarkFloors.set(door.id, floors);
  const y = heightAt(terrain, x, z);
  const floorsHere = Math.max(1, Math.round((door.top - y) / ((door.top - plan.base) / floors)));
  Object.assign(door, { x, z, y, face: front.face, w: maxU - minU, d: depth, ...room, wall, floors: floorsHere });
}

export class Landmarks {
  readonly group = new THREE.Group();
  /** Stairs, landings, columns and walls you can stand on or bump into. */
  readonly solids: LandmarkSolid[] = [];
  /** Names whose own boards are drawn here (the plain shop-style sign is left out for them). */
  readonly boards = new Set<string>();
  private readonly disposables: { dispose(): void }[] = [];
  /** Open-air areas cut out of a building: the building's outer walls let you through there. */
  private readonly open: { frame: Front; u: number; v: number; y0: number; y1: number }[] = [];
  /** Paved ground: in a front's frame, from s0 every metre, how far out (o) the paving reaches. */
  private readonly paving: { frame: Front; s0: number; reach: number[] }[] = [];
  /** Glass that reflects the sky (gets the city reflections), and what glows at night. */
  private readonly shiny: THREE.MeshStandardMaterial[] = [];
  private readonly glow: { material: THREE.MeshStandardMaterial; colour: THREE.Color }[] = [];

  constructor(doors: Door[], origin: { lat: number; lng: number }, terrain: TerrainGrid, pitches: { ring: number[] }[] = []) {
    const gear = doors.find((door) => GEAR_NAME.test(door.name ?? ''));
    if (gear) {
      const plan = gearPlan(origin, terrain);
      if (isGear(gear, plan)) {
        this.gear(gear, plan, terrain, pitches);
        if (gear.name) this.boards.add(gear.name);
      }
    }
  }

  /** True where a building is open to the air (walk straight in, the outer walls don't hold you). */
  openAt(x: number, y: number, z: number): boolean {
    for (const area of this.open) {
      const { s, o } = area.frame.local(x, z);
      if (Math.abs(s) < area.u && o > -0.3 && o < area.v && y > area.y0 && y < area.y1) return true;
    }
    return false;
  }

  /** The sky and city that glass reflects (rebuilt as the sun moves). */
  setReflections(texture: THREE.Texture | null): void {
    for (const material of this.shiny) {
      if (!material.envMap !== !texture) material.needsUpdate = true;
      material.envMap = texture;
    }
  }

  /** 0 = day … 1 = night: lit rooms behind the glass. */
  setNight(night: number): void {
    for (const { material, colour } of this.glow) material.emissive.copy(colour).multiplyScalar(night);
  }

  private glass(options: THREE.MeshStandardMaterialParameters, night?: string): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0.55, envMapIntensity: 1.25, side: THREE.DoubleSide, ...options });
    this.shiny.push(material);
    if (night) this.glow.push({ material, colour: new THREE.Color(night) });
    return material;
  }

  /** True on a landmark's paving (no grass grows there). */
  paved(x: number, z: number): boolean {
    for (const area of this.paving) {
      const { s, o } = area.frame.local(x, z);
      const i = Math.round(s - area.s0);
      if (i >= 0 && i < area.reach.length && o > -0.5 && o < area.reach[i] + 0.3) return true;
    }
    return this.open.some((area) => {
      const { s, o } = area.frame.local(x, z);
      return Math.abs(s) < area.u && o > -0.3 && o < area.v;
    });
  }

  private mesh(parts: Parts, material: THREE.Material, shadows = true): void {
    const geometry = parts.geometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geometry, material);
  }

  private board(texture: THREE.CanvasTexture, width: number, at: number[], face: number): void {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8), material);
    board.position.set(at[0], at[1], at[2]);
    board.rotation.y = face;
    this.group.add(board);
    this.disposables.push(board.geometry, material);
  }

  private gear(door: Door, plan: GearPlan, terrain: TerrainGrid, pitches: { ring: number[] }[]): void {
    const { front, hall, base } = plan;
    const L = front.length;
    if (L < 20) return;
    const top = door.top;
    const floors = Math.max(1, landmarkFloors.get(door.id) ?? door.floors);
    const storey = (top - base) / floors;
    const groundAt = (f: Front, s: number, o: number): number => {
      const p = f.at(s, 0, o);
      return heightAt(terrain, p[0], p[2]);
    };
    const solid = new Parts();
    const glass = new Parts();
    const doorGlass = new Parts();
    const windows = new Parts();
    const towerGlass = new Parts();
    const white = rgb('#f4f2ec');
    const cream = rgb('#e8d8b0');
    const rail = rgb('#2b2d30');
    const terracotta = rgb('#93472b');
    const rim = rgb('#3d4248');
    const blueLow = rgb('#2a55a8');
    const blueHigh = rgb('#6d9be0');
    const darkGlass = rgb('#1d2a36');
    const stone = rgb('#c9c2b4');
    const blue = (t: number): Rgb => [blueLow[0] + (blueHigh[0] - blueLow[0]) * t, blueLow[1] + (blueHigh[1] - blueLow[1]) * t, blueLow[2] + (blueHigh[2] - blueLow[2]) * t];
    const texture = nameBoard(['GEAR Innovative Intl. School', 'Multiple Intelligences & Talents Development Gurukul']);
    this.disposables.push(texture);

    // ---------- The road front (north): pillars, veranda, the name band, the arch, entrance 1.
    const sA = L / 2 - GEAR_ARCH_FROM_CORNER;
    const towerW = 3.2;
    const towerS = L / 2 - 0.3 - towerW;
    let high = -Infinity;
    for (let s = -L / 2; s <= L / 2; s += 2) high = Math.max(high, groundAt(front, s, 1.5));
    const yD = groundAt(front, sA, 0.5);
    const bays = Math.max(3, Math.round((towerS + L / 2) / 4.2));
    for (let i = 0; i <= bays; i++) {
      const s = -L / 2 + 0.6 + ((towerS - 0.4 - (-L / 2 + 0.6)) * i) / bays;
      if (Math.abs(s - sA) < 2.6) continue; // keep entrance 1 clear
      const g = groundAt(front, s, 0.3);
      front.box(solid, s - 0.24, g - 0.4, 0, s + 0.24, top - 0.2, 0.55, white);
      front.solid(this.solids, s - 0.24, g - 0.4, 0, s + 0.24, top - 0.2, 0.55);
    }
    // A veranda on each floor line (the building's own) that stands clear of the ground.
    const verandas: number[] = [];
    for (let f = 1; f < floors; f++) {
      const y = base + f * storey;
      if (y < high + 2.4 || y > top - 1.5) continue;
      verandas.push(y);
      const s0 = -L / 2 + 0.4;
      const s1 = towerS - 0.2;
      front.box(solid, s0, y - 0.18, 0, s1, y, 0.95, cream);
      front.box(solid, s0, y + 0.85, 0.9, s1, y + 0.92, 0.95, rail);
      for (let s = s0 + 0.2; s < s1 - 0.1; s += 0.5) front.box(solid, s - 0.02, y, 0.91, s + 0.02, y + 0.85, 0.94, rail);
    }
    // Entrance 1: glass doors in a dark frame (they open as you walk up), a canopy on two posts
    // (level with the veranda when there is one at about that height).
    const half = 1.22;
    front.box(doorGlass, sA - half, yD - 0.2, 0.03, sA + half, yD + 2.62, 0.06, darkGlass);
    // A pair of glass doors: the meeting stiles, a transom bar and steel pull handles (all cut away
    // with the glass when the doorway opens).
    front.box(doorGlass, sA - 0.04, yD - 0.2, 0.06, sA + 0.04, yD + 2.62, 0.1, rim);
    front.box(doorGlass, sA - half, yD + 2.1, 0.06, sA + half, yD + 2.17, 0.1, rim);
    for (const ds of [-0.14, 0.14]) front.box(doorGlass, sA + ds - 0.015, yD + 0.85, 0.1, sA + ds + 0.015, yD + 1.6, 0.16, rgb('#c9ccd0'));
    front.box(solid, sA - half - 0.23, yD - 0.2, 0, sA - half - 0.03, yD + 2.9, 0.2, rim);
    front.box(solid, sA + half + 0.03, yD - 0.2, 0, sA + half + 0.23, yD + 2.9, 0.2, rim);
    front.box(solid, sA - half - 0.23, yD + 2.66, 0, sA + half + 0.23, yD + 2.9, 0.2, rim);
    const canopy = verandas.find((y) => y > yD + 2.95 && y < yD + 4.4) ?? yD + 3.45;
    front.box(solid, sA - 3.4, canopy - 0.2, 0, sA + 3.4, canopy, 3.3, white);
    for (const side of [-1, 1]) {
      const s = sA + side * 3.0;
      const g = groundAt(front, s, 3.0);
      front.box(solid, s - 0.08, g - 0.2, 2.92, s + 0.08, canopy - 0.2, 3.08, rim);
      front.solid(this.solids, s - 0.08, g - 0.2, 2.92, s + 0.08, canopy - 0.2, 3.08);
    }
    // Concrete planters with clipped shrubs either side of entrance 1 and along the front.
    const leaf = [rgb('#3f6b2f'), rgb('#4d7d36'), rgb('#36602a'), rgb('#5a8a3c')];
    let jitter = 11;
    const rand = (): number => {
      jitter = (jitter * 16807) % 2147483647;
      return jitter / 2147483647;
    };
    for (const ds of [-4.4, 4.4, -9.6, 9.6]) {
      const s = sA + ds;
      if (s < -L / 2 + 1.5 || s > towerS - 1) continue;
      const o = 1.9;
      const g = groundAt(front, s, o);
      front.box(solid, s - 0.65, g - 0.2, o - 0.65, s + 0.65, g + 0.6, o + 0.65, rgb('#a7a39b'));
      front.box(solid, s - 0.55, g + 0.6, o - 0.55, s + 0.55, g + 0.62, o + 0.55, rgb('#4a3a2c'));
      front.solid(this.solids, s - 0.65, g - 0.2, o - 0.65, s + 0.65, g + 0.6, o + 0.65);
      const rows = 6;
      const cols = 10;
      const bump = Array.from({ length: (rows + 1) * cols }, () => 0.85 + rand() * 0.3);
      const at = (i: number, k: number): number[] => {
        const lat = -0.2 + (i / rows) * (Math.PI / 2 + 0.2);
        const lon = (k / cols) * Math.PI * 2;
        const r = 0.62 * bump[i * cols + (k % cols)];
        return front.at(s + Math.cos(lat) * Math.cos(lon) * r, g + 0.75 + Math.sin(lat) * r * 0.95, o + Math.cos(lat) * Math.sin(lon) * r);
      };
      for (let i = 0; i < rows; i++) for (let k = 0; k < cols; k++) solid.quad(at(i, k), at(i, k + 1), at(i + 1, k + 1), at(i + 1, k), leaf[(i + k) % 4], leaf[(i + k + 1) % 4]);
    }
    // The terracotta band along the top with the name on it.
    const span = 26;
    const bandW = span + 2;
    front.box(solid, sA - bandW / 2, top - 0.3, -0.2, sA + bandW / 2, top + 1.6, 0.7, terracotta);
    this.board(texture, Math.min(bandW * 0.9, 24), front.at(sA, top + 0.65, 0.72), front.face);
    // The arch: a circular segment of blue glass above the band, in a thick dark rim, with
    // mullions, and a barrel vault of glass running back over the roof.
    const rise = span * 0.34;
    const archBase = top + 1.6;
    const radius = (span * span) / 4 / (2 * rise) + rise / 2;
    const cy = archBase + rise - radius;
    const arcY = (s: number): number => cy + Math.sqrt(Math.max(0, radius * radius - s * s));
    const steps = 48;
    const depth = Math.min(10, L * 0.35);
    const out = (s: number, y: number, k: number, o: number): number[] => {
      const l = Math.hypot(s, y - cy) || 1;
      return front.at(sA + s + (s / l) * k, y + ((y - cy) / l) * k, o);
    };
    for (let i = 0; i < steps; i++) {
      const s0 = -span / 2 + (span * i) / steps;
      const s1 = -span / 2 + (span * (i + 1)) / steps;
      const y0 = arcY(s0);
      const y1 = arcY(s1);
      const t0 = (y0 - archBase) / rise;
      const t1 = (y1 - archBase) / rise;
      glass.tri(front.at(sA + s0, archBase, 0.3), front.at(sA + s1, archBase, 0.3), front.at(sA + s1, y1, 0.3), blueLow, blueLow, blue(t1));
      glass.tri(front.at(sA + s0, archBase, 0.3), front.at(sA + s1, y1, 0.3), front.at(sA + s0, y0, 0.3), blueLow, blue(t1), blue(t0));
      glass.quad(front.at(sA + s0, y0, 0.3), front.at(sA + s1, y1, 0.3), front.at(sA + s1, y1, -depth), front.at(sA + s0, y0, -depth), blue(Math.max(t0, t1)));
      solid.quad(front.at(sA + s0, y0, 0.85), front.at(sA + s1, y1, 0.85), out(s1, y1, 0.9, 0.85), out(s0, y0, 0.9, 0.85), rim);
      solid.quad(out(s0, y0, 0.9, 0.85), out(s1, y1, 0.9, 0.85), out(s1, y1, 0.9, -depth - 0.25), out(s0, y0, 0.9, -depth - 0.25), rim);
    }
    for (let s = -span / 2 + 2.2; s < span / 2 - 0.5; s += 2.2) front.box(solid, sA + s - 0.06, archBase, 0.3, sA + s + 0.06, arcY(s), 0.42, rim);
    for (let y = archBase + 1.6; y < archBase + rise - 0.4; y += 1.6) {
      const w = Math.sqrt(Math.max(0, radius * radius - (y - cy) * (y - cy)));
      front.box(solid, sA - w, y - 0.05, 0.3, sA + w, y + 0.05, 0.42, rim);
    }
    // The glass stair tower at the road corner, standing out from the wall: tinted blue glass in
    // a grid of dark mullions, white floor bands, a flat white cap, and through the glass the
    // flights of stairs going up inside it.
    const g0 = groundAt(front, towerS + towerW / 2, 1.3) - 0.4;
    const tTop = top + 1.2;
    const tD = 2.6;
    const t0 = towerS;
    const t1 = towerS + towerW;
    towerGlass.quad(front.at(t0, g0, tD), front.at(t1, g0, tD), front.at(t1, tTop, tD), front.at(t0, tTop, tD), blueLow, blueHigh);
    for (const s of [t0, t1]) towerGlass.quad(front.at(s, g0, 0), front.at(s, g0, tD), front.at(s, tTop, tD), front.at(s, tTop, 0), blueLow, blueHigh);
    front.solid(this.solids, t0, g0, 0, t1, tTop, tD);
    for (let k = 0; k <= 3; k++) {
      const s = t0 + (towerW * k) / 3;
      front.box(solid, s - 0.05, g0, tD - 0.04, s + 0.05, tTop, tD + 0.05, rim);
    }
    for (const s of [t0, t1]) for (const o of [0.05, tD / 2, tD]) front.box(solid, s - 0.05, g0, o - 0.05, s + 0.05, tTop, o + 0.05, rim);
    front.box(solid, t0 - 0.1, tTop, -0.1, t1 + 0.1, tTop + 0.35, tD + 0.1, white);
    front.box(solid, t0 - 0.05, g0, -0.05, t1 + 0.05, groundAt(front, towerS + towerW / 2, tD) + 0.2, tD + 0.05, rim);
    const flight = (sA: number, yA: number, sB: number, yB: number, o0: number, o1: number): void => {
      const p = (sv: number, yv: number, o: number): number[] => front.at(sv, yv, o);
      for (const o of [o0, o1]) solid.quad(p(sA, yA - 0.22, o), p(sB, yB - 0.22, o), p(sB, yB, o), p(sA, yA, o), white);
      solid.quad(p(sA, yA, o0), p(sB, yB, o0), p(sB, yB, o1), p(sA, yA, o1), rgb('#d9d6cf'));
      solid.quad(p(sA, yA - 0.22, o0), p(sB, yB - 0.22, o0), p(sB, yB - 0.22, o1), p(sA, yA - 0.22, o1), white);
      // A steel handrail along the outer side.
      front.box(solid, Math.min(sA, sB), Math.min(yA, yB) + 0.9, o1 - 0.03, Math.max(sA, sB), Math.min(yA, yB) + 0.95, o1 + 0.02, rail);
    };
    for (let y = base + storey; y < top + 0.1; y += storey) {
      if (y < g0 + 0.3) continue;
      // The floor band outside, the floor and the half landing inside, and two flights between.
      front.box(solid, t0 - 0.04, y - 0.3, tD - 0.02, t1 + 0.04, y, tD + 0.06, white);
      for (const sv of [t0 - 0.06, t1 - 0.02]) front.box(solid, sv, y - 0.3, 0, sv + 0.08, y, tD, white);
      front.box(solid, t0, y - 0.2, 0.1, t0 + 0.9, y, tD - 0.1, rgb('#d9d6cf'));
      const mid = y - storey / 2;
      if (mid > g0 + 0.3) {
        front.box(solid, t1 - 0.8, mid - 0.2, 0.1, t1, mid, tD - 0.1, rgb('#d9d6cf'));
        flight(t0 + 0.9, y - storey, t1 - 0.8, mid, 0.15, tD / 2 - 0.05);
        flight(t1 - 0.8, mid, t0 + 0.9, y, tD / 2 + 0.05, tD - 0.15);
      }
    }


    // ---------- The forecourt: paved from the front out to the courts (the way in to entrance 1).
    const paving = new Parts();
    const inPitch = (s: number, o: number): boolean => {
      const p = front.at(s, 0, o);
      return pitches.some((pitch) => pointInRing(p[0], p[2], pitch.ring));
    };
    const reach: number[] = [];
    const sFrom = -L / 2 - 0.5;
    const sTo = L / 2 + 2;
    for (let s = sFrom; s <= sTo + 0.01; s += 1) {
      // Right up to a court ahead (all of the open ground in front of the courts is the way in);
      // elsewhere a 14 m strip.
      let o = 0.6;
      while (o < 40 && !inPitch(s, o + 0.5)) o += 0.5;
      reach.push(o < 40 ? Math.max(2, o) : 14);
    }
    this.paving.push({ frame: front, s0: sFrom, reach });
    const plain = rgb('#ffffff');
    const vertex = (s: number, o: number): number[] => {
      const p = front.at(s, 0, o);
      return [p[0], heightAt(terrain, p[0], p[2]) + 0.05, p[2]];
    };
    const rows = 24;
    for (let i = 0; i < reach.length - 1; i++) {
      const sa = sFrom + i;
      const sb = sa + 1;
      for (let k = 0; k < rows; k++) {
        const oa0 = 0.35 + ((reach[i] - 0.35) * k) / rows;
        const oa1 = 0.35 + ((reach[i] - 0.35) * (k + 1)) / rows;
        const ob0 = 0.35 + ((reach[i + 1] - 0.35) * k) / rows;
        const ob1 = 0.35 + ((reach[i + 1] - 0.35) * (k + 1)) / rows;
        paving.quad(vertex(sa, oa0), vertex(sb, ob0), vertex(sb, ob1), vertex(sa, oa1), plain);
        // The two triangles a0 b0 b1 and a0 b1 a1; the pattern follows the front (2.5 m a repeat).
        const k2 = 1 / 2.5;
        paving.uv.push(sa * k2, oa0 * k2, sb * k2, ob0 * k2, sb * k2, ob1 * k2, sa * k2, oa0 * k2, sb * k2, ob1 * k2, sa * k2, oa1 * k2);
      }
    }
    const pavers = paverTexture();
    const pavingMaterial = new THREE.MeshLambertMaterial({ map: pavers, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.disposables.push(pavers);
    this.mesh(paving, pavingMaterial, false);

    // ---------- Entrance 2: the open hall facing Kumari, stairs up under a big blue dome.
    const U = plan.hallU;
    const V = plan.hallV;
    if (U > 2.5 && V > 4) {
      let gMin = Infinity;
      let gMax = -Infinity;
      for (const [s, o] of [
        [-U, 0],
        [U, 0],
        [-U, V],
        [U, V],
        [0, V / 2],
      ]) {
        const g = groundAt(hall, s, o);
        gMin = Math.min(gMin, g);
        gMax = Math.max(gMax, g);
      }
      const yF = gMax + 0.12; // the hall's stone floor
      // The landing: the first of the building's floor lines a storey up.
      let yL = base;
      while (yL < yF + 2.9) yL += storey;
      if (yL > top - 1.6) yL = yF + Math.min(3.4, (top - yF) / 2);
      // Two storeys high (the dome sits on its roof); above it the building's wall goes on up.
      let hallTop = yL + storey;
      if (top - hallTop < 1.5) hallTop = top;
      const beam = hallTop - 1.0;
      // The floor (a stone plinth), the back wall with its doors, the landing.
      hall.box(solid, -U - 0.3, gMin - 0.6, -0.1, U + 0.3, yF, V + 0.3, stone);
      hall.solid(this.solids, -U - 0.3, gMin - 0.6, -0.1, U + 0.3, yF, V + 0.3);
      hall.box(solid, -U - 0.3, yF - 0.5, -0.4, U + 0.3, top + 0.25, 0, cream);
      hall.solid(this.solids, -U - 1.3, yF - 1, -0.6, U + 1.3, top + 1, 0);
      // Above the hall the wall has a row of windows on each floor, like the rest of the block.
      for (let y = base + storey; y < top - 1.2; y += storey) {
        if (y < hallTop + 0.2) continue;
        hall.box(solid, -U - 0.3, y - 0.14, 0, U + 0.3, y + 0.04, 0.14, white);
        for (const sv of [-U + 1.55, 0, U - 1.55]) {
          hall.box(solid, sv - 0.82, y + 0.78, 0, sv + 0.82, y + 2.32, 0.06, white);
          hall.box(windows, sv - 0.74, y + 0.86, 0.06, sv + 0.74, y + 2.24, 0.08, darkGlass);
          hall.box(solid, sv - 0.025, y + 0.86, 0.06, sv + 0.025, y + 2.24, 0.11, white);
          hall.box(solid, sv - 0.74, y + 1.7, 0.06, sv + 0.74, y + 1.75, 0.11, white);
          hall.box(solid, sv - 0.95, y + 0.7, 0, sv + 0.95, y + 0.8, 0.22, white);
          hall.box(solid, sv - 0.95, y + 2.32, 0, sv + 0.95, y + 2.42, 0.4, white);
        }
      }
      const oTop = 2.6;
      hall.box(solid, -U, yL - 0.3, 0, U, yL, oTop, white);
      // Doors (they don't open: the way in is entrance 1): two at the ground beside the stairs,
      // a big one at the landing.
      for (const side of [-1, 1]) {
        const s = side * (U - 1.15);
        hall.box(solid, s - 0.8, yF, 0, s + 0.8, yF + 2.5, 0.08, rim);
        hall.box(windows, s - 0.7, yF, 0.08, s + 0.7, yF + 2.4, 0.1, darkGlass);
        hall.box(solid, s - 0.04, yF, 0.08, s + 0.04, yF + 2.4, 0.13, rim);
        for (const h of [-0.12, 0.12]) hall.box(solid, s + h - 0.015, yF + 0.8, 0.13, s + h + 0.015, yF + 1.4, 0.18, rgb('#c9ccd0'));
      }
      hall.box(solid, -1.8, yL, 0, 1.8, yL + 2.6, 0.08, rim);
      hall.box(windows, -1.7, yL, 0.08, 1.7, yL + 2.5, 0.1, darkGlass);
      // Its frame: a transom, the meeting stiles of two pairs of doors, and steel pull handles.
      hall.box(solid, -1.7, yL + 2.0, 0.08, 1.7, yL + 2.08, 0.13, rim);
      for (const s of [-0.85, 0, 0.85]) hall.box(solid, s - 0.04, yL, 0.08, s + 0.04, yL + 2.5, 0.13, rim);
      for (const s of [-0.98, -0.72, 0.72, 0.98, -0.12, 0.12]) hall.box(solid, s - 0.015, yL + 0.8, 0.13, s + 0.015, yL + 1.5, 0.18, rgb('#c9ccd0'));
      // The stairs, from the front of the hall up to the landing, between low white side walls.
      const oFoot = V + 0.3;
      const rise = yL - yF;
      const runAll = oFoot - oTop;
      const n = Math.max(8, Math.round(rise / 0.165));
      const riser = rise / n;
      const tread = runAll / n;
      const sw = 2.4;
      for (let i = 0; i < n; i++) {
        const shade = i % 2 ? rgb('#8f8b85') : rgb('#9b978f');
        hall.box(solid, -sw, yF, oFoot - (i + 1) * tread, sw, yF + (i + 1) * riser, oFoot - i * tread, shade);
      }
      // Underfoot one smooth slope through the step noses, then the landing.
      const oB = oTop + tread;
      {
        const yA = yF + riser;
        const run = oFoot - oB;
        const up = yL - yA;
        const slope = Math.atan2(up, run);
        const c = hall.at(0, (yA + yL) / 2 - 0.15 / Math.cos(slope), (oFoot + oB) / 2);
        this.solids.push({ x: c[0], y: c[1], z: c[2], hx: sw, hy: 0.15, hz: Math.hypot(run, up) / 2, rotation: hall.face + Math.PI, pitch: slope });
        hall.solid(this.solids, -U, yL - 0.3, 0, U, yL, oB);
      }
      const wallH = 1.0;
      const lineY = (o: number): number => Math.min(yL, yF + riser + ((oFoot - o) / (oFoot - oB)) * (yL - yF - riser));
      for (const side of [-1, 1]) {
        const s0 = side * sw;
        const s1 = side * (sw + 0.22);
        const at = (s: number, o: number, y: number): number[] => hall.at(s, y, o);
        for (const s of [s0, s1]) solid.quad(at(s, oFoot, yF), at(s, oTop, yF), at(s, oTop, yL + wallH), at(s, oFoot, lineY(oFoot) + wallH), white);
        solid.quad(at(s0, oFoot, lineY(oFoot) + wallH), at(s1, oFoot, lineY(oFoot) + wallH), at(s1, oTop, yL + wallH), at(s0, oTop, yL + wallH), white);
        solid.quad(at(s0, oFoot, yF), at(s1, oFoot, yF), at(s1, oFoot, lineY(oFoot) + wallH), at(s0, oFoot, lineY(oFoot) + wallH), white);
        // Solid in four pieces down the slope (no walking through it from the side).
        for (let k = 0; k < 4; k++) {
          const oa = oTop + ((oFoot - oTop) * k) / 4;
          const ob = oTop + ((oFoot - oTop) * (k + 1)) / 4;
          hall.solid(this.solids, Math.min(s0, s1), yF, oa, Math.max(s0, s1), lineY(oa) + wallH, ob);
        }
        // The landing's railing either side of the stairs, and along its open ends.
        const sIn = side * (sw + 0.22);
        const sOut = side * U;
        const lo = Math.min(sIn, sOut);
        const hi = Math.max(sIn, sOut);
        hall.box(solid, lo, yL + 0.95, oTop - 0.06, hi, yL + 1.02, oTop, rail);
        for (let s = lo + 0.15; s < hi; s += 0.45) hall.box(solid, s - 0.02, yL, oTop - 0.05, s + 0.02, yL + 0.95, oTop - 0.01, rail);
        hall.solid(this.solids, lo, yL, oTop - 0.08, hi, yL + 1.05, oTop);
        hall.box(solid, Math.min(sOut, sOut - side * 0.06), yL + 0.95, 0, Math.max(sOut, sOut - side * 0.06), yL + 1.02, oTop, rail);
        for (let o = 0.2; o < oTop; o += 0.45) hall.box(solid, Math.min(sOut - side * 0.05, sOut - side * 0.01), yL, o - 0.02, Math.max(sOut - side * 0.05, sOut - side * 0.01), yL + 0.95, o + 0.02, rail);
        hall.solid(this.solids, Math.min(sOut, sOut - side * 0.08), yL, 0, Math.max(sOut, sOut - side * 0.08), yL + 1.05, oTop);
      }
      // Six white columns and the beam round the top; on the front, a terracotta panel with the name.
      for (const side of [-1, 1]) {
        for (const o of [0.45, V / 2, V - 0.35]) {
          const s = side * (U - 0.35);
          hall.box(solid, s - 0.38, yF, o - 0.38, s + 0.38, yF + 0.3, o + 0.38, white);
          hall.column(solid, s, o, 0.28, yF, beam, white);
          hall.solid(this.solids, s - 0.3, yF, o - 0.3, s + 0.3, beam, o + 0.3);
        }
      }
      hall.box(solid, -U - 0.1, beam, V - 0.45, U + 0.1, hallTop + 0.25, V + 0.05, white);
      hall.box(solid, U - 0.45, beam, 0, U + 0.05, hallTop + 0.25, V, white);
      hall.box(solid, -U - 0.05, beam, 0, -U + 0.45, hallTop + 0.25, V, white);
      hall.box(solid, -U + 0.3, beam + 0.08, V + 0.05, U - 0.3, hallTop + 0.17, V + 0.15, terracotta);
      this.board(texture, Math.min(2 * U - 0.8, 8.4), hall.at(0, (beam + hallTop + 0.25) / 2, V + 0.17), hall.face);
      // A low white parapet round the hall's roof.
      hall.box(solid, -U - 0.1, hallTop + 0.25, V - 0.25, U + 0.1, hallTop + 0.95, V + 0.05, white);
      hall.box(solid, U - 0.25, hallTop + 0.25, 0, U + 0.05, hallTop + 0.95, V, white);
      hall.box(solid, -U - 0.05, hallTop + 0.25, 0, -U + 0.25, hallTop + 0.95, V, white);
      // The roof of the hall: a slab with a round opening, the dome on a glass drum above it.
      const R = Math.min(U, V / 2) - 0.15;
      const oc = V / 2;
      const deckTop = hallTop + 0.25;
      const deckBottom = hallTop - 0.15;
      const corners = [Math.atan2(oc, U), Math.atan2(oc, -U), Math.atan2(-oc, -U), Math.atan2(-oc, U)].map((a) => (a + Math.PI * 2) % (Math.PI * 2));
      const angles = [...Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2), ...corners].sort((a, b) => a - b);
      angles.push(angles[0] + Math.PI * 2);
      const edge = (a: number): [number, number] => {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const t = Math.min(Math.abs(c) > 1e-6 ? U / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? oc / Math.abs(s) : Infinity);
        return [t * c, oc + t * s];
      };
      for (let i = 0; i < angles.length - 1; i++) {
        const a0 = angles[i];
        const a1 = angles[i + 1];
        const [e0s, e0o] = edge(a0);
        const [e1s, e1o] = edge(a1);
        for (const y of [deckTop, deckBottom]) {
          solid.quad(hall.at(R * Math.cos(a0), y, oc + R * Math.sin(a0)), hall.at(R * Math.cos(a1), y, oc + R * Math.sin(a1)), hall.at(e1s, y, e1o), hall.at(e0s, y, e0o), white);
        }
        solid.quad(hall.at(R * Math.cos(a0), deckBottom, oc + R * Math.sin(a0)), hall.at(R * Math.cos(a1), deckBottom, oc + R * Math.sin(a1)), hall.at(R * Math.cos(a1), deckTop, oc + R * Math.sin(a1)), hall.at(R * Math.cos(a0), deckTop, oc + R * Math.sin(a0)), white);
      }
      const drumTop = deckTop + 1.1;
      const domeRise = R * 1.08;
      const sides = 40;
      const lats = 12;
      const ring = (a: number, r: number, y: number): number[] => hall.at(r * Math.cos(a), y, oc + r * Math.sin(a));
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2;
        const a1 = ((i + 1) / sides) * Math.PI * 2;
        glass.quad(ring(a0, R, deckTop), ring(a1, R, deckTop), ring(a1, R, drumTop), ring(a0, R, drumTop), blueLow);
        for (let j = 0; j < lats; j++) {
          const p0 = (j / lats) * (Math.PI / 2);
          const p1 = ((j + 1) / lats) * (Math.PI / 2);
          const y0 = drumTop + domeRise * Math.sin(p0);
          const y1 = drumTop + domeRise * Math.sin(p1);
          glass.quad(ring(a0, R * Math.cos(p0), y0), ring(a1, R * Math.cos(p0), y0), ring(a1, R * Math.cos(p1), y1), ring(a0, R * Math.cos(p1), y1), blue(j / lats), blue((j + 1) / lats));
        }
      }
      // Ribs, three rings and a crown on the dome; mullions round the drum.
      const ribs = 12;
      for (let k = 0; k < ribs; k++) {
        const a = (k / ribs) * Math.PI * 2;
        for (let j = 0; j < lats; j++) {
          const p0 = (j / lats) * (Math.PI / 2);
          const p1 = ((j + 1) / lats) * (Math.PI / 2);
          const r0 = R * Math.cos(p0) + 0.04;
          const r1 = R * Math.cos(p1) + 0.04;
          const y0 = drumTop + domeRise * Math.sin(p0) + 0.02;
          const y1 = drumTop + domeRise * Math.sin(p1) + 0.02;
          const w0 = 0.07 / Math.max(0.3, r0);
          const w1 = 0.07 / Math.max(0.3, r1);
          solid.quad(ring(a - w0, r0, y0), ring(a + w0, r0, y0), ring(a + w1, r1, y1), ring(a - w1, r1, y1), rim);
        }
        solid.quad(ring(a - 0.02, R + 0.03, deckTop), ring(a + 0.02, R + 0.03, deckTop), ring(a + 0.02, R + 0.03, drumTop), ring(a - 0.02, R + 0.03, drumTop), rim);
      }
      for (const p of [0, Math.PI / 6, Math.PI / 3]) {
        const r = R * Math.cos(p) + 0.05;
        const y = drumTop + domeRise * Math.sin(p);
        for (let i = 0; i < sides; i++) {
          const a0 = (i / sides) * Math.PI * 2;
          const a1 = ((i + 1) / sides) * Math.PI * 2;
          solid.quad(ring(a0, r, y - 0.06), ring(a1, r, y - 0.06), ring(a1, r, y + 0.06), ring(a0, r, y + 0.06), rim);
        }
      }
      const crown = drumTop + domeRise;
      hall.column(solid, 0, oc, 0.22, crown - 0.1, crown + 0.35, rim);
      hall.column(solid, 0, oc, 0.05, crown + 0.35, crown + 1.4, rim);

      // The building's own walls and roof there are cut away (it's open to the air), and its
      // outer walls let you walk in; the hall's own solids hold you.
      const o0 = 0.12;
      const o1 = V + 0.6;
      const yBottom = base - 1.5;
      const yTopCut = top + 3;
      const centre = hall.at(0, (yBottom + yTopCut) / 2, (o0 + o1) / 2);
      setOpenCut(centre[0], centre[1], centre[2], hall.face, U + 0.35, (yTopCut - yBottom) / 2, (o1 - o0) / 2);
      this.open.push({ frame: hall, u: U + 0.9, v: V + 1.0, y0: yF - 2, y1: top + 2 });
    }

    this.mesh(solid, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    // Blue glass: a mirror tinted by its colour, reflecting the sky; lit from inside at night.
    this.mesh(glass, this.glass({ vertexColors: true }, '#1c3f8c'));
    // Windows and doors: dark glass, warm lit rooms at night.
    this.mesh(windows, this.glass({ vertexColors: true, metalness: 0.3 }, '#5a4630'), false);
    const doorMaterial = this.glass({ vertexColors: true, metalness: 0.3 }, '#5a4630');
    withDoorHole(doorMaterial);
    this.mesh(doorGlass, doorMaterial, false);
    // The stair tower's glass you can see the stairs through.
    const towerMaterial = this.glass({ vertexColors: true, metalness: 0.25, transparent: true, opacity: 0.5, depthWrite: false }, '#20324f');
    const tower = new THREE.Mesh(towerGlass.geometry(), towerMaterial);
    tower.renderOrder = 2;
    this.group.add(tower);
    this.disposables.push(tower.geometry, towerMaterial);
  }

  dispose(): void {
    if (this.open.length) setOpenCut(0, -1e6, 0, 0, 0, 0, 0);
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
