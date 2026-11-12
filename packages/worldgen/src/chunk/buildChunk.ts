import { appendBuilding, buildingTriangleEstimate } from '../buildings/buildingMesh.ts';
import { appendGate, appendWalls } from '../buildings/compoundMesh.ts';
import { appendDoor } from '../buildings/doors.ts';
import { signedArea } from '../geom/polygon.ts';
import { MeshBuilder } from '../mesh/meshBuilder.ts';
import type { MeshData } from '../mesh/meshBuilder.ts';
import { appendDisc, appendRibbonRun } from '../roads/groundMesh.ts';
import type { PreparedWorld } from './prepare.ts';

/** Hard caps on the triangles of one chunk (PLAN §8.2): full detail, and far version. */
export const MAX_CHUNK_TRIANGLES = 30_000;
export const MAX_FAR_CHUNK_TRIANGLES = 10_000;

/** 0 = full detail (near, has colliders) · 1 = simplified (far away). */
export type ChunkLod = 0 | 1;

/** Far chunks leave out what nobody can see from 200 m: small buildings, paths, road ends. */
const FAR_MIN_BUILDING_M2 = 100;
const FAR_ROAD_STRIDE = 3; // 18 m road pieces instead of 6 m
const FAR_MIN_ROAD_WIDTH_M = 5;

/** The meshes of one chunk: at most two draw calls. */
export interface ChunkData {
  cx: number;
  cz: number;
  lod: ChunkLod;
  /** All buildings of the chunk merged into one mesh (with window data). */
  buildings: MeshData | null;
  /** All roads, paths, rails and streams of the chunk merged into one mesh. */
  ground: MeshData | null;
  triangles: number;
  /** Buildings left out because the chunk hit the triangle cap (smallest ones go first). */
  skippedBuildings: number;
}

export function buildChunk(world: PreparedWorld, cx: number, cz: number, lod: ChunkLod = 0): ChunkData {
  const bucket = world.buckets[cz * world.chunksPerSide + cx];
  if (!bucket) throw new Error(`No chunk at ${cx},${cz}`);
  const far = lod === 1;

  const ground = new MeshBuilder(3);
  for (const run of bucket.runs) {
    if (!far || run.ribbon.halfWidth * 2 >= FAR_MIN_ROAD_WIDTH_M) appendRibbonRun(ground, run, world.terrain, far ? FAR_ROAD_STRIDE : 1);
  }
  if (!far) for (const disc of bucket.discs) appendDisc(ground, disc, world.terrain);

  // Far buildings have no window data (the shader then draws plain walls).
  const buildings = new MeshBuilder(far ? 0 : 3);
  const budget = (far ? MAX_FAR_CHUNK_TRIANGLES : MAX_CHUNK_TRIANGLES) - ground.triangleCount;
  let planned = 0;
  let skippedBuildings = 0;
  for (const building of bucket.buildings) {
    if (far && Math.abs(signedArea(building.ring)) < FAR_MIN_BUILDING_M2 * 100) continue; // pack units are dm²
    const cost = buildingTriangleEstimate(building);
    if (planned + cost > budget) {
      skippedBuildings++;
      continue;
    }
    planned += cost;
    appendBuilding(buildings, building, world.terrain, far);
  }

  // Gated societies: walls only up close (from far away they are hidden behind trees), gates always.
  if (!far) appendWalls(buildings, bucket.walls, world.terrain);
  if (!far) for (const door of bucket.doors) appendDoor(buildings, door);
  for (const gate of bucket.gates) appendGate(buildings, gate, world.terrain);

  return {
    cx,
    cz,
    lod,
    buildings: buildings.finish(),
    ground: ground.finish(),
    triangles: ground.triangleCount + buildings.triangleCount,
    skippedBuildings,
  };
}
