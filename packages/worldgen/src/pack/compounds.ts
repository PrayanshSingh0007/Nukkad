import { UNITS_PER_METRE } from '@nukkad/shared';
import type { PackBuilding, PackCompound, PackLine } from '@nukkad/shared';
import { clipRingToSquare } from '../geom/clip.ts';
import { cleanRing, distToSegment, pointInRing, ringBounds, signedArea } from '../geom/polygon.ts';
import type { NamedComplex } from './places.ts';

/**
 * Gated societies: a named housing area ("Assetz East Point") gets a compound wall along
 * its outline, with openings where roads and paths cross it. The main road in gets the
 * entrance gate (pillars, an arch with the society's real name, a security cabin).
 * The towers inside are the society's own buildings from the map.
 */

const MIN_AREA_M2 = 1500;
const MAX_AREA_M2 = 600_000;
const PIECE_M = 6;
const PATHS = new Set(['footway', 'steps', 'cycleway', 'pedestrian', 'track']);
const NOT_CROSSINGS = new Set(['rail', 'river', 'stream']);
const GATE_KINDS = new Set(['service', 'residential', 'living', 'tertiary', 'unclassified', 'secondary', 'primary']);

interface Crossing {
  edge: number;
  /** Position along the edge, metres from its start. */
  at: number;
  half: number;
  width: number;
  kind: string;
}

/** Where segment a→b crosses c→d: the fraction along a→b, or null. */
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

