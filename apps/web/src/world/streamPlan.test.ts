import { describe, expect, it } from 'vitest';
import { chunkAt, distanceToChunk, planChunks } from './streamPlan.ts';
import type { StreamSettings } from './streamPlan.ts';

const s: StreamSettings = { half: 600, chunksPerSide: 8, chunkSize: 150, nearRing: 1, viewDistance: 350, hysteresis: 30 };

describe('chunk streaming plan', () => {
  it('finds chunks and distances', () => {
    expect(chunkAt(0, 0, s)).toEqual([4, 4]);
    expect(chunkAt(-9999, 9999, s)).toEqual([0, 7]);
    expect(distanceToChunk(10, 10, 4, 4, s)).toBe(0);
    expect(distanceToChunk(10, 10, 5, 4, s)).toBe(140);
  });

  it('loads 3 × 3 at full detail and the rest of the view simplified', () => {
    const plan = planChunks(75, 75, new Map(), s);
    const near = [...plan].filter(([, lod]) => lod === 0).map(([key]) => key).sort();
    expect(near).toEqual(['3,3', '3,4', '3,5', '4,3', '4,4', '4,5', '5,3', '5,4', '5,5']);
    expect(plan.get('0,4')).toBeUndefined(); // 525 m away: beyond the 350 m view
    expect(plan.get('2,4')).toBe(1); // 225 m away
    expect(plan.size).toBeLessThan(64);
  });

  it('does not flip-flop right after crossing a border', () => {
    const before = planChunks(5, 75, new Map(), s); // just inside chunk 4
    const after = planChunks(-5, 75, before, s); // 10 m into chunk 3
    expect(after.get('5,4')).toBe(0); // kept at full detail thanks to hysteresis
    expect(planChunks(-5, 75, new Map(), s).get('5,4')).toBe(1); // a fresh plan would drop it to far
  });
});
