import * as THREE from 'three';
import { CHUNK_SIZE } from '@nukkad/shared';
import { BENCH_STRIDE, LAMP_STRIDE, TREE_STRIDE, heightAt } from '@nukkad/worldgen';
import type { ChunkData, MeshData, PropSet, TerrainGrid } from '@nukkad/worldgen';
import type { ReadyMessage } from '../workers/protocol.ts';
import { createMaterials } from './materials.ts';
import type { WorldMaterials } from './materials.ts';
import { createPropModels } from './propModels.ts';

export interface WorldViewOptions {
  /** How many trees to draw (the list is shuffled, so any prefix is evenly spread). */
  maxTrees: number;
  windows: boolean;
  /** Sharper ground texture at flat angles; 1 = off. */
  anisotropy: number;
}

function meshToGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3, true));
  if (mesh.extra) geometry.setAttribute('aWin', new THREE.BufferAttribute(mesh.extra, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Everything of one loaded world that is on screen: terrain, water, props and chunk meshes. */
export class WorldView {
  readonly group = new THREE.Group();
  readonly terrain: TerrainGrid;
  readonly counts = { trees: 0, lamps: 0, benches: 0 };
  private readonly materials: WorldMaterials;
  private readonly groundMap: THREE.DataTexture;
  private readonly chunks = new Map<string, THREE.Group>();
  private readonly borders: THREE.LineSegments;
  private readonly halfSize: number;

  constructor(ready: ReadyMessage, options: WorldViewOptions) {
    this.terrain = ready.terrainHeights;
    this.halfSize = ready.info.halfSize;

    const { size, pixels } = ready.groundMap;
    this.groundMap = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    this.groundMap.colorSpace = THREE.SRGBColorSpace;
    this.groundMap.magFilter = THREE.LinearFilter;
    this.groundMap.minFilter = THREE.LinearMipmapLinearFilter;
    this.groundMap.generateMipmaps = true;
    this.groundMap.anisotropy = options.anisotropy;
    this.groundMap.needsUpdate = true;
    this.materials = createMaterials(this.groundMap, options.windows);

    const terrainGeometry = new THREE.BufferGeometry();
    terrainGeometry.setAttribute('position', new THREE.BufferAttribute(ready.terrain.positions, 3));
    terrainGeometry.setAttribute('normal', new THREE.BufferAttribute(ready.terrain.normals, 3));
    terrainGeometry.setAttribute('uv', new THREE.BufferAttribute(ready.terrain.uvs, 2));
    terrainGeometry.setIndex(new THREE.BufferAttribute(ready.terrain.indices, 1));
    terrainGeometry.computeBoundingSphere();
    this.group.add(new THREE.Mesh(terrainGeometry, this.materials.terrain));

    if (ready.water) this.group.add(new THREE.Mesh(meshToGeometry(ready.water), this.materials.water));
    this.addProps(ready.props, options.maxTrees);

    this.borders = this.buildChunkBorders(ready.info.chunksPerSide);
    this.borders.visible = false;
    this.group.add(this.borders);
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Shows one chunk: at most two meshes (buildings, ground overlay). */
  addChunk(chunk: ChunkData): void {
    const key = `${chunk.cx},${chunk.cz}`;
    if (this.chunks.has(key)) return;
    const group = new THREE.Group();
    if (chunk.buildings) group.add(new THREE.Mesh(meshToGeometry(chunk.buildings), this.materials.buildings));
    if (chunk.ground) group.add(new THREE.Mesh(meshToGeometry(chunk.ground), this.materials.ground));
    this.chunks.set(key, group);
    this.group.add(group);
  }

  setWireframe(on: boolean): void {
    for (const material of this.materials.all) (material as THREE.MeshLambertMaterial).wireframe = on;
  }

  setChunkBorders(on: boolean): void {
    this.borders.visible = on;
  }

  /** Frees everything on the GPU. Call before loading another place. */
  dispose(): void {
    this.group.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      geometry?.dispose();
    });
    for (const material of this.materials.all) material.dispose();
    (this.borders.material as THREE.Material).dispose();
    this.groundMap.dispose();
    this.group.removeFromParent();
  }

  /** One instanced mesh per model: hundreds of copies, one draw call each. */
  private addProps(props: PropSet, maxTrees: number): void {
    const models = createPropModels();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    const place = (mesh: THREE.InstancedMesh, index: number, data: Float32Array, o: number, size: number, angle: number): void => {
      position.set(data[o], data[o + 1], data[o + 2]);
      rotation.setFromAxisAngle(up, angle);
      scale.setScalar(size);
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
    };
    const finish = (mesh: THREE.InstancedMesh): void => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    };

    const treeCount = Math.min(maxTrees, props.trees.length / TREE_STRIDE);
    const perVariant = [0, 0, 0];
    for (let t = 0; t < treeCount; t++) perVariant[props.trees[t * TREE_STRIDE + 5]]++;
    models.trees.forEach((geometry, variant) => {
      if (perVariant[variant] === 0) return;
      const mesh = new THREE.InstancedMesh(geometry, this.materials.props, perVariant[variant]);
      let index = 0;
      for (let t = 0; t < treeCount; t++) {
        const o = t * TREE_STRIDE;
        if (props.trees[o + 5] !== variant) continue;
        place(mesh, index, props.trees, o, props.trees[o + 3], props.trees[o + 4]);
        // Small seeded colour differences so a row of trees is not one flat green.
        const shade = props.trees[o + 6];
        mesh.setColorAt(index, tint.setRGB(0.82 + shade * 0.3, 0.9 + shade * 0.16, 0.8 + shade * 0.2));
        index++;
      }
      finish(mesh);
    });
    this.counts.trees = treeCount;

    const addSimple = (geometry: THREE.BufferGeometry, data: Float32Array, stride: number): number => {
      const count = data.length / stride;
      if (count === 0) return 0;
      const mesh = new THREE.InstancedMesh(geometry, this.materials.props, count);
      for (let i = 0; i < count; i++) place(mesh, i, data, i * stride, 1, data[i * stride + 3]);
      finish(mesh);
      return count;
    };
    this.counts.lamps = addSimple(models.lamp, props.lamps, LAMP_STRIDE);
    this.counts.benches = addSimple(models.bench, props.benches, BENCH_STRIDE);
  }

  /** Debug lines along the chunk grid, laid on the ground. */
  private buildChunkBorders(chunksPerSide: number): THREE.LineSegments {
    const points: number[] = [];
    const step = this.terrain.cell;
    const half = this.halfSize;
    const lift = 0.4;
    for (let k = 0; k <= chunksPerSide; k++) {
      const fixed = -half + k * CHUNK_SIZE;
      for (let t = -half; t < half; t += step) {
        points.push(fixed, heightAt(this.terrain, fixed, t) + lift, t, fixed, heightAt(this.terrain, fixed, t + step) + lift, t + step);
        points.push(t, heightAt(this.terrain, t, fixed) + lift, fixed, t + step, heightAt(this.terrain, t + step, fixed) + lift, fixed);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xff3d7f }));
  }
}
