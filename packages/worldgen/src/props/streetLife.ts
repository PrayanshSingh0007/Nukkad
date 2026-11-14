import { UNITS_PER_METRE, hash01, hash32, makeRng } from '@nukkad/shared';
import type { AreaPack, LineKind } from '@nukkad/shared';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';
import type { Occupancy } from './occupancy.ts';

/**
 * Parked vehicles, street-food stalls and bus stops — what makes a Bengaluru street feel
 * busy. Seeded, so everyone sees the same street. (Moving traffic is roadmap step L5.)
 */
export const VEHICLE = { hatchback: 0, sedan: 1, suv: 2, auto: 3, twoWheeler: 4, bus: 5, taxi: 6, van: 7, ambulance: 8, truck: 9, delivery: 10, motorbike: 11 } as const;
export const VEHICLE_KINDS = ['hatchback', 'sedan', 'suv', 'auto', 'two_wheeler', 'bus', 'taxi', 'van', 'ambulance', 'truck', 'delivery', 'motorbike'] as const;
/** Footprint half-sizes (sideways, lengthways) in metres, for collisions. */
export const VEHICLE_HALF: [number, number][] = [
  [0.82, 1.9],
  [0.88, 2.25],
  [0.95, 2.3],
  [0.7, 1.35],
  [0.38, 0.95],
  [1.28, 5.6],
  [0.88, 2.15],
  [0.9, 2.15],
  [1.0, 2.6],
  [1.05, 2.5],
  [1.05, 2.6],
  [0.42, 1.08],
];
export const VEHICLE_HEIGHT = [1.5, 1.45, 1.75, 1.75, 1.1, 3.2, 1.6, 1.6, 2.3, 1.85, 3.0, 1.15];

/** Per vehicle: x, y, z, rotation, kind, colour variant (0–7). */
export const VEHICLE_STRIDE = 6;
/** Per stall / bus stop: x, y, z, rotation. */
export const STALL_STRIDE = 4;
export const STOP_STRIDE = 4;

export interface StreetLife {
  vehicles: Float32Array;
  stalls: Float32Array;
  stops: Float32Array;
}

const PARKING_STREETS = new Set<LineKind>(['residential', 'living', 'service']); // main roads carry moving traffic
const BUS_STREETS = new Set<LineKind>(['primary', 'secondary', 'tertiary']);
const MAX_VEHICLES = 3000; // only the ones near the player are drawn
const STOP_SPACING_M = 320;

/** Kerbside parking mix, roughly like a Bengaluru side street: lots of two-wheelers. */
function pickParked(roll: number): number {
  if (roll < 0.3) return VEHICLE.twoWheeler;
  if (roll < 0.4) return VEHICLE.motorbike;
  if (roll < 0.55) return VEHICLE.hatchback;
  if (roll < 0.65) return VEHICLE.sedan;
  if (roll < 0.74) return VEHICLE.suv;
  if (roll < 0.83) return VEHICLE.auto;
  if (roll < 0.88) return VEHICLE.taxi;
  if (roll < 0.93) return VEHICLE.van;
  if (roll < 0.96) return VEHICLE.delivery;
  if (roll < 0.985) return VEHICLE.truck;
  return VEHICLE.ambulance;
}

/** Calls `visit` at seeded gaps along a line with the direction of travel; skips the ends (junctions). */
function walk(pts: number[], seed: number, minGap: number, maxGap: number, visit: (x: number, z: number, dx: number, dz: number, n: number) => void): void {
  const random = makeRng(seed);
  let total = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  let next = 9 + random() * maxGap;
  let travelled = 0;
  let n = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dz = pts[i + 3] - pts[i + 1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    while (next <= travelled + length && next < total - 9) {
      const t = (next - travelled) / length;
      visit(pts[i] + dx * t, pts[i + 1] + dz * t, dx / length, dz / length, n++);
      next += minGap + random() * (maxGap - minGap);
    }
    travelled += length;
  }
}

