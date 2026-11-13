import * as THREE from 'three';
import { CHUNK_SIZE } from '@nukkad/shared';
import { BENCH_STRIDE, LAMP_STRIDE, TREE_STRIDE, heightAt } from '@nukkad/worldgen';
import type { ChunkData, MeshData, PropSet, TerrainGrid } from '@nukkad/worldgen';
import type { ReadyMessage } from '../workers/protocol.ts';
import { createMaterials } from './materials.ts';
import type { WorldMaterials } from './materials.ts';
import { LAMP_HEAD_OFFSET, createPropModels } from './propModels.ts';
import { createLeafyTrees, leafAtlas, speciesOf } from './treeModels.ts';
import { GrassView } from './grassView.ts';
import { Signs } from './signs.ts';
import { createSurfaceUniforms, loadSurfaces } from './surfaces.ts';

/** At most this many trees of each kind cast shadows at once. */
const SHADOW_TREES = 250;

export interface WorldViewOptions {
  /** How many trees to draw (the list is shuffled, so any prefix is evenly spread). */
  maxTrees: number;
  windows: boolean;
  /** Photo-scanned surface detail (Medium and High). */
  photoSurfaces?: boolean;
  /** Sharper ground texture at flat angles; 1 = off. */
  anisotropy: number;
  /** 0 = simple low-poly trees (Low) · 1 = leafy (Medium) · 2 = leafy, full detail (High). */
  leafyTrees?: 0 | 1 | 2;
}

