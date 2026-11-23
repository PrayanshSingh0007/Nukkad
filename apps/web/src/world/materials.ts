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
  /** Where the light comes from (sun by day, moon at night), for glints on glass and water. */
  lightDir: { value: THREE.Vector3 };
  /** The sky's colours, mirrored in window glass. */
  sky: SkyUniforms;
  /** 0 = dry … 1 = downpour: wet roads, puddles, darker walls and soil. */
  rain: { value: number };
  /** 0 = dry … 1 = soaked: how wet the ground and walls are (stays after the rain, dries slowly). */
  wet: { value: number };
  /** The true sun direction (for glare off wet roads). */
  sunDir: { value: THREE.Vector3 };
  terrain: THREE.MeshLambertMaterial;
  buildings: THREE.MeshLambertMaterial;
  ground: THREE.MeshLambertMaterial;
  water: THREE.MeshLambertMaterial;
  props: THREE.MeshLambertMaterial;
  trees: THREE.MeshLambertMaterial;
  all: THREE.Material[];
}

/** The sky's colours (copied from the atmosphere) for reflections in glass. */
export interface SkyUniforms {
  uSkyTop: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  /** How strongly glass mirrors the sky (matched to the sky's real brightness). */
  uSkyGain: { value: number };
}

/** Rain and the sky, for wet surfaces. */
export interface WeatherUniforms extends SkyUniforms {
  uRain: { value: number };
  uWet: { value: number };
  /** The true sun direction (not lifted at low sun like the light), for glare off wet roads. */
  uSunDir: { value: THREE.Vector3 };
  uNkTime: { value: number };
  uNight: { value: number };
}
const WEATHER_PARS_GLSL = /* glsl */ `
  uniform float uRain;
  uniform float uWet;
  uniform vec3 uSunDir;
  uniform float uNkTime;
  uniform float uNight;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
`;

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
  if (uTexOn > 0.5 && vWin.z > -1.5) { // not on solar glass or metal parts
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
    // Weathered paint: big soft patches of faded and darker plaster (sun and monsoon), never flat.
    if (style != 2) {
      float patchy = nkNoise(vec2(vWin.x * 0.31 + vColor.r * 13.0, vWin.y * 0.43 + vColor.g * 7.0));
      float blotch = nkNoise(vec2(vWin.x * 1.7 + vColor.b * 5.0, vWin.y * 1.3));
      wall *= 0.88 + 0.18 * patchy - 0.06 * smoothstep(0.55, 0.9, blotch) * fine;
      // The plinth: the foot of the wall painted a darker grey, as on most Bengaluru buildings.
      float plinth = 1.0 - smoothstep(0.1, 0.11 + fw.y, vWin.y);
      wall = mix(wall, vec3(0.3, 0.29, 0.27) * (0.85 + 0.15 * patchy), plinth * above * 0.9);
    }

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
    // What the glass mirrors: the real sky colours with clouds, and the buildings across the
    // street near the horizon. Each pane is tilted a hair differently (real glass is never
    // perfectly flat), so neighbouring reflections break up. Balconies have no glass.
    vec3 R = reflect(V, normalize(nrm + (vec3(nkH(id + 3.1), 0.0, nkH(id + 5.7)) - 0.5) * 0.06));
    float el = R.y;
    vec3 skyRef = mix(uSkyHorizon, uSkyTop, pow(clamp(el, 0.0, 1.0), 0.5));
    vec2 cloudUv = R.xz / max(0.12, el) * 1.6;
    float cloud = smoothstep(0.45, 0.85, nkNoise(cloudUv) * 0.65 + nkNoise(cloudUv * 2.7) * 0.35) * smoothstep(0.02, 0.2, el);
    skyRef = mix(skyRef, uSkyHorizon * 1.25 + 0.08, cloud * 0.7);
    // Opposite buildings: blocks of different heights, darker, with rows of their own windows.
    float az = atan(R.z, R.x) * 30.0;
    float block = floor(az);
    float roofLine = 0.04 + 0.32 * nkH(vec2(block, 9.1)) * nkH(vec2(block, 2.3));
    vec3 across = mix(vec3(0.26, 0.25, 0.24), vec3(0.5, 0.47, 0.42), nkH(vec2(block, 4.4))) * (uSkyHorizon * 0.7 + 0.12);
    across *= 0.8 + 0.3 * step(0.45, fract(el * 22.0)) * step(0.35, fract(az * 2.5));
    skyRef = el < roofLine ? across : skyRef;
    skyRef *= 0.07 + 0.93 * day;
    float fres = kind == 1 ? 0.0 : mix(kind == 3 ? 0.42 : 0.16, 1.0, pow(1.0 - facing, 3.0));
    fres *= 1.0 - shutter;
    // The room behind is lit like the wall; the reflection is light coming off the glass, so it
    // is added as its own light and stays bright even when the wall is in shade.
    vec3 glass = inside * inLight * (1.0 - fres);
    vec3 reflection = skyRef * fres;
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
    reflection *= 1.0 - bar * (1.0 - shutter);

    diffuseColor.rgb = mix(wall, frame, open);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, glassMask);
    // At night lit rooms shine by themselves (the sun is gone).
    vec3 glow = mix(room, clothCol * 0.75, cloth) * lamp * (1.0 - shutter) * (1.0 - bar);
    // Shops at night blaze like real ones (bright tube lights, goods on display) and are bright
    // enough for the bloom to give the shopfront a glow on the street; homes stay softer.
    nkEmit = glow * glassMask * lit * uNight * (kind == 1 ? 0.35 : (kind == 2 ? 2.4 : 0.8)) * (1.0 - fres * 0.6);
    // A television on in some lit homes: cool, flickering light that jumps with each cut.
    float tv = kind == 0 ? step(0.86, fract(tone * 3.71 + id.x * 0.61 + id.y * 0.29)) * lit : 0.0;
    if (tv > 0.0) {
      float cut = nkH(vec2(floor(uNkTime * 0.9 + nkH(id) * 5.0), id.x + id.y * 7.0));
      float flick = (0.35 + 0.65 * cut) * (0.88 + 0.12 * sin(uNkTime * 19.0 + id.x * 9.0));
      vec3 tvLight = mix(vec3(0.42, 0.56, 1.0), vec3(0.75, 0.85, 1.0), cut) * flick * 0.85;
      nkEmit = mix(nkEmit, tvLight * glassMask * uNight * (1.0 - fres * 0.6) * (1.0 - shutter) * (1.0 - bar), tv);
    }
    // The sun flashing off panes that face it.
    float glint = pow(max(dot(R, uLightDir), 0.0), 90.0) * day * (kind == 1 ? 0.0 : 1.0) * (1.0 - shutter);
    nkEmit += vec3(1.0, 0.93, 0.8) * glint * glassMask * 2.2;
    nkEmit += reflection * glassMask * uSkyGain;
  } else if (vWin.z < -0.5) { // roof things: -1 terrace, -2 solar glass, -3 metal
    vec3 nrmR = normalize(vNkNormal);
    vec3 Vr = normalize(vNkWorld - cameraPosition);
    if (vWin.z < -1.5 && vWin.z > -2.5) {
      // Solar heater glass: dark blue cells that mirror the sky and flash in the sun.
      vec3 Rr = reflect(Vr, nrmR);
      float fr = mix(0.08, 1.0, pow(1.0 - max(0.02, -dot(Vr, nrmR)), 4.0));
      vec2 cellP = fract(vNkWorld.xz * vec2(3.0, 4.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45), step(0.93, max(cellP.x, cellP.y)) * 0.5);
      nkEmit = mix(uSkyHorizon, uSkyTop, clamp(Rr.y, 0.0, 1.0)) * fr * 0.6 * (1.0 - uNight * 0.9);
      nkEmit += vec3(1.0, 0.93, 0.8) * pow(max(dot(Rr, uLightDir), 0.0), 120.0) * 3.0 * (1.0 - uNight);
    } else if (vWin.z > -1.5 && nrmR.y > 0.6) {
      // Terrace: rain stains (a little green where it stays damp), dust, patches of newer
      // waterproofing and the faint grid of the square roof tiles up close.
      vec2 p = vNkWorld.xz;
      float stain = smoothstep(0.55, 0.85, nkNoise(p * 0.18) * 0.7 + nkNoise(p * 0.6) * 0.3);
      float coat = step(0.78, nkNoise(floor(p / 2.4) * 0.37 + 11.0));
      vec2 fwR = fwidth(p);
      vec2 tile = fract(p / 0.6);
      float joint = (1.0 - smoothstep(0.0, 0.04 + fwR.x * 1.5, min(tile.x, tile.y))) * (1.0 - smoothstep(0.05, 0.25, max(fwR.x, fwR.y)));
      vec3 c = diffuseColor.rgb;
      c *= 1.0 - stain * 0.28;
      c = mix(c, c * vec3(0.9, 0.97, 0.88), stain * 0.6);
      c = mix(c, vec3(0.78, 0.76, 0.72), coat * 0.35);
      c *= 1.0 - joint * 0.12;
      diffuseColor.rgb = c;
    }
  }
