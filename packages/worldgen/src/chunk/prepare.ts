import { CHUNK_SIZE, UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, PackBuilding } from '@nukkad/shared';
import { digBasins } from '../areas/water.ts';
import { ringCentroid, signedArea } from '../geom/polygon.ts';
import { TREE_STRIDE, WALL_CREEPER_VARIANT, scatterProps, shuffleAndCap } from '../props/scatter.ts';
import type { PropSet } from '../props/scatter.ts';
import type { RibbonRun, RoadDisc } from '../roads/groundMesh.ts';
import type { GateSpot } from '../buildings/compoundMesh.ts';
import { GATE_LAMP_HEIGHT, HOUSE_WALL_TOP_M } from '../buildings/compoundMesh.ts';
import { HOUSE_WALL_STRIDE, PILLAR_STRIDE, houseCompounds } from '../buildings/houseCompounds.ts';
import { findDoors } from '../buildings/doors.ts';
import type { Door } from '../buildings/doors.ts';
import { FOOT_KINDS, bridgeRise, buildRibbon } from '../roads/ribbon.ts';
import { cloneTerrain, heightAt, terrainFromPack } from '../terrain/grid.ts';
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
  /** House compound walls [ax, az, bx, bz, tone] and gate pillars [x, z, ux, uz, tone]. */
  houseWalls: number[];
  pillars: number[];
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
    houseWalls: [],
    pillars: [],
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
    if (line.b) ribbon.rise = bridgeRise(ribbon.along, FOOT_KINDS.has(line.kind));
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
    if (line.w >= MIN_DISC_WIDTH_M && line.kind !== 'river' && line.kind !== 'stream' && !line.b) {
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

  // House compound walls with gate pillars and globe lamps (worked out from the doors and roads).
  const compounds = houseCompounds(pack, doors);
  for (let i = 0; i + 4 < compounds.walls.length; i += HOUSE_WALL_STRIDE) {
    const w = compounds.walls;
    chunkAt((w[i] + w[i + 2]) / 2, (w[i + 1] + w[i + 3]) / 2).houseWalls.push(w[i], w[i + 1], w[i + 2], w[i + 3], w[i + 4]);
  }
  for (let i = 0; i + 4 < compounds.pillars.length; i += PILLAR_STRIDE) {
    const p = compounds.pillars;
    chunkAt(p[i], p[i + 1]).pillars.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4]);
  }
  const props = scatterProps(pack, terrain);
  const gateLamps = new Float32Array((compounds.lamps.length / 2) * 3);
  for (let i = 0; i < compounds.lamps.length / 2; i++) {
    const x = compounds.lamps[i * 2];
    const z = compounds.lamps[i * 2 + 1];
    gateLamps.set([x, heightAt(terrain, x, z) + GATE_LAMP_HEIGHT, z], i * 3);
  }
  props.gateLamps = gateLamps;
  // Bougainvillea: about one compound wall piece in six has a bush of it spilling over the
  // top (seeded by the wall). They join the trees, shuffled in, so a quality's tree limit thins
  // them out evenly with everything else.
  const creepers: number[] = [];
  const spot = (a: number, b: number, salt: number): number => {
    const x = Math.sin(a * 12.9898 + b * 78.233 + salt * 37.719) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i + 4 < compounds.walls.length; i += HOUSE_WALL_STRIDE) {
    const [ax, az, bx, bz] = [compounds.walls[i], compounds.walls[i + 1], compounds.walls[i + 2], compounds.walls[i + 3]];
    if (Math.hypot(bx - ax, bz - az) < 3 || spot(ax, az, 1) > 0.16) continue;
    const t = 0.2 + 0.6 * spot(bx, bz, 2);
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (Math.abs(x) > half - 2 || Math.abs(z) > half - 2) continue; // inside the area, like every tree
    creepers.push(x, heightAt(terrain, x, z), z, 0.85 + 0.4 * spot(ax, bz, 3), spot(bx, az, 4) * Math.PI * 2, WALL_CREEPER_VARIANT, spot(x, z, 5));
  }
  // Serial lights: about one wall piece in nine is strung with a line of small coloured bulbs
  // along its top (as Bengaluru homes are for Deepavali and weddings), one every 30 cm.
  const bulbs: number[] = [];
  for (let i = 0; i + 4 < compounds.walls.length; i += HOUSE_WALL_STRIDE) {
    const [ax, az, bx, bz] = [compounds.walls[i], compounds.walls[i + 1], compounds.walls[i + 2], compounds.walls[i + 3]];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1.5 || spot(az, bx, 6) > 0.11) continue;
    const top = Math.max(heightAt(terrain, ax, az), heightAt(terrain, bx, bz)) + HOUSE_WALL_TOP_M + 0.1;
    const count = Math.floor(length / 0.3);
    for (let j = 0; j < count; j++) {
      const t = (j + 0.5) / count;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (Math.abs(x) > half - 1 || Math.abs(z) > half - 1) continue;
      bulbs.push(x, top, z, j);
    }
  }
  props.stringLights = new Float32Array(bulbs);
  // Posters: on the street face of the wall (0.11 m out from its middle line), middle 0.85 m up.
  const posters: number[] = [];
  for (let i = 0; i + 4 < compounds.posters.length; i += 5) {
    const [x, z, nx, nz, seed] = compounds.posters.slice(i, i + 5);
    const px = x + nx * 0.112;
    const pz = z + nz * 0.112;
    if (Math.abs(px) > half - 1 || Math.abs(pz) > half - 1) continue;
    posters.push(px, heightAt(terrain, x, z) + 0.85, pz, Math.atan2(nx, nz), seed);
  }
  props.posters = new Float32Array(posters);
  if (creepers.length > 0) {
    const all = [...props.trees, ...creepers];
    props.trees = shuffleAndCap(all, TREE_STRIDE, all.length / TREE_STRIDE, 4242);
  }

  return { doors, pack, half, chunksPerSide, terrain, originalTerrain, buckets, props };
}
