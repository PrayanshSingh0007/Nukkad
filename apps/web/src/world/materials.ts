import * as THREE from 'three';
import { SURFACE_GLSL } from './surfaces.ts';
import type { SurfaceUniforms } from './surfaces.ts';

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

/** Passes the world position (and world normal) to the fragment shader, plus the photo textures. */
function addWorldPosition(shader: THREE.WebGLProgramParametersWithUniforms, surfaces?: SurfaceUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vNkWorld;\nvarying vec3 vNkNormal;')
    .replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nvNkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvNkNormal = normalize(mat3(modelMatrix) * objectNormal);',
    );
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vNkWorld;\nvarying vec3 vNkNormal;\n${NOISE_GLSL}\n${SURFACE_GLSL}`);
  if (surfaces) Object.assign(shader.uniforms, surfaces);
}

/** Walls get painted plaster, roofs get worn concrete — in world space, keeping the map colours. */
const BUILDING_PHOTO_GLSL = /* glsl */ `
  if (uTexOn > 0.5) {
    vec3 n = normalize(vNkNormal);
    if (abs(n.y) > 0.6) {
      vec3 t = texture2D(uRoof, vNkWorld.xz / 5.0).rgb / uRoofAvg;
      diffuseColor.rgb *= mix(vec3(1.0), t, 0.85);
    } else {
      vec2 uv = vec2(vNkWorld.x * abs(n.z) + vNkWorld.z * abs(n.x), vNkWorld.y) / 3.2;
      vec3 t = texture2D(uPlaster, uv).rgb / uPlasterAvg;
      diffuseColor.rgb *= mix(vec3(1.0), t, 0.75);
    }
  }
`;

/**
 * Facades. Each building vertex carries (window column, floor, style); the shader builds the
 * whole front from that, with no extra triangles:
 * 0 house · 1 apartments · 2 glass office · 3 shops on the ground floor · 4 school/civic · 5 industrial.
 *
 * - Every opening has a frame, a sill and a sunshade (chajja) that throws a shadow on the glass.
 * - "Interior mapping": behind each pane a little room is ray-traced (back wall, side walls,
 *   floor, ceiling, furniture blocks), so rooms shift as you walk past — real depth for free.
 * - Curtains, lit rooms at night, sky reflected in the glass (stronger at flat angles).
 * - Apartments get balcony columns (railing, open air, a door at the back); shops get lit
 *   interiors, roller shutters and a coloured sign band; offices a reflective curtain wall.
 * - Walls: slab lines, rain streaks under sills, grime near the ground.
 * `fwidth` fades fine detail out far away so nothing shimmers.
 */
const FACADE_PARS_GLSL = /* glsl */ `
  float nkRect(vec2 p, vec4 b, vec2 fw) {
    vec2 lo = smoothstep(b.xy - fw, b.xy + fw, p);
    vec2 hi = 1.0 - smoothstep(b.zw - fw, b.zw + fw, p);
    return lo.x * lo.y * hi.x * hi.y;
  }
  float nkH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 nkPalette(float t) { // soft wall-paint / cloth colours
    return 0.62 + 0.3 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67)));
  }
