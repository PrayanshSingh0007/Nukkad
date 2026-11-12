import { UNITS_PER_METRE } from '@nukkad/shared';
import type { PackBuilding, PackLine } from '@nukkad/shared';
import { clipRingToSquare } from '../geom/clip.ts';
import { cleanRing, distToRing, distToSegment, orientRing, pointInRing, ringBounds, ringCentroid, signedArea } from '../geom/polygon.ts';
import type { Campus } from './places.ts';

/**
 * Named campuses (a school ground, hospital or mall site mapped as an outline). Often the
 * map has the outline but not the building — e.g. GEAR Innovative International School.
 * Then we put a plain generated block on free ground inside the outline (never on a road
 * or another building) so the name has a home. Generated blocks are marked `guessed`.
 */

/** Ids of generated buildings start here, far above OpenStreetMap ids. */
export const GENERATED_ID_BASE = 9_000_000_000_000;

const RESIDENTIAL = new Set(['house', 'apartments', 'shed', 'roof']);
const SIZES: [number, number][] = [
  [42, 15],
  [32, 13],
  [24, 11],
  [16, 9],
];
const FLOORS = 3;
const FLOOR_M = 3.4;

export interface SettledCampus extends Campus {
  /** The building that carries the campus name. */
  buildingId: number;
}

export function settleCampuses(
  campuses: Campus[],
  buildings: PackBuilding[],
  namedBuildings: ReadonlySet<number>,
  lines: PackLine[],
  half: number,
): { campuses: SettledCampus[]; added: PackBuilding[] } {
  // One per name: the largest part (a campus mapped in pieces gets one sign).
  const byName = new Map<string, Campus>();
  for (const campus of campuses) {
    const ring = cleanRing(clipRingToSquare(campus.ring, half - 2), 0.2);
    if (ring.length < 6) continue;
    const clipped = { ...campus, ring: orientRing(ring, true) };
    const old = byName.get(campus.name);
    if (!old || signedArea(clipped.ring) > signedArea(old.ring)) byName.set(campus.name, clipped);
  }

  const shapes = buildings.map((b) => {
    const ring = b.ring.map((v) => v / UNITS_PER_METRE);
    const [cx, cz] = ringCentroid(ring);
    return { b, ring, cx, cz, box: ringBounds(ring), area: Math.abs(signedArea(ring)) };
  });
  const roads = lines
    .filter((l) => l.kind !== 'river' && l.kind !== 'stream')
    .map((l) => ({ w: l.w, pts: l.pts.map((v) => v / UNITS_PER_METRE) }));

  const settled: SettledCampus[] = [];
  const added: PackBuilding[] = [];
  for (const campus of byName.values()) {
    const ring = campus.ring;
    const [mx, mz] = ringCentroid(ring);
    // A real building inside that is not a home and has no name of its own: the nearest to the middle.
    let best: (typeof shapes)[number] | undefined;
    for (const s of shapes) {
      if (RESIDENTIAL.has(s.b.kind) || s.area < 150 || namedBuildings.has(s.b.id) || !pointInRing(s.cx, s.cz, ring)) continue;
      if (!best || Math.hypot(s.cx - mx, s.cz - mz) < Math.hypot(best.cx - mx, best.cz - mz)) best = s;
    }
    if (best) {
      settled.push({ ...campus, buildingId: best.b.id });
      continue;
    }
    const block = findSpot(ring, shapes, roads);
    if (!block) continue;
    const id = GENERATED_ID_BASE + added.length;
    const building: PackBuilding = {
      id,
      kind: 'civic',
      h: FLOORS * FLOOR_M + 0.6,
      floors: FLOORS,
      guessed: 1,
      ring: orientRing(block, true).map((v) => Math.round(v * UNITS_PER_METRE)),
    };
    added.push(building);
    shapes.push({ b: building, ring: block, cx: 0, cz: 0, box: ringBounds(block), area: 0 });
    settled.push({ ...campus, buildingId: id });
  }
  return { campuses: settled, added };
}

/** The biggest rectangle that fits on free ground inside the outline, as close to its middle as possible. */
function findSpot(
  ring: number[],
  shapes: { ring: number[]; box: [number, number, number, number] }[],
  roads: { w: number; pts: number[] }[],
): number[] | null {
  const [minX, minZ, maxX, maxZ] = ringBounds(ring);
  const [mx, mz] = ringCentroid(ring);
  // Line the block up with the outline's longest side.
  let angle = 0;
  let longest = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const length = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    if (length > longest) {
      longest = length;
      angle = Math.atan2(ring[j + 1] - ring[i + 1], ring[j] - ring[i]);
    }
  }
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  const nearRoads = roads.filter((r) => {
    for (let i = 0; i < r.pts.length; i += 2) if (r.pts[i] > minX - 30 && r.pts[i] < maxX + 30 && r.pts[i + 1] > minZ - 30 && r.pts[i + 1] < maxZ + 30) return true;
    return false;
  });
  const nearShapes = shapes.filter((s) => s.box[2] > minX - 5 && s.box[0] < maxX + 5 && s.box[3] > minZ - 5 && s.box[1] < maxZ + 5);
  const spots: [number, number][] = [];
  for (let x = minX; x <= maxX; x += 4) for (let z = minZ; z <= maxZ; z += 4) if (pointInRing(x, z, ring)) spots.push([x, z]);
  spots.sort((a, b) => Math.hypot(a[0] - mx, a[1] - mz) - Math.hypot(b[0] - mx, b[1] - mz));

  for (const [length, depth] of SIZES) {
    for (const [x, z] of spots.slice(0, 400)) {
      const at = (su: number, sf: number): [number, number] => [x + ux * su * length * 0.5 - uz * sf * depth * 0.5, z + uz * su * length * 0.5 + ux * sf * depth * 0.5];
      const samples: [number, number][] = [];
      for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 1) samples.push(at(a, b));
      const fits = samples.every(([px, pz]) => {
        if (!pointInRing(px, pz, ring) || distToRing(px, pz, ring) < 2) return false;
        for (const s of nearShapes) if (distToRing(px, pz, s.ring) < 3 || pointInRing(px, pz, s.ring)) return false;
        for (const r of nearRoads) for (let i = 0; i + 3 < r.pts.length; i += 2) if (distToSegment(px, pz, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]) < r.w / 2 + 2) return false;
        return true;
      });
      // Nothing may poke into the block either (a small building between the samples).
      const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)].flat();
      if (fits && !nearShapes.some((s) => pointInRing(...ringCentroid(s.ring), corners))) return corners;
    }
  }
  return null;
}
