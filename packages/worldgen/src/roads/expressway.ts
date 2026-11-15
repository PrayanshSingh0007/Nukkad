import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, PackLine } from '@nukkad/shared';
import { distToSegment, ringCentroid } from '../geom/polygon.ts';

/**
 * A new elevated expressway across the area, like Bengaluru's elevated tollways: a long, straight,
 * wide deck on pillars with a ramp down to the ground at each end. It is ours (not on the map),
 * named "Nukkad Expressway", and made for driving fast: traffic mostly stays off it.
 *
 * It is added to the Area Pack on the player's device before anything is built, so the road,
 * deck, pillars, collisions, traffic and map all come from the usual flyover code (`b: 1`).
 * Seeded by the area, so everyone in the same place gets the same road. Buildings, trees, lamps,
 * benches, gated-society walls and places right under its path are cleared, as for real road works.
 */
export const EXPRESSWAY_ID = 900_000_001;
const WIDTH_M = 20; // four lanes plus shoulders
const CLEAR_M = WIDTH_M / 2 + 4;
const EDGE_M = 45; // stays this far inside the area
const STEP_M = 8;
const ANGLES = 16;

export function addExpressway(pack: AreaPack): void {
  if (pack.lines.some((line) => line.id === EXPRESSWAY_ID)) return;
  const half = pack.halfSize - EDGE_M;
  if (half < 200) return; // too small an area for a fast road
  const U = UNITS_PER_METRE;

  // Building centres (metres) with heights, to choose the line that clears the least.
  const centres = pack.buildings.map((b) => {
    const ring = b.ring.map((v) => v / U);
    const [x, z] = ringCentroid(ring);
    return { x, z, cost: Math.max(3, b.h) };
  });

  // Try straight lines through points near the middle, at many angles; keep the cheapest.
  let best: { ax: number; az: number; bx: number; bz: number; cost: number } | null = null;
  for (let a = 0; a < ANGLES; a++) {
    const angle = (a / ANGLES) * Math.PI;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    for (const shift of [-120, -60, 0, 60, 120]) {
      const ox = -dz * shift;
      const oz = dx * shift;
      // From one side of the square to the other.
      const t = Math.min(dx !== 0 ? half / Math.abs(dx) : Infinity, dz !== 0 ? half / Math.abs(dz) : Infinity);
      const ax = ox - dx * t;
      const az = oz - dz * t;
      const bx = ox + dx * t;
      const bz = oz + dz * t;
      if ([ax, az, bx, bz].some((v) => Math.abs(v) > half)) continue;
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 500) continue;
      let cost = 0;
      for (const c of centres) if (distToSegment(c.x, c.z, ax, az, bx, bz) < CLEAR_M + 6) cost += c.cost;
      // Longer is better: fewer buildings per metre of fast road.
      cost = cost / length;
      if (!best || cost < best.cost) best = { ax, az, bx, bz, cost };
    }
  }
  if (!best) return;
  const { ax, az, bx, bz } = best;
  const near = (x: number, z: number, extra = 0): boolean => distToSegment(x, z, ax, az, bx, bz) < CLEAR_M + extra;

  // Clear the way.
  pack.buildings = pack.buildings.filter((b) => {
    for (let i = 0; i < b.ring.length; i += 2) if (near(b.ring[i] / U, b.ring[i + 1] / U)) return false;
    const [cx, cz] = ringCentroid(b.ring.map((v) => v / U));
    return !near(cx, cz);
  });
  for (const kind of Object.keys(pack.points) as (keyof typeof pack.points)[]) {
    const list = pack.points[kind];
    const kept: number[] = [];
    for (let i = 0; i < list.length; i += 2) if (!near(list[i] / U, list[i + 1] / U, 2)) kept.push(list[i], list[i + 1]);
    pack.points[kind] = kept;
  }
  pack.places = pack.places.filter((p) => !near(p.x / U, p.z / U));
  if (pack.compounds) {
    for (const compound of pack.compounds) {
      const kept: number[] = [];
      for (let i = 0; i + 3 < compound.walls.length; i += 4) {
        const w = compound.walls;
        if (!near(w[i] / U, w[i + 1] / U) && !near(w[i + 2] / U, w[i + 3] / U)) kept.push(w[i], w[i + 1], w[i + 2], w[i + 3]);
      }
      compound.walls = kept;
    }
  }

  // The road itself: points every few metres (traffic and the ramp profile use them).
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.ceil(length / STEP_M));
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(Math.round((ax + (bx - ax) * t) * U), Math.round((az + (bz - az) * t) * U));
  }
  const line: PackLine = { id: EXPRESSWAY_ID, kind: 'motorway', w: WIDTH_M, pts, b: 1, n: 'Nukkad Expressway' };
  pack.lines.push(line);
}