`;

/**
 * Wet roads: the asphalt darkens and mirrors the sky (much more at low angles, as real wet roads
 * do), puddles collect in the dips, and while it rains drops make rings in the puddles. After
 * the rain it dries out in stages: the glossy film goes first, the puddles last.
 */
const WET_GLSL = /* glsl */ `
  vec3 nkWet = vec3(0.0);
  if (uWet > 0.01) {
    vec3 Vw = normalize(vNkWorld - cameraPosition);
    float grazing = pow(1.0 - clamp(-Vw.y, 0.0, 1.0), 6.0);
    vec2 wp = vNkWorld.xz;
    // Puddles shrink as they dry: the threshold rises (only the deepest dips stay wet).
    float pondLevel = mix(0.7, 0.5, smoothstep(0.05, 0.6, uWet));
    float puddle = smoothstep(pondLevel, pondLevel + 0.14, nkNoise(wp * 0.22) * 0.7 + nkNoise(wp * 1.1) * 0.3) * smoothstep(0.02, 0.3, uWet);
    // Rings from drops, only in puddles: each third-of-a-metre cell gets a drop at its own
    // moment and spot; the ring spreads and fades.
    vec2 cellW = floor(wp * 3.0);
    vec2 spot = vec2(nkHash(cellW + 1.7), nkHash(cellW + 9.3)) * 0.5 - 0.25;
    vec2 inCell = fract(wp * 3.0) - 0.5 - spot;
    float phase = fract(uNkTime * 1.1 + nkHash(cellW) * 7.0);
    float ring = (1.0 - smoothstep(0.0, 0.03, abs(length(inCell) - phase * 0.3))) * (1.0 - phase) * (1.0 - phase);
    ring *= smoothstep(0.4, 0.8, puddle) * step(0.35, nkHash(cellW + 4.1));
    float wet = smoothstep(0.25, 0.6, uWet);
    diffuseColor.rgb *= 1.0 - 0.45 * wet - 0.35 * puddle;
    // A mirror of the sky, dimmed: a wet road reads as dark and glossy, silvery only far off.
    vec3 mirrored = mix(uSkyHorizon, uSkyTop, 0.4) * 0.6 * (1.0 - uNight * 0.85);
    nkWet = mirrored * (grazing * 0.4 * wet + puddle * (0.1 + 0.45 * grazing) + ring * 0.25 * uRain);
    // The sun (or moon) mirrored in the wet: a hard glint in puddles, a broad sheen on damp tar,
    // blinding when you look into a low sun across a wet street. Rippled a little.
    vec3 nkN = normalize(vec3((nkNoise(wp * 1.7) - 0.5) * 0.07, 1.0, (nkNoise(wp * 1.7 + 7.3) - 0.5) * 0.07));
    vec3 nkR = reflect(Vw, nkN);
    float nkUp = uSunDir.y;
    vec3 nkSunCol = mix(vec3(1.0, 0.5, 0.22), vec3(1.0, 0.93, 0.82), smoothstep(0.05, 0.45, nkUp));
    float nkSun = smoothstep(-0.03, 0.02, nkUp) * (1.0 - uNight);
    float nkMoon = uNight * 0.12;
    float nkAlign = max(dot(nkR, nkUp > -0.05 ? uSunDir : normalize(vec3(-uSunDir.x, abs(uSunDir.y) + 0.2, -uSunDir.z))), 0.0);
    float nkGlare = pow(nkAlign, 500.0) * puddle * 8.0 + pow(nkAlign, 40.0) * wet * 0.5;
    nkWet += (nkSunCol * nkSun + vec3(0.75, 0.82, 1.0) * nkMoon) * nkGlare * (1.0 - uRain * 0.75);
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
  if (vRoad.z < -0.5) {
    // Footpath: interlocking pavers, and a kerb stone along the road (yellow-black on main roads).
    float fwp = fwidth(vRoad.x) + 0.001;
    vec2 pv = vec2(vRoad.x / 0.4, vRoad.y / 0.4);
    pv.y += 0.5 * step(1.0, mod(floor(pv.x), 2.0));
    vec2 pf = abs(fract(pv) - 0.5);
    float near = 1.0 - smoothstep(0.1, 0.5, fwidth(pv.x) + fwidth(pv.y));
    float joint = smoothstep(0.43, 0.5, max(pf.x, pf.y)) * near;
    vec3 paver = vec3(0.5, 0.48, 0.45) * (0.88 + 0.24 * nkHash(floor(pv)) * near);
    paver = mix(paver, paver * vec3(1.1, 0.92, 0.85), step(0.7, nkHash(floor(pv) + 3.0)) * near * 0.6); // a few red pavers
    paver *= 1.0 - 0.45 * joint;
    paver *= 0.85 + 0.25 * nkNoise(vNkWorld.xz * 0.9); // stains
    float kerb = 1.0 - smoothstep(0.22, 0.22 + fwp, vRoad.x);
    vec3 kerbCol = vec3(0.62, 0.61, 0.58);
    if (vRoad.z < -1.5) kerbCol = mix(vec3(0.78, 0.6, 0.08), vec3(0.06), step(0.5, fract(vRoad.y / 1.8)));
    diffuseColor.rgb = mix(paver, kerbCol, kerb);
  }
  if (vRoad.z > 0.0) {
    float across = abs(vRoad.x);
    // Tyre tracks: asphalt polished a little darker where wheels run.
    diffuseColor.rgb *= 1.0 - 0.07 * (1.0 - smoothstep(0.3, 0.9, abs(across - vRoad.z * 0.5)));
    // ---- Bengaluru road wear (only up close, where it can be seen) ----
    float nearR = 1.0 - smoothstep(0.08, 0.4, fwidth(vRoad.y));
    vec2 rp = vec2(vRoad.x, vRoad.y);
    // Wide roads: every 3.3 m lane has its own pair of polished wheel tracks and an oil line
    // down the middle, where engines drip at signals.
    if (vRoad.z > 2.75) {
      float lx = mod(vRoad.x + vRoad.z, 3.3) - 1.65;
      float tracks = 1.0 - smoothstep(0.18, 0.45, abs(abs(lx) - 0.85));
      float oil = (1.0 - smoothstep(0.05, 0.4, abs(lx))) * (0.45 + 0.55 * nkNoise(vec2(vRoad.x * 2.0, vRoad.y * 0.12)));
      diffuseColor.rgb *= 1.0 - 0.07 * tracks - 0.11 * oil;
    }
    // Dust drifts in along the kerbs: the road edges are paler and sandy.
    float dusty = smoothstep(vRoad.z - 1.3, vRoad.z - 0.1, across) * (0.55 + 0.45 * nkNoise(rp * 0.6));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.43, 0.39, 0.33), dusty * 0.38);
    // Big soft tone patches, so a long road is never one flat grey.
    diffuseColor.rgb *= 0.92 + 0.15 * nkNoise(rp * vec2(0.09, 0.025));
    // Tar patches: darker, fresher rectangles where the road was dug up and filled.
    vec2 pc = floor(rp / vec2(2.6, 7.0));
    float ph = nkHash(pc + 41.0);
    vec2 pf = fract(rp / vec2(2.6, 7.0));
    float patchR = step(0.82, ph) * step(0.12, pf.x) * step(pf.x, 0.88) * step(0.15, pf.y) * step(pf.y, 0.78);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.63, 0.66), patchR * nearR);
    // Potholes: rough round holes with a dark wet floor and a crumbling lighter rim.
    vec2 hc = floor(rp / 3.3);
    float hh = nkHash(hc + 7.0);
    vec2 hcen = (hc + 0.25 + 0.5 * vec2(nkHash(hc + 1.3), nkHash(hc + 2.9))) * 3.3;
    float hr = 0.25 + 0.4 * nkHash(hc + 5.1);
    float hd = length(rp - hcen) / hr + (nkNoise(rp * 6.0) - 0.5) * 0.5;
    float hole = step(0.9, hh) * (1.0 - smoothstep(0.85, 1.0, hd));
    float rim = step(0.9, hh) * smoothstep(0.85, 1.0, hd) * (1.0 - smoothstep(1.0, 1.35, hd));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.12, 0.11) + 0.05 * nkNoise(rp * 20.0), hole * nearR);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + 0.03, rim * nearR * 0.7);
    // Manhole covers every ~45 m, a little off the centre line.
    float along45 = mod(vRoad.y + 13.0, 45.0) - 22.5;
    vec2 mc = vec2(vRoad.x - vRoad.z * 0.28, along45);
    float md = length(mc);
    float cover = 1.0 - smoothstep(0.38, 0.4, md);
    float ring = smoothstep(0.33, 0.35, md) * cover;
    float grid = step(0.75, fract(mc.x * 6.0)) + step(0.75, fract(mc.y * 6.0));
    vec3 iron = vec3(0.22, 0.21, 0.2) * (1.0 - 0.25 * min(grid, 1.0)) + ring * 0.08;
    diffuseColor.rgb = mix(diffuseColor.rgb, iron, cover * nearR * step(5.5, vRoad.z * 2.0));
    // Painted speed-breakers across smaller roads, now and then: yellow and black stripes.
    float bump = step(0.86, nkHash(vec2(floor(vRoad.y / 80.0), vRoad.z))) * (1.0 - smoothstep(0.75, 0.8, abs(mod(vRoad.y, 80.0) - 40.0)));
    bump *= step(vRoad.z, 4.0);
    vec3 stripe = mix(vec3(0.85, 0.7, 0.1), vec3(0.08), step(0.5, fract(vRoad.x / 0.9)));
    diffuseColor.rgb = mix(diffuseColor.rgb, stripe, bump);
    float fw = fwidth(vRoad.x) + 0.001;
    float centre = (1.0 - smoothstep(0.07, 0.07 + fw, across)) * step(0.5, fract(vRoad.y / 6.0));
    float edge = smoothstep(vRoad.z - 0.42 - fw, vRoad.z - 0.42, across) * (1.0 - smoothstep(vRoad.z - 0.3, vRoad.z - 0.3 + fw, across));
    edge *= step(4.4, vRoad.z);
    float kerb = smoothstep(vRoad.z - 0.18 - fw, vRoad.z - 0.18, across);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.87, 0.82), max(centre, edge) * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.6), kerb);
  }
