import * as THREE from 'three';

/**
 * A two-wheeler helmet (riders in Bengaluru must wear one): a rounded shell, a little longer
 * front to back, with a dark visor across the face. Centred on the head; faces −z like
 * everyone. Vertex colours: the shell white (it takes the helmet's colour), the visor near black.
 */
export const HELMET_COLOURS = [0x141416, 0xf2f2f0, 0xb3121d, 0x1d3f8a, 0x9aa0a8, 0x141416, 0xe6c229, 0x2a2a2e];

let geometry: THREE.BufferGeometry | null = null;

export function helmetGeometry(): THREE.BufferGeometry {
  if (geometry) return geometry;
  const shell = new THREE.SphereGeometry(0.155, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.64).scale(1, 0.98, 1.12).translate(0, 0.02, 0.01);
  // The visor: a band of a slightly bigger sphere across the front (−z) at eye height.
  const visor = new THREE.SphereGeometry(0.162, 12, 4, Math.PI * 1.5 - Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.42, Math.PI * 0.2).scale(1, 0.98, 1.12).translate(0, 0.02, 0.01);
  const parts: [THREE.BufferGeometry, number][] = [
    [shell, 1],
    [visor, 0.07],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  for (const [part, shade] of parts) {
    const flat = part.index ? part.toNonIndexed() : part;
    const p = flat.getAttribute('position');
    positions.push(...(p.array as Float32Array));
    normals.push(...(flat.getAttribute('normal').array as Float32Array));
    for (let i = 0; i < p.count; i++) colours.push(shade, shade, shade);
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** A seeded colour (0–1 seed). */
export function helmetColour(seed: number): number {
  return HELMET_COLOURS[Math.floor(seed * HELMET_COLOURS.length) % HELMET_COLOURS.length];
}
