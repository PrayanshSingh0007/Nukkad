import earcut from 'earcut';
import { UNITS_PER_METRE } from '@nukkad/shared';
import type { PackBuilding } from '@nukkad/shared';
import { simplifyRing } from '../geom/polygon.ts';
import type { MeshBuilder, Rgb } from '../mesh/meshBuilder.ts';
import { buildingColors } from '../style/palette.ts';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';

/** Walls continue this far below the ground so nothing floats on a slope. */
const WALL_DEPTH_M = 3;
/** One window column per this many metres of wall. */
const WINDOW_SPACING_M = 2.6;
const MIN_WINDOW_WALL_M = 1.6;

const toMetres = (ring: number[]): number[] => ring.map((value) => value / UNITS_PER_METRE);

/**
 * Facade style, read by the building shader: 0 house · 1 apartments · 2 glass office ·
 * 3 shops on the ground floor · 4 school / civic · 5 industrial.
 */
export function facadeStyle(building: PackBuilding): number {
  switch (building.use) {
    case 'mall':
    case 'office':
    case 'hotel':
    case 'bank':
      return 2;
    case 'school':
    case 'college':
    case 'clinic':
      return 4;
    case undefined:
      break;
    default:
      return 3; // a shop of some kind: shopfront on the ground floor
  }
  switch (building.kind) {
    case 'house':
      return 0;
    case 'apartments':
      return 1;
    case 'commercial':
      return building.floors >= 3 ? 2 : 3;
    case 'retail':
      return 3;
    case 'civic':
    case 'religious':
      return 4;
    case 'industrial':
    case 'shed':
      return 5;
    default:
      return building.floors >= 4 ? 1 : 0;
  }
}

/** Triangles a building adds: 2 per wall edge + roof (+ underside when it floats). */
export function buildingTriangleEstimate(building: PackBuilding): number {
  let points = building.ring.length / 2;
  let holes = 0;
  for (const hole of building.holes ?? []) {
    points += hole.length / 2;
    holes++;
  }
  const cap = points - 2 + 2 * holes;
  return 2 * points + (building.minH ? 2 * cap : cap);
}

/**
 * Wall quads around one ring. The outward normal of edge (dx, dz) is (dz, -dx) for
 * outer rings (positive area) and, with the same formula, points into the hole for holes.
 * Extra vertex data = (window column, floor) so the shader can draw windows.
 */
function addWalls(
  mesh: MeshBuilder,
  ring: number[],
  yBottom: number,
  yTop: number,
  floorBottom: number,
  floorTop: number,
  color: Rgb,
  style: number,
): void {
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = ring[i];
    const az = ring[i + 1];
    const bx = ring[j];
    const bz = ring[j + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const nx = dz / length;
    const nz = -dx / length;
    const columns = length < MIN_WINDOW_WALL_M ? 0 : Math.max(1, Math.round(length / WINDOW_SPACING_M));
    const a = mesh.addVertex(ax, yBottom, az, nx, 0, nz, color, 0, floorBottom, style);
    const b = mesh.addVertex(bx, yBottom, bz, nx, 0, nz, color, columns, floorBottom, style);
    const c = mesh.addVertex(bx, yTop, bz, nx, 0, nz, color, columns, floorTop, style);
    const d = mesh.addVertex(ax, yTop, az, nx, 0, nz, color, 0, floorTop, style);
    mesh.addTriangle(a, c, b);
    mesh.addTriangle(a, d, c);
  }
}

/** Outline tolerance for far (LOD1) buildings, metres. */
const FAR_SIMPLIFY_M = 1.5;

/**
 * Adds one building (walls + flat roof) to a chunk's building mesh.
 * `far` = the simplified version for far away: rougher outline, no courtyards.
 */
export function appendBuilding(mesh: MeshBuilder, building: PackBuilding, terrain: TerrainGrid, far = false): void {
  const exact = toMetres(building.ring);
  const ring = far ? simplifyRing(exact, FAR_SIMPLIFY_M) : exact;
  const holes = far ? [] : (building.holes ?? []).map(toMetres);

  // Ground level = the lowest ground under the outline; uphill sides are simply buried a little.
  let ground = Infinity;
  for (let i = 0; i < ring.length; i += 2) ground = Math.min(ground, heightAt(terrain, ring[i], ring[i + 1]));

  const minH = building.minH ?? 0;
  const floats = minH > 0;
  const top = ground + building.h;
  const bottom = floats ? ground + minH : ground - WALL_DEPTH_M;
  const floorHeight = (building.h - minH) / building.floors;
  const floorBottom = floats ? 0 : -WALL_DEPTH_M / floorHeight;
  const { wall, roof } = buildingColors(building);

  const style = facadeStyle(building) + 1; // stored +1: 0 means "no facade data"
  addWalls(mesh, ring, bottom, top, floorBottom, building.floors, wall, style);
  for (const hole of holes) addWalls(mesh, hole, bottom, top, floorBottom, building.floors, wall, style);

  // Roof: cut the outline (minus courtyards) into triangles.
  const flat = ring.slice();
  const holeStarts: number[] = [];
  for (const hole of holes) {
    holeStarts.push(flat.length / 2);
    for (const value of hole) flat.push(value);
  }
  const triangles = earcut(flat, holeStarts, 2);
  const addCap = (y: number, up: boolean, color: Rgb): void => {
    const first = mesh.vertexCount;
    for (let i = 0; i < flat.length; i += 2) mesh.addVertex(flat[i], y, flat[i + 1], 0, up ? 1 : -1, 0, color, -1, -1, -1);
    for (let i = 0; i < triangles.length; i += 3) {
      mesh.addTriangleFacing(first + triangles[i], first + triangles[i + 1], first + triangles[i + 2], up);
    }
  };
  addCap(top, true, roof);
  if (floats) addCap(bottom, false, wall);
}
