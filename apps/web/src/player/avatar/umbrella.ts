import * as THREE from 'three';

/**
 * Umbrellas for the rain: an eight-panel canopy (a shallow dome, 1.06 m across) on a thin shaft
 * with a crook handle. Origin at the hand grip; the canopy's rim is 0.71 m above it. Vertex
 * colours: the canopy white (it takes the umbrella's colour), the shaft and handle dark.
 *
 * Colours as on a Bengaluru street in the monsoon: mostly plain black, then navy, maroon and
 * bottle green, and now and then a bright one.
 */
export const UMBRELLA_COLOURS = [0x141416, 0x141416, 0x141416, 0x18181c, 0x141416, 0x1d2a4a, 0x5a1a22, 0x1f3d2b, 0xc23b2e, 0xe0b31f, 0x2e6fb5, 0x7a3f8f];
/** How far above the grip the canopy's rim sits. */
export const UMBRELLA_RIM_M = 0.71;

let geometry: THREE.BufferGeometry | null = null;

export function umbrellaGeometry(): THREE.BufferGeometry {
  if (geometry) return geometry;
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, shade: number): THREE.BufferGeometry => {
    const plain = g.index ? g.toNonIndexed() : g;
    plain.deleteAttribute('uv');
    const colours = new Float32Array(plain.getAttribute('position').count * 3).fill(shade);
    plain.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return plain;
  };
  // Canopy: the top of a 0.7 m sphere, eight panels, apex 0.95 m above the grip.
  const canopy = new THREE.SphereGeometry(0.7, 8, 3, 0, Math.PI * 2, 0, 0.85).translate(0, 0.25, 0);
  // Panels sag a little between the ribs: pull the in-between vertices down.
  const p = canopy.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const angle = Math.atan2(p.getZ(i), p.getX(i));
    const between = Math.abs(Math.sin(angle * 4));
    const r = Math.hypot(p.getX(i), p.getZ(i));
    p.setY(i, p.getY(i) - between * r * 0.06);
  }
  canopy.computeVertexNormals();
  parts.push(paint(canopy, 1));
  // Shaft, tip and a crook handle.
  parts.push(paint(new THREE.CylinderGeometry(0.008, 0.008, 1.02, 5, 1, true).translate(0, 0.48, 0), 0.22));
  parts.push(paint(new THREE.CylinderGeometry(0.004, 0.01, 0.07, 5).translate(0, 1.0, 0), 0.22));
  parts.push(paint(new THREE.TorusGeometry(0.045, 0.011, 4, 8, Math.PI).rotateY(Math.PI / 2).translate(0, -0.03, 0.045), 0.15));
  // Merge.
  let count = 0;
  for (const part of parts) count += part.getAttribute('position').count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  let at = 0;
  for (const part of parts) {
    position.set(part.getAttribute('position').array as Float32Array, at * 3);
    normal.set(part.getAttribute('normal').array as Float32Array, at * 3);
    color.set(part.getAttribute('color').array as Float32Array, at * 3);
    at += part.getAttribute('position').count;
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

const materials = new Map<number, THREE.MeshStandardMaterial>();

/** One shared material per colour (nylon: a soft sheen, darker and glossier when wet). */
export function umbrellaMaterial(colour: number | null): THREE.MeshStandardMaterial {
  const key = colour ?? -1;
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ vertexColors: true, color: colour ?? 0xffffff, roughness: 0.42, metalness: 0, side: THREE.DoubleSide });
    materials.set(key, material);
  }
  return material;
}

/** A seeded colour (0–1 seed). */
export function umbrellaColour(seed: number): number {
  return UMBRELLA_COLOURS[Math.floor(seed * UMBRELLA_COLOURS.length) % UMBRELLA_COLOURS.length];
}
