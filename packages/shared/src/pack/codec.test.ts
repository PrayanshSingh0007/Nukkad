import { describe, expect, it } from 'vitest';
import { decodePack, encodePack } from './codec.ts';
import type { AreaPack } from './types.ts';

const pack: AreaPack = {
  v: 2,
  id: 'a_1_2_600',
  lat: 0.001,
  lng: 0.002,
  halfSize: 600,
  timeZone: 'UTC',
  attribution: ['© OpenStreetMap contributors'],
  terrain: { size: 2, cell: 10, base: 5, heights: [100, 104, 99, 250] },
  buildings: [
    { id: 1, kind: 'house', h: 6.5, floors: 2, ring: [1000, 2000, 1100, 2000, 1100, 2080, 1000, 2080], holes: [[1020, 2020, 1020, 2040, 1040, 2040]] },
  ],
  lines: [{ id: 2, kind: 'residential', w: 6, pts: [-6000, 0, -5990, 12, 6000, -3] }],
  areas: [{ id: 3, kind: 'park', ring: [0, 0, 500, 0, 500, 500] }],
  points: { tree: [10, 20], lamp: [], bench: [] },
  stats: { buildings: 1, heightsGuessed: 0, roadKm: 1.2, areas: 1, mappedTrees: 1, mappedLamps: 0 },
};

describe('pack wire format', () => {
  it('stores differences instead of full coordinates', () => {
    const wire = encodePack(pack);
    expect(wire.delta).toBe(1);
    expect(wire.buildings[0].ring).toEqual([1000, 2000, 100, 0, 0, 80, -100, 0]);
    expect(wire.lines[0].pts).toEqual([-6000, 0, 10, 12, 11990, -15]);
    expect(wire.terrain.heights).toEqual([100, 4, -5, 151]);
  });

  it('restores exactly the same pack and leaves the input untouched', () => {
    const before = JSON.stringify(pack);
    const restored = decodePack(JSON.parse(JSON.stringify(encodePack(pack))));
    expect(JSON.stringify(pack)).toBe(before);
    expect(restored).toEqual(pack);
  });
});
