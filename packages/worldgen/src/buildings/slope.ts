import { UNITS_PER_METRE } from '@nukkad/shared';
import type { PackBuilding } from '@nukkad/shared';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';

/**
 * Buildings that keep their full height above the HIGH side of a slope. Every building stands on
 * the lowest ground under it (so it never floats), which buries its uphill side: a 4-floor school
 * on ground that falls 6.5 m shows only 2 floors from its street. These get the floors the slope
 * uncovers added at the bottom instead, as hillside buildings really are.
 * (For now only landmarks drawn from the owner's photos; see B-034 for all buildings.)
 */
export const FULL_FLOORS_ON_SLOPE: ReadonlySet<number> = new Set([
  343629936, // GEAR Innovative International School, main block
]);

/** Adds the storeys a slope uncovers under the building (changes `h` and `floors`). */
export function addFloorsForSlope(building: PackBuilding, terrain: TerrainGrid): void {
  if ((building.minH ?? 0) > 0 || building.floors < 1) return;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < building.ring.length; i += 2) {
    const g = heightAt(terrain, building.ring[i] / UNITS_PER_METRE, building.ring[i + 1] / UNITS_PER_METRE);
    low = Math.min(low, g);
    high = Math.max(high, g);
  }
  const storey = building.h / building.floors;
  const extra = Math.floor((high - low) / storey + 0.3);
  if (extra <= 0) return;
  building.floors += extra;
  building.h += extra * storey;
}
