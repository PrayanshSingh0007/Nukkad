import * as THREE from 'three';

/**
 * Real clothes for the 3D people: a cloth layer cut from the body itself. We take the
 * triangles a garment covers (by body region and height), weld the seams, smooth the shape
 * so muscles and abs disappear the way they do under fabric, and push it out a little from
 * the skin. It keeps the body's bone weights, so it moves with every animation. Made once
 * per body build and outfit, and shared by everyone wearing it.
 */
export type GarmentPart = 'top' | 'longTop' | 'pants';

/** Regions written by prepareBody (people.ts): 0 skin · 1 torso · 2 upper arm · 3 forearm · 4 hips · 5 thigh · 6 calf · 7 foot. */
function covers(part: GarmentPart, region: number, h: number, sleeves: boolean): boolean {
  switch (part) {
    case 'top':
    case 'longTop':
      if (region === 1 || region === 2) return true;
      if (region === 3) return sleeves;
      if (region === 4) return h > (part === 'longTop' ? 0.44 : 0.5);
      return false;
    case 'pants':
      if (region === 4) return h <= 0.56;
      if (region === 5) return true;
      if (region === 6) return h > 0.065;
      return false;
  }
}

export interface GarmentSpec {
  part: GarmentPart;
  sleeves: boolean;
  /** How far the cloth stands off the skin, metres. */
  offset: number;
  /** Smoothing passes: more = looser, fewer folds of the body showing. */
  smooth: number;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** `metresPerUnit` = how many metres one unit of the body geometry is. */
export function garmentGeometry(body: THREE.BufferGeometry, spec: GarmentSpec, metresPerUnit: number, cacheKey: string): THREE.BufferGeometry | null {
  const key = `${cacheKey}|${spec.part}|${spec.sleeves}|${spec.offset}|${spec.smooth}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const position = body.getAttribute('position') as THREE.BufferAttribute;
  const cloth = body.getAttribute('aCloth') as THREE.BufferAttribute | undefined;
  const index = body.getIndex();
  if (!cloth || !index) return null;
  const count = position.count;

  // 1. Weld: vertices at the same spot (UV seams) move as one.
  const weld = new Int32Array(count);
  const byKey = new Map<string, number>();
  const q = 1e4 * Math.max(1, 0.001 / metresPerUnit);
  for (let i = 0; i < count; i++) {
    const k = `${Math.round(position.getX(i) * q)},${Math.round(position.getY(i) * q)},${Math.round(position.getZ(i) * q)}`;
    const id = byKey.get(k);
    if (id === undefined) {
      byKey.set(k, i);
      weld[i] = i;
    } else weld[i] = id;
  }

  // 2. The triangles this garment covers.
  const inside = (v: number): boolean => covers(spec.part, Math.round(cloth.getX(v)), cloth.getY(v), spec.sleeves);
  const tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (inside(a) && inside(b) && inside(c)) tris.push(a, b, c);
  }
  if (tris.length === 0) return null;

  // 3. Neighbours (on welded ids) and the open edge of the garment (cuffs, collar, hem).
  const neighbours = new Map<number, Set<number>>();
  const edgeUse = new Map<string, number>();
  const link = (a: number, b: number): void => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
  };
  for (let t = 0; t < tris.length; t += 3) {
    const a = weld[tris[t]];
    const b = weld[tris[t + 1]];
    const c = weld[tris[t + 2]];
    link(a, b);
    link(b, a);
    link(b, c);
    link(c, b);
    link(c, a);
    link(a, c);
  }
  const rim = new Set<number>();
  for (const [k, uses] of edgeUse) {
    if (uses > 2) continue; // each edge was counted twice per triangle (a→b and b→a)
    const [a, b] = k.split('_').map(Number);
    rim.add(a);
    rim.add(b);
  }

  // 4. Smooth (Laplacian, a little at a time). Rim vertices stay put so cuffs and hems hug the body.
  const ids = [...neighbours.keys()];
  const pos = new Map<number, THREE.Vector3>();
  for (const id of ids) pos.set(id, new THREE.Vector3().fromBufferAttribute(position, id));
  const next = new Map<number, THREE.Vector3>();
  for (let pass = 0; pass < spec.smooth; pass++) {
    for (const id of ids) {
      const p = pos.get(id)!;
      if (rim.has(id)) {
        next.set(id, p.clone());
        continue;
      }
      const avg = new THREE.Vector3();
      const set = neighbours.get(id)!;
      for (const n of set) avg.add(pos.get(n)!);
      avg.multiplyScalar(1 / set.size);
      next.set(id, p.clone().lerp(avg, 0.55));
    }
    for (const id of ids) pos.get(id)!.copy(next.get(id)!);
  }

  // 5. Normals of the smooth shape, then push out along them (plus what smoothing shrank).
  const normal = new Map<number, THREE.Vector3>();
  for (const id of ids) normal.set(id, new THREE.Vector3());
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let t = 0; t < tris.length; t += 3) {
    const a = weld[tris[t]];
    const b = weld[tris[t + 1]];
    const c = weld[tris[t + 2]];
    e1.subVectors(pos.get(b)!, pos.get(a)!);
    e2.subVectors(pos.get(c)!, pos.get(a)!);
    const n = e1.cross(e2);
    normal.get(a)!.add(n);
    normal.get(b)!.add(n);
    normal.get(c)!.add(n);
  }
  for (const n of normal.values()) n.normalize();
  const original = new THREE.Vector3();
  for (const id of ids) {
    const p = pos.get(id)!;
    const n = normal.get(id)!;
    // Never sink below the skin: measure how far smoothing pulled this point inwards.
    original.fromBufferAttribute(position, id);
    const sunk = Math.max(0, original.clone().sub(p).dot(n));
    p.addScaledVector(n, sunk + (rim.has(id) ? spec.offset * 0.5 : spec.offset) / metresPerUnit);
  }

  // 6. A new geometry: only the used vertices, with the body's skinning.
  const used = new Map<number, number>();
  const order: number[] = [];
  for (const v of tris) {
    if (!used.has(v)) {
      used.set(v, order.length);
      order.push(v);
    }
  }
  const out = new THREE.BufferGeometry();
  const outPos = new Float32Array(order.length * 3);
  const outNormal = new Float32Array(order.length * 3);
  order.forEach((v, i) => {
    const p = pos.get(weld[v])!;
    const n = normal.get(weld[v])!;
    outPos.set([p.x, p.y, p.z], i * 3);
    outNormal.set([n.x, n.y, n.z], i * 3);
  });
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(outNormal, 3));
  for (const name of ['skinIndex', 'skinWeight', 'aCloth']) {
    const source = body.getAttribute(name) as THREE.BufferAttribute;
    const size = source.itemSize;
    const Typed = (source.array as unknown as { constructor: new (n: number) => Float32Array }).constructor;
    const data = new Typed(order.length * size);
    order.forEach((v, i) => {
      for (let k = 0; k < size; k++) data[i * size + k] = source.getComponent(v, k);
    });
    out.setAttribute(name, new THREE.BufferAttribute(data, size, source.normalized));
  }
  out.setIndex(tris.map((v) => used.get(v)!));
  out.computeBoundingSphere();
  cache.set(key, out);
  return out;
}

let fabric: THREE.CanvasTexture | null = null;

/** A fine woven-cloth bump pattern (painted once), so garments read as fabric close up. */
export function fabricNormal(): THREE.CanvasTexture {
  if (fabric) return fabric;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = c.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Two sets of threads, over and under: a gentle tilt of the normal across each.
      const wx = Math.sin((x / S) * Math.PI * 2 * 32) * (Math.floor(y / 2) % 2 ? 1 : -1);
      const wy = Math.sin((y / S) * Math.PI * 2 * 32) * (Math.floor(x / 2) % 2 ? 1 : -1);
      const o = (y * S + x) * 4;
      image.data[o] = 128 + wx * 30;
      image.data[o + 1] = 128 + wy * 30;
      image.data[o + 2] = 255;
      image.data[o + 3] = 255;
    }
  }
  c.putImageData(image, 0, 0);
  fabric = new THREE.CanvasTexture(canvas);
  fabric.wrapS = THREE.RepeatWrapping;
  fabric.wrapT = THREE.RepeatWrapping;
  return fabric;
}
