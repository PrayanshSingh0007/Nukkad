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
}

/** A small filled circle at the end of a road; it fills the notch where two roads meet at an angle. */
export interface RoadDisc {
  kind: LineKind;
  x: number;
  z: number;
  radius: number;
}

const DISC_SIDES = 6;

function addGroundVertex(mesh: MeshBuilder, terrain: TerrainGrid, x: number, z: number, kind: LineKind): number {
  const style = LINE_STYLES[kind];
  const [nx, ny, nz] = normalAt(terrain, x, z);
  return mesh.addVertex(x, heightAt(terrain, x, z) + style.lift, z, nx, ny, nz, style.color);
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
    const left = addGroundVertex(mesh, terrain, ribbon.left[i * 2], ribbon.left[i * 2 + 1], ribbon.kind);
    const right = addGroundVertex(mesh, terrain, ribbon.right[i * 2], ribbon.right[i * 2 + 1], ribbon.kind);
    if (i > from) {
      mesh.addTriangleFacing(prevLeft, left, prevRight, true);
      mesh.addTriangleFacing(prevRight, left, right, true);
    }
    prevLeft = left;
    prevRight = right;
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
