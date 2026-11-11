import earcut from 'earcut';
import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, PackArea } from '@nukkad/shared';
import { densifyRing, distToSegment, pointInPolygon, ringBounds } from '../geom/polygon.ts';
import { MeshBuilder } from '../mesh/meshBuilder.ts';
import type { MeshData } from '../mesh/meshBuilder.ts';
import { POOL_COLOR, WATER_COLOR } from '../style/palette.ts';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';

/** Water is drawn this far above the original ground… */
const WATER_LIFT_M = 0.05;
/** …and the ground inside lakes is pushed down this far, so it can never poke through. */
const BASIN_DEPTH_M = 0.6;
/** Outline edges are cut to this length so the water follows the ground. */
const WATER_EDGE_STEP_M = 12;
/** The ground is not lowered this close to a road: bridges keep solid ground under them. */
const ROAD_CLEARANCE_M = 6;

const toMetres = (ring: number[]): number[] => ring.map((value) => value / UNITS_PER_METRE);
const isWater = (area: PackArea): boolean => area.kind === 'water' || area.kind === 'pool';

/**
 * Digs shallow basins: every height sample inside a lake or river polygon is lowered,
 * except near roads and rails. Changes `terrain` in place.
 */
export function digBasins(terrain: TerrainGrid, pack: AreaPack): void {
  const { size, cell, half, heights } = terrain;
  const roads = pack.lines
    .filter((line) => line.kind !== 'river' && line.kind !== 'stream')
    .map((line) => ({ pts: toMetres(line.pts), reach: line.w / 2 + ROAD_CLEARANCE_M }));
  const nearRoad = (x: number, z: number): boolean => {
    for (const road of roads) {
      for (let i = 0; i + 3 < road.pts.length; i += 2) {
        if (distToSegment(x, z, road.pts[i], road.pts[i + 1], road.pts[i + 2], road.pts[i + 3]) < road.reach) return true;
      }
    }
    return false;
  };

  for (const area of pack.areas) {
    if (area.kind !== 'water') continue;
    const ring = toMetres(area.ring);
    const holes = (area.holes ?? []).map(toMetres);
    const [minX, minZ, maxX, maxZ] = ringBounds(ring);
    const i0 = Math.max(0, Math.ceil((minX + half) / cell));
    const i1 = Math.min(size - 1, Math.floor((maxX + half) / cell));
    const j0 = Math.max(0, Math.ceil((minZ + half) / cell));
    const j1 = Math.min(size - 1, Math.floor((maxZ + half) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * cell;
        const z = -half + j * cell;
        if (pointInPolygon(x, z, ring, holes) && !nearRoad(x, z)) heights[j * size + i] -= BASIN_DEPTH_M;
      }
    }
  }
}

/**
 * All lakes, rivers and pools as one mesh. Heights come from the ORIGINAL ground
 * (before basins were dug) so the water surface stays where the shore is.
 */
export function buildWaterMesh(pack: AreaPack, originalTerrain: TerrainGrid): MeshData | null {
  const mesh = new MeshBuilder();
  for (const area of pack.areas) {
    if (!isWater(area)) continue;
    const color = area.kind === 'pool' ? POOL_COLOR : WATER_COLOR;
    const flat = densifyRing(toMetres(area.ring), WATER_EDGE_STEP_M);
    const holeStarts: number[] = [];
    for (const hole of area.holes ?? []) {
      holeStarts.push(flat.length / 2);
      for (const value of densifyRing(toMetres(hole), WATER_EDGE_STEP_M)) flat.push(value);
    }
    const triangles = earcut(flat, holeStarts, 2);
    const first = mesh.vertexCount;
    for (let i = 0; i < flat.length; i += 2) {
      const y = heightAt(originalTerrain, flat[i], flat[i + 1]) + WATER_LIFT_M;
      mesh.addVertex(flat[i], y, flat[i + 1], 0, 1, 0, color);
    }
    for (let i = 0; i < triangles.length; i += 3) {
      mesh.addTriangleFacing(first + triangles[i], first + triangles[i + 1], first + triangles[i + 2], true);
    }
  }
  return mesh.finish();
}
