import { CHUNK_SIZE, UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, PackBuilding } from '@nukkad/shared';
import { digBasins } from '../areas/water.ts';
import { ringCentroid, signedArea } from '../geom/polygon.ts';
import { scatterProps } from '../props/scatter.ts';
import type { PropSet } from '../props/scatter.ts';
import type { RibbonRun, RoadDisc } from '../roads/groundMesh.ts';
import type { GateSpot } from '../buildings/compoundMesh.ts';
import { findDoors } from '../buildings/doors.ts';
import type { Door } from '../buildings/doors.ts';
import { buildRibbon } from '../roads/ribbon.ts';
import { cloneTerrain, terrainFromPack } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';

/** Everything of one 150 m chunk, ready to be turned into meshes on request. */
export interface ChunkBucket {
  /** Largest footprint first (the triangle cap drops the smallest ones). */
  buildings: PackBuilding[];
  runs: RibbonRun[];
  discs: RoadDisc[];
  /** Compound wall pieces [ax, az, bx, bz, …] in metres, and society gates. */
  walls: number[];
  gates: GateSpot[];
  doors: Door[];
}

/** A pack unpacked for fast chunk building. Made once per world, in the worker. */
export interface PreparedWorld {
  pack: AreaPack;
  half: number;
  chunksPerSide: number;
  /** The ground everything stands on (with shallow basins under lakes). */
  terrain: TerrainGrid;
  /** The ground as mapped, used for the water surface. */
  originalTerrain: TerrainGrid;
  buckets: ChunkBucket[];
  props: PropSet;
  /** One front door per building (walk up to it to go inside). */
  doors: Door[];
}

/** Roads with a footpath on each side, and how wide it is. */
const PAVED = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential']);
const FOOTPATH_M = 1.6;

/** Road ends get a filling disc only when the road is at least this wide. */
const MIN_DISC_WIDTH_M = 3;

/** Index of the chunk containing a point (points outside are clamped to the edge chunks). */
export function chunkIndexAt(half: number, chunksPerSide: number, x: number, z: number): number {
  const cx = Math.min(chunksPerSide - 1, Math.max(0, Math.floor((x + half) / CHUNK_SIZE)));
  const cz = Math.min(chunksPerSide - 1, Math.max(0, Math.floor((z + half) / CHUNK_SIZE)));
  return cz * chunksPerSide + cx;
}

export function prepareWorld(pack: AreaPack): PreparedWorld {
  const half = pack.halfSize;
  const chunksPerSide = Math.round((2 * half) / CHUNK_SIZE);
  const originalTerrain = terrainFromPack(pack.terrain);
  const terrain = cloneTerrain(originalTerrain);
  digBasins(terrain, pack);

  const buckets: ChunkBucket[] = Array.from({ length: chunksPerSide * chunksPerSide }, () => ({
    buildings: [],
    runs: [],
    discs: [],
    walls: [],
    gates: [],
    doors: [],
  }));
  const chunkAt = (x: number, z: number): ChunkBucket => buckets[chunkIndexAt(half, chunksPerSide, x, z)];

  // Buildings: each belongs to the chunk that contains its centre.
  const sized = pack.buildings.map((building) => ({ building, area: Math.abs(signedArea(building.ring)) }));
  sized.sort((a, b) => b.area - a.area || a.building.id - b.building.id);
  for (const { building } of sized) {
    const [cx, cz] = ringCentroid(building.ring);
    chunkAt(cx / UNITS_PER_METRE, cz / UNITS_PER_METRE).buildings.push(building);
  }

  // Roads: one strip per line, then cut into the stretches that lie in each chunk.
  for (const line of pack.lines) {
    const ribbon = buildRibbon(
      line.kind,
      line.pts.map((value) => value / UNITS_PER_METRE),
      line.w,
    );
    if (!ribbon) continue;
    // Proper roads get a footpath on both sides (the same line, 3.2 m wider).
    const paved = PAVED.has(line.kind) && line.w >= 5;
    const wide = paved ? buildRibbon(line.kind, line.pts.map((value) => value / UNITS_PER_METRE), line.w + FOOTPATH_M * 2) : null;
    const walk = wide && wide.count === ribbon.count ? wide : undefined;
    const midpoint = (i: number): [number, number] => [
      (ribbon.left[i * 2] + ribbon.right[i * 2]) / 2,
      (ribbon.left[i * 2 + 1] + ribbon.right[i * 2 + 1]) / 2,
    ];
    let run: RibbonRun | null = null;
    let runBucket: ChunkBucket | null = null;
    for (let i = 0; i < ribbon.count - 1; i++) {
      const [ax, az] = midpoint(i);
      const [bx, bz] = midpoint(i + 1);
      const bucket = chunkAt((ax + bx) / 2, (az + bz) / 2);
      if (run && bucket === runBucket) {
        run.to = i + 1;
      } else {
        run = walk ? { ribbon, from: i, to: i + 1, walk } : { ribbon, from: i, to: i + 1 };
        runBucket = bucket;
        bucket.runs.push(run);
      }
    }
    if (line.w >= MIN_DISC_WIDTH_M && line.kind !== 'river' && line.kind !== 'stream') {
      for (const end of [0, ribbon.count - 1]) {
        const [x, z] = midpoint(end);
        const cutByEdge = Math.abs(x) > half - 0.2 || Math.abs(z) > half - 0.2;
        if (!cutByEdge) chunkAt(x, z).discs.push({ kind: line.kind, x, z, radius: ribbon.halfWidth });
      }
    }
  }

  for (const compound of pack.compounds ?? []) {
    const w = compound.walls;
    for (let i = 0; i + 3 < w.length; i += 4) {
      const piece = [w[i], w[i + 1], w[i + 2], w[i + 3]].map((v) => v / UNITS_PER_METRE);
      chunkAt((piece[0] + piece[2]) / 2, (piece[1] + piece[3]) / 2).walls.push(...piece);
    }
    const g = compound.gate;
    const gate = { x: g.x / UNITS_PER_METRE, z: g.z / UNITS_PER_METRE, face: g.face, half: g.half / UNITS_PER_METRE };
    chunkAt(gate.x, gate.z).gates.push(gate);
  }

  const doors = findDoors(pack, terrain);
  for (const door of doors) chunkAt(door.x, door.z).doors.push(door);

  return { doors, pack, half, chunksPerSide, terrain, originalTerrain, buckets, props: scatterProps(pack, terrain) };
}
