import { hash32 } from '@nukkad/shared';
import type { AreaKind, BuildingKind, LineKind, PackBuilding } from '@nukkad/shared';
import type { Rgb } from '../mesh/meshBuilder.ts';

/**
 * All colours of the world in one place. They are written as normal web colours
 * (sRGB hex). Vertex colours must be converted to "linear" for correct lighting;
 * the ground colour map stays sRGB because textures are converted by the GPU.
 */

export function srgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function linear(hex: string): Rgb {
  const toLinear = (channel: number): number => {
    const c = channel / 255;
    return Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 255);
  };
  const [r, g, b] = srgb(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

const linearList = (hexes: string): Rgb[] => hexes.split(' ').map(linear);

const WALLS: Record<BuildingKind, Rgb[]> = {
  house: linearList('#e8d8c0 #f0e2c8 #d9c4a5 #e6cdb0 #cfd8d0 #e9d3c7 #f2e6d0 #d8dfe6 #e3c9b4 #dcd3bf'),
  apartments: linearList('#d9d2c5 #c9d3d6 #e0d6c3 #cfc7ba #d6cbd0 #e6dccb'),
  commercial: linearList('#b9c7d0 #c8cfd4 #aebcc6 #d0d3d6 #bfc9c4'),
  retail: linearList('#e2c9a6 #d9b991 #e8d6b8 #dcc7b0'),
  industrial: linearList('#b7b9b5 #a9afb3 #c2bfb6'),
  civic: linearList('#e3d3b2 #d8c7a4 #e9dcc0 #d9cdb8'),
  religious: linearList('#f2ead8 #ecdcc0'),
  shed: linearList('#b5aa9a #a7a59e #bdb3a2'),
  roof: linearList('#9aa0a3 #a8a39a'),
  generic: linearList('#e8d8c0 #d9d2c5 #e0d6c3 #cfd8d0 #e6cdb0 #d6cbd0 #dcd3bf #e9d3c7'),
};

const ROOFS_GREY = linearList('#8d8f92 #9a958c #7f8689 #a39a8f #858a8c');
const ROOFS_WARM = linearList('#b5694f #a8604a #b98060');

/** Wall and roof colour of a building, picked from the palette by its map id. */
export function buildingColors(building: PackBuilding): { wall: Rgb; roof: Rgb } {
  const walls = WALLS[building.kind];
  const wall = walls[hash32(building.id, 1) % walls.length];
  const roofSeed = hash32(building.id, 2);
  const warm = building.kind === 'house' && roofSeed % 5 === 0;
  const roofs = warm ? ROOFS_WARM : ROOFS_GREY;
  return { wall, roof: roofs[(roofSeed >>> 8) % roofs.length] };
}

export interface LineStyle {
  /** How far above the ground the strip is drawn, metres. Different per kind so overlaps never flicker. */
  lift: number;
  color: Rgb;
}

const lineStyle = (lift: number, hex: string): LineStyle => ({ lift, color: linear(hex) });

export const LINE_STYLES: Record<LineKind, LineStyle> = {
  motorway: lineStyle(0.1, '#5a5d63'),
  trunk: lineStyle(0.1, '#5a5d63'),
  primary: lineStyle(0.1, '#5f6268'),
  secondary: lineStyle(0.095, '#63666c'),
  tertiary: lineStyle(0.09, '#686b70'),
  residential: lineStyle(0.08, '#6e7175'),
  living: lineStyle(0.08, '#77797c'),
  service: lineStyle(0.07, '#7d7f81'),
  pedestrian: lineStyle(0.075, '#b9b2a4'),
  cycleway: lineStyle(0.065, '#9a8f7f'),
  footway: lineStyle(0.06, '#c2b9a6'),
  steps: lineStyle(0.06, '#a9a295'),
  track: lineStyle(0.05, '#9c8a68'),
  construction: lineStyle(0.05, '#a08d6c'),
  rail: lineStyle(0.11, '#6b6258'),
  river: lineStyle(0.035, '#4f8fb5'),
  stream: lineStyle(0.03, '#5a98bb'),
};

/** Colour of bare ground where the map says nothing. */
export const GROUND_BASE = srgb('#a8a595');

/** Ground kinds in painting order: later entries are painted over earlier ones. */
export const GROUND_PAINT: [AreaKind, Rgb][] = [
  ['residential', srgb('#b3ad9b')],
  ['commercial', srgb('#b5b0a8')],
  ['industrial', srgb('#a9a7a2')],
  ['dirt', srgb('#9b8565')],
  ['farmland', srgb('#b7b27a')],
  ['grass', srgb('#86b05a')],
  ['park', srgb('#7fb35c')],
  ['cemetery', srgb('#8fa878')],
  ['scrub', srgb('#8a9a58')],
  ['forest', srgb('#5f8f4a')],
  ['wetland', srgb('#6f9a7a')],
  ['sand', srgb('#dccfa0')],
  ['rock', srgb('#9a9690')],
  ['parking', srgb('#8f8f8f')],
  ['plaza', srgb('#c2bdb3')],
  ['pitch', srgb('#5fae6a')],
  ['playground', srgb('#d8b56a')],
  ['water', srgb('#4a84a6')],
  ['pool', srgb('#6fb7cc')],
];

export const WATER_COLOR = linear('#4a90b8');
export const POOL_COLOR = linear('#74c3d8');