`;

function facades(material: THREE.MeshLambertMaterial, night: { value: number }, surfaces: SurfaceUniforms, lightDir: { value: THREE.Vector3 }, sky: SkyUniforms, rain: { value: number }, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.uniforms.uNkTime = time;
    shader.uniforms.uLightDir = lightDir;
    Object.assign(shader.uniforms, sky);
    shader.uniforms.uRain = rain;
    addWorldPosition(shader, surfaces);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWin;\nvarying vec3 vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWin;\nuniform float uNight;\nuniform vec3 uLightDir;\nuniform vec3 uSkyTop;\nuniform vec3 uSkyHorizon;\nuniform float uSkyGain;\nuniform float uRain;\nuniform float uNkTime;\n${FACADE_PARS_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BUILDING_PHOTO_GLSL}\ndiffuseColor.rgb *= 1.0 - 0.16 * uRain; // wet plaster\n${FACADE_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += nkEmit;');
  };
  material.customProgramCacheKey = () => 'nukkad-facades-11';
}

function roads(material: THREE.MeshLambertMaterial, surfaces: SurfaceUniforms, weather: WeatherUniforms): void {
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader, surfaces);
    Object.assign(shader.uniforms, weather);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRoad;\n${WEATHER_PARS_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROAD_GLSL}\n${WET_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += nkWet;')
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
  material.customProgramCacheKey = () => 'nukkad-roads-7';
}

/** Breaks up the flat ground colour with soft blotches and fine grain. */
function groundDetail(material: THREE.MeshLambertMaterial, surfaces: SurfaceUniforms, weather: WeatherUniforms): void {
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader, surfaces);
    Object.assign(shader.uniforms, weather);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${WEATHER_PARS_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       diffuseColor.rgb *= 1.0 - 0.32 * smoothstep(0.0, 0.4, uWet); // wet soil is darker
       float nkShade = diffuseColor.a; // baked: darker close to buildings
       diffuseColor.a = 1.0;
       vec3 nkBase = diffuseColor.rgb;
       float nkGrass = smoothstep(0.015, 0.09, nkBase.g - max(nkBase.r, nkBase.b) * 1.03);
       float blotch = nkNoise(vNkWorld.xz * 0.08) * 0.6 + nkNoise(vNkWorld.xz * 0.6) * 0.4;
       diffuseColor.rgb *= 0.88 + 0.18 * blotch;
       if (uTexOn > 0.5) {
         // Fine grain close up plus a big soft pattern, so the photo never shows as a repeating tile.
         float fineT = dot(texture2D(uSoil, vNkWorld.xz / 2.1).rgb / uSoilAvg, vec3(0.333));
         float wideT = dot(texture2D(uSoil, vNkWorld.zx / 19.0 + 0.37).rgb / uSoilAvg, vec3(0.333));
         float grain = mix(1.0, fineT, 0.38) * mix(1.0, wideT, 0.3);
         diffuseColor.rgb *= mix(grain, 1.0, nkGrass * 0.7);
       } else {
         diffuseColor.rgb *= 0.94 + 0.08 * nkNoise(vNkWorld.xz * 4.0);
       }
       // Lawns and parks: streaky blades, lighter and yellower patches.
       float blades = nkNoise(vNkWorld.xz * vec2(36.0, 6.0)) * 0.5 + nkNoise(vNkWorld.zx * vec2(39.0, 8.0)) * 0.5;
       float patchy = nkNoise(vNkWorld.xz * 0.3 + 11.0);
       vec3 lawn = nkBase * mix(vec3(0.72, 0.9, 0.6), vec3(1.12, 1.08, 0.78), patchy) * (0.78 + 0.44 * blades);
       diffuseColor.rgb = mix(diffuseColor.rgb, lawn, nkGrass);
       // Bare ground: patches of red earth, and darker damp soil.
       float nkBare = (1.0 - nkGrass) * step(nkBase.b, nkBase.r) * step(abs(nkBase.r - nkBase.g), 0.12);
       float earth = smoothstep(0.52, 0.75, nkNoise(vNkWorld.xz * 0.045 + 7.0) * 0.7 + nkNoise(vNkWorld.xz * 0.21) * 0.3);
       diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 0.84, 0.68), earth * nkBare * 0.75);
       diffuseColor.rgb *= 1.0 - 0.16 * smoothstep(0.6, 0.85, nkNoise(vNkWorld.xz * 0.11 + 31.0)) * nkBare;
       diffuseColor.rgb *= nkShade;`,
    );
  };
  material.customProgramCacheKey = () => 'nukkad-ground-7';
}

