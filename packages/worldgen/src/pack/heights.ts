import { hash32 } from '@nukkad/shared';
import type { BuildingKind } from '@nukkad/shared';
import type { OsmTags } from './osmTypes.ts';
import { parseMetres } from './tags.ts';

export const FLOOR_M = 3.0;
const ROOF_EXTRA_M = 0.5;

export interface BuildingHeight {
  /** Top above ground, metres. */
  h: number;
  /** Underside above ground, metres (0 = stands on the ground). */
  minH: number;
  floors: number;
  guessed: boolean;
}

/** Floors we assume when the map says what a building is but not how tall. 0 = fixed height below. */
const GUESSED_FLOORS: Record<BuildingKind, number> = {
  house: 2,
  apartments: 5,
  commercial: 5,
  retail: 1,
  civic: 3,
  industrial: 0,
  shed: 0,
  roof: 0,
  religious: 0,
  generic: 0,
};

const FIXED_HEIGHT_M: Partial<Record<BuildingKind, number>> = { industrial: 8, shed: 3, roof: 4, religious: 9 };

/** The height of a building we decided has this many floors (still counted as a guess). */
export function heightFromFloors(floors: number, minH = 0): BuildingHeight {
  const h = Math.max(1, floors) * FLOOR_M + ROOF_EXTRA_M;
  return { h: Math.round(h * 10) / 10, minH, floors: Math.max(1, Math.round((h - minH) / FLOOR_M)), guessed: true };
}

function floorsByFootprint(areaM2: number): number {
  if (areaM2 < 40) return 1;
  if (areaM2 < 150) return 2;
  if (areaM2 < 400) return 3;
  if (areaM2 < 1500) return 4;
  return 5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Building height, first match wins (PLAN §5.1):
 * 1. `height` tag  2. `building:levels`  3. a default for the building type
 * 4. unknown type → by footprint size. Only guesses get ±1 floor of seeded variety.
 * (Two more rules live in packBuildings.ts: our own height fixes come before all of
 * this, and guessed apartment blocks copy mapped apartment towers nearby.)
 */
export function buildingHeight(tags: OsmTags, kind: BuildingKind, footprintM2: number, id: number): BuildingHeight {
  let minH = parseMetres(tags.min_height) ?? 0;
  if (!(minH > 0)) {
    const minLevel = Number(tags['building:min_level']);
    minH = Number.isFinite(minLevel) && minLevel > 0 ? minLevel * FLOOR_M : 0;
  }

  let h: number;
  let guessed = false;
  const tagged = parseMetres(tags.height) ?? parseMetres(tags['building:height']);
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (tagged !== null && tagged > 0) {
    h = clamp(tagged, 2, 500);
  } else if (Number.isFinite(levels) && levels > 0) {
    h = clamp(levels, 0.5, 120) * FLOOR_M + ROOF_EXTRA_M;
  } else {
    guessed = true;
    const fixed = FIXED_HEIGHT_M[kind];
    if (fixed !== undefined) {
      h = fixed;
    } else {
      let floors = kind === 'generic' ? floorsByFootprint(footprintM2) : GUESSED_FLOORS[kind];
      if (kind === 'retail') {
        floors += hash32(id, 7) & 1; // shops: 1 or 2 floors
      } else if (floors >= 2) {
        const roll = hash32(id, 7) % 4; // -1, 0, 0, +1 floor
        floors += roll === 0 ? -1 : roll === 3 ? 1 : 0;
      }
      h = Math.max(1, floors) * FLOOR_M + ROOF_EXTRA_M;
    }
  }

  if (kind === 'roof' && minH <= 0) minH = Math.max(0, h - 0.4); // carports and canopies: a thin slab
  if (minH >= h - 0.2) minH = 0; // nonsense data
  const floors = Math.max(1, Math.round((h - minH) / FLOOR_M));
  return { h: Math.round(h * 10) / 10, minH: Math.round(minH * 10) / 10, floors, guessed };
}
