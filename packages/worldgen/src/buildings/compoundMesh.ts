import type { MeshBuilder, Rgb } from '../mesh/meshBuilder.ts';
import { linear } from '../style/palette.ts';
import { heightAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';

/** Compound walls and society gates, drawn into the chunk's building mesh (so they are solid). */

export interface GateSpot {
  x: number;
  z: number;
  /** Degrees: the gate's front looks along (sin, cos) of this. */
  face: number;
  /** Half of the opening, metres. */
  half: number;
}

const WALL_HEIGHT = 2.1;
const WALL_HALF_THICK = 0.13;
const WALL = linear('#e7dfcd');
const COPING = linear('#a19c92');
const PILLAR = linear('#c8b496');
const ARCH = linear('#6f6458');
const CABIN = linear('#ddd6c6');
const CABIN_ROOF = linear('#5b6168');
const BOOM_RED = linear('#c8332b');
const BOOM_WHITE = linear('#f1efe9');
const BOOM_BASE = linear('#e1b52c');

/** One flat four-cornered face, wound so it faces along `n`. */
function quad(mesh: MeshBuilder, c: number[][], n: [number, number, number], color: Rgb): void {
  const v = c.map(([x, y, z]) => mesh.addVertex(x, y, z, n[0], n[1], n[2], color, 0, 0, 0));
  const ax = c[1][0] - c[0][0];
  const ay = c[1][1] - c[0][1];
  const az = c[1][2] - c[0][2];
  const bx = c[2][0] - c[0][0];
  const by = c[2][1] - c[0][1];
  const bz = c[2][2] - c[0][2];
  const dot = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
  if (dot >= 0) {
    mesh.addTriangle(v[0], v[1], v[2]);
    mesh.addTriangle(v[0], v[2], v[3]);
  } else {
    mesh.addTriangle(v[0], v[2], v[1]);
    mesh.addTriangle(v[0], v[3], v[2]);
  }
}

/** A box turned to the axes u (right) and f (front); y0..y1 is its height. No bottom face. */
function box(mesh: MeshBuilder, x: number, z: number, y0: number, y1: number, hu: number, hf: number, ux: number, uz: number, color: Rgb): void {
  const fx = -uz;
  const fz = ux;
  const corner = (su: number, sf: number, y: number): number[] => [x + ux * hu * su + fx * hf * sf, y, z + uz * hu * su + fz * hf * sf];
  quad(mesh, [corner(-1, -1, y1), corner(1, -1, y1), corner(1, 1, y1), corner(-1, 1, y1)], [0, 1, 0], color);
  quad(mesh, [corner(-1, 1, y0), corner(1, 1, y0), corner(1, 1, y1), corner(-1, 1, y1)], [fx, 0, fz], color);
  quad(mesh, [corner(1, -1, y0), corner(-1, -1, y0), corner(-1, -1, y1), corner(1, -1, y1)], [-fx, 0, -fz], color);
  quad(mesh, [corner(1, 1, y0), corner(1, -1, y0), corner(1, -1, y1), corner(1, 1, y1)], [ux, 0, uz], color);
  quad(mesh, [corner(-1, -1, y0), corner(-1, 1, y0), corner(-1, 1, y1), corner(-1, -1, y1)], [-ux, 0, -uz], color);
}

/** Wall pieces [ax, az, bx, bz, …] in metres: plastered both sides, a grey coping on top. */
export function appendWalls(mesh: MeshBuilder, walls: number[], terrain: TerrainGrid): void {
  for (let i = 0; i + 3 < walls.length; i += 4) {
    const ax = walls[i];
    const az = walls[i + 1];
    const bx = walls[i + 2];
    const bz = walls[i + 3];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.1) continue;
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;
    const nx = uz * WALL_HALF_THICK;
    const nz = -ux * WALL_HALF_THICK;
    const ya = heightAt(terrain, ax, az);
    const yb = heightAt(terrain, bx, bz);
    const base = Math.min(ya, yb) - 0.4;
    const ta = ya + WALL_HEIGHT;
    const tb = yb + WALL_HEIGHT;
    const n: [number, number, number] = [uz, 0, -ux];
    quad(mesh, [[ax + nx, base, az + nz], [bx + nx, base, bz + nz], [bx + nx, tb, bz + nz], [ax + nx, ta, az + nz]], n, WALL);
    quad(mesh, [[bx - nx, base, bz - nz], [ax - nx, base, az - nz], [ax - nx, ta, az - nz], [bx - nx, tb, bz - nz]], [-n[0], 0, -n[2]], WALL);
    quad(mesh, [[ax + nx * 1.3, ta + 0.08, az + nz * 1.3], [bx + nx * 1.3, tb + 0.08, bz + nz * 1.3], [bx - nx * 1.3, tb + 0.08, bz - nz * 1.3], [ax - nx * 1.3, ta + 0.08, az - nz * 1.3]], [0, 1, 0], COPING);
    // The coping's outer lip, so the top line reads from the street.
    quad(mesh, [[ax + nx * 1.3, ta - 0.06, az + nz * 1.3], [bx + nx * 1.3, tb - 0.06, bz + nz * 1.3], [bx + nx * 1.3, tb + 0.08, bz + nz * 1.3], [ax + nx * 1.3, ta + 0.08, az + nz * 1.3]], n, COPING);
  }
}