/** Lakes and pools: moving ripples, the sky mirrored at flat angles, and sun glitter. */
function waterRipples(material: THREE.MeshLambertMaterial, time: { value: number }, night: { value: number }, lightDir: { value: THREE.Vector3 }, sky: SkyUniforms, rain: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uNight = night;
    shader.uniforms.uLightDir = lightDir;
    shader.uniforms.uSkyTop = sky.uSkyTop;
    shader.uniforms.uSkyHorizon = sky.uSkyHorizon;
    shader.uniforms.uRain = rain;
    addWorldPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uNight;\nuniform vec3 uLightDir;\nuniform vec3 uSkyTop;\nuniform vec3 uSkyHorizon;\nuniform float uRain;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec2 p = vNkWorld.xz;
         vec2 q1 = p * 0.35 + vec2(uTime * 0.25, uTime * 0.17);
         vec2 q2 = p * 1.3 - vec2(uTime * 0.4, -uTime * 0.3);
         // Rain stipples the surface with fine, fast-moving dimples.
         vec2 q3 = p * 5.0 + vec2(uTime * 2.1, -uTime * 1.7);
         float wave = nkNoise(q1) * 0.6 + nkNoise(q2) * 0.4;
         // A wavy surface normal from the slope of the ripples.
         float e = 0.35;
         float wx = (nkNoise(q1 + vec2(e, 0.0)) - nkNoise(q1)) * 0.6 + (nkNoise(q2 + vec2(e, 0.0)) - nkNoise(q2)) * 0.4;
         float wz = (nkNoise(q1 + vec2(0.0, e)) - nkNoise(q1)) * 0.6 + (nkNoise(q2 + vec2(0.0, e)) - nkNoise(q2)) * 0.4;
         wx += (nkNoise(q3 + vec2(0.15, 0.0)) - nkNoise(q3)) * uRain * 1.2;
         wz += (nkNoise(q3 + vec2(0.0, 0.15)) - nkNoise(q3)) * uRain * 1.2;
         vec3 wn = normalize(vec3(-wx * 1.6, 1.0, -wz * 1.6));
         vec3 wv = normalize(vNkWorld - cameraPosition);
         vec3 wr = reflect(wv, wn);
         float day = 1.0 - uNight;
         // The real sky mirrored: its horizon colour at flat angles, its top looking up.
         vec3 mirror = mix(uSkyHorizon, uSkyTop, clamp(wr.y * 1.5, 0.0, 1.0));
         float fres = 0.08 + 0.92 * pow(1.0 - max(0.0, -dot(wv, wn)), 4.0);
         diffuseColor.rgb = mix(diffuseColor.rgb * (0.8 + 0.25 * wave), mirror, fres * 0.85);
         float nkGlint = pow(max(dot(wr, uLightDir), 0.0), 140.0) * (0.25 + 0.75 * day);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * nkGlint * 2.5;');
  };
  material.customProgramCacheKey = () => 'nukkad-water-3';
}

