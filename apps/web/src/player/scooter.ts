import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A kick-scooter-style e-scooter built in code (no downloaded model): deck, two wheels,
 * stem, handlebar with grips, headlight. One merged mesh, ≈ 500 triangles.
 * Faces -z like the avatar; the deck top is 0.16 m above the ground.
 */
function part(geometry: THREE.BufferGeometry, hex: number, at: [number, number, number], rot?: [number, number, number]): THREE.BufferGeometry {
  geometry.deleteAttribute('uv');
  if (rot) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  geometry.translate(...at);
  const color = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const TYRE = 0x22252a;
const HUB = 0xb9bec4;
const FRAME = 0x2f3640;
const GRIP = 0x15171a;
const LIGHT = 0xfff4c2;

export function buildScooterGeometry(accent: number): THREE.BufferGeometry {
  const wheel = (z: number): THREE.BufferGeometry[] => [
    part(new THREE.TorusGeometry(0.085, 0.032, 8, 16), TYRE, [0, 0.117, z], [0, Math.PI / 2, 0]),
    part(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), HUB, [0, 0.117, z], [0, 0, Math.PI / 2]),
  ];
  const parts = [
    ...wheel(-0.42),
    ...wheel(0.4),
    part(new THREE.BoxGeometry(0.17, 0.045, 0.72), accent, [0, 0.135, 0]), // deck
    part(new THREE.BoxGeometry(0.15, 0.008, 0.6), GRIP, [0, 0.161, 0.01]), // grip tape
    part(new THREE.BoxGeometry(0.15, 0.03, 0.2), accent, [0, 0.24, 0.43], [0.25, 0, 0]), // rear mudguard
    part(new THREE.CylinderGeometry(0.022, 0.026, 0.95, 10), FRAME, [0, 0.62, -0.39], [-0.12, 0, 0]), // stem
    part(new THREE.BoxGeometry(0.06, 0.12, 0.08), FRAME, [0, 0.18, -0.4]), // fork
    part(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 10), FRAME, [0, 1.08, -0.33], [0, 0, Math.PI / 2]), // handlebar
    part(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 10), GRIP, [-0.23, 1.08, -0.33], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 10), GRIP, [0.23, 1.08, -0.33], [0, 0, Math.PI / 2]),
    part(new THREE.BoxGeometry(0.07, 0.05, 0.035), LIGHT, [0, 0.98, -0.45]), // headlight
    part(new THREE.BoxGeometry(0.1, 0.07, 0.04), accent, [0, 1.03, -0.42]), // little display box
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/** The scooter mesh that sits inside an avatar's leaning body group. */
export class ScooterModel {
  readonly mesh: THREE.Mesh;

  constructor(accent: number) {
    this.mesh = new THREE.Mesh(buildScooterGeometry(accent), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.mesh.visible = false;
  }

  setAccent(accent: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildScooterGeometry(accent);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
