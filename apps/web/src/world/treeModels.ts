import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Leafy trees, made in code (no downloaded assets). A canopy is a dark inner blob plus a few
 * dozen "leaf cards": flat squares showing a cluster of leaves (a picture painted on a canvas
 * here), with see-through gaps. Card normals point out of the canopy, so the whole crown
 * shades like one soft round shape. Species are the ones you see in Bengaluru.
 */

/** Atlas cells (4 across): 0 leaf cluster · 1 palm frond · 2 solid (trunks, inner blob) · 3 grass tuft. */
const CELLS = 4;
const SOLID_UV: [number, number] = [2.5 / CELLS, 0.5];

let atlas: THREE.CanvasTexture | null = null;

/** Paints the leaf atlas once: light leaves on a transparent background; colour comes from the mesh. */
export function leafAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S * CELLS;
  canvas.height = S;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  let seed = 12345;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const leaf = (x: number, y: number, length: number, width: number, angle: number, light: number): void => {
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    // A darker under-leaf first (depth), then the leaf, then its midrib.
    c.fillStyle = `rgb(${light * 0.55}, ${light * 0.6}, ${light * 0.5})`;
    c.beginPath();
    c.ellipse(1.5, 2, length, width, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = `rgb(${light * 0.93}, ${light}, ${light * 0.86})`;
    c.beginPath();
    c.ellipse(0, 0, length, width, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = `rgba(${light * 0.7}, ${light * 0.75}, ${light * 0.6}, 0.9)`;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-length, 0);
    c.lineTo(length, 0);
    c.stroke();
    c.restore();
  };
  // Cell 0: a round cluster, dense in the middle, ragged at the edge.
  for (let i = 0; i < 150; i++) {
    const r = Math.sqrt(random()) * S * 0.46;
    const a = random() * Math.PI * 2;
    leaf(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 15 + random() * 10, 6 + random() * 4, random() * Math.PI, 175 + random() * 80);
  }
  // Cell 1: a palm frond lying along x: a rib with long leaflets either side.
  c.strokeStyle = 'rgb(190, 200, 150)';
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(S + 6, S / 2);
  c.lineTo(S * 2 - 6, S / 2);
  c.stroke();
  for (let i = 0; i < 34; i++) {
    const x = S + 12 + (i / 34) * (S - 30);
    const reach = (0.45 - Math.abs(i / 34 - 0.4) * 0.35) * S;
    for (const side of [-1, 1]) {
      const light = 190 + random() * 60;
      c.fillStyle = `rgb(${light * 0.9}, ${light}, ${light * 0.8})`;
      c.beginPath();
      c.moveTo(x, S / 2);
      c.lineTo(x + 22, S / 2 + side * reach);
      c.lineTo(x + 9, S / 2 + side * 3);
      c.closePath();
      c.fill();
    }
  }
  // Cell 2: solid.
  c.fillStyle = '#ffffff';
  c.fillRect(S * 2, 0, S, S);
  // Cell 3: a tuft of grass blades growing up from the bottom edge.
  for (let i = 0; i < 46; i++) {
    const x = S * 3 + 20 + random() * (S - 40);
    const tip = x + (random() - 0.5) * 70;
    const height = S * (0.45 + random() * 0.5);
    const light = 170 + random() * 85;
    c.fillStyle = `rgb(${light * 0.92}, ${light}, ${light * 0.8})`;
    c.beginPath();
    c.moveTo(x - 5, S);
    c.lineTo(tip, S - height);
    c.lineTo(x + 5, S);
    c.closePath();
    c.fill();
  }

  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

interface Builder {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
}

const rgb = (hex: number): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

function vertex(b: Builder, p: THREE.Vector3, n: THREE.Vector3, color: [number, number, number], u: number, v: number): void {
  b.positions.push(p.x, p.y, p.z);
  b.normals.push(n.x, n.y, n.z);
  b.colors.push(color[0], color[1], color[2]);
  b.uvs.push(u, v);
}

function finish(b: Builder): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  return geometry;
}

/** A solid part (trunk, inner blob) from any three.js geometry, with smooth or kept normals. */
function solid(geometry: THREE.BufferGeometry, hex: number, shadeFrom = -1e9, shadeTo = 1e9): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = flat.getAttribute('position').count;
  const base = rgb(hex);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const y = flat.getAttribute('position').getY(i);
    const k = shadeTo > shadeFrom ? 0.7 + 0.4 * Math.min(1, Math.max(0, (y - shadeFrom) / (shadeTo - shadeFrom))) : 1;
    colors.set([base[0] * k, base[1] * k, base[2] * k], i * 3);
    uvs.set(SOLID_UV, i * 2);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return flat;
}

