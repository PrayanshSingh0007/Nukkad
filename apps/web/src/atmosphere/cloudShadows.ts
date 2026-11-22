import * as THREE from 'three';

/**
 * Cloud shadows drifting over the city by day: soft patches where a cloud is between the sun and
 * the ground, one to three hundred metres across, moving with the wind. The same everywhere at the same
 * time (from the clock), on everything lit by the sun: buildings, roads, trees, vehicles, people.
 *
 * How: three.js's own lighting code is patched once (before anything compiles) so every lit
 * material dims the sun by a cloud pattern at that point of the world. Its settings live in one
 * GLSL uniform, `nkCloud`, that three.js does not know about; `update` writes it into every
 * shader program each frame (a program keeps its uniform values, and three.js never touches it).
 */
const SCALE_M = 140;
/** The pattern repeats every 256 noise cells, so the wind offset can wrap without a jump. */
const PERIOD_M = SCALE_M * 256;
const WIND = new THREE.Vector2(5.2, 2.4); // m/s, from the west-southwest

const PARS = /* glsl */ `
uniform vec4 nkCloud; // wind offset x, z (m) · strength 0–1 · coverage threshold
float nkCloudHash(vec2 p) {
  p = mod(p, 256.0);
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float nkCloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(nkCloudHash(i), nkCloudHash(i + vec2(1.0, 0.0)), u.x), mix(nkCloudHash(i + vec2(0.0, 1.0)), nkCloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** 1 = full sun … lower under a cloud. viewPosition: the point in view space. */
float nkCloudShade(vec3 viewPosition) {
  if (nkCloud.z <= 0.001) return 1.0;
  vec3 world = cameraPosition + transpose(mat3(viewMatrix)) * viewPosition;
  vec2 p = (world.xz + nkCloud.xy) / ${SCALE_M.toFixed(1)};
  float n = nkCloudNoise(p) * 0.5 + nkCloudNoise(p * 2.0 + 17.0) * 0.3 + nkCloudNoise(p * 4.0 + 41.0) * 0.2;
  return 1.0 - nkCloud.z * smoothstep(nkCloud.w, nkCloud.w + 0.14, n);
}
`;

const SUN_LINE = 'getDirectionalLightInfo( directionalLight, directLight );';
const POSITION_LINE = 'vec3 geometryPosition = - vViewPosition;';
/** Under a cloud the sky's fill light dims a little too (part of it is the sunlit sky overhead). */
const FILL_SHARE = 0.35;
let patched = false;

/** Patches three.js's lighting code (once). Must run before the first frame is drawn. */
export function installCloudShadows(): boolean {
  if (patched) return true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  if (!chunks.lights_fragment_begin.includes(SUN_LINE) || !chunks.lights_fragment_begin.includes(POSITION_LINE) || !chunks.lights_fragment_end.includes('RE_IndirectDiffuse( irradiance')) {
    console.warn('Nukkad: cloud shadows are off (this three.js lights code looks different)');
    return false;
  }
  chunks.lights_pars_begin = `${chunks.lights_pars_begin}\n${PARS}`;
  chunks.lights_fragment_begin = chunks.lights_fragment_begin
    .replace(POSITION_LINE, `${POSITION_LINE}\nfloat nkCloudLight = nkCloudShade( geometryPosition );`)
    .replace(SUN_LINE, `${SUN_LINE}\n\t\tdirectLight.color *= nkCloudLight;`);
  chunks.lights_fragment_end = `\n#if defined( RE_IndirectDiffuse )\nirradiance *= mix( 1.0, nkCloudLight, ${FILL_SHARE.toFixed(2)} );\n#endif\n${chunks.lights_fragment_end}`;
  patched = true;
  return true;
}

export class CloudShadows {
  private readonly locations = new WeakMap<object, WebGLUniformLocation | null>();
  /** Current strength (eased), for the HUD-free "is a cloud over me" checks elsewhere. */
  strength = 0;

  /**
   * strength: 0 (none: night, indoors, phones) … 1; cover: 0 clear … 1 overcast (more of the
   * sky in cloud means more of the ground in shadow).
   */
  update(renderer: THREE.WebGLRenderer, nowMs: number, strength: number, cover: number): void {
    if (!patched) return;
    this.strength = strength;
    const seconds = nowMs / 1000;
    const ox = (seconds * WIND.x) % PERIOD_M;
    const oz = (seconds * WIND.y) % PERIOD_M;
    // The pattern's values sit around 0.5: a lower threshold shades more of the ground.
    const threshold = THREE.MathUtils.lerp(0.68, 0.36, THREE.MathUtils.clamp(cover, 0, 1));
    const gl = renderer.getContext();
    for (const program of renderer.info.programs ?? []) {
      const glProgram = (program as unknown as { program: WebGLProgram }).program;
      let location = this.locations.get(program);
      if (location === undefined) {
        location = gl.getUniformLocation(glProgram, 'nkCloud');
        this.locations.set(program, location);
      }
      if (!location) continue;
      // Through three.js's own state, so its idea of the bound program stays right.
      renderer.state.useProgram(glProgram);
      gl.uniform4f(location, -ox, -oz, strength, threshold);
    }
  }
}
