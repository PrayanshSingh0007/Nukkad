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
      // 1 = car paint (takes the per-copy colour) · 2 = glossy (glass, chrome, lamps) · 0 = matte.
      const isPaint = /paint/i.test(material.name) ? 1 : /glass|chrome|light/i.test(material.name) ? 2 : 0;
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
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
         #ifdef USE_COLOR
           vColor.rgb *= color;
         #endif
         #ifdef USE_INSTANCING_COLOR
           vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, step(0.5, aPaint) * (1.0 - step(1.5, aPaint)));
         #endif`,
      );
  };
  material.customProgramCacheKey = () => 'nukkad-paint-2';
  return material;
}

/** A model that keeps its own textured materials (the Kenney cars, the Sketchfab vehicles). */
export interface TexturedModel {
  geometry: THREE.BufferGeometry;
  /** One material per group of the geometry. */
  material: THREE.MeshStandardMaterial[];
  /** True when the body takes each copy's colour (see bodyPaint). */
  painted: boolean;
  /** Half width and half length after scaling, metres (for the solid box). */
  halfWidth: number;
  halfLength: number;
}

export interface TexturedFit {
  /** Scale so the model is this wide (x) … */
  width?: number;
  /** … or this long (z), metres. */
  length?: number;
  /** Extra turn about the vertical axis after the long side is laid along z, radians. */
  turn?: number;
  /** Repaint the body: texels of this hue get each copy's instance colour (see bodyPaint). */
  /** 'auto' = find the body's colour from the texture of the part that covers most of the model. */
  paint?: BodyPaint | 'auto';
}

export interface PaintWindow {
  /** Hue in degrees, how far either side still counts, and the least saturation. */
  hue: number;
  range: number;
  minSat: number;
  /** Most saturation and least brightness (0–1), to pick out pale panels. */
  maxSat?: number;
  minVal?: number;
  /** Mean linear brightness of these texels, so a new colour keeps the texture's shading. */
  ref: number;
}

/** One or two colour areas of the body that take the copy's paint. */
export type BodyPaint = PaintWindow[];

/**
 * The main paint of a body texture: the most common strong hue, and how bright those texels
 * are (linear). Null when the texture has no clear colour (e.g. a white car) or can't be read.
 */
function findBodyPaint(material: THREE.MeshStandardMaterial): BodyPaint | null {
  const image = material.map?.image as CanvasImageSource | undefined;
  if (!image) return null;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, S, S);
  } catch {
    return null;
  }
  const data = context.getImageData(0, 0, S, S).data;
  const lin = (v: number): number => Math.pow(v, 2.2);
  const bins = new Array<number>(36).fill(0);
  const texels: [number, number][] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (mx < 0.15 || d / mx < 0.3) continue;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    bins[Math.floor(h / 10) % 36]++;
    texels.push([h, 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)]);
  }
  const top = bins.indexOf(Math.max(...bins));
  if (bins[top] < S * S * 0.05) return null;
  const hue = top * 10 + 5;
  const near = texels.filter(([h]) => Math.abs(((h - hue + 540) % 360) - 180) < 20);
  const ref = near.reduce((sum, [, l]) => sum + l, 0) / near.length;
  return [{ hue, range: 24, minSat: 0.3, ref: Math.max(0.01, ref) }];
}

/**
 * Repaints only the body of a textured model: texels inside a paint window (by hue,
 * saturation and brightness) take the copy's instance colour, keeping their light and dark.
 * A white instance colour keeps the original.
 */