interface Canopy {
  /** Centre and radii of the crown. */
  y: number;
  rx: number;
  ry: number;
  cards: number;
  cardSize: number;
  leaf: number;
  /** Colour and share of flowering cards (0 = none). */
  flower?: number;
  flowerShare?: number;
  /** Cards hang down (ashoka) instead of standing out. */
  droop?: number;
}

/** The crown: an inner blob (hides the far side) and leaf cards all over it. */
function canopy(spec: Canopy, seed: number): THREE.BufferGeometry {
  let s = seed;
  const random = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const b: Builder = { positions: [], normals: [], colors: [], uvs: [] };
  const centre = new THREE.Vector3(0, spec.y, 0);
  const leaf = rgb(spec.leaf);
  const flower = spec.flower === undefined ? leaf : rgb(spec.flower);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spec.cards; i++) {
    // Evenly spread directions (golden-angle spiral), skipping the underside.
    const t = (i + 0.5) / spec.cards;
    const yDir = 1 - t * 1.45;
    const ring = Math.sqrt(Math.max(0, 1 - yDir * yDir));
    const angle = i * 2.39996 + random() * 0.5;
    const d = new THREE.Vector3(Math.cos(angle) * ring, yDir, Math.sin(angle) * ring).normalize();
    const at = centre.clone().add(new THREE.Vector3(d.x * spec.rx, d.y * spec.ry, d.z * spec.rx).multiplyScalar(0.78 + random() * 0.14));
    // The card faces out of the crown, tilted a little, turned at random about its own axis.
    const facing = d.clone().add(new THREE.Vector3(random() - 0.5, random() - 0.5 - (spec.droop ?? 0), random() - 0.5).multiplyScalar(0.7)).normalize();
    const right = new THREE.Vector3().crossVectors(Math.abs(facing.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up, facing).normalize();
    const upward = new THREE.Vector3().crossVectors(facing, right).normalize();
    const roll = random() * Math.PI * 2;
    const ax = right.clone().multiplyScalar(Math.cos(roll)).add(upward.clone().multiplyScalar(Math.sin(roll)));
    const ay = upward.clone().multiplyScalar(Math.cos(roll)).sub(right.clone().multiplyScalar(Math.sin(roll)));
    const half = (spec.cardSize * (0.8 + random() * 0.45)) / 2;
    // One soft normal for the whole card: out of the crown and a little up.
    const normal = d.clone().add(new THREE.Vector3(0, 0.45, 0)).normalize();
    const isFlower = random() < (spec.flowerShare ?? 0) && d.y > -0.2;
    const light = (0.62 + 0.38 * (d.y * 0.5 + 0.5)) * (0.88 + random() * 0.24); // darker underneath
    const base = isFlower ? flower : leaf;
    const color: [number, number, number] = [base[0] * light, base[1] * light, base[2] * light];
    const corner = (sx: number, sy: number): THREE.Vector3 => at.clone().add(ax.clone().multiplyScalar(sx * half)).add(ay.clone().multiplyScalar(sy * half));
    const u0 = 0.004;
    const u1 = 1 / CELLS - 0.004;
    const quad: [number, number, number, number][] = [
      [-1, -1, u0, 0],
      [1, -1, u1, 0],
      [1, 1, u1, 1],
      [-1, -1, u0, 0],
      [1, 1, u1, 1],
      [-1, 1, u0, 1],
    ];
    for (const [sx, sy, u, v] of quad) vertex(b, corner(sx, sy), normal, color, u, v);
  }
  const blob = new THREE.IcosahedronGeometry(1, 1).scale(spec.rx * 0.7, spec.ry * 0.72, spec.rx * 0.7).translate(0, spec.y, 0);
  const inner = solid(blob, spec.leaf, spec.y - spec.ry, spec.y + spec.ry);
  // Smooth round shading for the blob, a touch darker than the leaves around it.
  const p = inner.getAttribute('position');
  const n = inner.getAttribute('normal');
  const col = inner.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i) / spec.rx, (p.getY(i) - spec.y) / spec.ry, p.getZ(i) / spec.rx).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    col.setXYZ(i, col.getX(i) * 0.62, col.getY(i) * 0.62, col.getZ(i) * 0.62);
  }
  return mergeGeometries([finish(b), inner]);
}

