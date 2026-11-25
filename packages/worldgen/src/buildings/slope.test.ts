import { describe, expect, it } from 'vitest';
import type { PackBuilding } from '@nukkad/shared';
import { terrainFromPack } from '../terrain/grid.ts';
import { addFloorsForSlope } from './slope.ts';

/** 5 × 5 samples 10 m apart (the area is 40 m across, centred on 0), rising `rise` m per cell to the east. */
function ground(rise: number) {
  const heights: number[] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) heights.push(Math.round(i * rise * 100));
  return terrainFromPack({ size: 5, cell: 10, base: 0, heights });
}

/** A square building from x0 to x1 (metres) and z −5 to 5, 4 floors of 3 m. */
function block(x0: number, x1: number): PackBuilding {
  const ring = [x0, -5, x1, -5, x1, 5, x0, 5].map((v) => v * 10); // decimetres
  return { id: 1, kind: 'civic', h: 12, floors: 4, ring };
}

describe('addFloorsForSlope', () => {
  it('adds the storeys a slope uncovers, keeping the storey height', () => {
    const building = block(-10, 10); // ground under it rises 6.4 m (3.2 m a cell)
    addFloorsForSlope(building, ground(3.2));
    expect(building.floors).toBe(6);
    expect(building.h).toBeCloseTo(18);
  });

  it('leaves buildings on level ground or a gentle slope alone', () => {
    const level = block(-10, 10);
    addFloorsForSlope(level, ground(0));
    expect([level.floors, level.h]).toEqual([4, 12]);
    const gentle = block(-10, 10); // 2 m across: less than a storey
    addFloorsForSlope(gentle, ground(1));
    expect([gentle.floors, gentle.h]).toEqual([4, 12]);
  });

  it('never changes a floating part (carports, upper parts)', () => {
    const part = { ...block(-10, 10), minH: 3 };
    addFloorsForSlope(part, ground(3.2));
    expect([part.floors, part.h]).toEqual([4, 12]);
  });
});
