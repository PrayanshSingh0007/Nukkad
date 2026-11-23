import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, LineKind } from '@nukkad/shared';
import { pointInRing, signedArea } from '../geom/polygon.ts';
import type { Door } from './doors.ts';

/**
 * Bengaluru homes stand behind a compound wall: a low plastered wall across the front yard,
 * with a gate between two pillars, and on the pillars a pair of globe lamps. The map has no
 * plot lines, so we work it out per house:
 * - the front is the wall with the front door (or else the one facing the nearest road);
 * - the wall runs parallel to it across the free space in front (never onto the footpath or
 *   road), with short side walls back to the house corners;
 * - the gate opening (2.6 m) is in front of the door, so you can still walk in;
 * - any piece that would run into another building or a road is left out.
 */

/** Wall pieces: [ax, az, bx, bz, tone] in metres. */
export const HOUSE_WALL_STRIDE = 5;
/** Gate pillars: [x, z, ux, uz, tone] (u = along the wall). */
export const PILLAR_STRIDE = 5;
/** Globe lamps on the pillars: [x, z] (the height is worked out on the pillar). */
export const GATE_LAMP_STRIDE = 2;

export interface HouseCompounds {
  walls: number[];
  pillars: number[];
  lamps: number[];
  /** Posters on the street side of front walls: [x, z, nx, nz, seed] (n = facing the street). */
  posters: number[];
}

const HOME_KINDS = new Set(['house', 'apartments', 'generic']);
const CAR_ROADS = new Set<LineKind>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living', 'service']);
/** Roads that have a footpath on each side (prepare.ts PAVED) and its width. */
const PAVED = new Set<LineKind>(['trunk', 'primary', 'secondary', 'tertiary', 'residential']);
const FOOTPATH_M = 1.6;
const GATE_HALF_M = 1.3;
const PILLAR_HALF_M = 0.22;
const CELL_M = 40;

interface RoadSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Centre line to the far edge of the footpath (or the road edge), metres. */
  reach: number;
}

