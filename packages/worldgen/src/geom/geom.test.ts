import { describe, expect, it } from 'vitest';
import { clipLineToSquare, clipRingToSquare } from './clip.ts';
import { cleanRing, densifyRing, simplifyRing, distToSegment, orientRing, pointInPolygon, ringCentroid, signedArea } from './polygon.ts';

const square = [0, 0, 10, 0, 10, 10, 0, 10];

describe('polygon helpers', () => {
  it('measures signed area and can flip a ring', () => {
    expect(signedArea(square)).toBe(100);
    const flipped = orientRing(square, false);
    expect(signedArea(flipped)).toBe(-100);
    expect(flipped).toEqual([0, 10, 10, 10, 10, 0, 0, 0]);
    expect(orientRing(flipped, true)).toEqual(square);
    expect(orientRing(square, true)).toBe(square);
  });

  it('finds the centre and tests points, including holes', () => {
    expect(ringCentroid(square)).toEqual([5, 5]);
    const hole = [4, 4, 4, 6, 6, 6, 6, 4];
    expect(pointInPolygon(1, 1, square, [hole])).toBe(true);
    expect(pointInPolygon(5, 5, square, [hole])).toBe(false);
    expect(pointInPolygon(11, 5, square)).toBe(false);
  });

  it('removes repeated points and a repeated closing point', () => {
    expect(cleanRing([0, 0, 0, 0, 10, 0, 10, 10, 0, 10, 0, 0])).toEqual(square);
  });

  it('measures distance to a segment and densifies long edges', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    const dense = densifyRing(square, 4);
    expect(dense.length).toBe(24);
    expect(signedArea(dense)).toBeCloseTo(100);
  });
});

describe('simplifying outlines', () => {
  it('drops points that barely change the shape and keeps corners', () => {
    const wobbly = [0, 0, 5, 0.2, 10, 0, 10, 5, 10.3, 10, 0, 10, 0.1, 5];
    expect(simplifyRing(wobbly, 0.5)).toEqual([0, 0, 10, 0, 10.3, 10, 0, 10]);
    expect(simplifyRing(square, 0.5)).toBe(square);
  });
});

describe('clipping to the area square', () => {
  it('cuts a ring that sticks out', () => {
    const clipped = clipRingToSquare([-5, -5, 20, -5, 20, 5, -5, 5], 10);
    expect(signedArea(clipped)).toBeCloseTo(150);
    for (let i = 0; i < clipped.length; i++) expect(Math.abs(clipped[i])).toBeLessThanOrEqual(10);
  });

  it('drops a ring that is completely outside', () => {
    expect(clipRingToSquare([20, 20, 30, 20, 30, 30], 10)).toEqual([]);
  });

  it('splits a line that leaves and comes back', () => {
    const pieces = clipLineToSquare([-20, 0, 0, 0, 0, 20, 5, 20, 5, 0], 10);
    expect(pieces).toEqual([
      [-10, 0, 0, 0, 0, 10],
      [5, 10, 5, 0],
    ]);
  });
});
