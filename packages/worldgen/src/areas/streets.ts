import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack } from '@nukkad/shared';

/** A named road's centre line in metres, for "which street am I on?". */
export interface NamedRoad {
  name: string;
  /** Width in metres. */
  w: number;
  pts: number[];
}

/** Every named road in the pack (names come from OpenStreetMap). */
export function namedRoads(pack: AreaPack): NamedRoad[] {
  return pack.lines.filter((line) => line.n).map((line) => ({ name: line.n as string, w: line.w, pts: line.pts.map((v) => v / UNITS_PER_METRE) }));
}

const CELL_M = 40;
const MARGIN_M = 5;

/**
 * Finds the named road under a point: a centre line within half its width plus a few metres
 * (so pavements count); where roads meet, the wider one. Segments are binned in a 40 m grid, so a lookup only checks
 * the few nearby.
 */
export class StreetFinder {
  private readonly grid = new Map<string, number[]>();
  private readonly segments: { ax: number; az: number; bx: number; bz: number; reach: number; name: string }[] = [];

  constructor(roads: NamedRoad[]) {
    for (const road of roads) {
      for (let i = 0; i + 3 < road.pts.length; i += 2) {
        const segment = { ax: road.pts[i], az: road.pts[i + 1], bx: road.pts[i + 2], bz: road.pts[i + 3], reach: road.w / 2 + MARGIN_M, name: road.name };
        const index = this.segments.push(segment) - 1;
        const x0 = Math.floor((Math.min(segment.ax, segment.bx) - segment.reach) / CELL_M);
        const x1 = Math.floor((Math.max(segment.ax, segment.bx) + segment.reach) / CELL_M);
        const z0 = Math.floor((Math.min(segment.az, segment.bz) - segment.reach) / CELL_M);
        const z1 = Math.floor((Math.max(segment.az, segment.bz) + segment.reach) / CELL_M);
        for (let gx = x0; gx <= x1; gx++)
          for (let gz = z0; gz <= z1; gz++) {
            const key = `${gx},${gz}`;
            let cell = this.grid.get(key);
            if (!cell) this.grid.set(key, (cell = []));
            cell.push(index);
          }
      }
    }
  }

  /** The street at (x, z) in metres, or null when you are not on a named road. */
  at(x: number, z: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const index of this.grid.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`) ?? []) {
      const s = this.segments[index];
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
      // At a junction the wider road wins (you are on the main road, not the side street).
      const score = d - s.reach * 0.5;
      if (d <= s.reach && score < bestD) {
        bestD = score;
        best = s.name;
      }
    }
    return best;
  }
}