`;

const FACADE_GLSL = /* glsl */ `
  vec3 nkEmit = vec3(0.0);
  if (vWin.z > 0.5) { // 0 = no facade data (far buildings, roofs)
    int style = int(vWin.z + 0.5) - 1;
    vec2 fw = fwidth(vWin.xy);
    vec2 cell = fract(vWin.xy);
    float span = max(fw.x, fw.y);
    float fade = 1.0 - smoothstep(0.12, 0.45, span);   // openings disappear far away
    float fine = 1.0 - smoothstep(0.02, 0.1, span);    // frames, bars, streaks only up close
    vec2 id = floor(vWin.xy) + vColor.rg * 91.0;
    float tone = nkH(id);
    float tone2 = nkH(id + 17.31);
    float colTone = nkH(vec2(id.x, 3.7));
    float groundFloor = step(vWin.y, 1.0) * step(0.0, vWin.y);
    float above = step(0.0, vWin.y);
    vec3 wall = diffuseColor.rgb;

    // ---- What kind of opening is in this cell? 0 window · 1 balcony · 2 shop · 3 curtain wall · 4 strip window
    int kind = 0;
    vec4 box = vec4(0.27, 0.30, 0.73, 0.80); // x0, y0, x1, y1 of the opening inside its cell
    float depth = 3.4;                        // metres of room behind it
    if (style == 1) {
      box = vec4(0.2, 0.27, 0.66, 0.82);
      if (colTone > 0.62) { kind = 1; box = vec4(0.07, 0.05, 0.93, 0.86); depth = 1.5; }
    } else if (style == 2) { kind = 3; box = vec4(0.03, 0.08, 0.97, 0.95); depth = 6.0; }
    else if (style == 4) box = vec4(0.14, 0.3, 0.86, 0.76);
    else if (style == 5) { kind = 4; box = vec4(0.08, 0.7, 0.92, 0.9); }
    if (style == 3 && groundFloor > 0.5) { kind = 2; box = vec4(0.05, 0.03, 0.95, 0.76); depth = 5.0; }

    // ---- The wall itself.
    // Slab line at every floor, a little darker; shops get a painted sign band above the front.
    float slab = (1.0 - smoothstep(0.0, 0.05 + fw.y, cell.y)) * fade * above;
    if (style != 2) wall *= 1.0 - 0.16 * slab;
    if (style == 4) wall = mix(wall, vec3(0.62, 0.3, 0.2), smoothstep(0.86 - fw.y, 0.88 + fw.y, cell.y) * fade);
    if (kind == 2) {
      float band = nkRect(cell, vec4(0.0, 0.8, 1.0, 0.985), fw) * fade;
      vec3 sign = nkPalette(colTone * 3.1) * vec3(0.75, 0.7, 0.7);
      wall = mix(wall, sign, band * 0.9);
      wall = mix(wall, sign * 1.5, band * nkRect(cell, vec4(0.12, 0.855, 0.88, 0.93), fw) * 0.35); // lighter name plate
    }
    // Rain streaks: under sills and down the wall, only close up.
    float streak = nkNoise(vec2(vWin.x * 11.0 + vColor.r * 40.0, vWin.y * 0.7)) * nkNoise(vec2(vWin.x * 3.1, vWin.y * 2.3 + 5.0));
    float underSill = step(cell.y, box.y) * step(box.x - 0.05, cell.x) * step(cell.x, box.z + 0.05);
    wall *= 1.0 - (0.1 + 0.22 * underSill) * streak * fine * above * (style == 2 ? 0.0 : 1.0);
    // Grime near the ground.
    wall *= 0.8 + 0.2 * smoothstep(-0.2, 0.45, vWin.y);

    // ---- The opening: frame, sill, sunshade.
    float open = nkRect(cell, box, fw) * fade * above;
    vec2 ft = (kind == 3 ? vec2(0.012, 0.014) : vec2(0.03, 0.028)) + fw * 0.5;
    vec4 inner = vec4(box.xy + ft, box.zw - ft);
    float glassMask = nkRect(cell, inner, fw) * fade * above;
    vec3 frame = (style == 0 || style == 1 || style == 4) && tone2 > 0.35 ? vec3(0.82, 0.8, 0.76) : vec3(0.12, 0.13, 0.14);
    if (kind == 1) frame = wall * 0.7;
    if (kind == 0 || kind == 4) {
      float sill = nkRect(cell, vec4(box.x - 0.035, box.y - 0.04, box.z + 0.035, box.y), fw) * fine;
      float shade = nkRect(cell, vec4(box.x - 0.05, box.w, box.z + 0.05, box.w + 0.045), fw) * fine;
      wall = mix(wall, wall * 1.22 + 0.03, max(sill, shade) * 0.9);
      wall *= 1.0 - 0.3 * nkRect(cell, vec4(box.x - 0.035, box.y - 0.075, box.z + 0.035, box.y - 0.04), fw) * fine; // shadow under the sill
    }

    // ---- Behind the glass: a ray-traced box room.
    vec3 V = normalize(vNkWorld - cameraPosition);
    vec3 nrm = normalize(vNkNormal);
    vec3 T = vec3(-nrm.z, 0.0, nrm.x);
    float facing = max(0.02, -dot(V, nrm));
    vec3 rd = vec3(dot(V, T) / 2.6, V.y / 3.1, facing / depth);
    vec3 tA = (step(0.0, rd) - vec3(cell, 0.0)) / (rd + vec3(1e-5));
    float tHit = min(tA.x, min(tA.y, tA.z));
    vec3 hit = vec3(cell, 0.0) + rd * tHit;
    vec3 paint = mix(vec3(0.86, 0.82, 0.74), nkPalette(tone2 * 5.0), 0.3);
    vec3 room;
    if (tHit == tA.z) { // back wall
      room = paint;
      if (kind == 2) { // shop shelves full of goods
        vec2 g = floor(hit.xy * vec2(13.0, 5.0));
        float shelf = step(0.12, fract(hit.y * 5.0));
        room = mix(vec3(0.3), nkPalette(nkH(g + id) * 3.0), shelf * step(hit.y, 0.82));
      } else if (kind == 1) { // balcony: a door and the wall of the flat
        room = wall * 1.05;
        room = mix(room, vec3(0.1, 0.13, 0.16), nkRect(hit.xy, vec4(0.3, 0.02, 0.62, 0.8), vec2(0.004)));
      } else {
        room = mix(room, paint * 0.5, nkRect(hit.xy, vec4(0.08, 0.0, 0.4, 0.62), vec2(0.004)) * step(0.4, tone));      // wardrobe / shelf
        room = mix(room, nkPalette(tone * 9.0) * 0.8, nkRect(hit.xy, vec4(0.56, 0.45, 0.82, 0.68), vec2(0.004)));     // picture
      }
    } else if (tHit == tA.y) { // ceiling or floor
      room = hit.y > 0.5 ? vec3(0.9, 0.9, 0.88) : (kind == 1 ? vec3(0.62, 0.58, 0.52) : vec3(0.36, 0.3, 0.25));
      if (kind == 3 && hit.y > 0.5) room = mix(room, vec3(1.6), step(0.8, fract(hit.z * 3.0)) * step(0.3, fract(hit.x * 2.0))); // ceiling lights
    } else room = paint * 0.8; // side walls
    room *= mix(1.0, 0.5, clamp(hit.z, 0.0, 1.0));

    // Curtains just behind the glass (homes), blinds from the top (offices), grill bars (schools).
    float u = (cell.x - inner.x) / (inner.z - inner.x);
    float v = (cell.y - inner.y) / (inner.w - inner.y);
    float cloth = 0.0;
    vec3 clothCol = mix(vec3(0.78, 0.76, 0.72), nkPalette(tone * 4.0 + 0.2), 0.4);
    if (kind == 0 && style != 5) {
      float cl = step(0.25, tone2) * (0.1 + 0.3 * tone);
      cloth = max(1.0 - smoothstep(cl - 0.01, cl + 0.01, u), smoothstep(1.0 - cl * 0.8 - 0.01, 1.0 - cl * 0.8 + 0.01, u));
      clothCol *= 0.82 + 0.18 * sin(u * 70.0);
    } else if (kind == 3) {
      cloth = step(1.0 - 0.6 * tone * step(0.5, tone2), v);
      clothCol = vec3(0.78, 0.78, 0.74) * (0.9 + 0.1 * step(0.5, fract(v * 40.0)));
    }
    // Shops: a roller shutter, fully or half down.
    float shutter = 0.0;
    if (kind == 2) shutter = tone > 0.72 ? 1.0 : (tone > 0.58 ? step(0.5, v) : 0.0);
    vec3 shutterCol = vec3(0.5, 0.51, 0.52) * (0.82 + 0.18 * step(0.5, fract(cell.y * 26.0)));

    // How bright the room is: daylight spill, or the lamp at night.
    float lit = step(kind == 3 ? 0.55 : (kind == 2 ? 0.25 : 0.52), fract(tone * 7.13 + id.x * 0.37));
    float day = 1.0 - uNight;
    float inLight = kind == 1 ? 0.8 : (kind == 2 ? 0.75 : 0.4);
    vec3 lamp = kind == 3 ? vec3(0.85, 0.93, 1.0) : (kind == 2 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.78, 0.5));
    vec3 inside = mix(room, clothCol, cloth);
    inside = mix(inside, shutterCol, shutter);
    // Sky in the glass: more at flat angles; balconies have no glass.
    vec3 R = reflect(V, nrm);
    vec3 skyRef = mix(vec3(0.62, 0.7, 0.78), vec3(0.2, 0.36, 0.66), clamp(R.y * 1.4, 0.0, 1.0)) * (0.07 + 0.93 * day);
    float fres = kind == 1 ? 0.0 : mix(kind == 3 ? 0.42 : 0.16, 1.0, pow(1.0 - facing, 3.0));
    fres *= 1.0 - shutter;
    vec3 glass = mix(inside * inLight, skyRef, fres);
    // Shadow of the sunshade on the top of the pane (daytime).
    if (kind == 0) glass *= 1.0 - 0.45 * smoothstep(0.78, 0.9, v) * day;
    // Balcony railing at the front: bars you can see through, or a solid low wall.
    if (kind == 1) {
      float rail = step(v, 0.34);
      float bars = max(step(0.72, fract(cell.x * 15.0)), step(0.3, v) * step(v, 0.34));
      float solid = step(0.5, tone2);
      vec3 railCol = mix(vec3(0.16, 0.17, 0.18), wall * 0.92, solid);
      glass = mix(glass, railCol, rail * mix(bars * fine + (1.0 - fine) * 0.4, 1.0, solid));
    }
    // Window bars: a centre mullion on homes, a grid on offices, a grill on schools.
    float bar = 0.0;
    if (kind == 0) bar = (1.0 - smoothstep(0.012, 0.012 + fw.x, abs(u - 0.5))) * fine;
    if (kind == 3) bar = max(1.0 - smoothstep(0.01, 0.01 + fw.x, abs(u - 0.5)), 1.0 - smoothstep(0.012, 0.012 + fw.y, abs(v - 0.32))) * fine;
    if (style == 4) bar = max(bar, step(0.82, fract(v * 7.0)) * fine * 0.8);
    glass = mix(glass, frame, bar * (1.0 - shutter));

    diffuseColor.rgb = mix(wall, frame, open);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, glassMask);
    // At night lit rooms shine by themselves (the sun is gone).
    vec3 glow = mix(room, clothCol * 0.75, cloth) * lamp * (1.0 - shutter) * (1.0 - bar);
    nkEmit = glow * glassMask * lit * uNight * (kind == 1 ? 0.35 : 0.8) * (1.0 - fres * 0.6);
  }
