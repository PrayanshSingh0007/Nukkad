import { TERRAIN_CELL, makeProjector } from '@nukkad/shared';
import type { AreaRef, PackTerrain } from '@nukkad/shared';

/** Returns the real elevation in metres at a lat/lng, or NaN when unknown. */
export type ElevationSampler = (lat: number, lng: number) => number;

const BLUR_PASSES = 3;

function flatTerrain(size: number): PackTerrain {
  return { size, cell: TERRAIN_CELL, base: 0, flat: 1, heights: new Array<number>(size * size).fill(0) };
}

/** One pass of a small [1 2 1] blur in both directions; edges repeat their neighbour. */
function blur(grid: Float64Array, size: number): Float64Array {
  const temp = new Float64Array(grid.length);
  const out = new Float64Array(grid.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const left = grid[j * size + Math.max(0, i - 1)];
      const right = grid[j * size + Math.min(size - 1, i + 1)];
      temp[j * size + i] = (left + 2 * grid[j * size + i] + right) / 4;
    }
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const up = temp[Math.max(0, j - 1) * size + i];
      const down = temp[Math.min(size - 1, j + 1) * size + i];
      out[j * size + i] = (up + 2 * temp[j * size + i] + down) / 4;
    }
  }
  return out;
}

/**
 * Samples the ground height every 10 m across the area (121 × 121 points for 1.2 km).
 * Raw elevation data is bumpy in cities (it sees rooftops), so it is blurred.
 * With no sampler, or missing data, the ground is flat and the pack says so.
 */
export function buildHeightGrid(ref: AreaRef, sample: ElevationSampler | null): PackTerrain {
  const size = Math.round((2 * ref.halfSize) / TERRAIN_CELL) + 1;
  if (!sample) return flatTerrain(size);

  const projector = makeProjector(ref.lat, ref.lng);
  let grid: Float64Array = new Float64Array(size * size);
  let highest = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [lat, lng] = projector.toGeo(-ref.halfSize + i * TERRAIN_CELL, -ref.halfSize + j * TERRAIN_CELL);
      const height = sample(lat, lng);
      if (!Number.isFinite(height)) return flatTerrain(size);
      grid[j * size + i] = height;
      if (height > highest) highest = height;
    }
  }
  // The data also contains the sea floor. On a coast, keep the sea flat at 0 instead of a deep pit.
  if (highest > 0) grid = grid.map((height) => Math.max(0, height));
  for (let pass = 0; pass < BLUR_PASSES; pass++) grid = blur(grid, size);

  let lowest = Infinity;
  for (const height of grid) if (height < lowest) lowest = height;
  const base = Math.floor(lowest);
  const heights = new Array<number>(grid.length);
  for (let k = 0; k < grid.length; k++) heights[k] = Math.round((grid[k] - base) * 100);
  return { size, cell: TERRAIN_CELL, base, heights };
}
