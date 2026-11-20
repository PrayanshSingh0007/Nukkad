import { describe, expect, it } from 'vitest';
import type { AreaPack, PackBuilding, PackLine } from '@nukkad/shared';
import { houseCompounds } from './houseCompounds.ts';
import type { Door } from './doors.ts';

// Pack units are decimetres. A 10 × 8 m house whose front (z = 8 m) faces a 6 m residential
// road 12 m away (centre line at z = 20 m, footpath 1.6 m each side).
const house: PackBuilding = { id: 1, kind: 'house', h: 6.5, floors: 2, ring: [0, 0, 100, 0, 100, 80, 0, 80] };
const road: PackLine = { id: 9, kind: 'residential', w: 6, pts: [-300, 200, 400, 200] };
const door: Door = { id: 1, x: 3, z: 8, y: 0, face: 0, kind: 'home', w: 10, d: 8 } as Door;
const pack = (buildings: PackBuilding[], lines: PackLine[]): AreaPack => ({ buildings, lines }) as unknown as AreaPack;

describe('house compound walls', () => {
  const out = houseCompounds(pack([house], [road]), [door]);

  it('puts a wall across the front yard, with side walls, and none on the road or footpath', () => {
    expect(out.walls.length / 5).toBe(4);
    for (let i = 0; i < out.walls.length; i += 5) {
      for (const z of [out.walls[i + 1], out.walls[i + 3]]) {
        expect(z).toBeGreaterThanOrEqual(8 - 1e-6); // in front of the house
        expect(z).toBeLessThan(20 - 3 - 1.6); // short of the footpath
      }
    }
  });

  it('opens the gate in front of the door, between two pillars with globe lamps', () => {
    expect(out.pillars.length / 5).toBe(2);
    expect(out.lamps.length / 2).toBe(2);
    const gateX = (out.pillars[0] + out.pillars[5]) / 2;
    expect(gateX).toBeCloseTo(3, 0);
    // No wall piece covers the gate opening.
    for (let i = 0; i < out.walls.length; i += 5) {
      const [ax, , bx] = out.walls.slice(i, i + 3);
      const lo = Math.min(ax, bx);
      const hi = Math.max(ax, bx);
      if (Math.abs(out.walls[i + 1] - out.walls[i + 3]) < 1e-6) expect(gateX > lo && gateX < hi).toBe(false);
    }
  });

  it('leaves houses with no road in front, and shops, alone', () => {
    expect(houseCompounds(pack([house], []), [door]).walls).toHaveLength(0);
    expect(houseCompounds(pack([{ ...house, kind: 'retail' }], [road]), [door]).walls).toHaveLength(0);
  });

  it('keeps walls out of a neighbouring building', () => {
    // A shed filling the left part of the front yard.
    const shed: PackBuilding = { id: 2, kind: 'shed', h: 3, floors: 1, ring: [-20, 85, 25, 85, 25, 140, -20, 140] };
    const crowded = houseCompounds(pack([house, shed], [road]), [door]);
    expect(crowded.walls.length / 5).toBeLessThan(4);
  });
});
