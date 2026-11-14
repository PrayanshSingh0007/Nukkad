import type { MeshBuilder, Rgb } from '../mesh/meshBuilder.ts';
import { linear } from '../style/palette.ts';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';
import { deckHeight } from './groundMesh.ts';
import type { RibbonRun } from './groundMesh.ts';

/**
 * The concrete of a bridge or flyover, for the stretch of it in one chunk: the slab's
 * underside and edges, a crash barrier on both sides, and round pillars under the middle
 * every ~24 m. Goes into the chunk's building mesh, so it is solid and casts shadows.
 */
const CONCRETE = linear('#a8a49c');
const UNDER = linear('#7a776f');
const BARRIER = linear('#c9c5bb');
const STRIPE = linear('#d8b13a');
const SLAB_M = 0.9;
const BARRIER_M = 0.95;
const PILLAR_EVERY_M = 24;

function quad(mesh: MeshBuilder, a: number[], b: number[], c: number[], d: number[], n: number[], color: Rgb): void {
  const v = [a, b, c, d].map((p) => mesh.addVertex(p[0], p[1], p[2], n[0], n[1], n[2], color, 0, 0, 0));
  // Wind to face along n: check (b - a) × (c - a) · n.
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const wx = c[0] - a[0];
  const wy = c[1] - a[1];
  const wz = c[2] - a[2];
  const dot = (uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2];
  if (dot >= 0) {
    mesh.addTriangle(v[0], v[1], v[2]);
    mesh.addTriangle(v[0], v[2], v[3]);
  } else {
    mesh.addTriangle(v[0], v[2], v[1]);
    mesh.addTriangle(v[0], v[3], v[2]);
  }
}

export function appendFlyover(mesh: MeshBuilder, run: RibbonRun, terrain: TerrainGrid): void {
  const { ribbon, from, to } = run;
  const rise = ribbon.rise;
  if (!rise) return;
  let nextPillar = Math.ceil(ribbon.along[from] / PILLAR_EVERY_M) * PILLAR_EVERY_M;
  for (let i = from; i < to; i++) {
    const j = i + 1;
    if (Math.max(rise[i], rise[j]) < 0.4) continue;
    const yi = deckHeight(ribbon, i, terrain);
    const yj = deckHeight(ribbon, j, terrain);
    const L = (k: number, y: number): number[] => [ribbon.left[k * 2], y, ribbon.left[k * 2 + 1]];
    const R = (k: number, y: number): number[] => [ribbon.right[k * 2], y, ribbon.right[k * 2 + 1]];
    // Sideways direction (left edge minus right edge, normalised) for side faces.
    const sx = ribbon.left[i * 2] - ribbon.right[i * 2];
    const sz = ribbon.left[i * 2 + 1] - ribbon.right[i * 2 + 1];
    const sl = Math.hypot(sx, sz) || 1;
    const side = [sx / sl, 0, sz / sl];
    const out = [-side[0], 0, -side[2]];
    // Underside and slab edges.
    quad(mesh, L(i, yi - SLAB_M), R(i, yi - SLAB_M), R(j, yj - SLAB_M), L(j, yj - SLAB_M), [0, -1, 0], UNDER);
    quad(mesh, L(i, yi - SLAB_M), L(j, yj - SLAB_M), L(j, yj + 0.05), L(i, yi + 0.05), side, CONCRETE);
    quad(mesh, R(i, yi - SLAB_M), R(j, yj - SLAB_M), R(j, yj + 0.05), R(i, yi + 0.05), out, CONCRETE);
    // Crash barriers on both edges (outer and inner faces, a painted stripe on top).
    for (const [edge, n] of [
      [L, side],
      [R, out],
    ] as const) {
      quad(mesh, edge(i, yi), edge(j, yj), edge(j, yi + BARRIER_M + (yj - yi)), edge(i, yi + BARRIER_M), n, BARRIER);
      quad(mesh, edge(i, yi), edge(j, yj), edge(j, yi + BARRIER_M + (yj - yi)), edge(i, yi + BARRIER_M), [-n[0], 0, -n[2]], BARRIER);
      const a = edge(i, yi + BARRIER_M);
      const b = edge(j, yj + BARRIER_M);
      quad(mesh, a, b, [b[0], b[1] + 0.06, b[2]], [a[0], a[1] + 0.06, a[2]], n, STRIPE);
    }
    // Pillars: a round column from the ground to the slab, with a wider cap.
    while (nextPillar <= ribbon.along[j]) {
      const t = (nextPillar - ribbon.along[i]) / Math.max(0.01, ribbon.along[j] - ribbon.along[i]);
      nextPillar += PILLAR_EVERY_M;
      const r = rise[i] + (rise[j] - rise[i]) * t;
      if (r < 3) continue; // the ramps sit on fill, not pillars
      const cx = (ribbon.left[i * 2] + ribbon.right[i * 2]) / 2 + ((ribbon.left[j * 2] + ribbon.right[j * 2]) / 2 - (ribbon.left[i * 2] + ribbon.right[i * 2]) / 2) * t;
      const cz = (ribbon.left[i * 2 + 1] + ribbon.right[i * 2 + 1]) / 2 + ((ribbon.left[j * 2 + 1] + ribbon.right[j * 2 + 1]) / 2 - (ribbon.left[i * 2 + 1] + ribbon.right[i * 2 + 1]) / 2) * t;
      const top = yi + (yj - yi) * t - SLAB_M;
      const ground = heightAt(terrain, cx, cz) - 0.3;
      const radius = Math.min(1.1, ribbon.halfWidth * 0.18 + 0.5);
      const sides = 10;
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2;
        const a1 = ((k + 1) / sides) * Math.PI * 2;
        const p = (a: number, y: number, rr = radius): number[] => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr];
        const mid = (a0 + a1) / 2;
        const n = [Math.cos(mid), 0, Math.sin(mid)];
        quad(mesh, p(a0, ground), p(a1, ground), p(a1, top - 0.6), p(a0, top - 0.6), n, CONCRETE);
        // Pier cap: flares out to carry the deck.
        quad(mesh, p(a0, top - 0.6), p(a1, top - 0.6), p(a1, top, radius * 2.2), p(a0, top, radius * 2.2), [n[0] * 0.7, -0.7, n[2] * 0.7], CONCRETE);
      }
    }
  }
}