`;

/** Road markings from (metres across, metres along, half width), plus asphalt grit. */
const ROAD_GLSL = /* glsl */ `
  if (uTexOn > 0.5) {
    vec3 t = texture2D(uAsphalt, vNkWorld.xz / 3.5).rgb / uAsphaltAvg;
    diffuseColor.rgb *= mix(vec3(1.0), t, 0.9);
  } else {
    float grit = nkNoise(vNkWorld.xz * 1.7) * 0.6 + nkNoise(vNkWorld.xz * 7.0) * 0.4;
    diffuseColor.rgb *= 0.9 + 0.18 * grit;
  }
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

function facades(material: THREE.MeshLambertMaterial, night: { value: number }, surfaces: SurfaceUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    addWorldPosition(shader, surfaces);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWin;\nvarying vec3 vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWin;\nuniform float uNight;\n${FACADE_PARS_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BUILDING_PHOTO_GLSL}\n${FACADE_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += nkEmit;');
  };
  material.customProgramCacheKey = () => 'nukkad-facades-4';
}

function roads(material: THREE.MeshLambertMaterial, surfaces: SurfaceUniforms): void {
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader, surfaces);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoad;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROAD_GLSL}`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         if (uTexOn > 0.5) {
           vec3 tn = texture2D(uAsphaltNormal, vNkWorld.xz / 3.5).xyz * 2.0 - 1.0;
           vec3 worldNormal = normalize(vec3(tn.x * 0.8, tn.z, -tn.y * 0.8));
           normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);
         }`,
      );
  };
  material.customProgramCacheKey = () => 'nukkad-roads-2';
}

