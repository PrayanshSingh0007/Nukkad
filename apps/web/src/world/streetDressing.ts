import * as THREE from 'three';
import { LAMP_STRIDE, TREE_STRIDE } from '@nukkad/worldgen';

/**
 * Small things that make a street feel like Bengaluru, made in code:
 * - overhead wires sagging from pole to pole (the street-lamp poles carry them),
 * - fallen petals on the ground under gulmohar, tabebuia and bougainvillea.
 */

const WIRE_HEIGHT = 4.85;
const MAX_SPAN_M = 42;
const MIN_SPAN_M = 9;

/** Wires between each pole and its two nearest neighbours: three strands per span, 6 pieces each. */
export function buildWires(lamps: Float32Array): THREE.LineSegments | null {
  const count = lamps.length / LAMP_STRIDE;
  if (count < 2) return null;
  // A grid of poles so finding neighbours is quick.
  const CELL = MAX_SPAN_M;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.floor(lamps[i * LAMP_STRIDE] / CELL)},${Math.floor(lamps[i * LAMP_STRIDE + 2] / CELL)}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  }
  const done = new Set<number>();
  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    const ax = lamps[i * LAMP_STRIDE];
    const ay = lamps[i * LAMP_STRIDE + 1];
    const az = lamps[i * LAMP_STRIDE + 2];
    const near: { j: number; d: number }[] = [];
    const gx = Math.floor(ax / CELL);
    const gz = Math.floor(az / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const j of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (j === i) continue;
          const d = Math.hypot(lamps[j * LAMP_STRIDE] - ax, lamps[j * LAMP_STRIDE + 2] - az);
          if (d >= MIN_SPAN_M && d <= MAX_SPAN_M) near.push({ j, d });
        }
    near.sort((p, q) => p.d - q.d);
    for (const { j, d } of near.slice(0, 2)) {
      const pair = Math.min(i, j) * 100000 + Math.max(i, j);
      if (done.has(pair)) continue;
      done.add(pair);
      const bx = lamps[j * LAMP_STRIDE];
      const by = lamps[j * LAMP_STRIDE + 1];
      const bz = lamps[j * LAMP_STRIDE + 2];
      for (let strand = 0; strand < 3; strand++) {
        const sag = 0.35 + d * 0.018 + strand * 0.22;
        const lift = WIRE_HEIGHT - strand * 0.28;
        const pieces = 6;
        for (let k = 0; k < pieces; k++) {
          for (const t of [k / pieces, (k + 1) / pieces]) {
            const droop = 4 * t * (1 - t) * sag;
            points.push(ax + (bx - ax) * t, ay + (by - ay) * t + lift - droop, az + (bz - az) * t);
          }
        }
      }
    }
  }
  if (points.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const wires = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x1b1c1f }));
  wires.frustumCulled = false;
  return wires;
}

let petalTexture: THREE.CanvasTexture | null = null;

/** A round scatter of small petals, white on see-through; the instance colour tints it. */
function petals(): THREE.CanvasTexture {
  if (petalTexture) return petalTexture;
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  let seed = 9001;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 1700; i++) {
    // Thick under the middle of the crown, thinning out to the edge.
    const r = Math.pow(random(), 0.75) * S * 0.48;
    const a = random() * Math.PI * 2;
    const light = 200 + random() * 55;
    c.fillStyle = `rgb(${light}, ${light}, ${light})`;
    c.beginPath();
    c.ellipse(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1.6 + random() * 2.2, 1.1 + random() * 1.4, random() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  petalTexture = new THREE.CanvasTexture(canvas);
  petalTexture.colorSpace = THREE.SRGBColorSpace;
  petalTexture.anisotropy = 4;
  return petalTexture;
}

/** Species (see treeModels.ts) that drop petals, their colour and the size of the carpet. */
const PETALS: Record<number, { color: number; radius: number }> = {
  4: { color: 0xe2552b, radius: 4.4 }, // gulmohar
  5: { color: 0xf09ac0, radius: 3.2 }, // tabebuia
  7: { color: 0xd6338a, radius: 1.8 }, // bougainvillea
};

/** One flat petal carpet under every flowering tree: one draw call for the whole area. */
export function buildPetals(trees: Float32Array, species: Uint8Array, limit: number): THREE.InstancedMesh | null {
  const total = Math.min(limit, species.length);
  let count = 0;
  for (let t = 0; t < total; t++) if (PETALS[species[t]]) count++;
  if (count === 0) return null;
  const material = new THREE.MeshLambertMaterial({ map: petals(), alphaTest: 0.45, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material, count);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  let i = 0;
  for (let t = 0; t < total; t++) {
    const spec = PETALS[species[t]];
    if (!spec) continue;
    const o = t * TREE_STRIDE;
    const size = spec.radius * trees[o + 3];
    rotation.setFromAxisAngle(up, trees[o + 4]);
    mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(trees[o], trees[o + 1] + 0.1, trees[o + 2]), rotation, new THREE.Vector3(size, 1, size)));
    mesh.setColorAt(i, color.set(spec.color));
    i++;
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