/** `extraName` = what the shader calls the extra numbers (aWin for buildings, aRoad for roads). */
function meshToGeometry(mesh: MeshData, extraName = 'aWin'): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3, true));
  if (mesh.extra) geometry.setAttribute(extraName, new THREE.BufferAttribute(mesh.extra, mesh.extraSize));
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
  private readonly treeMeshes: (THREE.InstancedMesh | null)[] = [];
  /** Invisible copies of only the trees near you; they exist just to cast sun shadows (layer 1). */
  private readonly shadowTrees: (THREE.InstancedMesh | null)[] = [];
  private shadowTreesAt: [number, number] | null = null;
  private treeLimit = 0;
  private treePositions = new Float32Array(0);
  /** Grass tufts around the player (Medium and High). */
  private grass: GrassView | null = null;
  private treeVariants = new Uint8Array(0);
  private lampHeads: THREE.MeshBasicMaterial | null = null;
  private glow: THREE.InstancedMesh | null = null;
  private glowMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly signs: Signs;
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
    const surfaces = createSurfaceUniforms();
    const leafy = options.leafyTrees ?? 0;
    this.materials = createMaterials(this.groundMap, options.windows, surfaces, leafy > 0 ? leafAtlas() : null);
    if (options.photoSurfaces) void loadSurfaces(surfaces, options.anisotropy);

    const terrainGeometry = new THREE.BufferGeometry();
    terrainGeometry.setAttribute('position', new THREE.BufferAttribute(ready.terrain.positions, 3));
    terrainGeometry.setAttribute('normal', new THREE.BufferAttribute(ready.terrain.normals, 3));
    terrainGeometry.setAttribute('uv', new THREE.BufferAttribute(ready.terrain.uvs, 2));
    terrainGeometry.setIndex(new THREE.BufferAttribute(ready.terrain.indices, 1));
    terrainGeometry.computeBoundingSphere();
    const ground = new THREE.Mesh(terrainGeometry, this.materials.terrain);
    ground.receiveShadow = true;
    this.group.add(ground);

    if (ready.water) this.group.add(new THREE.Mesh(meshToGeometry(ready.water), this.materials.water));
    this.addProps(ready.props, leafy);
    if (leafy > 0) {
      this.grass = new GrassView(this.materials.trees, this.terrain, ready.groundMap, this.halfSize, leafy === 2 ? 26 : 14);
      this.group.add(this.grass.mesh);
    }
    this.signs = new Signs(ready.places, this.terrain, options.anisotropy);
    if (this.signs.mesh) this.group.add(this.signs.mesh);
    this.setTreeLimit(options.maxTrees);

    this.borders = this.buildChunkBorders(ready.info.chunksPerSide);
    this.borders.visible = false;
    this.group.add(this.borders);
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Shows one chunk: at most two meshes (buildings, ground overlay). A chunk already on
   * screen is replaced in the same frame (far → near detail), so there is never a hole.
   */
  addChunk(chunk: ChunkData): void {
    const key = `${chunk.cx},${chunk.cz}`;
    const group = new THREE.Group();
    if (chunk.buildings) {
      const buildings = new THREE.Mesh(meshToGeometry(chunk.buildings), this.materials.buildings);
      buildings.castShadow = chunk.lod === 0; // far buildings are outside the shadow area anyway
      buildings.receiveShadow = true;
      group.add(buildings);
    }
    if (chunk.ground) {
      const ground = new THREE.Mesh(meshToGeometry(chunk.ground, 'aRoad'), this.materials.ground);
      ground.receiveShadow = true;
      group.add(ground);
    }
    this.removeChunk(key);
    this.chunks.set(key, group);
    this.group.add(group);
  }

  /** Takes a chunk off the screen and frees its GPU memory. */
  removeChunk(key: string): void {
    const group = this.chunks.get(key);
    if (!group) return;
    for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
    group.removeFromParent();
    this.chunks.delete(key);
  }

  /** Draws only the first `limit` trees (the list is shuffled, so they stay evenly spread). */
  setTreeLimit(limit: number): void {
    const counts = new Array<number>(this.treeMeshes.length).fill(0);
    const shown = Math.min(limit, this.treeVariants.length);
    for (let t = 0; t < shown; t++) counts[this.treeVariants[t]]++;
    this.treeMeshes.forEach((mesh, variant) => {
      if (mesh) mesh.count = counts[variant];
    });
    this.counts.trees = shown;
    this.treeLimit = shown;
    this.shadowTreesAt = null;
  }

  /** Refills the shadow-casting trees when you have moved more than 10 m. */
  updateShadowTrees(x: number, z: number, range: number): void {
    this.grass?.update(x, z);
    if (range <= 0) return;
    const at = this.shadowTreesAt;
    if (at && Math.hypot(at[0] - x, at[1] - z) < 10) return;
    this.shadowTreesAt = [x, z];
    const reach = range + 15;
    const filled = new Array<number>(this.treeMeshes.length).fill(0);
    const seen = new Array<number>(this.treeMeshes.length).fill(0);
    const matrix = new THREE.Matrix4();
    for (let t = 0; t < this.treeLimit; t++) {
      const variant = this.treeVariants[t];
      const index = seen[variant]++;
      if (Math.abs(this.treePositions[t * 2] - x) > reach || Math.abs(this.treePositions[t * 2 + 1] - z) > reach) continue;
      const source = this.treeMeshes[variant];
      const target = this.shadowTrees[variant];
      if (!source || !target || filled[variant] >= SHADOW_TREES) continue;
      source.getMatrixAt(index, matrix);
      target.setMatrixAt(filled[variant]++, matrix);
    }
    this.shadowTrees.forEach((mesh, variant) => {
      if (!mesh) return;
      mesh.count = filled[variant];
      mesh.instanceMatrix.needsUpdate = true;
    });
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
    this.lampHeads?.dispose();
    this.signs.dispose();
    this.glowMaterial?.map?.dispose();
    this.glowMaterial?.dispose();
    (this.borders.material as THREE.Material).dispose();
    this.groundMap.dispose();
    this.group.removeFromParent();
  }

  /** One instanced mesh per model: hundreds of copies, one draw call each. */
  private addProps(props: PropSet, leafy: 0 | 1 | 2): void {
    const models = createPropModels();
    const treeModels = leafy > 0 ? createLeafyTrees(leafy as 1 | 2) : models.trees;
    // Leaf cards have see-through gaps: their shadows need the same cut-outs.
    const leafShadow = leafy > 0 ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafAtlas(), alphaTest: 0.4, side: THREE.DoubleSide }) : null;
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

    const treeCount = props.trees.length / TREE_STRIDE;
    this.treeVariants = new Uint8Array(treeCount);
    this.treePositions = new Float32Array(treeCount * 2);
    for (let t = 0; t < treeCount; t++) {
      this.treePositions[t * 2] = props.trees[t * TREE_STRIDE];
      this.treePositions[t * 2 + 1] = props.trees[t * TREE_STRIDE + 2];
    }
    const perVariant = new Array<number>(treeModels.length).fill(0);
    for (let t = 0; t < treeCount; t++) {
      const mapped = props.trees[t * TREE_STRIDE + 5];
      this.treeVariants[t] = leafy > 0 ? speciesOf(mapped, props.trees[t * TREE_STRIDE + 6]) : mapped;
      perVariant[this.treeVariants[t]]++;
    }
    treeModels.forEach((geometry, variant) => {
      this.treeMeshes[variant] = null;
      if (perVariant[variant] === 0) return;
      const mesh = new THREE.InstancedMesh(geometry, this.materials.trees, perVariant[variant]);
      mesh.receiveShadow = true;
      const shadow = new THREE.InstancedMesh(geometry, this.materials.trees, SHADOW_TREES);
      shadow.count = 0;
      shadow.castShadow = true;
      shadow.frustumCulled = false;
      shadow.layers.set(1); // the main camera never draws layer 1, the sun's shadow pass does
      if (leafShadow) shadow.customDepthMaterial = leafShadow;
      this.shadowTrees[variant] = shadow;
      this.group.add(shadow);
      let index = 0;
      for (let t = 0; t < treeCount; t++) {
        const o = t * TREE_STRIDE;
        if (this.treeVariants[t] !== variant) continue;
        place(mesh, index, props.trees, o, props.trees[o + 3], props.trees[o + 4]);
        // Small seeded colour differences so a row of trees is not one flat green.
        const shade = props.trees[o + 6];
        mesh.setColorAt(index, tint.setRGB(0.82 + shade * 0.3, 0.9 + shade * 0.16, 0.8 + shade * 0.2));
        index++;
      }
      finish(mesh);
      this.treeMeshes[variant] = mesh;
    });

    const addSimple = (geometry: THREE.BufferGeometry, data: Float32Array, stride: number): number => {
      const count = data.length / stride;
      if (count === 0) return 0;
      const mesh = new THREE.InstancedMesh(geometry, this.materials.props, count);
      for (let i = 0; i < count; i++) place(mesh, i, data, i * stride, 1, data[i * stride + 3]);
      finish(mesh);
      return count;
    };
    this.counts.lamps = addSimple(models.lamp, props.lamps, LAMP_STRIDE);
    this.addLampLights(models.lampHead, props.lamps);
    this.counts.benches = addSimple(models.bench, props.benches, BENCH_STRIDE);
  }

  /**
   * Street lights: glowing heads (one draw call) and soft pools of light on the ground
   * (one more draw call, shown only at night). No real lights: those are far too slow on phones.
   */
  private addLampLights(headGeometry: THREE.BufferGeometry, lamps: Float32Array): void {
    const count = lamps.length / LAMP_STRIDE;
    if (count === 0) return;
    this.lampHeads = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xd8d2c0 });
    const heads = new THREE.InstancedMesh(headGeometry, this.lampHeads, count);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    const gradient = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gradient;
    c.fillRect(0, 0, 64, 64);
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      color: 0xffc37a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      fog: true,
    });
    const pool = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2);
    this.glow = new THREE.InstancedMesh(pool, this.glowMaterial, count);
    this.glow.visible = false;

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const o = i * LAMP_STRIDE;
      const [x, y, z, angle] = [lamps[o], lamps[o + 1], lamps[o + 2], lamps[o + 3]];
      rotation.setFromAxisAngle(up, angle);
      heads.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, y, z), rotation, one));
      // The pool sits under the lamp head (the arm points along the lamp's +x).
      const px = x + Math.cos(angle) * LAMP_HEAD_OFFSET;
      const pz = z - Math.sin(angle) * LAMP_HEAD_OFFSET;
      const py = heightAt(this.terrain, px, pz) + 0.14;
      this.glow.setMatrixAt(i, matrix.compose(new THREE.Vector3(px, py, pz), rotation, one));
    }
    for (const mesh of [heads, this.glow]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  /** Moves water and wind. Call every frame. */
  update(dt: number): void {
    this.materials.time.value = (this.materials.time.value + dt) % 3600;
  }

  /** 0 = day … 1 = night: windows, lamp heads and light pools follow it. */
  setNight(night: number): void {
    this.materials.night.value = night;
    this.signs.setNight(night);
    this.lampHeads?.color.setRGB(0.85 + night * 0.15, 0.82 + night * 0.06, 0.75 - night * 0.2);
    if (this.glow && this.glowMaterial) {
      this.glow.visible = night > 0.05;
      this.glowMaterial.opacity = night * 0.55;
    }
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
