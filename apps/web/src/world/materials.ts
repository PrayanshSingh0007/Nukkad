import * as THREE from 'three';

/**
 * The few materials the whole world shares. Fewer materials = fewer draw calls.
 * Everything is the cheapest lit material (Lambert) plus small shader additions:
 * facades by building type, road markings, ground and water detail, swaying trees.
 * No image textures are downloaded — all detail is computed on the GPU.
 */
export interface WorldMaterials {
  /** 0 = day … 1 = night. Shared by reference with the shaders. */
  night: { value: number };
  /** Seconds, for water and wind. */
  time: { value: number };
  terrain: THREE.MeshLambertMaterial;
  buildings: THREE.MeshLambertMaterial;
  ground: THREE.MeshLambertMaterial;
  water: THREE.MeshLambertMaterial;
  props: THREE.MeshLambertMaterial;
  trees: THREE.MeshLambertMaterial;
  all: THREE.Material[];
}

/** Cheap 2D value noise (no textures). */
const NOISE_GLSL = /* glsl */ `
  float nkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float nkNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(nkHash(i), nkHash(i + vec2(1.0, 0.0)), u.x), mix(nkHash(i + vec2(0.0, 1.0)), nkHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

/** Passes the world position to the fragment shader. */
function addWorldPosition(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vNkWorld;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvNkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vNkWorld;\n${NOISE_GLSL}`);
}

/**
 * Facades. Each building vertex carries (window column, floor, style); the shader draws
 * a pane in every cell, shaped by the style:
 * 0 house · 1 apartments (slab edges) · 2 glass office · 3 shopfront on the ground floor ·
 * 4 school/civic (colour band) · 5 industrial (high strip windows).
 * `fwidth` fades windows out far away so they never shimmer.
 */
const FACADE_GLSL = /* glsl */ `
  float nkGlow = 0.0;
  if (vWin.z > 0.5) { // 0 = no facade data (far buildings, roofs)
    int style = int(vWin.z + 0.5) - 1;
    vec2 fw = fwidth(vWin.xy);
    vec2 cell = fract(vWin.xy);
    float fade = 1.0 - smoothstep(0.12, 0.45, max(fw.x, fw.y));
    vec4 box = vec4(0.25, 0.32, 0.75, 0.80); // x0, y0, x1, y1 of the pane inside its cell
    vec3 glass = vec3(0.05, 0.075, 0.1);
    float groundFloor = step(vWin.y, 1.0) * step(0.0, vWin.y);
    if (style == 1) box = vec4(0.18, 0.28, 0.62, 0.82);
    else if (style == 2) { box = vec4(0.04, 0.1, 0.96, 0.94); glass = vec3(0.18, 0.3, 0.38); }
    else if (style == 4) box = vec4(0.15, 0.3, 0.85, 0.74);
    else if (style == 5) box = vec4(0.1, 0.72, 0.9, 0.88);
    if (style == 3 && groundFloor > 0.5) { box = vec4(0.05, 0.04, 0.95, 0.78); glass = vec3(0.16, 0.2, 0.22); }
    vec2 lo = smoothstep(box.xy - fw, box.xy + fw, cell);
    vec2 hi = 1.0 - smoothstep(box.zw - fw, box.zw + fw, cell);
    float pane = lo.x * lo.y * hi.x * hi.y * fade;
    vec2 id = floor(vWin.xy) + vColor.rg * 91.0;
    float tone = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
    // Glass looks a bit like it reflects the sky: lighter towards the top of each pane.
    vec3 sky = glass + vec3(0.06, 0.09, 0.12) * smoothstep(box.y, box.w, cell.y) + tone * 0.04;
    // Shops pull a grey shutter down on some fronts.
    if (style == 3 && groundFloor > 0.5 && tone > 0.55) sky = vec3(0.45, 0.46, 0.47) * (0.85 + 0.15 * step(0.5, fract(cell.y * 12.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, sky, pane * 0.92);
    // Slab edges on apartments and a coloured band on schools, both darker/lighter lines per floor.
    if (style == 1) diffuseColor.rgb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.07 + fw.y, cell.y)) * fade;
    if (style == 4) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.3, 0.2), smoothstep(0.86 - fw.y, 0.88 + fw.y, cell.y) * fade);
    // Grime: walls get a little darker near the ground.
    diffuseColor.rgb *= 0.82 + 0.18 * smoothstep(-0.2, 0.4, vWin.y);
    float lit = step(style == 2 ? 0.4 : 0.6, fract(tone * 7.13 + id.x * 0.37));
    nkGlow = pane * lit * uNight;
  }
`;

