import { describe, expect, it } from 'vitest';
import type { PackBuilding, PackTerrain } from '@nukkad/shared';
import { fillPolygon } from '../areas/groundMap.ts';
import { appendBuilding, buildingTriangleEstimate } from '../buildings/buildingMesh.ts';
import { MeshBuilder } from '../mesh/meshBuilder.ts';
import type { MeshData } from '../mesh/meshBuilder.ts';
import { buildRibbon } from '../roads/ribbon.ts';
import { buildTerrainMesh, heightAt, terrainFromPack } from '../terrain/grid.ts';

/** A small sloping test ground: 5 × 5 samples, 10 m apart, rising 1 m per cell to the east. */
function slope(): PackTerrain {
  const heights: number[] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) heights.push(i * 100);
  return { size: 5, cell: 10, base: 0, heights };
}

/** Geometric normal of triangle t of a mesh. */
function faceNormal(mesh: MeshData, t: number): [number, number, number] {
  const [a, b, c] = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
  const p = (v: number, k: number): number => mesh.positions[v * 3 + k];
  const u = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)];
  const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

describe('terrain', () => {
  const terrain = terrainFromPack(slope());

  it('returns exact heights at samples and blends between them', () => {
    expect(heightAt(terrain, -20, -20)).toBe(0);
    expect(heightAt(terrain, 20, 20)).toBe(4);
    expect(heightAt(terrain, -15, 3)).toBeCloseTo(0.5);
    expect(heightAt(terrain, 999, 0)).toBe(4); // outside → clamped to the edge
  });

  it('builds a mesh whose triangles all face up', () => {
    const mesh = buildTerrainMesh(terrain);
    expect(mesh.indices.length).toBe(4 * 4 * 2 * 3);
    for (let t = 0; t < mesh.indices.length / 3; t++) {
      const a = mesh.indices[t * 3];
      const b = mesh.indices[t * 3 + 1];
      const c = mesh.indices[t * 3 + 2];
      const p = mesh.positions;
      const ny = (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
      expect(ny).toBeGreaterThan(0);
    }
  });
});

describe('building mesh', () => {
  const terrain = terrainFromPack(slope());
  const box: PackBuilding = { id: 7, kind: 'house', h: 6.5, floors: 2, ring: [0, 0, 100, 0, 100, 80, 0, 80] };

  it('makes 2 triangles per wall plus the roof, all facing outwards', () => {
    const builder = new MeshBuilder(true);
    appendBuilding(builder, box, terrain);
    const mesh = builder.finish() as MeshData;
    expect(mesh.indices.length / 3).toBe(10);
    expect(buildingTriangleEstimate(box)).toBe(10);
    const centre = [5, 0, 4];
    for (let t = 0; t < 10; t++) {
      const normal = faceNormal(mesh, t);
      const a = mesh.indices[t * 3];
      const toFace = [mesh.positions[a * 3] - centre[0], 0, mesh.positions[a * 3 + 2] - centre[2]];
      const isRoof = Math.abs(normal[1]) > 1e-6;
      if (isRoof) expect(normal[1]).toBeGreaterThan(0);
      else expect(normal[0] * toFace[0] + normal[2] * toFace[2]).toBeGreaterThan(0);
      // the stored (shading) normal agrees with the real one
      const stored = [mesh.normals[a * 3], mesh.normals[a * 3 + 1], mesh.normals[a * 3 + 2]];
      expect(stored[0] * normal[0] + stored[1] * normal[1] + stored[2] * normal[2]).toBeGreaterThan(0);
    }
  });

  it('stands on the lowest ground under it and reaches below it', () => {
    const builder = new MeshBuilder(true);
    appendBuilding(builder, box, terrain);
    const mesh = builder.finish() as MeshData;
    const ys = Array.from({ length: mesh.positions.length / 3 }, (_, v) => mesh.positions[v * 3 + 1]);
    const ground = heightAt(terrain, 0, 0); // lowest corner (the slope rises to the east)
    expect(Math.max(...ys)).toBeCloseTo(ground + 6.5);
    expect(Math.min(...ys)).toBeCloseTo(ground - 3);
  });

  it('cuts a courtyard out of the roof and walls it', () => {
    const withYard: PackBuilding = { ...box, holes: [[30, 30, 30, 50, 60, 50, 60, 30]] };
    const builder = new MeshBuilder(true);
    appendBuilding(builder, withYard, terrain);
    expect(builder.triangleCount).toBe(buildingTriangleEstimate(withYard));
    expect(builder.triangleCount).toBe(16 + 8);
  });

  it('gives floating parts an underside', () => {
    const canopy: PackBuilding = { ...box, kind: 'roof', h: 4, minH: 3.6, floors: 1 };
    const builder = new MeshBuilder(true);
    appendBuilding(builder, canopy, terrain);
    expect(builder.triangleCount).toBe(12);
  });
});

describe('road ribbons', () => {
  it('keeps the width on straight roads and cuts long pieces', () => {
    const ribbon = buildRibbon('residential', [0, 0, 30, 0], 6);
    expect(ribbon).not.toBeNull();
    expect(ribbon!.count).toBe(6); // 30 m in 6 m steps
    for (let i = 0; i < ribbon!.count; i++) {
      expect(Math.abs(ribbon!.left[i * 2 + 1] - ribbon!.right[i * 2 + 1])).toBeCloseTo(6);
    }
  });

  it('widens the corner on a bend so the road keeps its width', () => {
    const ribbon = buildRibbon('residential', [0, 0, 6, 0, 6, 6], 4)!;
    const corner = 1;
    const reach = Math.hypot(ribbon.left[corner * 2] - 6, ribbon.left[corner * 2 + 1] - 0);
    expect(reach).toBeCloseTo(2 * Math.SQRT2, 3);
  });

  it('returns null for a line with no length', () => {
    expect(buildRibbon('footway', [1, 1, 1, 1], 2)).toBeNull();
  });
});

describe('ground painting', () => {
  it('fills a shape and leaves its hole empty', () => {
    const size = 16;
    const pixels = new Uint8Array(size * size * 4);
    fillPolygon(pixels, size, [[2, 2, 14, 2, 14, 14, 2, 14], [6, 6, 6, 10, 10, 10, 10, 6]], [200, 100, 50]);
    const red = (x: number, y: number): number => pixels[(y * size + x) * 4];
    expect(red(3, 3)).toBe(200);
    expect(red(13, 13)).toBe(200);
    expect(red(8, 8)).toBe(0); // inside the hole
    expect(red(0, 0)).toBe(0); // outside
    expect(red(15, 8)).toBe(0);
  });
});
