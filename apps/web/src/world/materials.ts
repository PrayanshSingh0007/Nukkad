import * as THREE from 'three';

/**
 * The few materials the whole world shares. Fewer materials = fewer draw calls.
 * Everything uses the cheapest lit material (Lambert); colours come from the meshes.
 */
export interface WorldMaterials {
  terrain: THREE.MeshLambertMaterial;
  buildings: THREE.MeshLambertMaterial;
  ground: THREE.MeshLambertMaterial;
  water: THREE.MeshLambertMaterial;
  props: THREE.MeshLambertMaterial;
  all: THREE.Material[];
}

/**
 * Windows are not triangles or pictures: the building mesh carries two numbers per
 * vertex (window column, floor) and this bit of shader darkens a pane inside every
 * cell. `fwidth` tells how many cells fit in one pixel, so far windows fade out
 * instead of shimmering.
 */
const WINDOW_GLSL = /* glsl */ `
  if (vWin.y > 0.0) {
    vec2 fw = fwidth(vWin);
    vec2 cell = fract(vWin);
    vec2 lo = smoothstep(vec2(0.22, 0.30) - fw, vec2(0.22, 0.30) + fw, cell);
    vec2 hi = 1.0 - smoothstep(vec2(0.78, 0.82) - fw, vec2(0.78, 0.82) + fw, cell);
    float fade = 1.0 - smoothstep(0.12, 0.4, max(fw.x, fw.y));
    float pane = lo.x * lo.y * hi.x * hi.y * fade;
    vec2 id = floor(vWin) + vColor.rg * 91.0;
    float tone = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 glass = mix(vec3(0.045, 0.07, 0.10), vec3(0.11, 0.16, 0.21), tone);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, pane * 0.9);
  }
`;

function addWindows(material: THREE.MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWin;\nvarying vec2 vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWin;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${WINDOW_GLSL}`);
  };
  material.customProgramCacheKey = () => 'nukkad-windows';
}

export function createMaterials(groundMap: THREE.Texture, windows: boolean): WorldMaterials {
  const terrain = new THREE.MeshLambertMaterial({ map: groundMap });
  const buildings = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (windows) addWindows(buildings);
  // Roads and water lie just above the ground; the offset stops them flickering against it.
  const ground = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const water = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const props = new THREE.MeshLambertMaterial({ vertexColors: true });
  return { terrain, buildings, ground, water, props, all: [terrain, buildings, ground, water, props] };
}