const BARK = 0x6a5240;

function trunk(height: number, bottom: number, top: number, sides = 6): THREE.BufferGeometry {
  return solid(new THREE.CylinderGeometry(top, bottom, height, sides, 1, true).translate(0, height / 2, 0), BARK, 0, height * 1.6);
}

/** A branch from (x0, y0) leaning out to (x1, y1) in direction `angle`. */
function branch(y0: number, y1: number, reach: number, angle: number, radius: number): THREE.BufferGeometry {
  const length = Math.hypot(reach, y1 - y0);
  const g = new THREE.CylinderGeometry(radius * 0.6, radius, length, 5, 1, true).translate(0, length / 2, 0);
  g.rotateZ(-Math.atan2(reach, y1 - y0));
  g.rotateY(angle);
  g.translate(0, y0, 0);
  return solid(g, BARK, 0, y1 * 1.5);
}

function leafy(trunkHeight: number, trunkRadius: number, spec: Canopy, seed: number, branches = 3): THREE.BufferGeometry {
  const parts = [trunk(trunkHeight, trunkRadius * 1.25, trunkRadius * 0.75), canopy(spec, seed)];
  for (let i = 0; i < branches; i++) parts.push(branch(trunkHeight * 0.72, spec.y - spec.ry * 0.2, spec.rx * 0.5, (i / branches) * Math.PI * 2 + seed, trunkRadius * 0.55));
  return mergeGeometries(parts);
}

/** Coconut palm: a slim curved trunk and a crown of arching fronds. */
function palm(cardsPerFrond: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const height = 8.5;
  const lean = (y: number): number => 0.9 * (y / height) ** 2; // curve of the trunk
  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const y0 = (i / segments) * height;
    const y1 = ((i + 1) / segments) * height;
    const g = new THREE.CylinderGeometry(0.15, 0.18 + (i === 0 ? 0.08 : 0), y1 - y0, 5, 1, true);
    g.translate(0, (y1 - y0) / 2, 0);
    g.rotateZ(-Math.atan2(lean(y1) - lean(y0), y1 - y0));
    g.translate(lean(y0), y0, 0);
    parts.push(solid(g, 0x8a7a66, 0, height));
  }
  const top = new THREE.Vector3(lean(height), height, 0);
  const b: Builder = { positions: [], normals: [], colors: [], uvs: [] };
  const fronds = 11;
  const leaf = rgb(0x5f9440);
  for (let f = 0; f < fronds; f++) {
    const angle = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const lift = f % 3 === 0 ? 0.9 : 0.35; // some fronds stand up, most arch over
    const length = 3.6;
    // The frond as a bent strip: out and up, then drooping.
    const point = (t: number): THREE.Vector3 => top.clone().add(dir.clone().multiplyScalar(t * length)).add(new THREE.Vector3(0, lift * t * 2.2 - t * t * (1.6 + lift), 0));
    for (let k = 0; k < cardsPerFrond; k++) {
      const t0 = k / cardsPerFrond;
      const t1 = (k + 1) / cardsPerFrond;
      const p0 = point(t0);
      const p1 = point(t1);
      const width = 0.75;
      const normal = new THREE.Vector3(0, 1, 0).add(dir.clone().multiplyScalar(0.3)).normalize();
      const shade = 0.75 + 0.3 * (1 - t0);
      const color: [number, number, number] = [leaf[0] * shade, leaf[1] * shade, leaf[2] * shade];
      const u = (t: number): number => 1 / CELLS + 0.01 + t * (1 / CELLS - 0.02);
      const a = p0.clone().add(side.clone().multiplyScalar(-width));
      const bb = p0.clone().add(side.clone().multiplyScalar(width));
      const cc = p1.clone().add(side.clone().multiplyScalar(width));
      const dd = p1.clone().add(side.clone().multiplyScalar(-width));
      vertex(b, a, normal, color, u(t0), 0);
      vertex(b, bb, normal, color, u(t0), 1);
      vertex(b, cc, normal, color, u(t1), 1);
      vertex(b, a, normal, color, u(t0), 0);
      vertex(b, cc, normal, color, u(t1), 1);
      vertex(b, dd, normal, color, u(t1), 0);
    }
  }
  parts.push(finish(b));
  // Coconuts under the crown.
  parts.push(solid(new THREE.IcosahedronGeometry(0.28, 0).translate(top.x, top.y - 0.25, top.z), 0x6b6a2e));
  return mergeGeometries(parts);
}

