import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, PackBuilding, PlaceKind } from '@nukkad/shared';
import { distToRing, distToSegment, pointInRing, ringCentroid, signedArea } from '../geom/polygon.ts';
import { heightAt } from '../terrain/grid.ts';
import type { MeshBuilder } from '../mesh/meshBuilder.ts';
import type { TerrainGrid } from '../terrain/grid.ts';
import { linear } from '../style/palette.ts';

/**
 * Every building gets one front door, on the wall that faces its nearest street. Walking up to
 * it lets you go inside: the inside is built on the player's device from the building's kind
 * and size (see apps/web/src/world/interiors.ts).
 */
export type InteriorKind = 'home' | 'supermarket' | 'mall' | 'showroom' | 'school' | 'office' | 'food' | 'shop' | 'worship' | 'hotel' | 'clinic' | 'gym' | 'warehouse';

export interface Door {
  /** The building's id (seed for its inside). */
  id: number;
  x: number;
  z: number;
  /** Ground height at the door, metres. */
  y: number;
  /** Radians: the door looks out along (sin, cos). */
  face: number;
  kind: InteriorKind;
  /** Building width along the door wall and depth behind it, metres. */
  w: number;
  d: number;
  floors: number;
  /** Real name from the map, if the building is a named place. */
  name?: string;
  /** Wide glass door (shops) instead of a wooden one. */
  wide: boolean;
}

const BY_PLACE: Partial<Record<PlaceKind, InteriorKind>> = {
  supermarket: 'supermarket',
  grocery: 'supermarket',
  food: 'food',
  cafe: 'food',
  bakery: 'food',
  pharmacy: 'shop',
  clinic: 'clinic',
  salon: 'shop',
  clothes: 'shop',
  mobile: 'shop',
  bank: 'office',
  gym: 'gym',
  school: 'school',
  college: 'school',
  office: 'office',
  hotel: 'hotel',
  mall: 'mall',
  showroom: 'showroom',
  shop: 'shop',
  apartments: 'home',
  worship: 'worship',
};

const BY_BUILDING: Partial<Record<PackBuilding['kind'], InteriorKind>> = {
  house: 'home',
  apartments: 'home',
  commercial: 'office',
  retail: 'shop',
  industrial: 'warehouse',
  civic: 'office',
  religious: 'worship',
  generic: 'home',
};

const MIN_AREA_M2 = 25;
const NO_ROADS = new Set(['rail', 'river', 'stream']);

