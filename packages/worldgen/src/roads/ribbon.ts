import type { LineKind } from '@nukkad/shared';

/**
 * A road (or path, rail, stream) as a flat strip: for every point of the centre
 * line we keep the point on the left edge and the point on the right edge.
 */
export interface Ribbon {
  kind: LineKind;
  halfWidth: number;
  /** Number of cross-sections. */
  count: number;
  /** [x0, z0, x1, z1, …] for each edge. */
  left: Float32Array;
  right: Float32Array;
  /** Metres from the start of the line to each cross-section (for dashed lines). */
  along: Float32Array;
  /** Car roads get painted markings. */
  markings: boolean;
  /** Bridges and flyovers: metres above the ground at each cross-section. */
  rise?: Float32Array;
}

/**
 * How high a bridge rides along its length: long ones are flyovers (6.5 m clearance) with
 * ramps at both ends; short ones (over a drain or a canal) just lift a little.
 */
export function bridgeRise(along: Float32Array): Float32Array {
  const total = along[along.length - 1] || 1;
  const clearance = total > 120 ? 6.5 : Math.min(2.5, total * 0.04);
  const ramp = Math.min(70, total / 3);
  const rise = new Float32Array(along.length);
  for (let i = 0; i < along.length; i++) {
    const fromEnd = Math.min(along[i], total - along[i]);
    const t = Math.min(1, fromEnd / ramp);
    rise[i] = clearance * t * t * (3 - 2 * t); // smooth ramp
  }
  return rise;
}

const MARKED = new Set<LineKind>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential']);

/** Roads are cut into pieces no longer than this so they can follow the ground. */
export const MAX_STEP_M = 6;
/** Sharp corners would make the outer edge shoot far out; the corner is capped at this factor. */
const MAX_MITRE = 2.5;

/** Removes repeated points and inserts points so no piece is longer than `maxStep`. */
function resample(pts: number[], maxStep: number): number[] {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = out[out.length - 2];
    const az = out[out.length - 1];
    const distance = Math.hypot(pts[i] - ax, pts[i + 1] - az);
    if (distance < 0.05) continue;
    const steps = Math.ceil(distance / maxStep);
    for (let s = 1; s <= steps; s++) {
      out.push(ax + ((pts[i] - ax) * s) / steps, az + ((pts[i + 1] - az) * s) / steps);
    }
  }
  return out;
}

/** Centre line (metres) + width → strip. Returns null for lines that are too short to draw. */
export function buildRibbon(kind: LineKind, ptsM: number[], width: number, maxStep = MAX_STEP_M): Ribbon | null {
  const pts = resample(ptsM, maxStep);
  const count = pts.length / 2;
  if (count < 2) return null;
  const halfWidth = width / 2;
  const left = new Float32Array(count * 2);
  const right = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const x = pts[i * 2];
    const z = pts[i * 2 + 1];
    // Direction of the piece arriving at this point and of the piece leaving it.
    let inX = 0;
    let inZ = 0;
    let outX = 0;
    let outZ = 0;
    if (i > 0) {
      inX = x - pts[i * 2 - 2];
      inZ = z - pts[i * 2 - 1];
      const length = Math.hypot(inX, inZ);
      inX /= length;
      inZ /= length;
    }
    if (i < count - 1) {
      outX = pts[i * 2 + 2] - x;
      outZ = pts[i * 2 + 3] - z;
      const length = Math.hypot(outX, outZ);
      outX /= length;
      outZ /= length;
    }
    if (i === 0) {
      inX = outX;
      inZ = outZ;
    } else if (i === count - 1) {
      outX = inX;
      outZ = inZ;
    }
    let tx = inX + outX;
    let tz = inZ + outZ;
    const tLength = Math.hypot(tx, tz);
    if (tLength < 1e-6) {
      tx = inX; // a U-turn: just keep the incoming direction
      tz = inZ;
    } else {
      tx /= tLength;
      tz /= tLength;
    }
    // Sideways direction, and how much wider the strip must be at a bend to keep its width.
    const sx = -tz;
    const sz = tx;
    const cosHalfBend = sx * -inZ + sz * inX;
    const reach = halfWidth * Math.min(MAX_MITRE, 1 / Math.max(cosHalfBend, 1e-3));
    left[i * 2] = x + sx * reach;
    left[i * 2 + 1] = z + sz * reach;
    right[i * 2] = x - sx * reach;
    right[i * 2 + 1] = z - sz * reach;
  }
  const along = new Float32Array(count);
  for (let i = 1; i < count; i++) along[i] = along[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return { kind, halfWidth, count, left, right, along, markings: MARKED.has(kind) && width >= 5.5 };
}
