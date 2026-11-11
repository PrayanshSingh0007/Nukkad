import { UNITS_PER_METRE, hash01, hash32, makeRng } from '@nukkad/shared';
import type { AreaKind, AreaPack, LineKind } from '@nukkad/shared';
import { pointInPolygon, ringBounds, signedArea } from '../geom/polygon.ts';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';
import { Occupancy } from './occupancy.ts';

/**
 * Positions of trees, street lamps and benches. OpenStreetMap rarely has them,
 * so most are invented — but from seeds, so every player sees the same ones.
 * Each list is shuffled: a lower quality level simply draws the first N.
 */
export interface PropSet {
  /** Per tree: x, y, z, scale, rotation, variant (0 round · 1 tall · 2 bush), tint 0–1. */
  trees: Float32Array;
  /** Per lamp: x, y, z, rotation. */
  lamps: Float32Array;
  /** Per bench: x, y, z, rotation. */
  benches: Float32Array;
}

export const TREE_STRIDE = 7;
export const LAMP_STRIDE = 4;
export const BENCH_STRIDE = 4;

const MAX_TREES = 3000;
const MAX_LAMPS = 1500;
const MAX_BENCHES = 200;

/** Where trees grow by themselves: spacing in metres and the kind of plant. */
const GREEN: Partial<Record<AreaKind, { spacing: number; bush: boolean }>> = {
  forest: { spacing: 8, bush: false },
  park: { spacing: 15, bush: false },
  cemetery: { spacing: 18, bush: false },
  grass: { spacing: 32, bush: false },
  scrub: { spacing: 11, bush: true },
  wetland: { spacing: 20, bush: true },
};

const TREE_STREETS = new Set<LineKind>(['primary', 'secondary', 'tertiary', 'residential', 'living']);
const LAMP_STREETS = TREE_STREETS;
const STREET_TREE_SPACING_M = 22;
const LAMP_SPACING_M = 32;

const toMetres = (ring: number[]): number[] => ring.map((value) => value / UNITS_PER_METRE);

/** Calls `visit` at regular distances along a line, with the direction of travel. */
function walkLine(
  pts: number[],
  start: number,
  spacing: number,
  visit: (x: number, z: number, dirX: number, dirZ: number, index: number) => void,
): void {
  let next = start;
  let travelled = 0;
  let index = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dz = pts[i + 3] - pts[i + 1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    while (next <= travelled + length) {
      const t = (next - travelled) / length;
      visit(pts[i] + dx * t, pts[i + 1] + dz * t, dx / length, dz / length, index++);
      next += spacing;
    }
    travelled += length;
  }
}

/** Shuffles records of `stride` numbers with a seed and keeps at most `max` of them. */
function shuffleAndCap(values: number[], stride: number, max: number, seed: number): Float32Array {
  const count = values.length / stride;
  const order = Array.from({ length: count }, (_, index) => index);
  const random = makeRng(seed);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const kept = Math.min(count, max);
  const out = new Float32Array(kept * stride);
  for (let k = 0; k < kept; k++) {
    for (let s = 0; s < stride; s++) out[k * stride + s] = values[order[k] * stride + s];
  }
  return out;
}