const hash = (n: number, salt: number): number => {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function houseCompounds(pack: AreaPack, doors: Door[]): HouseCompounds {
  const out: HouseCompounds = { walls: [], pillars: [], lamps: [], posters: [] };
  const metres = (ring: number[]): number[] => ring.map((v) => v / UNITS_PER_METRE);

  // Road segments in a grid.
  const roads: RoadSegment[] = [];
  const roadGrid = new Map<string, number[]>();
  const key = (gx: number, gz: number): string => `${gx},${gz}`;
  for (const line of pack.lines) {
    if (!CAR_ROADS.has(line.kind) || line.b) continue;
    const p = metres(line.pts);
    const reach = line.w / 2 + (PAVED.has(line.kind) && line.w >= 5 ? FOOTPATH_M : 0.4);
    for (let i = 0; i + 3 < p.length; i += 2) {
      const index = roads.push({ ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3], reach }) - 1;
      const x0 = Math.floor((Math.min(p[i], p[i + 2]) - 30) / CELL_M);
      const x1 = Math.floor((Math.max(p[i], p[i + 2]) + 30) / CELL_M);
      const z0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - 30) / CELL_M);
      const z1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + 30) / CELL_M);
      for (let gx = x0; gx <= x1; gx++)
        for (let gz = z0; gz <= z1; gz++) {
          const k = key(gx, gz);
          let cell = roadGrid.get(k);
          if (!cell) roadGrid.set(k, (cell = []));
          cell.push(index);
        }
    }
  }
  /** The nearest road centre point to (x, z), with how far its footpath reaches. */
  const nearestRoad = (x: number, z: number): { x: number; z: number; d: number; reach: number } | null => {
    let best: { x: number; z: number; d: number; reach: number } | null = null;
    for (const index of roadGrid.get(key(Math.floor(x / CELL_M), Math.floor(z / CELL_M))) ?? []) {
      const r = roads[index];
      const dx = r.bx - r.ax;
      const dz = r.bz - r.az;
      const t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz || 1)));
      const px = r.ax + dx * t;
      const pz = r.az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { x: px, z: pz, d, reach: r.reach };
    }
    return best;
  };
  /** Is (x, z) on a road or its footpath? */
  const onRoad = (x: number, z: number): boolean => {
    const r = nearestRoad(x, z);
    return r !== null && r.d < r.reach + 0.2;
  };

  // Buildings in a grid (metres outlines), to keep walls out of the neighbours.
  const rings = pack.buildings.map((b) => metres(b.ring));
  const buildingGrid = new Map<string, number[]>();
  rings.forEach((ring, index) => {
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
    for (let gx = Math.floor(minX / CELL_M); gx <= Math.floor(maxX / CELL_M); gx++)
      for (let gz = Math.floor(minZ / CELL_M); gz <= Math.floor(maxZ / CELL_M); gz++) {
        const k = key(gx, gz);
        let cell = buildingGrid.get(k);
        if (!cell) buildingGrid.set(k, (cell = []));
        cell.push(index);
      }
  });
  const inBuilding = (x: number, z: number, own: number): boolean => {
    for (const index of buildingGrid.get(key(Math.floor(x / CELL_M), Math.floor(z / CELL_M))) ?? []) {
      if (index !== own && pointInRing(x, z, rings[index])) return true;
    }
    return false;
  };
  /** A wall piece is kept only if no point along it is in another building or on a road. */
  const clear = (ax: number, az: number, bx: number, bz: number, own: number): boolean => {
    for (const t of [0.12, 0.35, 0.6, 0.85, 1]) {
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (inBuilding(x, z, own) || onRoad(x, z)) return false;
    }
    return true;
  };

  const doorOf = new Map(doors.map((door) => [door.id, door]));

  pack.buildings.forEach((building, index) => {
    if (building.minH || !HOME_KINDS.has(building.kind) || building.material === 'glass') return;
    const ring = rings[index];
    const area = Math.abs(signedArea(ring));
    if (area < 35 || area > (building.kind === 'house' ? 700 : 350) || building.floors > 5) return;
    const door = doorOf.get(building.id);

    // The front: the edge with the door, or else the one facing a road most closely.
    let front: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; free: number } | null = null;
    let bestScore = Infinity;
    const count = ring.length / 2;
    for (let k = 0; k < count; k++) {
      const ax = ring[k * 2];
      const az = ring[k * 2 + 1];
      const bx = ring[((k + 1) % count) * 2];
      const bz = ring[((k + 1) % count) * 2 + 1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 4.6) continue;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      let nx = (bz - az) / length;
      let nz = -(bx - ax) / length;
      if (pointInRing(mx + nx * 0.3, mz + nz * 0.3, ring)) {
        nx = -nx;
        nz = -nz;
      }
      const road = nearestRoad(mx + nx, mz + nz);
      if (!road || road.d > 30) continue;
      const toX = road.x - mx;
      const toZ = road.z - mz;
      const dist = Math.hypot(toX, toZ);
      if ((toX * nx + toZ * nz) / (dist || 1) < 0.7) continue; // the road is not in front of this wall
      const free = dist - road.reach - 0.35;
      if (free < 1.1) continue; // no front yard: the house stands right on the footpath
      const doorHere = door ? distanceToSegment(door.x, door.z, ax, az, bx, bz) < 0.6 : false;
      const score = dist - (doorHere ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        front = { ax, az, bx, bz, nx, nz, free };
      }
    }
    if (!front) return;

    const { ax, az, bx, bz, nx, nz } = front;
    const length = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;
    const depth = Math.min(3.2, front.free * 0.8) * (0.9 + 0.2 * hash(building.id, 1));
    const tone = Math.floor(hash(building.id, 2) * 6);
    // The gate: in front of the door if it is on this wall, else a little off the middle.
    let at = length * (0.5 + (hash(building.id, 3) - 0.5) * 0.4);
    if (door && distanceToSegment(door.x, door.z, ax, az, bx, bz) < 0.6) at = (door.x - ax) * ux + (door.z - az) * uz;
    at = Math.max(GATE_HALF_M + 0.5, Math.min(length - GATE_HALF_M - 0.5, at));
    const fx = (s: number): number => ax + ux * s + nx * depth;
    const fz = (s: number): number => az + uz * s + nz * depth;
    const pieces: [number, number, number, number][] = [
      [fx(0), fz(0), fx(at - GATE_HALF_M), fz(at - GATE_HALF_M)],
      [fx(at + GATE_HALF_M), fz(at + GATE_HALF_M), fx(length), fz(length)],
      [ax, az, fx(0), fz(0)],
      [bx, bz, fx(length), fz(length)],
    ];
    let kept = 0;
    pieces.forEach(([px, pz, qx, qz], k) => {
      if (Math.hypot(qx - px, qz - pz) < 0.4 || !clear(px, pz, qx, qz, index)) return;
      out.walls.push(px, pz, qx, qz, tone);
      kept++;
      // Posters pasted on the street side of the front walls (the first two pieces).
      const length = Math.hypot(qx - px, qz - pz);
      if (k < 2 && length > 1.4 && hash(building.id, 10 + k) < 0.45) {
        const posters = 1 + Math.floor(hash(building.id, 20 + k) * Math.min(3, length / 1.2));
        for (let j = 0; j < posters; j++) {
          const t = (j + 0.5) / posters + (hash(building.id, 30 + k * 4 + j) - 0.5) * 0.15;
          out.posters.push(px + (qx - px) * t, pz + (qz - pz) * t, nx, nz, hash(building.id, 40 + k * 4 + j));
        }
      }
    });
    if (kept === 0) return;
    // Two pillars either side of the gate, each with a globe lamp.
    for (const side of [-1, 1]) {
      const s = at + side * (GATE_HALF_M + PILLAR_HALF_M);
      const x = fx(s);
      const z = fz(s);
      if (inBuilding(x, z, index) || onRoad(x, z)) continue;
      out.pillars.push(x, z, ux, uz, tone);
      out.lamps.push(x, z);
    }
  });
  return out;
}

function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
