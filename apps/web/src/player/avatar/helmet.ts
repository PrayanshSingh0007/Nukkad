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
  // A full-face helmet: the shell comes down round the jaw, with a black rubber trim at the
  // bottom edge, a dark visor over the face (forehead to mouth), and a chin bar below it.
  const fit = (g: THREE.BufferGeometry) => g.scale(1, 0.98, 1.1).translate(0, 0.02, 0.01);
  const shell = fit(new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.72));
  const trim = fit(new THREE.SphereGeometry(0.149, 20, 1, 0, Math.PI * 2, Math.PI * 0.72, Math.PI * 0.05));
  const visor = fit(new THREE.SphereGeometry(0.156, 14, 6, Math.PI * 1.5 - Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.37, Math.PI * 0.28));
  const parts: [THREE.BufferGeometry, number][] = [
    [shell, 1],
    [trim, 0.12],
    [visor, 0.06],
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
