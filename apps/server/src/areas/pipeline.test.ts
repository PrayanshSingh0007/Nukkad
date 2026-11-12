import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_AREA, UNITS_PER_METRE, areaRefFor, decodePack, placeName } from '@nukkad/shared';
import type { AreaPack, WirePack } from '@nukkad/shared';
import { MAX_CHUNK_TRIANGLES, MAX_FAR_CHUNK_TRIANGLES, TREE_STRIDE, buildChunk, buildTerrainMesh, buildWaterMesh, paintGroundMap, prepareWorld } from '@nukkad/worldgen';
import type { ChunkData, MeshData, PreparedWorld } from '@nukkad/worldgen';
import { loadConfig } from '../config.ts';
import { MemoryAreaStore } from '../store/areaStore.ts';
import { AreaService } from './areaService.ts';
import { createAreaSource } from './areaSource.ts';

/**
 * The whole map → mesh pipeline on the saved test area (no internet needed):
 * raw OpenStreetMap data + elevation tiles → Area Pack → chunks.
 */
const ref = areaRefFor(TEST_AREA.lat, TEST_AREA.lng);

async function buildFixturePack(): Promise<{ gz: Buffer; pack: AreaPack }> {
  const config = loadConfig();
  const failingFetch = (() => Promise.reject(new Error('tests must not use the network'))) as unknown as typeof fetch;
  const realFetch = globalThis.fetch;
  globalThis.fetch = failingFetch;
  try {
    const service = new AreaService({ store: new MemoryAreaStore(), source: createAreaSource(config) });
    const gz = await service.getPackGz(ref);
    return { gz, pack: decodePack(JSON.parse(gunzipSync(gz).toString('utf8')) as WirePack) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

function checkMesh(mesh: MeshData | null): number {
  if (!mesh) return 0;
  const vertices = mesh.positions.length / 3;
  expect(mesh.normals.length).toBe(vertices * 3);
  expect(mesh.colors.length).toBe(vertices * 3);
  if (mesh.extra) expect(mesh.extra.length).toBe(vertices * mesh.extraSize);
  expect(mesh.indices.length % 3).toBe(0);
  let maxIndex = 0;
  for (const index of mesh.indices) if (index > maxIndex) maxIndex = index;
  expect(maxIndex).toBeLessThan(vertices);
  for (const value of mesh.positions) if (!Number.isFinite(value)) throw new Error('mesh has a broken coordinate');
  return mesh.indices.length / 3;
}

describe('test area: map → pack', () => {
  let gz: Buffer;
  let pack: AreaPack;
  beforeAll(async () => {
    ({ gz, pack } = await buildFixturePack());
  });

  it('builds a pack with the expected amount of city in it', () => {
    expect(pack.id).toBe('a_12921_77695_600');
    expect(pack.timeZone).toBe('Asia/Kolkata');
    expect(pack.attribution[0]).toContain('OpenStreetMap');
    expect(pack.stats.buildings).toBeGreaterThan(1500);
    expect(pack.stats.roadKm).toBeGreaterThan(25);
    expect(pack.stats.heightsGuessed).toBeGreaterThan(pack.stats.buildings * 0.4);
    expect(pack.areas.some((area) => area.kind === 'water')).toBe(true);
  });

  it('has shops, schools and offices — every area gets a mall, a showroom and a supermarket', () => {
    const kinds = new Set(pack.places.map((place) => place.kind));
    for (const kind of ['mall', 'showroom', 'supermarket', 'school', 'food', 'grocery'] as const) expect(kinds.has(kind)).toBe(true);
    expect(pack.stats.realPlaces).toBeGreaterThan(20); // the map really knows these
    expect(pack.places.length).toBeLessThanOrEqual(100);
  });

  it('never carries a real name or brand from the map (legal rule)', async () => {
    const { readFixtureOsm } = await import('./fixtures.ts');
    const osm = await readFixtureOsm(loadConfig().fixturesDir, pack.id);
    const realNames = new Set<string>();
    for (const element of osm?.elements ?? []) {
      for (const key of ['name', 'brand', 'operator', 'name:en', 'name:kn']) {
        const value = element.tags?.[key];
        if (value && value.length >= 4) realNames.add(value.toLowerCase());
      }
    }
    expect(realNames.size).toBeGreaterThan(50);
    const text = JSON.stringify(pack).toLowerCase();
    for (const name of realNames) expect(text.includes(`"${name}"`)).toBe(false);
    const signs = pack.places.map((place) => placeName(place.kind, place.seed).toLowerCase());
    for (const sign of signs) expect(realNames.has(sign)).toBe(false);
  });

  it('stays inside the download budget (150 KB zipped)', () => {
    expect(gz.length).toBeLessThan(150 * 1024);
  });

  it('keeps every coordinate inside the area, as whole decimetres', () => {
    const limit = pack.halfSize * UNITS_PER_METRE;
    const check = (values: number[], slack: number): void => {
      for (const value of values) {
        if (!Number.isInteger(value) || Math.abs(value) > limit + slack) throw new Error(`bad coordinate ${value}`);
      }
    };
    for (const line of pack.lines) check(line.pts, 0);
    for (const area of pack.areas) check(area.ring, 0);
    for (const building of pack.buildings) check(building.ring, 3000); // buildings may stick out a little
    for (const building of pack.buildings) {
      expect(building.h).toBeGreaterThan(1.9);
      expect(building.h).toBeLessThanOrEqual(500);
      expect(building.floors).toBeGreaterThanOrEqual(1);
    }
  });

  it('has real, gently varying ground heights', () => {
    const { terrain } = pack;
    expect(terrain.flat).toBeUndefined();
    expect(terrain.size).toBe(121);
    expect(terrain.heights).toHaveLength(121 * 121);
    expect(terrain.base).toBeGreaterThan(800); // Bengaluru sits around 900 m
    expect(terrain.base).toBeLessThan(1000);
    const relief = Math.max(...terrain.heights) / 100;
    expect(relief).toBeGreaterThan(2);
    expect(relief).toBeLessThan(80);
  });

  it('gives the same pack for the same data', async () => {
    const again = await buildFixturePack();
    expect(again.gz.equals(gz)).toBe(true);
  });
});

describe('test area: pack → meshes', () => {
  let pack: AreaPack;
  let world: PreparedWorld;
  let chunks: ChunkData[];
  beforeAll(async () => {
    ({ pack } = await buildFixturePack());
    world = prepareWorld(pack);
    chunks = [];
    for (let cz = 0; cz < world.chunksPerSide; cz++) {
      for (let cx = 0; cx < world.chunksPerSide; cx++) chunks.push(buildChunk(world, cx, cz));
    }
  });

  it('splits the area into 8 × 8 chunks and places every building once', () => {
    expect(world.chunksPerSide).toBe(8);
    const placed = world.buckets.reduce((sum, bucket) => sum + bucket.buildings.length, 0);
    expect(placed).toBe(pack.buildings.length);
  });

  it('keeps every chunk under the triangle cap with valid meshes', () => {
    let total = 0;
    for (const chunk of chunks) {
      const triangles = checkMesh(chunk.buildings) + checkMesh(chunk.ground);
      expect(triangles).toBe(chunk.triangles);
      expect(triangles).toBeLessThanOrEqual(MAX_CHUNK_TRIANGLES);
      expect(chunk.skippedBuildings).toBe(0);
      total += triangles;
    }
    expect(total).toBeGreaterThan(20_000);
    expect(total).toBeLessThan(150_000); // the whole area at full detail fits the Medium budget
  });

  it('builds lighter far versions of every chunk', () => {
    let near = 0;
    let far = 0;
    for (const chunk of chunks) {
      const simple = buildChunk(world, chunk.cx, chunk.cz, 1);
      expect(simple.lod).toBe(1);
      expect(simple.triangles).toBeLessThanOrEqual(MAX_FAR_CHUNK_TRIANGLES);
      expect(simple.triangles).toBeLessThanOrEqual(chunk.triangles);
      expect(simple.buildings?.extra).toBeUndefined(); // no window data far away
      near += chunk.triangles;
      far += simple.triangles;
    }
    expect(far).toBeLessThan(near * 0.7);
  });

  it('builds terrain, water and the ground colour map', () => {
    const terrain = buildTerrainMesh(world.terrain);
    expect(terrain.indices.length / 3).toBe(28_800);
    expect(checkMesh(buildWaterMesh(pack, world.originalTerrain))).toBeGreaterThan(0);
    const pixels = paintGroundMap(pack, 256);
    expect(pixels).toHaveLength(256 * 256 * 4);
    const colours = new Set<number>();
    for (let o = 0; o < pixels.length; o += 4 * 97) colours.add((pixels[o] >> 4) * 256 + (pixels[o + 1] >> 4) * 16 + (pixels[o + 2] >> 4));
    expect(colours.size).toBeGreaterThan(3); // more than one kind of ground was painted
  });

  it('invents trees and lamps, but never inside the limits it promised', () => {
    const { trees, lamps } = world.props;
    const treeCount = trees.length / TREE_STRIDE;
    expect(treeCount).toBeGreaterThan(100);
    expect(treeCount).toBeLessThanOrEqual(3000);
    expect(lamps.length / 4).toBeGreaterThan(100);
    for (let i = 0; i < trees.length; i += TREE_STRIDE) {
      expect(Math.abs(trees[i])).toBeLessThanOrEqual(pack.halfSize);
      expect(Math.abs(trees[i + 2])).toBeLessThanOrEqual(pack.halfSize);
    }
  });

  it('builds exactly the same world twice', () => {
    const second = prepareWorld(pack);
    expect(Array.from(second.props.trees)).toEqual(Array.from(world.props.trees));
    const a = buildChunk(world, 3, 4);
    const b = buildChunk(second, 3, 4);
    expect(Array.from(b.buildings?.positions ?? [])).toEqual(Array.from(a.buildings?.positions ?? []));
    expect(Array.from(b.ground?.indices ?? [])).toEqual(Array.from(a.ground?.indices ?? []));
  });
});
