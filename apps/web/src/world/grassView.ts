import * as THREE from 'three';
import { heightAt } from '@nukkad/worldgen';
import type { TerrainGrid } from '@nukkad/worldgen';
import { createGrassTuft } from './treeModels.ts';

const SPACING = 0.7;
const REFILL_M = 5;

/**
 * Real grass around your feet: tufts (two crossed leaf cards each) on lawns and parks within a
 * short distance, taking their colour from the ground under them. Where the lawns are comes
 * from the ground colour map the world already has. One draw call; refilled as you walk.
 */
export class GrassView {
  readonly mesh: THREE.InstancedMesh;
  private readonly terrain: TerrainGrid;
  private readonly pixels: Uint8Array;
  private readonly size: number;
  private readonly half: number;
  private readonly capacity: number;
  private radius: number;
  private at: [number, number] | null = null;

  constructor(material: THREE.Material, terrain: TerrainGrid, groundMap: { size: number; pixels: Uint8Array }, half: number, radius: number) {
    this.terrain = terrain;
    this.pixels = groundMap.pixels;
    this.size = groundMap.size;
    this.half = half;
    this.radius = radius;
    this.capacity = Math.ceil((Math.PI * 30 * 30) / (SPACING * SPACING));
    this.mesh = new THREE.InstancedMesh(createGrassTuft(), material, this.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  setRadius(radius: number): void {
    this.radius = Math.min(30, radius);
    this.at = null;
  }

  /** Ground colour (0–255) at a spot, from the ground map (north at the top). */
  private colourAt(x: number, z: number): [number, number, number] {
    const px = Math.min(this.size - 1, Math.max(0, Math.floor(((x + this.half) / (2 * this.half)) * this.size)));
    const pz = Math.min(this.size - 1, Math.max(0, Math.floor(((z + this.half) / (2 * this.half)) * this.size)));
    const o = (pz * this.size + px) * 4;
    return [this.pixels[o], this.pixels[o + 1], this.pixels[o + 2]];
  }

  update(x: number, z: number): void {
    if (this.radius <= 0) {
      this.mesh.count = 0;
      return;
    }
    if (this.at && Math.hypot(this.at[0] - x, this.at[1] - z) < REFILL_M) return;
    this.at = [x, z];
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const reach = this.radius + REFILL_M;
    let count = 0;
    const x0 = Math.floor((x - reach) / SPACING);
    const x1 = Math.ceil((x + reach) / SPACING);
    const z0 = Math.floor((z - reach) / SPACING);
    const z1 = Math.ceil((z + reach) / SPACING);
    for (let gx = x0; gx <= x1 && count < this.capacity; gx++) {
      for (let gz = z0; gz <= z1 && count < this.capacity; gz++) {
        // The same tuft always stands in the same place: its jitter comes from its grid cell.
        const h = Math.abs(Math.sin(gx * 127.1 + gz * 311.7) * 43758.5453) % 1;
        const h2 = Math.abs(Math.sin(gx * 269.5 + gz * 183.3) * 43758.5453) % 1;
        const tx = (gx + h) * SPACING;
        const tz = (gz + h2) * SPACING;
        const d = Math.hypot(tx - x, tz - z);
        if (d > reach) continue;
        const [r, g, b] = this.colourAt(tx, tz);
        if (g < r * 1.08 || g < b * 1.2) continue; // not a lawn
        const size = (0.45 + h * 0.45) * Math.min(1, (reach - d) / 6); // shrink away at the edge
        if (size < 0.15) continue;
        position.set(tx, heightAt(this.terrain, tx, tz), tz);
        rotation.setFromAxisAngle(up, h2 * Math.PI);
        scale.set(size * 1.3, size * (0.7 + h2 * 0.5), size * 1.3);
        this.mesh.setMatrixAt(count, matrix.compose(position, rotation, scale));
        const shade = 0.85 + h * 0.4;
        this.mesh.setColorAt(count, color.setRGB((r / 255) * shade, (g / 255) * shade * 1.05, (b / 255) * shade * 0.9, THREE.SRGBColorSpace));
        count++;
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
