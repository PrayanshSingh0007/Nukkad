import { UNITS_PER_METRE } from '@nukkad/shared';
import type { BuildingKind, PackBuilding } from '@nukkad/shared';
import { cleanRing, orientRing, pointInRing, ringBounds, ringCentroid, signedArea } from '../geom/polygon.ts';
import { parseColour, parseMaterial } from './colours.ts';
import { HEIGHT_FIXES } from './heightFixes.ts';
import type { HeightFixes } from './heightFixes.ts';
import { buildingHeight, heightFromFloors } from './heights.ts';
import type { BuildingHeight } from './heights.ts';
import type { OsmTags } from './osmTypes.ts';
import { buildingKind } from './tags.ts';

const MIN_BUILDING_M2 = 3;
/** A guessed apartment block looks at mapped apartment buildings this close… */
const NEIGHBOUR_RADIUS_M = 300;
/** …and copies them only when at least this many have a known height. */
const MIN_NEIGHBOURS = 2;

/** A building outline in local metres, before heights are decided. */
export interface BuildingDraft {
  id: number;
  tags: OsmTags;
  ring: number[];
  holes: number[][];
  areaM2: number;
}

/** Rounds a ring to pack units (decimetres) and removes points that collapsed together. */
export function quantizeRing(ring: number[]): number[] {
  return cleanRing(
    ring.map((value) => Math.round(value * UNITS_PER_METRE)),
    0.5,
  );
}

/** Cleans an outline. Returns null for junk and for buildings whose centre is outside the area. */
export function draftBuilding(
  id: number,
  tags: OsmTags,
  outer: number[],
  holes: number[][],
  half: number,
): BuildingDraft | null {
  const ring = orientRing(cleanRing(outer, 0.05), true);
  if (ring.length < 6) return null;
  const cleanHoles = holes.map((hole) => orientRing(cleanRing(hole, 0.05), false)).filter((hole) => hole.length >= 6);
  let areaM2 = signedArea(ring);
  for (const hole of cleanHoles) areaM2 += signedArea(hole); // holes have negative area
  if (areaM2 < MIN_BUILDING_M2) return null;
  const [cx, cz] = ringCentroid(ring);
  if (Math.abs(cx) > half || Math.abs(cz) > half) return null;
  return { id, tags, ring, holes: cleanHoles, areaM2 };
}

/** Map tags with one of our own height fixes written over them. */
function withFix(tags: OsmTags, fixes: HeightFixes, id: number): OsmTags {
  const fix = fixes[id];
  if (!fix) return tags;
  const fixed = { ...tags };
  delete fixed.height;
  delete fixed['building:height'];
  delete fixed['building:levels'];
  if (fix.height !== undefined) fixed.height = String(fix.height);
  else if (fix.levels !== undefined) fixed['building:levels'] = String(fix.levels);
  return fixed;
}

/**
 * Turns drafts into pack buildings.
 * - "Simple 3D buildings" rule: when detailed parts exist inside an outline, the
 *   parts are drawn and the plain outline is not (otherwise they would overlap).
 * - Our own height fixes win over map tags.
 * - Apartment blocks without a height copy the typical floor count of mapped
 *   apartment buildings nearby (a housing complex is usually built to one height).
 */
export function finishBuildings(
  outlines: BuildingDraft[],
  parts: BuildingDraft[],
  fixes: HeightFixes = HEIGHT_FIXES,
): PackBuilding[] {
  const replaced = new Set<BuildingDraft>();
  const parentOf = new Map<BuildingDraft, BuildingDraft>();
  const boxes = outlines.map((outline) => ringBounds(outline.ring));
  for (const part of parts) {
    const [px, pz] = ringCentroid(part.ring);
    for (let i = 0; i < outlines.length; i++) {
      const [minX, minZ, maxX, maxZ] = boxes[i];
      if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;
      if (!pointInRing(px, pz, outlines[i].ring)) continue;
      replaced.add(outlines[i]);
      parentOf.set(part, outlines[i]);
      break;
    }
  }

  interface Item {
    draft: BuildingDraft;
    kind: BuildingKind;
    height: BuildingHeight;
    centre: [number, number];
  }
  const items: Item[] = [];
  const add = (draft: BuildingDraft, parent?: BuildingDraft): void => {
    let kind = buildingKind(draft.tags);
    if (kind === 'generic' && parent) kind = buildingKind(parent.tags);
    const height = buildingHeight(withFix(draft.tags, fixes, draft.id), kind, draft.areaM2, draft.id);
    items.push({ draft, kind, height, centre: ringCentroid(draft.ring) });
  };
  for (const outline of outlines) if (!replaced.has(outline)) add(outline);
  for (const part of parts) add(part, parentOf.get(part));

  // Guessed apartment blocks copy the middle floor count of known apartment buildings nearby.
  const known = items.filter((item) => item.kind === 'apartments' && !item.height.guessed);
  for (const item of items) {
    if (item.kind !== 'apartments' || !item.height.guessed) continue;
    const floors = known
      .filter((other) => Math.hypot(other.centre[0] - item.centre[0], other.centre[1] - item.centre[1]) <= NEIGHBOUR_RADIUS_M)
      .map((other) => other.height.floors)
      .sort((a, b) => a - b);
    if (floors.length >= MIN_NEIGHBOURS) item.height = heightFromFloors(floors[Math.floor(floors.length / 2)]);
  }

  const result: PackBuilding[] = [];
  for (const { draft, kind, height } of items) {
    const ring = quantizeRing(draft.ring);
    if (ring.length < 6) continue;
    const building: PackBuilding = { id: draft.id, kind, h: height.h, floors: height.floors, ring };
    if (height.minH > 0) building.minH = height.minH;
    if (height.guessed) building.guessed = 1;
    const colour = parseColour(draft.tags['building:colour']);
    const roofColour = parseColour(draft.tags['roof:colour']);
    const material = parseMaterial(draft.tags['building:material']);
    if (colour) building.colour = colour;
    if (roofColour) building.roofColour = roofColour;
    if (material) building.material = material;
    const holes = draft.holes.map(quantizeRing).filter((hole) => hole.length >= 6);
    if (holes.length > 0) building.holes = holes;
    result.push(building);
  }
  return result;
}
