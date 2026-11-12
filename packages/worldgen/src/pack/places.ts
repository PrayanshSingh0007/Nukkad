import { UNITS_PER_METRE, hash01, hash32 } from '@nukkad/shared';
import { cleanPlaceName } from '@nukkad/shared';
import type { PackBuilding, PackCompound, PackLine, PackPlace, PlaceKind } from '@nukkad/shared';
import { GATE_ARCH_BOTTOM, GATE_ARCH_HALF_DEPTH, GATE_ARCH_TOP } from '../buildings/compoundMesh.ts';
import { distToSegment, pointInRing, ringCentroid, signedArea } from '../geom/polygon.ts';
import type { OsmTags } from './osmTypes.ts';

/** How many signs one area may have (the sign picture holds 120 names). */
export const MAX_PLACES = 120;

const SHOPS: Record<string, PlaceKind> = {
  supermarket: 'supermarket',
  convenience: 'grocery',
  greengrocer: 'grocery',
  general: 'grocery',
  seafood: 'grocery',
  butcher: 'grocery',
  dairy: 'grocery',
  bakery: 'bakery',
  pastry: 'bakery',
  confectionery: 'bakery',
  clothes: 'clothes',
  tailor: 'clothes',
  shoes: 'clothes',
  fashion: 'clothes',
  boutique: 'clothes',
  mobile_phone: 'mobile',
  electronics: 'mobile',
  computer: 'mobile',
  hairdresser: 'salon',
  beauty: 'salon',
  car: 'showroom',
  motorcycle: 'showroom',
  mall: 'mall',
  department_store: 'mall',
};

const AMENITIES: Record<string, PlaceKind> = {
  restaurant: 'food',
  fast_food: 'food',
  food_court: 'food',
  cafe: 'cafe',
  ice_cream: 'cafe',
  pharmacy: 'pharmacy',
  clinic: 'clinic',
  doctors: 'clinic',
  dentist: 'clinic',
  hospital: 'clinic',
  bank: 'bank',
  school: 'school',
  kindergarten: 'school',
  college: 'college',
  university: 'college',
};

const BUILDINGS: Record<string, PlaceKind> = {
  supermarket: 'supermarket',
  school: 'school',
  kindergarten: 'school',
  college: 'college',
  university: 'college',
  office: 'office',
  hotel: 'hotel',
  hospital: 'clinic',
  apartments: 'apartments',
  residential: 'apartments',
  temple: 'worship',
  church: 'worship',
  mosque: 'worship',
};

/** A place the map knows: its kind and (when it has one) its real name. */
export interface KnownPlace {
  kind: PlaceKind;
  name?: string;
}

/** Map tags → a known place. Apartments and places of worship only count when they have a name. */
export function knownPlace(tags: OsmTags): KnownPlace | null {
  const kind = tags.amenity === 'place_of_worship' ? 'worship' : classifyPlace(tags);
  if (!kind) return null;
  const name = cleanPlaceName(tags['name:en'] ?? tags.name);
  if ((kind === 'apartments' || kind === 'worship') && !name) return null;
  return name ? { kind, name } : { kind };
}

/** Map tags → the kind of place. Only the KIND is kept; names and brands are never read. */
export function classifyPlace(tags: OsmTags): PlaceKind | null {
  if (tags.shop) return SHOPS[tags.shop] ?? 'shop';
  if (tags.amenity && AMENITIES[tags.amenity]) return AMENITIES[tags.amenity];
  if (tags.healthcare) return 'clinic';
  if (tags.office) return 'office';
  if (tags.tourism === 'hotel' || tags.tourism === 'guest_house' || tags.tourism === 'hostel') return 'hotel';
  if (tags.leisure === 'fitness_centre' || tags.leisure === 'sports_centre') return 'gym';
  return (tags.building ? BUILDINGS[tags.building] : undefined) ?? null;
}

/** What invented street shops are, roughly as common as on a Bengaluru street. */
const STREET_MIX: [PlaceKind, number][] = [
  ['grocery', 20],
  ['food', 20],
  ['clothes', 10],
  ['shop', 10],
  ['bakery', 8],
  ['pharmacy', 8],
  ['salon', 8],
  ['mobile', 8],
  ['cafe', 8],
];
const MIX_TOTAL = STREET_MIX.reduce((sum, [, weight]) => sum + weight, 0);

function pickStreetKind(seed: number): PlaceKind {
  let roll = hash01(seed, 81) * MIX_TOTAL;
  for (const [kind, weight] of STREET_MIX) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return 'shop';
}

interface Candidate {
  building: PackBuilding;
  ring: number[];
  cx: number;
  cz: number;
  area: number;
  /** Distance to the nearest street, and the closest point on it. */
  road: number;
  roadX: number;
  roadZ: number;
  kind?: PlaceKind;
  real?: boolean;
  name?: string;
}

const BUSY_ROADS = new Set(['primary', 'secondary', 'tertiary']);

export interface PointPlace {
  kind: PlaceKind;
  name?: string;
  x: number;
  z: number;
}

