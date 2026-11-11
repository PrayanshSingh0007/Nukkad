/**
 * 2D polygon helpers on the ground plane.
 * A ring is a flat array [x0, z0, x1, z1, …]; the first point is NOT repeated at the end.
 *
 * Orientation rule used everywhere: an outer ring has POSITIVE signed area in (x, z),
 * a hole has negative area. For an edge going (dx, dz) the solid is then on the left
 * and the outward direction is (dz, -dx).
 */
export type Ring = number[];

export function signedArea(ring: Ring): number {
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    sum += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  return sum / 2;
}

export function reverseRing(ring: Ring): Ring {
  const n = ring.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 2) {
    out[i] = ring[n - 2 - i];
    out[i + 1] = ring[n - 1 - i];
  }
  return out;
}

/** Returns the ring wound so that its signed area is positive (or negative). */
export function orientRing(ring: Ring, positive: boolean): Ring {
  return signedArea(ring) > 0 === positive ? ring : reverseRing(ring);
}

/** Drops repeated neighbours (and a repeated closing point). */
export function cleanRing(ring: Ring, minGap = 0.01): Ring {
  const out: number[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.abs(ring[i] - out[n - 2]) < minGap && Math.abs(ring[i + 1] - out[n - 1]) < minGap) continue;
    out.push(ring[i], ring[i + 1]);
  }
  while (
    out.length >= 4 &&
    Math.abs(out[0] - out[out.length - 2]) < minGap &&
    Math.abs(out[1] - out[out.length - 1]) < minGap
  ) {
    out.length -= 2;
  }
  return out;
}

export function ringBounds(ring: Ring): [minX: number, minZ: number, maxX: number, maxZ: number] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    if (ring[i] < minX) minX = ring[i];
    if (ring[i] > maxX) maxX = ring[i];
    if (ring[i + 1] < minZ) minZ = ring[i + 1];
    if (ring[i + 1] > maxZ) maxZ = ring[i + 1];
  }
  return [minX, minZ, maxX, maxZ];
}

/** Area-weighted centre; falls back to the average point for degenerate rings. */
export function ringCentroid(ring: Ring): [x: number, z: number] {
  let area = 0;
  let cx = 0;
  let cz = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const cross = ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
    area += cross;
    cx += (ring[i] + ring[j]) * cross;
    cz += (ring[i + 1] + ring[j + 1]) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < n; i += 2) {
      sx += ring[i];
      sz += ring[i + 1];
    }
    return [sx / (n / 2), sz / (n / 2)];
  }
  return [cx / (3 * area), cz / (3 * area)];
}

export function pointInRing(x: number, z: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i];
    const zi = ring[i + 1];
    const xj = ring[j];
    const zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, z: number, ring: Ring, holes?: Ring[]): boolean {
  if (!pointInRing(x, z, ring)) return false;
  if (holes) {
    for (const hole of holes) if (pointInRing(x, z, hole)) return false;
  }
  return true;
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  let t = lengthSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lengthSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Distance from a point to the outline of a ring. */
export function distToRing(x: number, z: number, ring: Ring): number {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const d = distToSegment(x, z, ring[i], ring[i + 1], ring[j], ring[j + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Inserts points so that no edge of the ring is longer than `maxStep`. */
export function densifyRing(ring: Ring, maxStep: number): Ring {
  const out: number[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = ring[i];
    const az = ring[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(ring[j] - ax, ring[j + 1] - az) / maxStep));
    for (let s = 0; s < steps; s++) {
      out.push(ax + ((ring[j] - ax) * s) / steps, az + ((ring[j + 1] - az) * s) / steps);
    }
  }
  return out;
}