export function buildCompounds(complexes: NamedComplex[], lines: PackLine[], buildings: PackBuilding[], half: number): PackCompound[] {
  const roads = lines.filter((line) => !NOT_CROSSINGS.has(line.kind)).map((line) => ({ line, pts: line.pts.map((v) => v / UNITS_PER_METRE) }));
  const shapes = buildings.map((b) => {
    const ring = b.ring.map((v) => v / UNITS_PER_METRE);
    return { ring, box: ringBounds(ring), centre: [0, 0] as [number, number] };
  });
  for (const s of shapes) s.centre = [(s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2];
  const inBuilding = (x: number, z: number): boolean =>
    shapes.some((s) => x >= s.box[0] && x <= s.box[2] && z >= s.box[1] && z <= s.box[3] && pointInRing(x, z, s.ring));
  /** Midpoints of wall pieces already placed (neighbouring societies share an outline). */
  const taken = new Map<string, [number, number][]>();
  const isTaken = (x: number, z: number): boolean => {
    const gx = Math.round(x / 3);
    const gz = Math.round(z / 3);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) for (const [px, pz] of taken.get(`${gx + i},${gz + j}`) ?? []) if (Math.hypot(px - x, pz - z) < 1.5) return true;
    return false;
  };
  const take = (x: number, z: number): void => {
    const key = `${Math.round(x / 3)},${Math.round(z / 3)}`;
    const list = taken.get(key) ?? [];
    list.push([x, z]);
    taken.set(key, list);
  };

  const edge = half - 1.5;
  const out: PackCompound[] = [];
  // Small societies first: when two share an outline, the wall belongs to both anyway.
  const sorted = complexes
    .map((complex) => ({ complex, area: Math.abs(signedArea(complex.ring)) }))
    .filter(({ area }) => area >= MIN_AREA_M2 && area <= MAX_AREA_M2)
    .sort((a, b) => a.area - b.area || a.complex.name.localeCompare(b.complex.name));

  for (const { complex } of sorted) {
    const ring = cleanRing(clipRingToSquare(complex.ring, half), 0.2);
    const n = ring.length / 2;
    if (n < 3) continue;
    // Only real compounds: at least two buildings inside.
    let inside = 0;
    for (const s of shapes) if (pointInRing(s.centre[0], s.centre[1], ring)) inside++;
    if (inside < (complex.minBuildings ?? 2)) continue;

    // Edges made by cutting at the world's border are not real walls (and never a gate).
    const onBorder = (e: number): boolean => {
      const ax = ring[e * 2];
      const az = ring[e * 2 + 1];
      const bx = ring[((e + 1) % n) * 2];
      const bz = ring[((e + 1) % n) * 2 + 1];
      return (Math.abs(ax) > edge && Math.abs(bx) > edge && Math.sign(ax) === Math.sign(bx)) || (Math.abs(az) > edge && Math.abs(bz) > edge && Math.sign(az) === Math.sign(bz));
    };
    const crossings: Crossing[] = [];
    for (let e = 0; e < n; e++) {
      if (onBorder(e)) continue;
      const ax = ring[e * 2];
      const az = ring[e * 2 + 1];
      const bx = ring[((e + 1) % n) * 2];
      const bz = ring[((e + 1) % n) * 2 + 1];
      const length = Math.hypot(bx - ax, bz - az);
      for (const { line, pts } of roads) {
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const t = cross(ax, az, bx, bz, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
          if (t === null) continue;
          const path = PATHS.has(line.kind);
          crossings.push({ edge: e, at: t * length, half: path ? 1.1 : line.w / 2 + 1.2, width: line.w, kind: line.kind });
        }
      }
    }
    // The entrance: the widest road crossing the wall. No road in → no wall (never trap anyone).
    const drivable = crossings.filter((c) => GATE_KINDS.has(c.kind));
    if (drivable.length === 0) continue;
    const gateCrossing = drivable.reduce((best, c) => (c.width > best.width ? c : best));
    gateCrossing.half = Math.max(3.5, gateCrossing.width / 2 + 1.5);

    const walls: number[] = [];
    for (let e = 0; e < n; e++) {
      const ax = ring[e * 2];
      const az = ring[e * 2 + 1];
      const bx = ring[((e + 1) % n) * 2];
      const bz = ring[((e + 1) % n) * 2 + 1];
      if (onBorder(e)) continue;
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.5) continue;
      const gaps = crossings.filter((c) => c.edge === e).map((c) => [c.at - c.half, c.at + c.half] as const);
      const pieces = Math.ceil(length / PIECE_M);
      for (let k = 0; k < pieces; k++) {
        // The piece minus every opening that overlaps it.
        let parts: [number, number][] = [[(k * length) / pieces, ((k + 1) * length) / pieces]];
        for (const [g0, g1] of gaps) parts = parts.flatMap(([p0, p1]): [number, number][] => (g1 <= p0 || g0 >= p1 ? [[p0, p1]] : [[p0, Math.max(p0, g0)], [Math.min(p1, g1), p1]]));
        for (const [s0, s1] of parts) {
          if (s1 - s0 < 0.6) continue;
          const px = (s: number): number => ax + ((bx - ax) * s) / length;
          const pz = (s: number): number => az + ((bz - az) * s) / length;
          const mx = px((s0 + s1) / 2);
          const mz = pz((s0 + s1) / 2);
          if (inBuilding(mx, mz) || isTaken(mx, mz)) continue;
          take(mx, mz);
          walls.push(...[px(s0), pz(s0), px(s1), pz(s1)].map((v) => Math.round(v * UNITS_PER_METRE)));
        }
      }
    }

    const e = gateCrossing.edge;
    const ax = ring[e * 2];
    const az = ring[e * 2 + 1];
    const bx = ring[((e + 1) % n) * 2];
    const bz = ring[((e + 1) % n) * 2 + 1];
    const length = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;
    const gx = ax + ux * gateCrossing.at;
    const gz = az + uz * gateCrossing.at;
    // Facing out, towards the street outside.
    let fx = uz;
    let fz = -ux;
    if (pointInRing(gx + fx * 2, gz + fz * 2, ring)) {
      fx = -fx;
      fz = -fz;
    }
    // Near a corner the next edge can run into the gate: keep the whole entrance clear.
    const clear = gateCrossing.half + 1;
    const open: number[] = [];
    for (let i = 0; i + 3 < walls.length; i += 4) {
      const [wax, waz, wbx, wbz] = walls.slice(i, i + 4).map((v) => v / UNITS_PER_METRE);
      if (distToSegment(gx, gz, wax, waz, wbx, wbz) > clear) open.push(...walls.slice(i, i + 4));
    }
    out.push({
      name: complex.name,
      walls: open,
      gate: {
        x: Math.round(gx * UNITS_PER_METRE),
        z: Math.round(gz * UNITS_PER_METRE),
        face: Math.round((Math.atan2(fx, fz) * 180) / Math.PI),
        half: Math.round(gateCrossing.half * UNITS_PER_METRE),
      },
    });
  }
  return out;
}