/** A named housing complex (an area on the map, e.g. a gated society). */
export interface NamedComplex {
  name: string;
  /** Outline in metres. */
  ring: number[];
}

/**
 * Decides which buildings are places and where their signs hang.
 * 1. Places the map knows (building tags and point tags).
 * 2. Invented ones, seeded: shops and offices in commercial buildings, ground-floor shops
 *    along busy streets, and — if the map has none — one mall, one vehicle showroom and
 *    one supermarket, so every area has them.
 */
export function buildPlaces(
  buildings: PackBuilding[],
  tagged: ReadonlyMap<number, KnownPlace>,
  points: PointPlace[],
  lines: PackLine[],
  half: number,
  complexes: NamedComplex[] = [],
  compounds: PackCompound[] = [],
): PackPlace[] {
  const streets = lines
    .filter((line) => line.kind !== 'rail' && line.kind !== 'river' && line.kind !== 'stream' && line.kind !== 'footway' && line.kind !== 'steps')
    .map((line) => ({ pts: line.pts.map((v) => v / UNITS_PER_METRE), busy: BUSY_ROADS.has(line.kind) }));

  const nearestStreet = (x: number, z: number, busyOnly: boolean): [number, number, number] => {
    let best = Infinity;
    let bx = x;
    let bz = z;
    for (const street of streets) {
      if (busyOnly && !street.busy) continue;
      const p = street.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const d = distToSegment(x, z, p[i], p[i + 1], p[i + 2], p[i + 3]);
        if (d < best) {
          best = d;
          const dx = p[i + 2] - p[i];
          const dz = p[i + 3] - p[i + 1];
          const t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / (dx * dx + dz * dz || 1)));
          bx = p[i] + dx * t;
          bz = p[i + 1] + dz * t;
        }
      }
    }
    return [best, bx, bz];
  };

  const limit = half - 20;
  const candidates: Candidate[] = [];
  for (const building of buildings) {
    const known = tagged.get(building.id);
    if (building.minH || building.kind === 'shed' || building.kind === 'roof' || (building.kind === 'religious' && !known)) continue;
    const ring = building.ring.map((v) => v / UNITS_PER_METRE);
    const [cx, cz] = ringCentroid(ring);
    if (Math.abs(cx) > limit || Math.abs(cz) > limit) continue;
    const [road, roadX, roadZ] = nearestStreet(cx, cz, false);
    const candidate: Candidate = { building, ring, cx, cz, area: Math.abs(signedArea(ring)), road, roadX, roadZ };
    if (known) Object.assign(candidate, { kind: known.kind, name: known.name, real: true });
    candidates.push(candidate);
  }

  // Point places (a shop mapped as a dot): give them to the building they are in, or the nearest one.
  for (const point of points) {
    let target: Candidate | undefined = candidates.find((c) => !c.kind && pointInRing(point.x, point.z, c.ring));
    if (!target) {
      let best = 25;
      for (const c of candidates) {
        const d = Math.hypot(c.cx - point.x, c.cz - point.z);
        if (!c.kind && d < best) {
          best = d;
          target = c;
        }
      }
    }
    if (target) Object.assign(target, { kind: point.kind, name: point.name, real: true });
  }

  // Named housing complexes ("Assetz East Point"): a free-standing gate board by the road,
  // in front of the complex building closest to the road (even if that building has its own name).
  const gates: PackPlace[] = [];
  // Walled societies: the name board sits on the front of the gate arch.
  for (const compound of compounds) {
    const { x, z, face, half: gateHalf } = compound.gate;
    const a = (face * Math.PI) / 180;
    const out = (GATE_ARCH_HALF_DEPTH + 0.03) * UNITS_PER_METRE;
    const width = Math.min((gateHalf / UNITS_PER_METRE) * 2 + 0.6, 1.6 + compound.name.length * 0.28, 7.5);
    gates.push({
      kind: 'apartments',
      x: Math.round(x + Math.sin(a) * out),
      z: Math.round(z + Math.cos(a) * out),
      y: Math.round((GATE_ARCH_BOTTOM + (GATE_ARCH_TOP - GATE_ARCH_BOTTOM - width / 5.33) / 2) * 10),
      face,
      w: Math.round(width * UNITS_PER_METRE),
      seed: hash32(x, z),
      real: 1,
      name: compound.name,
    });
  }
  const walled = new Set(compounds.map((compound) => compound.name));
  for (const complex of complexes) {
    if (walled.has(complex.name)) continue;
    let best: Candidate | undefined;
    for (const c of candidates) {
      if (!pointInRing(c.cx, c.cz, complex.ring)) continue;
      if (!best || c.road < best.road) best = c;
    }
    if (!best || best.road > 60) continue;
    const dx = best.cx - best.roadX;
    const dz = best.cz - best.roadZ;
    const d = Math.hypot(dx, dz) || 1;
    const x = best.roadX + (dx / d) * Math.min(4, d * 0.4);
    const z = best.roadZ + (dz / d) * Math.min(4, d * 0.4);
    gates.push({
      kind: 'apartments',
      x: Math.round(x * UNITS_PER_METRE),
      z: Math.round(z * UNITS_PER_METRE),
      y: 22, // a board on posts, 2.2 m up
      face: Math.round((Math.atan2(-dx, -dz) * 180) / Math.PI), // looking at the road
      w: Math.round(Math.min(7, 1.6 + complex.name.length * 0.28) * UNITS_PER_METRE),
      seed: hash32(best.building.id, 85),
      real: 1,
      name: complex.name,
    });
  }

  // Invented: every area gets a mall, a vehicle showroom and a supermarket if the map has none.
  const has = (kind: PlaceKind): boolean => candidates.some((c) => c.kind === kind);
  const free = (): Candidate[] => candidates.filter((c) => !c.kind && c.building.kind !== 'house' && c.building.kind !== 'apartments' && c.building.kind !== 'civic');
  const invent = (kind: PlaceKind, minArea: number, maxArea: number, score: (c: Candidate) => number): void => {
    if (has(kind)) return;
    const pool = free().filter((c) => c.area >= minArea && c.area <= maxArea && c.road < 40);
    pool.sort((a, b) => score(a) - score(b) || a.building.id - b.building.id);
    if (pool[0]) Object.assign(pool[0], { kind, real: false });
  };
  invent('mall', 900, Infinity, (c) => -c.area);
  invent('showroom', 200, 1500, (c) => nearestStreet(c.cx, c.cz, true)[0]);
  invent('supermarket', 250, 2000, (c) => c.road);

  // Invented: shops and offices in commercial buildings, ground-floor shops on busy streets.
  for (const c of candidates) {
    if (c.kind) continue;
    const seed = c.building.id;
    const type = c.building.kind;
    if (type === 'retail') Object.assign(c, { kind: pickStreetKind(seed), real: false });
    else if (type === 'commercial') Object.assign(c, { kind: c.area > 400 && hash01(seed, 82) < 0.6 ? 'office' : pickStreetKind(seed), real: false });
    else if ((type === 'generic' || type === 'house') && c.area >= 40 && c.area <= 400 && c.road < 14) {
      const busy = nearestStreet(c.cx, c.cz, true)[0] < 16;
      if (hash01(seed, 83) < (busy ? 0.45 : 0.06)) Object.assign(c, { kind: pickStreetKind(seed), real: false });
    }
  }

  // Real places first, then the big ones, then nearest to the centre — and cap the count.
  const chosen = candidates.filter((c) => c.kind);
  // Named real places and the three must-haves (mall, showroom, supermarket) always get a sign.
  const mustHave = (c: Candidate): boolean => !c.real && (c.kind === 'mall' || c.kind === 'showroom' || c.kind === 'supermarket');
  const rank = (c: Candidate): number => (mustHave(c) || (c.real && c.name) ? 0 : c.real ? 1 : 2);
  chosen.sort((a, b) => rank(a) - rank(b) || Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz) || a.building.id - b.building.id);

  const places: PackPlace[] = [...gates.slice(0, 20)];
  for (const c of chosen.slice(0, MAX_PLACES - places.length)) {
    const sign = signSpot(c);
    if (!sign) continue;
    c.building.use = c.kind;
    const big = c.kind === 'mall' || c.kind === 'supermarket' || c.kind === 'showroom';
    const width = Math.min(sign.length * 0.75, big ? 7 : 4.2);
    places.push({
      kind: c.kind as PlaceKind,
      x: Math.round(sign.x * UNITS_PER_METRE),
      z: Math.round(sign.z * UNITS_PER_METRE),
      y: Math.round(Math.min(3.4, c.building.h - 0.6 - width / 8) * UNITS_PER_METRE),
      face: Math.round((Math.atan2(sign.nx, sign.nz) * 180) / Math.PI),
      w: Math.round(width * UNITS_PER_METRE),
      seed: hash32(c.building.id, 84),
      real: c.real ? 1 : 0,
      ...(c.real && c.name ? { name: c.name } : {}),
    });
  }
  return places;
}

/** The wall a sign hangs on: the one that looks at the nearest street. */
function signSpot(c: Candidate): { x: number; z: number; nx: number; nz: number; length: number } | null {
  const ring = c.ring;
  const n = ring.length;
  let best: { x: number; z: number; nx: number; nz: number; length: number } | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const dx = ring[j] - ring[i];
    const dz = ring[j + 1] - ring[i + 1];
    const length = Math.hypot(dx, dz);
    if (length < 2.6) continue;
    const nx = dz / length; // outward (rings have positive area)
    const nz = -dx / length;
    const mx = (ring[i] + ring[j]) / 2;
    const mz = (ring[i + 1] + ring[j + 1]) / 2;
    const score = Math.hypot(mx + nx * 3 - c.roadX, mz + nz * 3 - c.roadZ) - Math.min(length, 8) * 0.3;
    if (score < bestScore) {
      bestScore = score;
      best = { x: mx + nx * 0.15, z: mz + nz * 0.15, nx, nz, length };
    }
  }
  return best;
}