/** Arch over the road in: pillars, a beam that carries the name board, a security cabin and a raised boom. */
export const GATE_ARCH_BOTTOM = 4.4;
export const GATE_ARCH_TOP = 5.9;
export const GATE_ARCH_HALF_DEPTH = 0.45;

export function appendGate(mesh: MeshBuilder, gate: GateSpot, terrain: TerrainGrid): void {
  const a = (gate.face * Math.PI) / 180;
  const ux = Math.cos(a);
  const uz = -Math.sin(a);
  const fx = Math.sin(a);
  const fz = Math.cos(a);
  const ground = heightAt(terrain, gate.x, gate.z);
  const base = ground - 0.4;
  const at = (u: number, f: number): [number, number] => [gate.x + ux * u + fx * f, gate.z + uz * u + fz * f];
  const pillar = gate.half + 0.5;
  for (const side of [-1, 1]) {
    const [px, pz] = at(side * pillar, 0);
    box(mesh, px, pz, base, GATE_ARCH_TOP + ground + 0.3, 0.5, 0.5, ux, uz, PILLAR);
    box(mesh, px, pz, GATE_ARCH_TOP + ground + 0.3, GATE_ARCH_TOP + ground + 0.5, 0.62, 0.62, ux, uz, ARCH); // cap
  }
  box(mesh, gate.x, gate.z, ground + GATE_ARCH_BOTTOM, ground + GATE_ARCH_TOP, pillar, GATE_ARCH_HALF_DEPTH, ux, uz, ARCH);
  // Security cabin just inside, by the right pillar.
  const [cx, cz] = at(pillar + 2.1, -2.2);
  box(mesh, cx, cz, base, ground + 2.6, 1.2, 1.2, ux, uz, CABIN);
  box(mesh, cx, cz, ground + 2.6, ground + 2.8, 1.5, 1.5, ux, uz, CABIN_ROOF);
  // Boom barrier, standing up (open), inside the left pillar.
  const [bx, bz] = at(-pillar + 0.2, -1.1);
  box(mesh, bx, bz, base, ground + 1.0, 0.22, 0.22, ux, uz, BOOM_BASE);
  for (let k = 0; k < 6; k++) box(mesh, bx, bz, ground + 1.0 + k * 0.5, ground + 1.5 + k * 0.5, 0.06, 0.06, ux, uz, k % 2 ? BOOM_WHITE : BOOM_RED);
}
