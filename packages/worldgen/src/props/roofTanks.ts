import { UNITS_PER_METRE, hash01, hash32 } from '@nukkad/shared';
import type { AreaPack } from '@nukkad/shared';
import { hasParapet } from '../buildings/buildingMesh.ts';
import { pointInRing, ringCentroid, signedArea } from '../geom/polygon.ts';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';

/** Per tank: x, y (the roof), z, rotation. */
export const TANK_STRIDE = 4;

/**
 * The black plastic water tank on almost every Bengaluru terrace. One on a house, up to
 * three on big blocks of flats, placed (seeded) inside the roof outline.
 */
export function placeRoofTanks(pack: AreaPack, terrain: TerrainGrid): Float32Array {
  const out: number[] = [];
  for (const building of pack.buildings) {
    if (!hasParapet(building) || building.floors < 2) continue;
    if (building.kind !== 'house' && building.kind !== 'apartments' && building.kind !== 'generic') continue;
    const ring = building.ring.map((v) => v / UNITS_PER_METRE);
    let ground = Infinity;
    for (let i = 0; i < ring.length; i += 2) ground = Math.min(ground, heightAt(terrain, ring[i], ring[i + 1]));
    const area = signedArea(ring);
    const count = area > 1200 ? 3 : area > 400 ? 2 : 1;
    const [cx, cz] = ringCentroid(ring);
    for (let t = 0; t < count; t++) {
      const seed = hash32(building.id, 150 + t);
      const reach = Math.min(Math.sqrt(area) * 0.3, 6);
      const x = cx + (hash01(seed, 1) - 0.5) * 2 * reach;
      const z = cz + (hash01(seed, 2) - 0.5) * 2 * reach;
      if (!pointInRing(x, z, ring)) continue;
      out.push(x, ground + building.h, z, hash01(seed, 3) * Math.PI * 2);
    }
  }
  return new Float32Array(out);
}
