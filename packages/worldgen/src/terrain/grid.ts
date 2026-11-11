import type { PackTerrain } from '@nukkad/shared';

/**
 * The ground as a grid of heights (metres above the lowest point of the area).
 *
 * Each grid cell is split into two triangles along the SAME diagonal everywhere:
 *   (i,j)──(i+1,j)
 *     │  ╲    │        triangle A: (i,j) (i,j+1) (i+1,j)
 *   (i,j+1)─(i+1,j+1)  triangle B: (i+1,j) (i,j+1) (i+1,j+1)
 * `heightAt` uses the same split as the drawn mesh, so roads and feet sit exactly
 * on the visible ground. (Phase 2: the physics heightfield must match this split.)
 */
export interface TerrainGrid {
  size: number;
  cell: number;
  half: number;
  /** Real elevation of y = 0, metres above sea level. */
  base: number;
  heights: Float32Array;
}

export function terrainFromPack(terrain: PackTerrain): TerrainGrid {
  const heights = new Float32Array(terrain.heights.length);
  for (let k = 0; k < heights.length; k++) heights[k] = terrain.heights[k] / 100;
  return { size: terrain.size, cell: terrain.cell, half: ((terrain.size - 1) * terrain.cell) / 2, base: terrain.base, heights };
}

export function cloneTerrain(terrain: TerrainGrid): TerrainGrid {
  return { ...terrain, heights: terrain.heights.slice() };
}

export function heightAt(terrain: TerrainGrid, x: number, z: number): number {
  const { size, cell, half, heights } = terrain;
  const fx = Math.min(size - 1, Math.max(0, (x + half) / cell));
  const fz = Math.min(size - 1, Math.max(0, (z + half) / cell));
  const i = Math.min(size - 2, Math.floor(fx));
  const j = Math.min(size - 2, Math.floor(fz));
  const u = fx - i;
  const v = fz - j;
  const row = j * size + i;
  const h10 = heights[row + 1];
  const h01 = heights[row + size];
  if (u + v <= 1) {
    const h00 = heights[row];
    return h00 + u * (h10 - h00) + v * (h01 - h00);
  }
  const h11 = heights[row + size + 1];
  return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

/** Upward unit normal of the ground near a point (smooth, from neighbouring heights). */
export function normalAt(terrain: TerrainGrid, x: number, z: number): [number, number, number] {
  const step = terrain.cell;
  const dx = heightAt(terrain, x + step, z) - heightAt(terrain, x - step, z);
  const dz = heightAt(terrain, x, z + step) - heightAt(terrain, x, z - step);
  const nx = -dx / (2 * step);
  const nz = -dz / (2 * step);
  const length = Math.hypot(nx, 1, nz);
  return [nx / length, 1 / length, nz / length];
}

export interface TerrainMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Texture coordinates into the ground colour map: (0,0) = north-west corner. */
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

/** The whole ground as one mesh: (size-1)² × 2 triangles (28,800 for a 1.2 km area). */
export function buildTerrainMesh(terrain: TerrainGrid): TerrainMesh {
  const { size, cell, half, heights } = terrain;
  const count = size * size;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const x = -half + i * cell;
      const z = -half + j * cell;
      positions[k * 3] = x;
      positions[k * 3 + 1] = heights[k];
      positions[k * 3 + 2] = z;
      const [nx, ny, nz] = normalAt(terrain, x, z);
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;
      uvs[k * 2] = i / (size - 1);
      uvs[k * 2 + 1] = j / (size - 1);
    }
  }
  const cells = (size - 1) * (size - 1);
  const indices = count > 65535 ? new Uint32Array(cells * 6) : new Uint16Array(cells * 6);
  let o = 0;
  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      const a = j * size + i;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }
  return { positions, normals, uvs, indices };
}
