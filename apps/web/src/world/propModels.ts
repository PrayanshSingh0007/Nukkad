import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Tiny models made in code (no downloaded assets): three plants, a street lamp, a bench.
 * Each is one geometry with colours baked into its vertices, so one model = one draw call
 * no matter how many copies are shown.
 */

/** Gives a part one flat colour and makes it mergeable with the other parts. */
function part(geometry: THREE.BufferGeometry, hex: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('uv');
  flat.translate(x, y, z);
  const color = new THREE.Color(hex);
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

const TRUNK = 0x6b4f3a;

/** Darker low down, lighter on top: leaves catch the sky. Applied to vertices above `from`. */
function shadeByHeight(geometry: THREE.BufferGeometry, from: number, to: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y < from) continue;
    const k = 0.72 + 0.45 * Math.min(1, (y - from) / (to - from));
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
  }
  return geometry;
}

/** Round tree: 28 triangles. */
function roundTree(): THREE.BufferGeometry {
  const canopy = new THREE.IcosahedronGeometry(1.7, 0).scale(1, 0.85, 1);
  return shadeByHeight(
    mergeGeometries([part(new THREE.CylinderGeometry(0.16, 0.22, 2.4, 4, 1, true), TRUNK, 0, 1.2, 0), part(canopy, 0x5d9a4a, 0, 3.4, 0)]),
    2.0,
    4.9,
  );
}

/** Tall tree: 20 triangles. */
function tallTree(): THREE.BufferGeometry {
  return shadeByHeight(
    mergeGeometries([part(new THREE.CylinderGeometry(0.14, 0.2, 1.8, 4, 1, true), TRUNK, 0, 0.9, 0), part(new THREE.ConeGeometry(1.25, 4.6, 6, 1), 0x4c8a4f, 0, 3.9, 0)]),
    1.6,
    6.2,
  );
}

/** Bush: 20 triangles. */
function bush(): THREE.BufferGeometry {
  return shadeByHeight(part(new THREE.IcosahedronGeometry(0.95, 0).scale(1, 0.7, 1), 0x6f9a52, 0, 0.5, 0), 0, 1.2);
}

/** Street lamp pole with its arm: 20 triangles. The arm points along +x. */
function lamp(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.06, 0.09, 5.2, 4, 1, true), 0x55595e, 0, 2.6, 0),
    part(new THREE.BoxGeometry(1.0, 0.08, 0.1), 0x55595e, 0.45, 5.2, 0),
  ]);
}

/** The lamp's light: a flat box under the end of the arm. Drawn unlit, so it can glow. */
export const LAMP_HEAD_OFFSET = 0.85;
function lampHead(): THREE.BufferGeometry {
  return part(new THREE.BoxGeometry(0.42, 0.06, 0.22), 0xffffff, LAMP_HEAD_OFFSET, 5.13, 0);
}

/** Bench: 36 triangles. */
function bench(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.BoxGeometry(1.5, 0.08, 0.45), 0x9a7650, 0, 0.45, 0),
    part(new THREE.BoxGeometry(1.5, 0.4, 0.06), 0x9a7650, 0, 0.78, -0.2),
    part(new THREE.BoxGeometry(1.3, 0.4, 0.3), 0x5f6468, 0, 0.2, 0),
  ]);
}

export interface PropModels {
  /** Index = tree variant in the prop list: 0 round, 1 tall, 2 bush. */
  trees: THREE.BufferGeometry[];
  lamp: THREE.BufferGeometry;
  lampHead: THREE.BufferGeometry;
  bench: THREE.BufferGeometry;
}

export function createPropModels(): PropModels {
  return { trees: [roundTree(), tallTree(), bush()], lamp: lamp(), lampHead: lampHead(), bench: bench() };
}