export function scatterProps(pack: AreaPack, terrain: TerrainGrid): PropSet {
  const occupancy = new Occupancy(pack);
  const trees: number[] = [];
  const lamps: number[] = [];
  const benches: number[] = [];

  const addTree = (x: number, z: number, seed: number, bush: boolean): void => {
    const variant = bush ? 2 : hash01(seed, 3) < 0.25 ? 1 : 0;
    const scale = bush ? 0.55 + hash01(seed, 4) * 0.35 : 0.8 + hash01(seed, 4) * 0.55;
    trees.push(x, heightAt(terrain, x, z), z, scale, hash01(seed, 5) * Math.PI * 2, variant, hash01(seed, 6));
  };

  // 1. Things that really are on the map.
  const eachMapped = (list: number[], visit: (x: number, z: number, seed: number) => void): void => {
    for (let i = 0; i < list.length; i += 2) {
      const x = list[i] / UNITS_PER_METRE;
      const z = list[i + 1] / UNITS_PER_METRE;
      if (!occupancy.isBlocked(x, z, 0.3, 0)) visit(x, z, hash32(list[i] * 4099 + list[i + 1], 60));
    }
  };
  eachMapped(pack.points.tree, (x, z, seed) => addTree(x, z, seed, false));
  eachMapped(pack.points.lamp, (x, z, seed) => lamps.push(x, heightAt(terrain, x, z), z, hash01(seed, 5) * Math.PI * 2));
  eachMapped(pack.points.bench, (x, z, seed) => benches.push(x, heightAt(terrain, x, z), z, hash01(seed, 5) * Math.PI * 2));

  // 2. Trees and bushes inside green areas, on a jittered grid.
  for (const area of pack.areas) {
    const green = GREEN[area.kind];
    if (!green) continue;
    const ring = toMetres(area.ring);
    const holes = (area.holes ?? []).map(toMetres);
    const [minX, minZ, maxX, maxZ] = ringBounds(ring);
    const random = makeRng(hash32(area.id, 21));
    for (let gx = minX; gx < maxX; gx += green.spacing) {
      for (let gz = minZ; gz < maxZ; gz += green.spacing) {
        const x = gx + random() * green.spacing;
        const z = gz + random() * green.spacing;
        const seed = Math.floor(random() * 4294967296);
        if (!pointInPolygon(x, z, ring, holes) || occupancy.isBlocked(x, z, 1.5, 1)) continue;
        addTree(x, z, seed, green.bush);
      }
    }
    // A few benches in parks.
    if (area.kind === 'park') {
      const wanted = Math.min(6, Math.floor(signedArea(ring) / 1500));
      for (let placed = 0, tries = 0; placed < wanted && tries < wanted * 20; tries++) {
        const x = minX + random() * (maxX - minX);
        const z = minZ + random() * (maxZ - minZ);
        if (!pointInPolygon(x, z, ring, holes) || occupancy.isBlocked(x, z, 1, 0.5)) continue;
        benches.push(x, heightAt(terrain, x, z), z, random() * Math.PI * 2);
        placed++;
      }
    }
  }

  // 3. Street trees and street lamps (skipped where the map already has plenty of real ones).
  const inventTrees = pack.stats.mappedTrees < 300;
  const inventLamps = pack.stats.mappedLamps < 30;
  for (const line of pack.lines) {
    const pts = toMetres(line.pts);
    if (inventTrees && TREE_STREETS.has(line.kind) && line.w >= 5) {
      const offset = line.w / 2 + 1.6;
      walkLine(pts, hash01(line.id, 31) * STREET_TREE_SPACING_M, STREET_TREE_SPACING_M, (x, z, dirX, dirZ, index) => {
        const seed = hash32(line.id, 40 + index);
        if (seed % 10 >= 7) return; // leave gaps so rows don't look planted by a machine
        const side = index % 2 === 0 ? 1 : -1;
        const tx = x - dirZ * offset * side;
        const tz = z + dirX * offset * side;
        if (!occupancy.isBlocked(tx, tz, 1.2, 0.8)) addTree(tx, tz, seed, false);
      });
    }
    if (inventLamps && LAMP_STREETS.has(line.kind)) {
      const offset = line.w / 2 + 0.5;
      const side = hash32(line.id, 32) % 2 === 0 ? 1 : -1;
      walkLine(pts, hash01(line.id, 33) * LAMP_SPACING_M, LAMP_SPACING_M, (x, z, dirX, dirZ) => {
        const lx = x - dirZ * offset * side;
        const lz = z + dirX * offset * side;
        if (occupancy.isBlocked(lx, lz, 0.4, 0.3)) return;
        // The lamp arm (the model's +x axis) points back towards the road.
        lamps.push(lx, heightAt(terrain, lx, lz), lz, Math.atan2(dirX * side, dirZ * side));
      });
    }
  }

  const seed = hash32(pack.buildings.length + pack.lines.length * 7919, 50);
  return {
    trees: shuffleAndCap(trees, TREE_STRIDE, MAX_TREES, seed),
    lamps: shuffleAndCap(lamps, LAMP_STRIDE, MAX_LAMPS, seed + 1),
    benches: shuffleAndCap(benches, BENCH_STRIDE, MAX_BENCHES, seed + 2),
  };
}