function bodyPaint(material: THREE.MeshStandardMaterial, paint: BodyPaint): void {
  const off: PaintWindow = { hue: 0, range: 0, minSat: 2, ref: 1 };
  const windows = [paint[0] ?? off, paint[1] ?? off];
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintA = { value: windows.map((w) => new THREE.Vector4(w.hue / 360, w.range / 360, w.minSat, w.ref)) };
    shader.uniforms.uPaintB = { value: windows.map((w) => new THREE.Vector4(w.maxSat ?? 2, w.minVal ?? 0, 0, 0)) };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uPaintA[2];\nuniform vec4 uPaintB[2];').replace(
      '#include <color_fragment>',
      `#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
      {
        vec3 c = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
        float mx = max(c.r, max(c.g, c.b));
        float d = mx - min(c.r, min(c.g, c.b));
        float h = 0.0;
        if (d > 1e-4) {
          if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
          else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
          else h = (c.r - c.g) / d + 4.0;
          h /= 6.0;
        }
        float sat = d / max(mx, 1e-4);
        vec3 tint = vColor.rgb;
        float keep = step(2.995, tint.r + tint.g + tint.b);
        float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 painted = diffuseColor.rgb;
        for (int i = 0; i < 2; i++) {
          vec4 a = uPaintA[i];
          vec4 b = uPaintB[i];
          float dh = abs(mod(h - a.x + 1.5, 1.0) - 0.5);
          float m = (1.0 - smoothstep(a.y * 0.7, a.y, dh)) * smoothstep(a.z * 0.6 - 0.0001, a.z, sat)
            * (1.0 - smoothstep(b.x, b.x + 0.08, sat)) * smoothstep(b.y - 0.08, b.y, mx) * step(0.0001, a.y);
          painted = mix(painted, tint * (min(lum / a.w, 1.3) * 0.8), m * (1.0 - keep));
        }
        diffuseColor.rgb = painted;
      }
      #endif`,
    );
  };
  material.customProgramCacheKey = () => `nukkad-body-${JSON.stringify(paint)}`;
}

const texturedCache = new Map<string, Promise<TexturedModel | null>>();

/**
 * Loads a textured .glb, lays its long side along z (and turns it by `fit.turn`), scales it
 * uniformly to the given width or length with its lowest point on the ground, and merges it
 * into one geometry with one group per material.
 */
export function loadTexturedModel(path: string, fit: TexturedFit): Promise<TexturedModel | null> {
  const key = `${path}|${fit.width}|${fit.length}|${fit.turn}|${JSON.stringify(fit.paint ?? null)}`;
  let promise = texturedCache.get(key);
  if (!promise) {
    promise = loader
      .loadAsync(path)
      .then((gltf) => {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
        root.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
          let g = mesh.geometry.clone();
          g.applyMatrix4(mesh.matrixWorld);
          for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
          if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          if (g.index) g = g.toNonIndexed();
          if (!byMaterial.has(material)) byMaterial.set(material, []);
          byMaterial.get(material)!.push(g);
        });
        if (byMaterial.size === 0) return null;
        const sources = [...byMaterial.keys()];
        const merged = mergeGeometries(sources.map((m) => mergeGeometries(byMaterial.get(m)!)), true);
        merged.computeBoundingBox();
        let box = merged.boundingBox as THREE.Box3;
        if (box.max.x - box.min.x > box.max.z - box.min.z) merged.rotateY(Math.PI / 2);
        if (fit.turn) merged.rotateY(fit.turn);
        merged.computeBoundingBox();
        box = merged.boundingBox as THREE.Box3;
        const scale = fit.length ? fit.length / (box.max.z - box.min.z) : (fit.width ?? 1) / (box.max.x - box.min.x);
        merged.translate(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
        merged.scale(scale, scale, scale);
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        const size = (merged.boundingBox as THREE.Box3).getSize(new THREE.Vector3());
        // The body = the material drawing the most triangles.
        const counts = sources.map((m) => byMaterial.get(m)!.reduce((sum, g) => sum + g.getAttribute('position').count, 0));
        const body = counts.indexOf(Math.max(...counts));
        let painted = false;
        const material = sources.map((m, index) => {
          const source = m as THREE.MeshStandardMaterial;
          const own = new THREE.MeshStandardMaterial({
            map: source.map ?? null,
            color: source.color ?? new THREE.Color(1, 1, 1),
            roughness: Math.max(0.3, source.roughness ?? 0.5),
            metalness: Math.min(0.6, source.metalness ?? 0.1),
            transparent: source.transparent,
            opacity: source.opacity,
            alphaTest: source.alphaTest,
            side: source.side,
          });
          if (own.map) own.map.colorSpace = THREE.SRGBColorSpace;
          // 'auto': only the body takes paint; the other parts keep their own colours.
          const paint = fit.paint === 'auto' ? (index === body ? findBodyPaint(source) : null) ?? [] : fit.paint;
          if (paint) bodyPaint(own, paint);
          if (index === body) painted = (paint?.length ?? 0) > 0;
          return own;
        });
        return { geometry: merged, material, painted, halfWidth: size.x / 2, halfLength: size.z / 2 };
      })
      .catch((error: unknown) => {
        console.warn(`Nukkad: ${path} could not be loaded — skipped`, error);
        return null;
      });
    texturedCache.set(key, promise);
  }
  return promise;
}
