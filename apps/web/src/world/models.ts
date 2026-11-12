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
