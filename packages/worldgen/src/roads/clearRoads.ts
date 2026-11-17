import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, LineKind } from '@nukkad/shared';
import { pointInRing } from '../geom/polygon.ts';

/**
 * Keeps the main roads drivable. On the map, things that really stand OVER a road (metro
 * stations, footbridges, toll canopies) are plain building outlines; built on the ground they
 * would wall the road off. Any building whose outline contains a point of a main road's centre
 * line is removed, and so are trees, lamps and benches standing on the carriageway.
 *
 * Runs on the player's device right after the pack is decoded, so the cached packs stay as they
 * are and everyone in the same place gets the same result.
 */
const MAIN = new Set<LineKind>(['motorway', 'trunk', 'primary', 'secondary']);
const STEP_M = 4;

export function clearMainRoads(pack: AreaPack): number {
  const U = UNITS_PER_METRE;
  // Sample points along every main road (pack units).
  const xs: number[] = [];
  const zs: number[] = [];
  const halfWidths: number[] = [];
  for (const line of pack.lines) {
    if (!MAIN.has(line.kind) || line.b) continue; // flyover decks pass above buildings
    for (let i = 0; i + 3 < line.pts.length; i += 2) {
      const ax = line.pts[i];
      const az = line.pts[i + 1];
      const bx = line.pts[i + 2];
      const bz = line.pts[i + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (STEP_M * U)));
      for (let s = 0; s <= steps; s++) {
        xs.push(ax + ((bx - ax) * s) / steps);
        zs.push(az + ((bz - az) * s) / steps);
        halfWidths.push((line.w / 2) * U);
      }
    }
  }
  if (xs.length === 0) return 0;

  // A coarse grid of the sample points, so each building only checks the points near it.
  const CELL = 60 * U;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < xs.length; i++) {
    const key = `${Math.floor(xs[i] / CELL)},${Math.floor(zs[i] / CELL)}`;
    let cell = grid.get(key);
    if (!cell) grid.set(key, (cell = []));
    cell.push(i);
  }

  const before = pack.buildings.length;
  pack.buildings = pack.buildings.filter((building) => {
    if (building.minH) return true; // already floats above the ground
    const ring = building.ring;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]);
      maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]);
      maxZ = Math.max(maxZ, ring[i + 1]);
    }
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        for (const i of grid.get(`${cx},${cz}`) ?? []) {
          if (xs[i] < minX || xs[i] > maxX || zs[i] < minZ || zs[i] > maxZ) continue;
          if (pointInRing(xs[i], zs[i], ring)) return false;
        }
      }
    }
    return true;
  });

  // Trees, lamps and benches on the carriageway.
  for (const kind of Object.keys(pack.points) as (keyof typeof pack.points)[]) {
    const list = pack.points[kind];
    const kept: number[] = [];
    for (let p = 0; p < list.length; p += 2) {
      let onRoad = false;
      const cx = Math.floor(list[p] / CELL);
      const cz = Math.floor(list[p + 1] / CELL);
      for (let gx = cx - 1; gx <= cx + 1 && !onRoad; gx++) {
        for (let gz = cz - 1; gz <= cz + 1 && !onRoad; gz++) {
          for (const i of grid.get(`${gx},${gz}`) ?? []) {
            if (Math.hypot(list[p] - xs[i], list[p + 1] - zs[i]) < halfWidths[i]) {
              onRoad = true;
              break;
            }
          }
        }
      }
      if (!onRoad) kept.push(list[p], list[p + 1]);
    }
    pack.points[kind] = kept;
  }
  return before - pack.buildings.length;
}
