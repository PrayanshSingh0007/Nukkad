import { UNITS_PER_METRE, hash32 } from '@nukkad/shared';
import type { AreaKind, AreaPack, PackArea } from '@nukkad/shared';
import type { Rgb } from '../mesh/meshBuilder.ts';
import { GROUND_BASE, GROUND_PAINT } from '../style/palette.ts';

/**
 * The ground colour map: parks, grass, sand, parking… painted into ONE picture
 * that is stretched over the whole terrain. It costs no triangles and no extra
 * draw calls. We fill the shapes ourselves (no canvas), so it also runs in tests.
 */
export const GROUND_MAP_SIZE = 1024;

/** How strongly neighbouring pixels differ in brightness (a cheap "texture"). */
const NOISE = 0.05;

/** Fills a polygon (outer ring + holes, even-odd rule) row by row. Coordinates are in pixels. */
export function fillPolygon(pixels: Uint8Array, size: number, rings: number[][], color: Rgb): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 2) {
      if (ring[i] < minY) minY = ring[i];
      if (ring[i] > maxY) maxY = ring[i];
    }
  }
  const firstRow = Math.max(0, Math.ceil(minY - 0.5));
  const lastRow = Math.min(size - 1, Math.floor(maxY - 0.5));
  const crossings: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const y = row + 0.5;
    crossings.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const y0 = ring[j + 1];
        const y1 = ring[i + 1];
        if (y0 <= y === y1 <= y) continue; // the edge does not cross this row
        crossings.push(ring[j] + ((y - y0) / (y1 - y0)) * (ring[i] - ring[j]));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(size - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let col = from; col <= to; col++) {
        const o = (row * size + col) * 4;
        pixels[o] = color[0];
        pixels[o + 1] = color[1];
        pixels[o + 2] = color[2];
      }
    }
  }
}

/** Paints the ground colour map for a pack. Returns RGBA pixels, row 0 = north edge. */
export function paintGroundMap(pack: AreaPack, size: number = GROUND_MAP_SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let o = 0; o < pixels.length; o += 4) {
    pixels[o] = GROUND_BASE[0];
    pixels[o + 1] = GROUND_BASE[1];
    pixels[o + 2] = GROUND_BASE[2];
    pixels[o + 3] = 255;
  }

  const byKind = new Map<AreaKind, PackArea[]>();
  for (const area of pack.areas) {
    const list = byKind.get(area.kind);
    if (list) list.push(area);
    else byKind.set(area.kind, [area]);
  }
  const scale = size / (2 * pack.halfSize * UNITS_PER_METRE);
  const offset = pack.halfSize * UNITS_PER_METRE;
  const toPixels = (ring: number[]): number[] => ring.map((value) => (value + offset) * scale);
  for (const [kind, color] of GROUND_PAINT) {
    for (const area of byKind.get(kind) ?? []) {
      fillPolygon(pixels, size, [toPixels(area.ring), ...(area.holes ?? []).map(toPixels)], color);
    }
  }

  for (let k = 0; k < size * size; k++) {
    const factor = 1 + (hash32(k, 11) / 4294967296 - 0.5) * 2 * NOISE;
    const o = k * 4;
    pixels[o] = Math.min(255, pixels[o] * factor);
    pixels[o + 1] = Math.min(255, pixels[o + 1] * factor);
    pixels[o + 2] = Math.min(255, pixels[o + 2] * factor);
  }
  return pixels;
}
