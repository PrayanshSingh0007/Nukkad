import { UNITS_PER_METRE, hash01, hash32, makeRng } from '@nukkad/shared';
import type { AreaKind, AreaPack, LineKind } from '@nukkad/shared';
import { pointInPolygon, ringBounds, signedArea } from '../geom/polygon.ts';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';
import { Occupancy } from './occupancy.ts';
import { placeStreetLife } from './streetLife.ts';
import { placeRoofTanks } from './roofTanks.ts';
import type { StreetLife } from './streetLife.ts';

/**
 * Positions of trees, street lamps and benches. OpenStreetMap rarely has them,
 * so most are invented — but from seeds, so every player sees the same ones.
 * Each list is shuffled: a lower quality level simply draws the first N.
 */
export interface PropSet extends StreetLife {
  /** Water tanks on terraces: x, y, z, rotation. */
  tanks: Float32Array;
  /** Per tree: x, y, z, scale, rotation, variant (0 round · 1 tall · 2 bush), tint 0–1. */
  trees: Float32Array;
  /** Per lamp: x, y, z, rotation. */
  lamps: Float32Array;
  /** Per bench: x, y, z, rotation. */
  benches: Float32Array;
  /** Globe lamps on house gate pillars: x, y, z (the centre of the glass ball). */
  gateLamps: Float32Array;
  /** Festive string lights along some compound walls: [x, y, z, n] (n = bulb number on its string). */
  stringLights: Float32Array;
  /** Overhead cables between neighbouring street poles: [ax, ay, az, bx, by, bz] (pole feet). */
  cables: Float32Array;
}

export const TREE_STRIDE = 7;
/** Tree variant for a bougainvillea draped over a compound wall (always that species). */
export const WALL_CREEPER_VARIANT = 3;
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

/**
 * The lamps, shuffled and capped like everything else, and the cables between poles that
 * both survived the cap (so no cable ever ends in mid-air).
 */
function lampsAndCables(lamps: number[], spans: number[], seed: number): { lamps: Float32Array; cables: Float32Array } {
  const count = lamps.length / LAMP_STRIDE;
  const order = Array.from({ length: count }, (_, index) => index);
  const random = makeRng(seed);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const kept = Math.min(count, MAX_LAMPS);
  const out = new Float32Array(kept * LAMP_STRIDE);
  const keep = new Set<number>();
  for (let k = 0; k < kept; k++) {
    keep.add(order[k]);
    for (let s = 0; s < LAMP_STRIDE; s++) out[k * LAMP_STRIDE + s] = lamps[order[k] * LAMP_STRIDE + s];
  }
  const cables: number[] = [];
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const a = spans[i];
    const b = spans[i + 1];
    if (!keep.has(a) || !keep.has(b)) continue;
    cables.push(lamps[a * LAMP_STRIDE], lamps[a * LAMP_STRIDE + 1], lamps[a * LAMP_STRIDE + 2], lamps[b * LAMP_STRIDE], lamps[b * LAMP_STRIDE + 1], lamps[b * LAMP_STRIDE + 2]);
  }
  return { lamps: out, cables: new Float32Array(cables) };
}

/** Shuffles records of `stride` numbers with a seed and keeps at most `max` of them. */
export function shuffleAndCap(values: number[], stride: number, max: number, seed: number): Float32Array {
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
  // Lamps: the map's own are few and far between (a couple of dozen in a whole district), so
  // ours fill in unless the real ones already cover a good share of the lit streets.
  let litStreetsM = 0;
  for (const line of pack.lines) {
    if (!LAMP_STREETS.has(line.kind)) continue;
    const p = toMetres(line.pts);
    for (let i = 2; i < p.length; i += 2) litStreetsM += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  }
  const inventLamps = pack.stats.mappedLamps < (0.3 * litStreetsM) / LAMP_SPACING_M;
  /** Pairs of neighbouring poles (indices into `lamps`) that carry overhead cables. */
  const spans: number[] = [];
  const realLamps = lamps.slice();
  const nearRealLamp = (x: number, z: number): boolean => {
    for (let i = 0; i < realLamps.length; i += LAMP_STRIDE) if (Math.abs(realLamps[i] - x) < 12 && Math.abs(realLamps[i + 2] - z) < 12) return true;
    return false;
  };
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
      let previous = -1;
      walkLine(pts, hash01(line.id, 33) * LAMP_SPACING_M, LAMP_SPACING_M, (x, z, dirX, dirZ) => {
        const lx = x - dirZ * offset * side;
        const lz = z + dirX * offset * side;
        if (occupancy.isBlocked(lx, lz, 0.4, 0.3) || nearRealLamp(lx, lz)) {
          previous = -1; // a gap in the poles breaks the cable run
          return;
        }
        // The lamp arm (the model's +x axis) points back towards the road.
        const index = lamps.length / LAMP_STRIDE;
        lamps.push(lx, heightAt(terrain, lx, lz), lz, Math.atan2(dirX * side, dirZ * side));
        // Bengaluru's street poles carry the power and cable lines from one pole to the next.
        if (previous >= 0 && Math.hypot(lamps[previous * LAMP_STRIDE] - lx, lamps[previous * LAMP_STRIDE + 2] - lz) < LAMP_SPACING_M * 1.3) spans.push(previous, index);
        previous = index;
      });
    }
  }

  const seed = hash32(pack.buildings.length + pack.lines.length * 7919, 50);
  return {
    trees: shuffleAndCap(trees, TREE_STRIDE, MAX_TREES, seed),
    ...lampsAndCables(lamps, spans, seed + 1),
    benches: shuffleAndCap(benches, BENCH_STRIDE, MAX_BENCHES, seed + 2),
    ...placeStreetLife(pack, terrain, occupancy),
    tanks: placeRoofTanks(pack, terrain),
    gateLamps: new Float32Array(0), // filled in by prepareWorld (needs the doors)
    stringLights: new Float32Array(0), // filled in by prepareWorld (needs the compound walls)
  };
}
