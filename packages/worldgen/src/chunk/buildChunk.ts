import { appendBuilding, buildingTriangleEstimate } from '../buildings/buildingMesh.ts';
import { MeshBuilder } from '../mesh/meshBuilder.ts';
import type { MeshData } from '../mesh/meshBuilder.ts';
import { appendDisc, appendRibbonRun } from '../roads/groundMesh.ts';
import type { PreparedWorld } from './prepare.ts';

/** Hard cap on the triangles of one chunk (PLAN §8.2). */
export const MAX_CHUNK_TRIANGLES = 30_000;

/** The meshes of one chunk: at most two draw calls. */
export interface ChunkData {
  cx: number;
  cz: number;
  /** All buildings of the chunk merged into one mesh (with window data). */
  buildings: MeshData | null;
  /** All roads, paths, rails and streams of the chunk merged into one mesh. */
  ground: MeshData | null;
  triangles: number;
  /** Buildings left out because the chunk hit the triangle cap (smallest ones go first). */
  skippedBuildings: number;
}

export function buildChunk(world: PreparedWorld, cx: number, cz: number): ChunkData {
  const bucket = world.buckets[cz * world.chunksPerSide + cx];
  if (!bucket) throw new Error(`No chunk at ${cx},${cz}`);

  const ground = new MeshBuilder();
  for (const run of bucket.runs) appendRibbonRun(ground, run, world.terrain);
  for (const disc of bucket.discs) appendDisc(ground, disc, world.terrain);

  const buildings = new MeshBuilder(true);
  const budget = MAX_CHUNK_TRIANGLES - ground.triangleCount;
  let planned = 0;
  let skippedBuildings = 0;
  for (const building of bucket.buildings) {
    const cost = buildingTriangleEstimate(building);
    if (planned + cost > budget) {
      skippedBuildings++;
      continue;
    }
    planned += cost;
    appendBuilding(buildings, building, world.terrain);
  }

  return {
    cx,
    cz,
    buildings: buildings.finish(),
    ground: ground.finish(),
    triangles: ground.triangleCount + buildings.triangleCount,
    skippedBuildings,
  };
}