/** Index in the returned list = species. See SPECIES_OF_VARIANT. */
export const TREE_SPECIES = ['rain tree', 'ashoka', 'bush', 'neem', 'gulmohar', 'tabebuia', 'coconut palm', 'bougainvillea'] as const;

/**
 * `detail` 1 = Medium (fewer cards), 2 = High. About 90–150 triangles per tree on High.
 */
export function createLeafyTrees(detail: 1 | 2): THREE.BufferGeometry[] {
  const k = detail === 2 ? 1 : 0.6;
  const n = (cards: number): number => Math.round(cards * k);
  return [
    // Rain tree: the wide umbrella over Bengaluru's old avenues.
    leafy(4.4, 0.34, { y: 6.6, rx: 4.3, ry: 2.0, cards: n(40), cardSize: 2.9, leaf: 0x4f8f3a }, 11),
    // Ashoka: tall and narrow, leaves hanging down.
    leafy(2.2, 0.16, { y: 5.6, rx: 1.15, ry: 3.6, cards: n(30), cardSize: 1.9, leaf: 0x3f7d3a, droop: 0.7 }, 23, 0),
    // Bush / hedge.
    mergeGeometries([canopy({ y: 0.75, rx: 1.15, ry: 0.85, cards: n(16), cardSize: 1.25, leaf: 0x5b9442 }, 31)]),
    // Neem / mango: dense and round.
    leafy(3.2, 0.28, { y: 5.4, rx: 2.9, ry: 2.4, cards: n(36), cardSize: 2.5, leaf: 0x3d7a34 }, 47),
    // Gulmohar: flat crown, orange-red flowers.
    leafy(3.6, 0.26, { y: 5.6, rx: 3.6, ry: 1.6, cards: n(36), cardSize: 2.5, leaf: 0x5a983e, flower: 0xe2552b, flowerShare: 0.5 }, 59),
    // Tabebuia rosea: Bengaluru's pink spring trees.
    leafy(3.4, 0.22, { y: 5.6, rx: 2.5, ry: 2.3, cards: n(32), cardSize: 2.2, leaf: 0x6aa04a, flower: 0xf09ac0, flowerShare: 0.7 }, 67),
    palm(detail === 2 ? 3 : 2),
    // Bougainvillea: a magenta bush over compound walls.
    mergeGeometries([canopy({ y: 0.95, rx: 1.4, ry: 1.0, cards: n(18), cardSize: 1.35, leaf: 0x4f8a3c, flower: 0xd6338a, flowerShare: 0.6 }, 79)]),
  ];
}

/** Which species a tree becomes: the map's variant (0 round · 1 tall · 2 bush) and its own random number. */
export function speciesOf(variant: number, chance: number): number {
  const r = (chance * 7.31) % 1;
  if (variant === 2) return r < 0.75 ? 2 : 7;
  if (variant === 1) return r < 0.55 ? 1 : 6;
  if (r < 0.36) return 0;
  if (r < 0.62) return 3;
  if (r < 0.74) return 4;
  if (r < 0.83) return 5;
  if (r < 0.93) return 6;
  return 0;
}

/** One grass tuft: two crossed upright cards (4 triangles), drawn hundreds of times around the player. */
export function createGrassTuft(): THREE.BufferGeometry {
  const b: Builder = { positions: [], normals: [], colors: [], uvs: [] };
  const up = new THREE.Vector3(0, 1, 0);
  const u0 = 3 / CELLS + 0.01;
  const u1 = 1 - 0.01;
  for (const angle of [0.3, 0.3 + Math.PI / 2]) {
    const dx = Math.cos(angle) * 0.42;
    const dz = Math.sin(angle) * 0.42;
    const corners: [number, number, number, number, number][] = [
      [-dx, 0, -dz, u0, 0],
      [dx, 0, dz, u1, 0],
      [dx, 0.5, dz, u1, 1],
      [-dx, 0, -dz, u0, 0],
      [dx, 0.5, dz, u1, 1],
      [-dx, 0.5, -dz, u0, 1],
    ];
    for (const [x, y, z, u, v] of corners) vertex(b, new THREE.Vector3(x, y, z), up, [y > 0 ? 1.1 : 0.75, y > 0 ? 1.1 : 0.75, y > 0 ? 1.1 : 0.75], u, v);
  }
  return finish(b);
}