export function findDoors(pack: AreaPack, terrain: TerrainGrid): Door[] {
  const streets = pack.lines.filter((l) => !NO_ROADS.has(l.kind)).map((l) => l.pts.map((v) => v / UNITS_PER_METRE));
  const places = pack.places.map((p) => ({ place: p, x: p.x / UNITS_PER_METRE, z: p.z / UNITS_PER_METRE }));
  const doors: Door[] = [];
  for (const building of pack.buildings) {
    if (building.minH || building.kind === 'shed' || building.kind === 'roof') continue;
    const ring = building.ring.map((v) => v / UNITS_PER_METRE);
    const area = Math.abs(signedArea(ring));
    if (area < MIN_AREA_M2) continue;
    const [cx, cz] = ringCentroid(ring);

    // The nearest street point.
    let best = Infinity;
    let rx = cx;
    let rz = cz + 1;
    for (const p of streets) {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const d = distToSegment(cx, cz, p[i], p[i + 1], p[i + 2], p[i + 3]);
        if (d >= best) continue;
        best = d;
        const dx = p[i + 2] - p[i];
        const dz = p[i + 3] - p[i + 1];
        const t = Math.max(0, Math.min(1, ((cx - p[i]) * dx + (cz - p[i + 1]) * dz) / (dx * dx + dz * dz || 1)));
        rx = p[i] + dx * t;
        rz = p[i + 1] + dz * t;
      }
    }

    // The wall (long enough for a door) that faces that point best.
    const sign = signedArea(ring) > 0 ? 1 : -1;
    let door: { x: number; z: number; nx: number; nz: number; score: number } | null = null;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const ax = ring[i];
      const az = ring[i + 1];
      const bx = ring[j];
      const bz = ring[j + 1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 2.6) continue;
      const ux = (bx - ax) / length;
      const uz = (bz - az) / length;
      const nx = uz * sign;
      const nz = -ux * sign;
      const t = Math.max(1.2, Math.min(length - 1.2, (rx - ax) * ux + (rz - az) * uz));
      const px = ax + ux * t;
      const pz = az + uz * t;
      const toX = rx - px;
      const toZ = rz - pz;
      const away = Math.hypot(toX, toZ) || 1;
      const facing = (toX * nx + toZ * nz) / away;
      const score = facing * 10 - away * 0.2;
      if (!door || score > door.score) door = { x: px, z: pz, nx, nz, score };
    }
    if (!door) continue;
    // Outward check (the formula above assumes a clean outline).
    if (pointInRing(door.x + door.nx * 0.5, door.z + door.nz * 0.5, ring)) {
      door.nx = -door.nx;
      door.nz = -door.nz;
    }

    // Is it a named/known place? Its sign hangs on this building.
    let kind = BY_BUILDING[building.kind] ?? 'home';
    let name: string | undefined;
    let nearest = 3;
    for (const { place, x, z } of places) {
      if (Math.abs(x - cx) > 80 || Math.abs(z - cz) > 80) continue;
      const d = distToRing(x, z, ring);
      if (d < nearest) {
        nearest = d;
        kind = BY_PLACE[place.kind] ?? kind;
        name = place.real ? place.name : undefined;
      }
    }

    // Size of the inside: the footprint measured along and behind the door wall.
    const ux = -door.nz;
    const uz = door.nx;
    let minU = Infinity;
    let maxU = -Infinity;
    let depth = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const dx = ring[i] - door.x;
      const dz = ring[i + 1] - door.z;
      const u = dx * ux + dz * uz;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      depth = Math.max(depth, -(dx * door.nx + dz * door.nz));
    }
    const wide = kind !== 'home' && kind !== 'worship';
    doors.push({
      id: building.id,
      x: door.x,
      z: door.z,
      y: heightAt(terrain, door.x, door.z),
      face: Math.atan2(door.nx, door.nz),
      kind,
      w: maxU - minU,
      d: depth,
      floors: building.floors,
      ...(name ? { name } : {}),
      wide,
    });
  }
  return doors;
}

const WOOD = linear('#6a4630');
const FRAME = linear('#d8d0bf');
const GLASS = linear('#2c434d');
const STEEL = linear('#9aa1a7');
const HANDLE = linear('#c9b06a');

/** Draws a door on the facade: a wooden door for homes, a glass shop door for the rest. */
export function appendDoor(mesh: MeshBuilder, door: Door): void {
  const nx = Math.sin(door.face);
  const nz = Math.cos(door.face);
  const ux = nz;
  const uz = -nx;
  const half = door.wide ? 1.2 : 0.55;
  const top = door.wide ? 2.6 : 2.15;
  const y = door.y - 0.05;
  const panel = (out: number, h0: number, h1: number, w: number, color: readonly [number, number, number], shift = 0): void => {
    const x = door.x + nx * out + ux * shift;
    const z = door.z + nz * out + uz * shift;
    const a = mesh.addVertex(x - ux * w, y + h0, z - uz * w, nx, 0, nz, color, 0, 0, 0);
    const b = mesh.addVertex(x + ux * w, y + h0, z + uz * w, nx, 0, nz, color, 0, 0, 0);
    const c = mesh.addVertex(x + ux * w, y + h1, z + uz * w, nx, 0, nz, color, 0, 0, 0);
    const d = mesh.addVertex(x - ux * w, y + h1, z - uz * w, nx, 0, nz, color, 0, 0, 0);
    // Wound to face outward (along n).
    mesh.addTriangle(a, b, c);
    mesh.addTriangle(a, c, d);
  };
  panel(0.04, 0, top + 0.18, half + 0.16, door.wide ? STEEL : FRAME); // frame
  panel(0.06, 0, top, half, door.wide ? GLASS : WOOD); // door
  if (door.wide) panel(0.07, 0, top, 0.03, STEEL); // the line between the two glass leaves
  else panel(0.075, 1.0, 1.1, 0.05, HANDLE, half * 0.7); // handle
}
