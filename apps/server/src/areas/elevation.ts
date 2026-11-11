import { decode } from 'fast-png';
import { tileXY } from '@nukkad/shared';
import type { GeoBox } from '@nukkad/shared';
import type { ElevationSampler } from '@nukkad/worldgen';

/**
 * Ground heights from the open "Terrarium" elevation tiles (Mapzen, hosted on AWS Open Data).
 * Each pixel stores a height: metres = R × 256 + G + B / 256 − 32768.
 */
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

const TILE_PX = 256;
const START_ZOOM = 14;
const MIN_ZOOM = 11;
const MAX_TILES = 6;

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Returns the PNG bytes of one tile. */
export type TileLoader = (tile: TileId) => Promise<Uint8Array>;

export const tileName = (tile: TileId): string => `terrarium-${tile.z}-${tile.x}-${tile.y}.png`;

/** The tiles covering a box at the most detailed zoom that needs only a handful of tiles. */
export function tilesForBox(box: GeoBox): TileId[] {
  for (let z = START_ZOOM; ; z--) {
    const [x0, y0] = tileXY(box.north, box.west, z);
    const [x1, y1] = tileXY(box.south, box.east, z);
    const tiles: TileId[] = [];
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) tiles.push({ z, x, y });
    }
    if (tiles.length <= MAX_TILES || z === MIN_ZOOM) return tiles;
  }
}

/** PNG bytes → heights in metres, row by row. */
export function decodeTerrarium(png: Uint8Array): Float32Array {
  const image = decode(png);
  if (image.width !== TILE_PX || image.height !== TILE_PX || image.channels < 3 || image.depth !== 8) {
    throw new Error('Unexpected elevation tile format');
  }
  const heights = new Float32Array(TILE_PX * TILE_PX);
  for (let k = 0; k < heights.length; k++) {
    const o = k * image.channels;
    heights[k] = image.data[o] * 256 + image.data[o + 1] + image.data[o + 2] / 256 - 32768;
  }
  return heights;
}

/** Downloads from the open elevation bucket. */
export function networkTileLoader(userAgent: string, fetchImpl: typeof fetch = fetch): TileLoader {
  return async (tile) => {
    const response = await fetchImpl(`${TERRARIUM_URL}/${tile.z}/${tile.x}/${tile.y}.png`, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Elevation tile answered ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}

/** Loads the tiles for a box and returns a function giving the height at any lat/lng inside it. */
export async function loadElevationSampler(box: GeoBox, loadTile: TileLoader): Promise<ElevationSampler> {
  const tiles = tilesForBox(box);
  const zoom = tiles[0].z;
  const decoded = await Promise.all(tiles.map(async (tile) => decodeTerrarium(await loadTile(tile))));
  const byKey = new Map<string, Float32Array>();
  tiles.forEach((tile, index) => byKey.set(`${tile.x},${tile.y}`, decoded[index]));
  const minPx = Math.min(...tiles.map((tile) => tile.x)) * TILE_PX;
  const maxPx = (Math.max(...tiles.map((tile) => tile.x)) + 1) * TILE_PX - 1;
  const minPy = Math.min(...tiles.map((tile) => tile.y)) * TILE_PX;
  const maxPy = (Math.max(...tiles.map((tile) => tile.y)) + 1) * TILE_PX - 1;

  /** Height of one pixel of the big picture made of all tiles (clamped at its border). */
  const pixel = (px: number, py: number): number => {
    const cx = Math.min(maxPx, Math.max(minPx, px));
    const cy = Math.min(maxPy, Math.max(minPy, py));
    const tile = byKey.get(`${Math.floor(cx / TILE_PX)},${Math.floor(cy / TILE_PX)}`);
    return tile ? tile[(cy % TILE_PX) * TILE_PX + (cx % TILE_PX)] : Number.NaN;
  };

  return (lat, lng) => {
    const [tx, ty] = tileXY(lat, lng, zoom);
    const fx = tx * TILE_PX - 0.5; // pixel centres sit at half-pixel positions
    const fy = ty * TILE_PX - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = fx - x0;
    const v = fy - y0;
    const top = pixel(x0, y0) * (1 - u) + pixel(x0 + 1, y0) * u;
    const bottom = pixel(x0, y0 + 1) * (1 - u) + pixel(x0 + 1, y0 + 1) * u;
    return top * (1 - v) + bottom * v;
  };
}