/** Road markings from (metres across, metres along, half width), plus asphalt grit. */
const ROAD_GLSL = /* glsl */ `
  float grit = nkNoise(vNkWorld.xz * 1.7) * 0.6 + nkNoise(vNkWorld.xz * 7.0) * 0.4;
  diffuseColor.rgb *= 0.9 + 0.18 * grit;
  if (vRoad.z > 0.0) {
    float across = abs(vRoad.x);
    float fw = fwidth(vRoad.x) + 0.001;
    float centre = (1.0 - smoothstep(0.07, 0.07 + fw, across)) * step(0.5, fract(vRoad.y / 6.0));
    float edge = smoothstep(vRoad.z - 0.42 - fw, vRoad.z - 0.42, across) * (1.0 - smoothstep(vRoad.z - 0.3, vRoad.z - 0.3 + fw, across));
    edge *= step(4.4, vRoad.z);
    float kerb = smoothstep(vRoad.z - 0.18 - fw, vRoad.z - 0.18, across);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.87, 0.82), max(centre, edge) * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.6), kerb);
  }
`;

function facades(material: THREE.MeshLambertMaterial, night: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWin;\nvarying vec3 vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWin;\nuniform float uNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * nkGlow * 1.4;');
  };
  material.customProgramCacheKey = () => 'nukkad-facades-2';
}

function roads(material: THREE.MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoad;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROAD_GLSL}`);
  };
  material.customProgramCacheKey = () => 'nukkad-roads-1';
}

/** Breaks up the flat ground colour with soft blotches and fine grain. */
function groundDetail(material: THREE.MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float blotch = nkNoise(vNkWorld.xz * 0.08) * 0.6 + nkNoise(vNkWorld.xz * 0.6) * 0.4;
       float grain = nkNoise(vNkWorld.xz * 4.0);
       diffuseColor.rgb *= 0.86 + 0.2 * blotch + 0.08 * grain;`,
    );
  };
  material.customProgramCacheKey = () => 'nukkad-ground-1';
}

/** Moving ripples and a sun glint on lakes and pools. */
function waterRipples(material: THREE.MeshLambertMaterial, time: { value: number }, night: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uNight = night;
    addWorldPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uNight;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec2 p = vNkWorld.xz;
         float wave = nkNoise(p * 0.35 + vec2(uTime * 0.25, uTime * 0.17)) * 0.6 + nkNoise(p * 1.3 - vec2(uTime * 0.4, -uTime * 0.3)) * 0.4;
         diffuseColor.rgb *= 0.86 + 0.28 * wave;
         float nkGlint = pow(smoothstep(0.55, 0.95, wave), 3.0) * (1.0 - uNight);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * nkGlint * 0.35;');
  };
  material.customProgramCacheKey = () => 'nukkad-water-1';
}

/** Tree tops sway gently; each tree moves a little differently. */
function wind(material: THREE.MeshLambertMaterial, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         float phase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
       #else
         float phase = 0.0;
       #endif
       float bend = max(0.0, transformed.y - 1.4);
       transformed.x += sin(uTime * 1.6 + phase) * 0.045 * bend;
       transformed.z += cos(uTime * 1.3 + phase * 1.7) * 0.03 * bend;`,
    );
  };
  material.customProgramCacheKey = () => 'nukkad-wind-1';
}

export function createMaterials(groundMap: THREE.Texture, windows: boolean): WorldMaterials {
  const night = { value: 0 };
  const time = { value: 0 };
  const terrain = new THREE.MeshLambertMaterial({ map: groundMap });
  groundDetail(terrain);
  const buildings = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (windows) facades(buildings, night);
  // Roads and water lie just above the ground; the offset stops them flickering against it.
  const ground = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  roads(ground);
  const water = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  waterRipples(water, time, night);
  const props = new THREE.MeshLambertMaterial({ vertexColors: true });
  const trees = new THREE.MeshLambertMaterial({ vertexColors: true });
  wind(trees, time);
  return { night, time, terrain, buildings, ground, water, props, trees, all: [terrain, buildings, ground, water, props, trees] };
}
