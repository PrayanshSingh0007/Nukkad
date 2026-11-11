import type { AreaPack } from './types.ts';

/**
 * How a pack travels over the network ("wire format").
 * Coordinates are stored as the DIFFERENCE from the previous point instead of the
 * full value: [1000, 2000, 1004, 2001] becomes [1000, 2000, 4, 1]. Small numbers zip
 * much better — packs get about 30 % smaller. `decodePack` restores the real values.
 */
export interface WirePack extends AreaPack {
  /** Marks a pack whose coordinate lists hold differences. */
  delta: 1;
}

function toDeltas(values: number[], stride: number): number[] {
  const out = values.slice();
  for (let i = values.length - 1; i >= stride; i--) out[i] = values[i] - values[i - stride];
  return out;
}

function fromDeltas(values: number[], stride: number): number[] {
  const out = values.slice();
  for (let i = stride; i < out.length; i++) out[i] += out[i - stride];
  return out;
}

/** Applies `convert` to every coordinate list of a pack (2 numbers per point; heights: 1). */
function convertPack(pack: AreaPack, convert: (values: number[], stride: number) => number[]): AreaPack {
  const ringOf = <T extends { ring: number[]; holes?: number[][] }>(shape: T): T => {
    const out = { ...shape, ring: convert(shape.ring, 2) };
    if (shape.holes) out.holes = shape.holes.map((hole) => convert(hole, 2));
    return out;
  };
  return {
    ...pack,
    terrain: { ...pack.terrain, heights: convert(pack.terrain.heights, 1) },
    buildings: pack.buildings.map(ringOf),
    areas: pack.areas.map(ringOf),
    lines: pack.lines.map((line) => ({ ...line, pts: convert(line.pts, 2) })),
  };
}

export function encodePack(pack: AreaPack): WirePack {
  return { ...convertPack(pack, toDeltas), delta: 1 };
}

export function decodePack(wire: WirePack): AreaPack {
  const { delta: _marker, ...pack } = wire;
  return convertPack(pack, fromDeltas);
}