/** Tree tops sway gently; each tree moves a little differently. Leaf cards also flutter. */
function wind(material: THREE.MeshLambertMaterial, time: { value: number }, rain: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uRain = rain;
    // Leaf cards are seen from both sides but must shade as part of one round crown:
    // undo the "flip the normal on the back face" that double-sided materials do.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif',
    );
    // Whitewashed trunks with a red band, the way roadside trees are painted in India: bark-
    // coloured parts below about 1.1 m (the trunk's own height, before wind and growth).
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTrunkY;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      #ifdef USE_COLOR
        float nkBark = step(vColor.g * 1.25, vColor.r) * step(vColor.b * 1.15, vColor.g) * step(vColor.r, 0.3);
        if (nkBark > 0.5 && vTrunkY < 1.15) {
          float band = step(0.76, vTrunkY) * step(vTrunkY, 0.92);
          vec3 paint = mix(vec3(0.8, 0.8, 0.76), vec3(0.6, 0.06, 0.05), band);
          diffuseColor.rgb = mix(paint, diffuseColor.rgb, smoothstep(1.06, 1.15, vTrunkY));
        }
      #endif`,
    );
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uRain;\nvarying float vTrunkY;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         float phase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
       #else
         float phase = 0.0;
       #endif
       vTrunkY = position.y;
       float bend = max(0.0, transformed.y - 1.4);
       // Storms: stronger sway, gusts that lean the whole crown, and leaves thrashing.
       float storm = 1.0 + 2.4 * uRain;
       float gust = uRain * (0.5 + 0.5 * sin(uTime * 0.45 + phase * 0.37)) * 0.05;
       transformed.x += (sin(uTime * 1.6 + phase) * 0.045 * storm + gust) * bend;
       transformed.z += (cos(uTime * 1.3 + phase * 1.7) * 0.03 * storm + gust * 0.6) * bend;
       float flutter = step(1.6, transformed.y) * 0.035 * (1.0 + 2.0 * uRain);
       transformed.y += sin(uTime * 3.1 + position.x * 4.0 + position.z * 3.0 + phase) * flutter;`,
    );
  };
  material.customProgramCacheKey = () => 'nukkad-wind-4';
}

export function createMaterials(groundMap: THREE.Texture, windows: boolean, surfaces: SurfaceUniforms, leaves: THREE.Texture | null = null): WorldMaterials {
  const night = { value: 0 };
  const time = { value: 0 };
  const lightDir = { value: new THREE.Vector3(0.4, 0.8, 0.3) };
  const sky: SkyUniforms = { uSkyTop: { value: new THREE.Color(0.25, 0.42, 0.8) }, uSkyHorizon: { value: new THREE.Color(0.7, 0.74, 0.8) }, uSkyGain: { value: 1 } };
  const rain = { value: 0 };
  const wet = { value: 0 };
  const sunDir = { value: new THREE.Vector3(0.4, 0.6, 0.3) };
  const weather: WeatherUniforms = { ...sky, uRain: rain, uWet: wet, uSunDir: sunDir, uNkTime: time, uNight: night };
  const terrain = new THREE.MeshLambertMaterial({ map: groundMap });
  groundDetail(terrain, surfaces, weather);
  const buildings = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (windows) facades(buildings, night, surfaces, lightDir, sky, wet, time); // walls dry like the ground
  // Roads and water lie just above the ground; the offset stops them flickering against it.
  const ground = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  roads(ground, surfaces, weather);
  const water = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  waterRipples(water, time, night, lightDir, sky, rain);
  const props = new THREE.MeshLambertMaterial({ vertexColors: true });
  const trees = leaves
    ? new THREE.MeshLambertMaterial({ vertexColors: true, map: leaves, alphaTest: 0.4, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  wind(trees, time, rain);
  return { night, time, lightDir, sunDir, sky, rain, wet, terrain, buildings, ground, water, props, trees, all: [terrain, buildings, ground, water, props, trees] };
}
