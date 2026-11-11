import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { OverpassResponse } from '@nukkad/worldgen';
import { tileName } from './elevation.ts';
import type { TileId, TileLoader } from './elevation.ts';

/**
 * Fixtures = raw map data saved in the repo (tools/fixtures/<areaId>/) so the built-in
 * test area loads with no internet, and tests always see the same data.
 */
const OSM_FILE = 'overpass.json.gz';

async function readOrNull(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

export async function readFixtureOsm(fixturesDir: string, areaId: string): Promise<OverpassResponse | null> {
  const data = await readOrNull(path.join(fixturesDir, areaId, OSM_FILE));
  return data ? (JSON.parse(gunzipSync(data).toString('utf8')) as OverpassResponse) : null;
}

/** A tile loader that uses a saved tile when there is one and the fallback otherwise. */
export function fixtureTileLoader(fixturesDir: string, areaId: string, fallback: TileLoader): TileLoader {
  return async (tile: TileId) => {
    const saved = await readOrNull(path.join(fixturesDir, areaId, tileName(tile)));
    return saved ? new Uint8Array(saved) : fallback(tile);
  };
}

export async function writeFixture(
  fixturesDir: string,
  areaId: string,
  osm: OverpassResponse,
  tiles: { tile: TileId; png: Uint8Array }[],
): Promise<string> {
  const dir = path.join(fixturesDir, areaId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, OSM_FILE), gzipSync(JSON.stringify(osm), { level: 9 }));
  for (const { tile, png } of tiles) await writeFile(path.join(dir, tileName(tile)), png);
  return dir;
}