/** Breaks up the flat ground colour with soft blotches and fine grain. */
function groundDetail(material: THREE.MeshLambertMaterial, surfaces: SurfaceUniforms): void {
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader, surfaces);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float blotch = nkNoise(vNkWorld.xz * 0.08) * 0.6 + nkNoise(vNkWorld.xz * 0.6) * 0.4;
       diffuseColor.rgb *= 0.88 + 0.18 * blotch;
       if (uTexOn > 0.5) {
         vec3 soil = texture2D(uSoil, vNkWorld.xz / 6.0).rgb / uSoilAvg;
         diffuseColor.rgb *= mix(vec3(1.0), vec3(dot(soil, vec3(0.333))), 0.6);
       } else {
         diffuseColor.rgb *= 0.94 + 0.08 * nkNoise(vNkWorld.xz * 4.0);
       }`,
    );
  };
  material.customProgramCacheKey = () => 'nukkad-ground-2';
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

/** Tree tops sway gently; each tree moves a little differently. Leaf cards also flutter. */
function wind(material: THREE.MeshLambertMaterial, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    // Leaf cards are seen from both sides but must shade as part of one round crown:
    // undo the "flip the normal on the back face" that double-sided materials do.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif',
    );
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
       transformed.z += cos(uTime * 1.3 + phase * 1.7) * 0.03 * bend;
       float flutter = step(1.6, transformed.y) * 0.035;
       transformed.y += sin(uTime * 3.1 + position.x * 4.0 + position.z * 3.0 + phase) * flutter;`,
    );
  };
  material.customProgramCacheKey = () => 'nukkad-wind-2';
}

export function createMaterials(groundMap: THREE.Texture, windows: boolean, surfaces: SurfaceUniforms, leaves: THREE.Texture | null = null): WorldMaterials {
  const night = { value: 0 };
  const time = { value: 0 };
  const terrain = new THREE.MeshLambertMaterial({ map: groundMap });
  groundDetail(terrain, surfaces);
  const buildings = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (windows) facades(buildings, night, surfaces);
  // Roads and water lie just above the ground; the offset stops them flickering against it.
  const ground = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  roads(ground, surfaces);
  const water = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  waterRipples(water, time, night);
  const props = new THREE.MeshLambertMaterial({ vertexColors: true });
  const trees = leaves
    ? new THREE.MeshLambertMaterial({ vertexColors: true, map: leaves, alphaTest: 0.4, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  wind(trees, time);
  return { night, time, terrain, buildings, ground, water, props, trees, all: [terrain, buildings, ground, water, props, trees] };
}
