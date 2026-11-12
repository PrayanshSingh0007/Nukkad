import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Our own 3D models, made in Blender and saved as small .glb files in public/models/.
 * Each model is flattened into ONE geometry with colours per vertex (no textures), so a
 * whole street of copies is one draw call. Parts on a material named "Paint" get the
 * per-copy colour (car body colours); everything else keeps its own colour.
 */
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.BufferGeometry | null>>();

function flatten(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    source.applyMatrix4(mesh.matrixWorld);
    const count = source.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const paint = new Float32Array(count);
    const groups = source.groups.length > 0 ? source.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const color = material.color ?? new THREE.Color(1, 1, 1);
      const isPaint = /paint/i.test(material.name) ? 1 : 0;
      for (let i = group.start; i < group.start + group.count; i++) {
        colors.set([color.r, color.g, color.b], i * 3);
        paint[i] = isPaint;
      }
    }
    const clean = new THREE.BufferGeometry();
    clean.setAttribute('position', source.getAttribute('position'));
    if (source.getAttribute('normal')) clean.setAttribute('normal', source.getAttribute('normal'));
    else clean.computeVertexNormals();
    clean.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    clean.setAttribute('aPaint', new THREE.BufferAttribute(paint, 1));
    parts.push(clean);
    source.dispose();
  });
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Loads /models/<name>.glb once. Resolves to null when the file is missing (the game carries on). */
export function loadModel(name: string): Promise<THREE.BufferGeometry | null> {
  let promise = cache.get(name);
  if (!promise) {
    promise = loader
      .loadAsync(`/models/${name}.glb`)
      .then((gltf) => flatten(gltf.scene))
      .catch(() => {
        console.warn(`Nukkad: model ${name}.glb not found — skipped`);
        return null;
      });
    cache.set(name, promise);
  }
  return promise;
}

/** Lambert with vertex colours, where only "Paint" parts take the per-copy colour. */
export function createModelMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;')
      .replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aPaint);');
  };
  material.customProgramCacheKey = () => 'nukkad-paint-1';
  return material;
}

/** A model that keeps its own textured material (e.g. the Kenney cars). */
export interface TexturedModel {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Half width and half length after scaling, metres (for the solid box). */
  halfWidth: number;
  halfLength: number;
}

const texturedCache = new Map<string, Promise<TexturedModel | null>>();

/**
 * Loads a textured .glb, turns it to face -z when `flip` is set, scales it uniformly so it is
 * `width` metres wide with its lowest point on the ground, and merges it into one geometry.
 */
export function loadTexturedModel(path: string, width: number, flip: boolean): Promise<TexturedModel | null> {
  const key = `${path}|${width}|${flip}`;
  let promise = texturedCache.get(key);
  if (!promise) {
    promise = loader
      .loadAsync(path)
      .then((gltf) => {
        const root = gltf.scene;
        if (flip) root.rotation.y = Math.PI;
        root.updateMatrixWorld(true);
        const parts: THREE.BufferGeometry[] = [];
        let material: THREE.MeshStandardMaterial | null = null;
        root.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          material ??= (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
          const g = mesh.geometry.clone();
          g.applyMatrix4(mesh.matrixWorld);
          for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
          parts.push(g.index ? g : g);
        });
        if (parts.length === 0 || !material) return null;
        const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
        merged.computeBoundingBox();
        const box = merged.boundingBox as THREE.Box3;
        const scale = width / (box.max.x - box.min.x);
        merged.translate(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
        merged.scale(scale, scale, scale);
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        const size = (merged.boundingBox as THREE.Box3).getSize(new THREE.Vector3());
        const source = material as THREE.MeshStandardMaterial;
        const own = new THREE.MeshStandardMaterial({ map: source.map, roughness: 0.42, metalness: 0.15 });
        if (own.map) own.map.colorSpace = THREE.SRGBColorSpace;
        return { geometry: merged, material: own, halfWidth: size.x / 2, halfLength: size.z / 2 };
      })
      .catch(() => {
        console.warn(`Nukkad: ${path} could not be loaded — skipped`);
        return null;
      });
    texturedCache.set(key, promise);
  }
  return promise;
}
