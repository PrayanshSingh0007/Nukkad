import { PACK_VERSION, decodePack } from '@nukkad/shared';
import type { WirePack } from '@nukkad/shared';
import { GROUND_MAP_SIZE, findSpawn, buildChunk, buildTerrainMesh, buildWaterMesh, meshBuffers, paintGroundMap, prepareWorld } from '@nukkad/worldgen';
import type { ChunkLod, PreparedWorld } from '@nukkad/worldgen';
import type { FromWorker, ToWorker } from './protocol.ts';

/**
 * The world worker: downloads the Area Pack and builds every mesh here, in the
 * background, so the page never freezes. Finished arrays are handed to the page
 * without copying (they are "transferred").
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let world: PreparedWorld | null = null;

async function load(url: string): Promise<void> {
  scope.postMessage({ type: 'progress', stage: 'download' });
  const fetchStart = performance.now();
  const response = await fetch(url);
  if (!response.ok) {
    let message = `The server answered with error ${response.status}.`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  const text = await response.text();
  const wire = JSON.parse(text) as WirePack;
  if (wire.v !== PACK_VERSION) throw new Error('This place was saved by a different version of Nukkad. Reload the page.');
  const pack = decodePack(wire);
  const fetchMs = performance.now() - fetchStart;

  scope.postMessage({ type: 'progress', stage: 'build' });
  const prepareStart = performance.now();
  world = prepareWorld(pack);
  const terrain = buildTerrainMesh(world.terrain);
  const pixels = paintGroundMap(pack, GROUND_MAP_SIZE);
  const water = buildWaterMesh(pack, world.originalTerrain);
  // The worker keeps its own copies of the terrain and props for later chunk builds.
  const heights = world.terrain.heights.slice();
  const props = {
    trees: world.props.trees.slice(),
    lamps: world.props.lamps.slice(),
    benches: world.props.benches.slice(),
  };
  const prepareMs = performance.now() - prepareStart;

  scope.postMessage(
    {
      type: 'ready',
      info: {
        id: pack.id,
        lat: pack.lat,
        lng: pack.lng,
        halfSize: pack.halfSize,
        chunksPerSide: world.chunksPerSide,
        timeZone: pack.timeZone,
        attribution: pack.attribution,
        stats: pack.stats,
        flatTerrain: pack.terrain.flat === 1,
        spawn: findSpawn(pack),
        downloadBytes: Number(response.headers.get('content-length')) || 0,
        packBytes: text.length,
        fetchMs,
        prepareMs,
      },
      terrain,
      terrainHeights: { size: world.terrain.size, cell: world.terrain.cell, half: world.terrain.half, base: world.terrain.base, heights },
      groundMap: { size: GROUND_MAP_SIZE, pixels },
      water,
      props,
    },
    [
      terrain.positions.buffer,
      terrain.normals.buffer,
      terrain.uvs.buffer,
      terrain.indices.buffer,
      heights.buffer,
      pixels.buffer,
      props.trees.buffer,
      props.lamps.buffer,
      props.benches.buffer,
      ...meshBuffers(water),
    ],
  );
}

function chunk(cx: number, cz: number, lod: ChunkLod): void {
  if (!world) throw new Error('The world is not loaded yet.');
  const start = performance.now();
  const data = buildChunk(world, cx, cz, lod);
  scope.postMessage({ type: 'chunk', chunk: data, buildMs: performance.now() - start }, [
    ...meshBuffers(data.buildings),
    ...meshBuffers(data.ground),
  ]);
}

scope.onmessage = (event) => {
  const message = event.data;
  const fail = (error: unknown): void => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  };
  try {
    if (message.type === 'load') load(message.url).catch(fail);
    else chunk(message.cx, message.cz, message.lod);
  } catch (error) {
    fail(error);
  }
};
