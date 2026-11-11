import type { Ring } from './polygon.ts';

/**
 * Cuts shapes to the square [-half, half] × [-half, half] so nothing in a pack
 * reaches outside its area.
 */

/** Keeps the part of a ring on one side of an axis-aligned line (one Sutherland–Hodgman pass). */
function clipHalfPlane(input: Ring, axis: 0 | 1, limit: number, keepBelow: boolean): Ring {
  const out: number[] = [];
  const n = input.length;
  if (n === 0) return out;
  const inside = (i: number): boolean => (keepBelow ? input[i + axis] <= limit : input[i + axis] >= limit);
  let prev = n - 2;
  let prevIn = inside(prev);
  for (let cur = 0; cur < n; cur += 2) {
    const curIn = inside(cur);
    if (curIn !== prevIn) {
      const a = input[prev + axis];
      const b = input[cur + axis];
      const t = (limit - a) / (b - a);
      out.push(input[prev] + (input[cur] - input[prev]) * t, input[prev + 1] + (input[cur + 1] - input[prev + 1]) * t);
    }
    if (curIn) out.push(input[cur], input[cur + 1]);
    prev = cur;
    prevIn = curIn;
  }
  return out;
}

export function clipRingToSquare(ring: Ring, half: number): Ring {
  let out = clipHalfPlane(ring, 0, half, true);
  out = clipHalfPlane(out, 0, -half, false);
  out = clipHalfPlane(out, 1, half, true);
  out = clipHalfPlane(out, 1, -half, false);
  return out;
}

/** Liang–Barsky: the part [t0, t1] of segment a→b that lies inside the square, or null. */
function clipSegment(ax: number, az: number, bx: number, bz: number, half: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const p = [-dx, dx, -dz, dz];
  const q = [ax + half, half - ax, az + half, half - az];
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return null;
      continue;
    }
    const r = q[k] / p[k];
    if (p[k] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [t0, t1];
}

/** Cuts a polyline to the square. A line that leaves and comes back becomes several pieces. */
export function clipLineToSquare(pts: number[], half: number): number[][] {
  const pieces: number[][] = [];
  let current: number[] | null = null;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const az = pts[i + 1];
    const bx = pts[i + 2];
    const bz = pts[i + 3];
    const range = clipSegment(ax, az, bx, bz, half);
    if (!range) {
      current = null;
      continue;
    }
    const [t0, t1] = range;
    if (!current || t0 > 0) {
      current = [ax + (bx - ax) * t0, az + (bz - az) * t0];
      pieces.push(current);
    }
    current.push(ax + (bx - ax) * t1, az + (bz - az) * t1);
    if (t1 < 1) current = null;
  }
  return pieces.filter((piece) => piece.length >= 4);
}
