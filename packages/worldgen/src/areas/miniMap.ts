import { UNITS_PER_METRE } from '@nukkad/shared';
import type { AreaPack, LineKind } from '@nukkad/shared';
import { fillPolygon } from './groundMap.ts';

/**
 * The picture behind the on-screen map: a clean, dark "GPS" style map of the area —
 * parks and water, buildings, and roads drawn by importance (main roads wider and brighter).
 * Painted once in the worker, 2 pixels per metre at 1024 px for a 1.2 km area... (size / area).
 */
export const MINI_MAP_SIZE = 1024;

const BACKGROUND: [number, number, number] = [28, 33, 41];
const AREA_COLORS: Partial<Record<string, [number, number, number]>> = {
  park: [38, 70, 50],
  grass: [38, 66, 48],
  forest: [34, 62, 44],
  pitch: [42, 78, 54],
  cemetery: [40, 60, 48],
  water: [34, 74, 110],
  pool: [40, 90, 125],
  wetland: [36, 66, 74],
};
const BUILDING: [number, number, number] = [52, 58, 70];
const ROADS: Partial<Record<LineKind, { color: [number, number, number]; width: number; order: number }>> = {
  service: { color: [70, 76, 88], width: 4, order: 0 },
  living: { color: [80, 86, 98], width: 5, order: 1 },
  residential: { color: [92, 98, 112], width: 6, order: 2 },
  tertiary: { color: [150, 152, 160], width: 8, order: 3 },
  secondary: { color: [214, 176, 98], width: 10, order: 4 },
  primary: { color: [236, 170, 70], width: 12, order: 5 },
  trunk: { color: [240, 150, 60], width: 13, order: 6 },
  motorway: { color: [240, 130, 60], width: 14, order: 7 },
  river: { color: [34, 74, 110], width: 8, order: -1 },
  stream: { color: [34, 74, 110], width: 3, order: -1 },
};

/** Thick line: stamps filled discs along the segment (simple and plenty fast for one picture). */
function thickLine(pixels: Uint8Array, size: number, ax: number, ay: number, bx: number, by: number, radius: number, color: [number, number, number]): void {
  const length = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(length / Math.max(1, radius * 0.6)));
  const r2 = radius * radius;
  for (let s = 0; s <= steps; s++) {
    const cx = ax + ((bx - ax) * s) / steps;
    const cy = ay + ((by - ay) * s) / steps;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(size - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(size - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
        const o = (y * size + x) * 4;
        pixels[o] = color[0];
        pixels[o + 1] = color[1];
        pixels[o + 2] = color[2];
      }
    }
  }
}

export function paintMiniMap(pack: AreaPack, size: number = MINI_MAP_SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let o = 0; o < pixels.length; o += 4) {
    pixels[o] = BACKGROUND[0];
    pixels[o + 1] = BACKGROUND[1];
    pixels[o + 2] = BACKGROUND[2];
    pixels[o + 3] = 255;
  }
  const scale = size / (2 * pack.halfSize * UNITS_PER_METRE);
  const offset = pack.halfSize * UNITS_PER_METRE;
  const toPixels = (ring: number[]): number[] => ring.map((value) => (value + offset) * scale);
  for (const area of pack.areas) {
    const color = AREA_COLORS[area.kind];
    if (color) fillPolygon(pixels, size, [toPixels(area.ring), ...(area.holes ?? []).map(toPixels)], color);
  }
  for (const building of pack.buildings) {
    if (building.minH) continue;
    fillPolygon(pixels, size, [toPixels(building.ring)], BUILDING);
  }
  const pxPerMetre = size / (2 * pack.halfSize);
  const lines = pack.lines.filter((line) => ROADS[line.kind]).sort((a, b) => ROADS[a.kind]!.order - ROADS[b.kind]!.order);
  // Dark outline first for every road, then the fill: roads read like a real map.
  for (const pass of ['edge', 'fill'] as const) {
    for (const line of lines) {
      const style = ROADS[line.kind]!;
      const radius = (style.width * pxPerMetre * 0.5) / 2 + (pass === 'edge' ? 1.2 : 0);
      const color: [number, number, number] = pass === 'edge' ? [18, 21, 27] : style.color;
      const p = toPixels(line.pts);
      for (let i = 0; i + 3 < p.length; i += 2) thickLine(pixels, size, p[i], p[i + 1], p[i + 2], p[i + 3], radius, color);
    }
  }
  return pixels;
}
