import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, LineKind } from '@nukkad/shared';

/** Lines nobody should be dropped onto. */
const NOT_FOR_SPAWNING = new Set<LineKind>(['motorway', 'trunk', 'rail', 'river', 'stream', 'construction']);

/**
 * Where players appear: the point of a street or path closest to the chosen spot
 * (the centre of the area) — "the Nukkad". Falls back to the centre itself when
 * the map has no streets nearby.
 */
export function findSpawn(pack: AreaPack): [x: number, z: number] {
  const limit = (pack.halfSize - 120) * UNITS_PER_METRE; // stay well inside the playable square
  let best: [number, number] = [0, 0];
  let bestDistance = Infinity;
  for (const line of pack.lines) {
    if (NOT_FOR_SPAWNING.has(line.kind)) continue;
    for (let i = 0; i < line.pts.length; i += 2) {
      const x = line.pts[i];
      const z = line.pts[i + 1];
      if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
      const distance = x * x + z * z;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [x, z];
      }
    }
  }
  return [best[0] / UNITS_PER_METRE, best[1] / UNITS_PER_METRE];
}
