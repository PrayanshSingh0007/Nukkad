import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaKind, AreaPack } from '@nukkad/shared';
import { distToRing, distToSegment, pointInPolygon, pointInRing, ringBounds } from '../geom/polygon.ts';

/**
 * Answers "is this spot free?" quickly, so invented trees and lamps never end
 * up inside a building, on a road or in a lake.
 */

const CELL_M = 25;

interface BuildingShape {
  ring: number[];
}

interface RoadSegment {
  line: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halfWidth: number;
}

interface NoGoArea {
  box: [number, number, number, number];
  ring: number[];
  holes: number[][];
}

/** Ground kinds where we never plant anything. */
const NO_GO_KINDS = new Set<AreaKind>(['water', 'pool', 'pitch', 'playground', 'parking', 'plaza']);

const toMetres = (ring: number[]): number[] => ring.map((value) => value / UNITS_PER_METRE);
const cellKey = (ix: number, iz: number): number => (ix + 512) * 2048 + (iz + 512);

class Grid<T> {
  private readonly cells = new Map<number, T[]>();

  insert(minX: number, minZ: number, maxX: number, maxZ: number, item: T): void {
    for (let ix = Math.floor(minX / CELL_M); ix <= Math.floor(maxX / CELL_M); ix++) {
      for (let iz = Math.floor(minZ / CELL_M); iz <= Math.floor(maxZ / CELL_M); iz++) {
        const key = cellKey(ix, iz);
        const list = this.cells.get(key);
        if (list) list.push(item);
        else this.cells.set(key, [item]);
      }
    }
  }

  at(x: number, z: number): T[] {
    return this.cells.get(cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M))) ?? [];
  }
}

/** The widest margin any caller asks for; shapes are indexed this much larger than they are. */
const MAX_MARGIN_M = 3;

export class Occupancy {
  private readonly buildings = new Grid<BuildingShape>();
  private readonly roads = new Grid<RoadSegment>();
  private readonly noGo: NoGoArea[] = [];
  private readonly half: number;

  constructor(pack: AreaPack) {
    this.half = pack.halfSize;
    for (const building of pack.buildings) {
      if (building.minH) continue; // you can stand under a canopy
      const ring = toMetres(building.ring);
      const [minX, minZ, maxX, maxZ] = ringBounds(ring);
      this.buildings.insert(minX - MAX_MARGIN_M, minZ - MAX_MARGIN_M, maxX + MAX_MARGIN_M, maxZ + MAX_MARGIN_M, { ring });
    }
    for (const [lineIndex, line] of pack.lines.entries()) {
      const pts = toMetres(line.pts);
      const reach = line.w / 2 + MAX_MARGIN_M;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const segment = { line: lineIndex, ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3], halfWidth: line.w / 2 };
        this.roads.insert(
          Math.min(segment.ax, segment.bx) - reach,
          Math.min(segment.az, segment.bz) - reach,
          Math.max(segment.ax, segment.bx) + reach,
          Math.max(segment.az, segment.bz) + reach,
          segment,
        );
      }
    }
    for (const area of pack.areas) {
      if (!NO_GO_KINDS.has(area.kind)) continue;
      const ring = toMetres(area.ring);
      this.noGo.push({ box: ringBounds(ring), ring, holes: (area.holes ?? []).map(toMetres) });
    }
  }

  /** How many different roads/paths cover this spot (2 or more = a junction). */
  roadsAt(x: number, z: number, margin: number): number {
    const lines = new Set<number>();
    for (const road of this.roads.at(x, z)) {
      if (distToSegment(x, z, road.ax, road.az, road.bx, road.bz) < road.halfWidth + margin) lines.add(road.line);
    }
    return lines.size;
  }

  /** True when the spot is outside the area, in/near a building, on/near a road, or in a no-go area. */
  isBlocked(x: number, z: number, buildingMargin: number, roadMargin: number): boolean {
    const limit = this.half - 2;
    if (Math.abs(x) > limit || Math.abs(z) > limit) return true;
    for (const building of this.buildings.at(x, z)) {
      if (pointInRing(x, z, building.ring) || distToRing(x, z, building.ring) < buildingMargin) return true;
    }
    for (const road of this.roads.at(x, z)) {
      if (distToSegment(x, z, road.ax, road.az, road.bx, road.bz) < road.halfWidth + roadMargin) return true;
    }
    for (const area of this.noGo) {
      const [minX, minZ, maxX, maxZ] = area.box;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (pointInPolygon(x, z, area.ring, area.holes)) return true;
    }
    return false;
  }
}