export function placeStreetLife(pack: AreaPack, terrain: TerrainGrid, occupancy: Occupancy): StreetLife {
  const vehicles: number[] = [];
  const stalls: number[] = [];
  const stops: number[] = [];
  const limit = pack.halfSize - 30;
  const inside = (x: number, z: number): boolean => Math.abs(x) < limit && Math.abs(z) < limit;

  for (const line of pack.lines) {
    const pts = line.pts.map((v) => v / UNITS_PER_METRE);
    const half = line.w / 2;
    // Parked along the kerb, on both sides, facing the way the street runs.
    if (PARKING_STREETS.has(line.kind) && line.w >= 3.4) {
      walk(pts, hash32(line.id, 90), 5, 26, (x, z, dx, dz, n) => {
        const seed = hash32(line.id, 91 + n);
        if (vehicles.length / VEHICLE_STRIDE >= MAX_VEHICLES || hash01(seed, 1) < 0.35) return;
        const kind = pickParked(hash01(seed, 2));
        const side = hash01(seed, 3) < 0.5 ? 1 : -1;
        const offset = Math.max(0.6, half - VEHICLE_HALF[kind][0] - 0.25) * side;
        const px = x - dz * offset;
        const pz = z + dx * offset;
        // Not inside a building, and not where a crossing road or a car already is.
        if (!inside(px, pz) || occupancy.isBlocked(px, pz, 0.3, -1000) || occupancy.roadsAt(px, pz, 2.5) > 1) return;
        const rotation = Math.atan2(-dx, -dz) + (hash01(seed, 4) < 0.5 ? 0 : Math.PI);
        vehicles.push(px, heightAt(terrain, px, pz), pz, rotation, kind, Math.floor(hash01(seed, 5) * 8));
      });
    }
    // Bus stops on main roads, with a bus waiting at some of them.
    if (BUS_STREETS.has(line.kind) && line.w >= 6) {
      walk(pts, hash32(line.id, 92), STOP_SPACING_M * 0.7, STOP_SPACING_M * 1.3, (x, z, dx, dz, n) => {
        const seed = hash32(line.id, 93 + n);
        const side = hash01(seed, 1) < 0.5 ? 1 : -1;
        const sx = x - dz * (half + 1.6) * side;
        const sz = z + dx * (half + 1.6) * side;
        if (!inside(sx, sz) || occupancy.isBlocked(sx, sz, 0.8, 0)) return;
        // The shelter's open side (+z of the model) faces the road.
        stops.push(sx, heightAt(terrain, sx, sz), sz, Math.atan2(dz * side, -dx * side));
        if (hash01(seed, 2) < 0.4) {
          const bx = x - dz * (half - 1.5) * side;
          const bz = z + dx * (half - 1.5) * side;
          vehicles.push(bx, heightAt(terrain, bx, bz), bz, Math.atan2(-dx, -dz), VEHICLE.bus, Math.floor(hash01(seed, 3) * 8));
        }
      });
    }
  }

  // Street-food and fruit stalls in front of food and grocery places.
  for (const place of pack.places) {
    if (place.kind !== 'food' && place.kind !== 'grocery' && place.kind !== 'cafe') continue;
    if (hash01(place.seed, 94) < 0.4) continue;
    const angle = (place.face * Math.PI) / 180;
    const nx = Math.sin(angle);
    const nz = Math.cos(angle);
    const x = place.x / UNITS_PER_METRE + nx * 2.4 + nz * (hash01(place.seed, 95) - 0.5) * 2;
    const z = place.z / UNITS_PER_METRE + nz * 2.4 - nx * (hash01(place.seed, 95) - 0.5) * 2;
    if (!inside(x, z) || occupancy.isBlocked(x, z, 0.6, 0.2)) continue;
    stalls.push(x, heightAt(terrain, x, z), z, angle); // the customer side faces the street
  }

  return { vehicles: new Float32Array(vehicles), stalls: new Float32Array(stalls), stops: new Float32Array(stops) };
}
