import type { LineKind } from '@nukkad/shared';
import type { MeshBuilder } from '../mesh/meshBuilder.ts';
import { LINE_STYLES } from '../style/palette.ts';
import { heightAt, normalAt } from '../terrain/grid.ts';
import type { TerrainGrid } from '../terrain/grid.ts';
import type { Ribbon } from './ribbon.ts';

/** A stretch of one ribbon that lies in one chunk: cross-sections `from`…`to` inclusive. */
export interface RibbonRun {
  ribbon: Ribbon;
  from: number;
  to: number;
  /** The same road, wider: the strips between the two outlines are the footpaths. */
  walk?: Ribbon;
}

/** Footpaths lie a little lower than every road, so a side street always covers them at its mouth. */
const WALK_LIFT = 0.045;
const WALK_COLOR = [0x8a, 0x86, 0x7e] as const;
const MAIN_ROADS = new Set<LineKind>(['trunk', 'primary', 'secondary']);

/** A small filled circle at the end of a road; it fills the notch where two roads meet at an angle. */
export interface RoadDisc {
  kind: LineKind;
  x: number;
  z: number;
  radius: number;
}

const DISC_SIDES = 6;

/**
 * Extra numbers per vertex for the road shader: metres across from the centre line,
 * metres along the road, and the half width (0 = no painted markings).
 */
function addGroundVertex(mesh: MeshBuilder, terrain: TerrainGrid, x: number, z: number, kind: LineKind, across = 0, along = 0, half = 0, rise = 0): number {
  const style = LINE_STYLES[kind];
  const [nx, ny, nz] = rise > 0.3 ? [0, 1, 0] : normalAt(terrain, x, z);
  return mesh.addVertex(x, heightAt(terrain, x, z) + style.lift + rise, z, nx, ny, nz, style.color, across, along, half);
}

/** Height of a bridge deck at a cross-section: the higher end of the ground under it, plus the rise. */
export function deckHeight(ribbon: Ribbon, i: number, terrain: TerrainGrid): number {
  const a = heightAt(terrain, ribbon.left[i * 2], ribbon.left[i * 2 + 1]);
  const b = heightAt(terrain, ribbon.right[i * 2], ribbon.right[i * 2 + 1]);
  return Math.max(a, b) + (ribbon.rise ? ribbon.rise[i] : 0);
}

/**
 * Lays one stretch of road on the ground: two triangles between each pair of cross-sections.
 * `stride` > 1 skips cross-sections (far away the road need not follow every bump).
 */
export function appendRibbonRun(mesh: MeshBuilder, run: RibbonRun, terrain: TerrainGrid, stride = 1): void {
  const { ribbon, from, to } = run;
  let prevLeft = -1;
  let prevRight = -1;
  for (let i = from; i <= to; i = i === to ? to + 1 : Math.min(to, i + stride)) {
    const half = ribbon.markings ? ribbon.halfWidth : 0;
    // On a bridge both edges sit on one flat deck (the ground under it may slope).
    const rl = ribbon.rise ? deckHeight(ribbon, i, terrain) - heightAt(terrain, ribbon.left[i * 2], ribbon.left[i * 2 + 1]) : 0;
    const rr = ribbon.rise ? deckHeight(ribbon, i, terrain) - heightAt(terrain, ribbon.right[i * 2], ribbon.right[i * 2 + 1]) : 0;
    const left = addGroundVertex(mesh, terrain, ribbon.left[i * 2], ribbon.left[i * 2 + 1], ribbon.kind, -ribbon.halfWidth, ribbon.along[i], half, rl);
    const right = addGroundVertex(mesh, terrain, ribbon.right[i * 2], ribbon.right[i * 2 + 1], ribbon.kind, ribbon.halfWidth, ribbon.along[i], half, rr);
    if (i > from) {
      mesh.addTriangleFacing(prevLeft, left, prevRight, true);
      mesh.addTriangleFacing(prevRight, left, right, true);
    }
    prevLeft = left;
    prevRight = right;
  }
  if (run.walk && stride === 1 && !ribbon.rise) appendFootpaths(mesh, run, run.walk, terrain);
}

/**
 * Footpaths: a paved strip on each side of the road. The shader reads (metres from the kerb,
 * metres along, -1 or -2): -2 = a main road, whose kerb stones are painted yellow and black.
 */
function appendFootpaths(mesh: MeshBuilder, run: RibbonRun, walk: Ribbon, terrain: TerrainGrid): void {
  const { ribbon, from, to } = run;
  const flag = MAIN_ROADS.has(ribbon.kind) ? -2 : -1;
  const width = walk.halfWidth - ribbon.halfWidth;
  const add = (x: number, z: number, across: number, along: number): number => {
    const [nx, ny, nz] = normalAt(terrain, x, z);
    return mesh.addVertex(x, heightAt(terrain, x, z) + WALK_LIFT, z, nx, ny, nz, WALK_COLOR, across, along, flag);
  };
  for (const side of ['left', 'right'] as const) {
    let prevInner = -1;
    let prevOuter = -1;
    for (let i = from; i <= to; i++) {
      const inner = add(ribbon[side][i * 2], ribbon[side][i * 2 + 1], 0, ribbon.along[i]);
      const outer = add(walk[side][i * 2], walk[side][i * 2 + 1], width, ribbon.along[i]);
      if (i > from) {
        mesh.addTriangleFacing(prevInner, inner, prevOuter, true);
        mesh.addTriangleFacing(prevOuter, inner, outer, true);
      }
      prevInner = inner;
      prevOuter = outer;
    }
  }
}

export function appendDisc(mesh: MeshBuilder, disc: RoadDisc, terrain: TerrainGrid): void {
  const rim: number[] = [];
  for (let k = 0; k < DISC_SIDES; k++) {
    const angle = (k / DISC_SIDES) * Math.PI * 2;
    rim.push(addGroundVertex(mesh, terrain, disc.x + Math.cos(angle) * disc.radius, disc.z + Math.sin(angle) * disc.radius, disc.kind));
  }
  for (let k = 1; k < DISC_SIDES - 1; k++) mesh.addTriangleFacing(rim[0], rim[k], rim[k + 1], true);
}
