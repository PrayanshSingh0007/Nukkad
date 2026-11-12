import { encode } from 'fast-png';
import { describe, expect, it } from 'vitest';
import { areaGeoBox, areaRefFor, makeProjector } from '@nukkad/shared';
import { buildHeightGrid } from '@nukkad/worldgen';
import { decodeTerrarium, loadElevationSampler, tilesForBox } from './elevation.ts';
import type { TileId } from './elevation.ts';
import { overpassQuery } from './overpass.ts';

/** A fake elevation tile where the height is `heightOf(column, row)`, encoded like the real ones. */
function fakeTile(heightOf: (px: number, py: number) => number): Uint8Array {
  const data = new Uint8Array(256 * 256 * 3);
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const value = Math.round((heightOf(px, py) + 32768) * 256);
      const o = (py * 256 + px) * 3;
      data[o] = (value >> 16) & 255;
      data[o + 1] = (value >> 8) & 255;
      data[o + 2] = value & 255;
    }
  }
  return encode({ width: 256, height: 256, data, channels: 3, depth: 8 });
}

const ref = areaRefFor(12.921, 77.695);

describe('elevation tiles', () => {
  it('decodes the Terrarium height formula', () => {
    const heights = decodeTerrarium(fakeTile((px, py) => 900 + px * 0.5 - py * 0.25));
    expect(heights[0]).toBeCloseTo(900, 2);
    expect(heights[10]).toBeCloseTo(905, 2);
    expect(heights[256 * 4]).toBeCloseTo(899, 2);
  });

  it('needs only a handful of tiles for one area', () => {
    const tiles = tilesForBox(areaGeoBox(ref, 30));
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(6);
    expect(tiles.every((tile) => tile.z === 14)).toBe(true);
    // Far north, tiles are tiny in metres: the zoom drops instead of asking for dozens.
    const north = tilesForBox(areaGeoBox(areaRefFor(78.2, 15.6), 30));
    expect(north.length).toBeLessThanOrEqual(6);
    expect(north[0].z).toBeLessThan(14);
  });

  it('samples smoothly across tile borders', async () => {
    // Height = global pixel column → a perfectly even slope across all tiles.
    const loadTile = async (tile: TileId): Promise<Uint8Array> => fakeTile((px) => (tile.x * 256 + px) * 0.1 - 300000);
    const box = areaGeoBox(ref, 30);
    const sampler = await loadElevationSampler(box, loadTile);
    const projector = makeProjector(ref.lat, ref.lng);
    let previous = -Infinity;
    for (let x = -600; x <= 600; x += 50) {
      const [lat, lng] = projector.toGeo(x, 0);
      const height = sampler(lat, lng);
      expect(Number.isFinite(height)).toBe(true);
      expect(height).toBeGreaterThan(previous); // rises steadily to the east, no jumps back
      previous = height;
    }
    const grid = buildHeightGrid(ref, sampler);
    expect(grid.flat).toBeUndefined();
    expect(grid.heights).toHaveLength(121 * 121);
    expect(Math.min(...grid.heights)).toBeGreaterThanOrEqual(0);
  });
});

describe('Overpass query', () => {
  it('asks only for the box and only for things we draw', () => {
    const query = overpassQuery(areaGeoBox(ref, 10));
    expect(query).toContain('[bbox:12.915');
    expect(query).toContain('way["building"]');
    expect(query).toContain('out body geom');
    expect(query).not.toMatch(/name|brand/); // we ask what kind of place it is, never for names or brands
  });
});
