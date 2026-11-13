import * as THREE from 'three';
import { PLACE_COLORS, PLACE_KANNADA, UNITS_PER_METRE, signText } from '@nukkad/shared';
import type { PackPlace } from '@nukkad/shared';
import { heightAt } from '@nukkad/worldgen';
import type { TerrainGrid } from '@nukkad/worldgen';

/**
 * Shop, school and office signboards. All names are painted once into one picture
 * (2 columns × 60 rows of 256 × 48 pixels ≈ 5.6 MB on the GPU) and all boards are one
 * merged mesh: 100 signs = 200 triangles = ONE draw call. Real places show their real name
 * (plain text, never a logo); invented ones a made-up name.
 */
const CELL_W = 256;
const CELL_H = 48;
const COLUMNS = 2;
const ROWS = 60;
const ASPECT = CELL_W / CELL_H;

function paintSign(c: CanvasRenderingContext2D, x: number, y: number, place: PackPlace): void {
  c.fillStyle = PLACE_COLORS[place.kind];
  c.fillRect(x, y, CELL_W, CELL_H);
  c.strokeStyle = 'rgba(255,255,255,0.55)';
  c.lineWidth = 2;
  c.strokeRect(x + 3, y + 3, CELL_W - 6, CELL_H - 6);
  // Kannada first (what the place is), then the name — the way boards are in Bengaluru.
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.font = `700 14px "Noto Sans Kannada", "Kannada Sangam MN", "Tunga", system-ui, sans-serif`;
  c.fillText(PLACE_KANNADA[place.kind], x + CELL_W / 2, y + 13);
  const name = signText(place).toUpperCase();
  let size = 21;
  c.font = `800 ${size}px system-ui, -apple-system, Roboto, sans-serif`;
  while (c.measureText(name).width > CELL_W - 18 && size > 11) {
    size -= 1;
    c.font = `800 ${size}px system-ui, -apple-system, Roboto, sans-serif`;
  }
  c.fillStyle = '#ffffff';
  c.fillText(name, x + CELL_W / 2, y + 32);
}

export class Signs {
  readonly mesh: THREE.Mesh | null = null;
  private readonly material: THREE.MeshBasicMaterial | null = null;
  private readonly texture: THREE.CanvasTexture | null = null;

  constructor(places: PackPlace[], terrain: TerrainGrid, anisotropy: number) {
    const list = places.slice(0, COLUMNS * ROWS);
    if (list.length === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = CELL_W * COLUMNS;
    canvas.height = CELL_H * ROWS;
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;

    const positions = new Float32Array(list.length * 4 * 3);
    const uvs = new Float32Array(list.length * 4 * 2);
    const indices = new Uint16Array(list.length * 6);
    list.forEach((place, i) => {
      const column = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      paintSign(c, column * CELL_W, row * CELL_H, place);

      const width = place.w / UNITS_PER_METRE;
      const height = width / ASPECT;
      const x = place.x / UNITS_PER_METRE;
      const z = place.z / UNITS_PER_METRE;
      const base = heightAt(terrain, x, z) + place.y / UNITS_PER_METRE;
      const angle = (place.face * Math.PI) / 180;
      // The board's own right (+x) and front (+z) turned by `face`.
      const rx = Math.cos(angle);
      const rz = -Math.sin(angle);
      const corners: [number, number][] = [
        [-width / 2, 0],
        [width / 2, 0],
        [width / 2, height],
        [-width / 2, height],
      ];
      corners.forEach(([side, up], k) => {
        positions.set([x + rx * side, base + up, z + rz * side], (i * 4 + k) * 3);
      });
      const u0 = column / COLUMNS;
      const u1 = (column + 1) / COLUMNS;
      const vTop = 1 - row / ROWS;
      const vBottom = 1 - (row + 1) / ROWS;
      uvs.set([u0, vBottom, u1, vBottom, u1, vTop, u0, vTop], i * 8);
      const v = i * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    // Unlit: signs read clearly by day and look lit at night.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(geometry, this.material);
  }

  /** A little dimmer in daylight, full brightness at night. */
  setNight(night: number): void {
    this.material?.color.setScalar(0.82 + night * 0.18);
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.texture?.dispose();
  }
}
