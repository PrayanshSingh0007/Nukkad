import * as THREE from 'three';

/**
 * The sky: a big dome around the camera painted by a small shader — colour fades from
 * the horizon to the top, a sun disc with a glow, a moon disc, and stars at night.
 * No textures, one draw call.
 */
const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far end of the depth range
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uNight;
  uniform float uTime;
  uniform float uRain;
  uniform float uFlash;
  uniform float uRainbow;
  varying vec3 vDir;
  /** A rainbow's colour at t = 0 (violet, inside) … 1 (red, outside). */
  vec3 nkSpectrum(float t) {
    float hue = (1.0 - clamp(t, 0.0, 1.0)) * 0.78;
    vec3 k = clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    return k * k * (3.0 - 2.0 * k);
  }

  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise2(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = max(dir.y, 0.0);
    // Deep blue overhead fading into a pale, slightly warm haze band at the horizon.
    vec3 color = mix(uHorizon, uTop, pow(up, 0.45));
    color = mix(color, uHorizon * vec3(1.04, 1.0, 0.94), (1.0 - smoothstep(0.0, 0.12, up)) * 0.5);
    if (dir.y < 0.0) color = mix(uHorizon, uHorizon * 0.7, min(1.0, -dir.y * 4.0));

    float sun = dot(dir, uSunDir);
    float sunUp = max(sun, 0.0);
    // Sun disc, a tight glow and a wide warm haze around it (light scattered by the city's air).
    color += uSunColor * (smoothstep(0.9993, 0.9997, sun) * 5.0 + pow(sunUp, 64.0) * 0.45 + pow(sunUp, 6.0) * 0.18 + pow(sunUp, 2.0) * 0.06) * (1.0 - uRain * 0.92);

    if (dir.y > 0.015) {
      vec2 base = dir.xz / (dir.y + 0.12);
      float fadeOut = smoothstep(0.015, 0.2, dir.y); // thin out into the horizon haze
      vec3 lit = mix(vec3(1.0, 0.985, 0.95), uSunColor, 0.3) * (1.0 - uNight * 0.86) * (1.0 - uRain * 0.45);
      vec3 shade = mix(uHorizon * 0.82, vec3(0.5, 0.55, 0.65), 0.55) * (1.0 - uNight * 0.8) * (1.0 - uRain * 0.5);

      // High cirrus: thin streaks stretched along the wind.
      vec2 cq = base * vec2(0.6, 2.4) + vec2(uTime * 0.004, 0.0);
      float cirrus = smoothstep(0.55, 0.85, fbm(cq * 1.3)) * 0.35;
      color = mix(color, lit, cirrus * fadeOut);

      // Cumulus: puffy clouds. Density towards the sun gives them shaded bellies and bright tops.
      vec2 cp = base * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
      float cover = fbm(cp);
      float body = smoothstep(0.5 - uRain * 0.36, 0.74 - uRain * 0.3, cover); // rain: the sky closes over
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.07;
      float shadowing = smoothstep(0.5, 0.85, fbm(cp + toSun)) * 0.55 + smoothstep(0.5, 0.85, fbm(cp + toSun * 2.2)) * 0.45;
      vec3 cloud = mix(lit, shade, shadowing * 0.75);
      // Silver lining: thin cloud edges glow when you look towards the sun.
      float edge = body * (1.0 - smoothstep(0.55, 0.9, cover));
      cloud += uSunColor * edge * pow(sunUp, 4.0) * 0.9;
      color = mix(color, cloud, body * fadeOut * 0.95);
      // Lightning lights the cloud bellies from inside.
      color += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + body) * fadeOut;
    }

    // A rainbow after rain, opposite the sun: the main bow 40–42.5° from the point straight
    // opposite it (violet inside, red outside), a fainter second bow at 50–53.5° with its colours
    // the other way round, and the sky a little brighter inside the main bow.
    if (uRainbow > 0.001) {
      float bowA = degrees(acos(clamp(dot(dir, -uSunDir), -1.0, 1.0)));
      float t1 = (bowA - 40.0) / 2.5;
      float band1 = smoothstep(-0.1, 0.15, t1) * (1.0 - smoothstep(0.85, 1.1, t1));
      float t2 = 1.0 - (bowA - 50.2) / 3.4;
      float band2 = smoothstep(-0.1, 0.15, t2) * (1.0 - smoothstep(0.85, 1.1, t2));
      float inside = 1.0 - smoothstep(34.0, 40.0, bowA);
      float aboveGround = smoothstep(-0.01, 0.06, dir.y);
      vec3 bow = nkSpectrum(t1) * band1 * 0.32 + nkSpectrum(t2) * band2 * 0.075 + vec3(0.05) * inside;
      color += bow * uRainbow * aboveGround;
    }

    float moon = dot(dir, uMoonDir);
    color = mix(color, vec3(0.92, 0.94, 1.0), smoothstep(0.9994, 0.9997, moon) * uNight);

    vec3 cell = floor(dir * 220.0);
    float star = step(0.9975, hash(cell)) * smoothstep(0.02, 0.25, dir.y);
    color += vec3(star) * smoothstep(0.7, 1.0, uNight) * 0.9 * (1.0 - smoothstep(0.0, 0.25, uRain)); // stars only when it is properly dark and clear

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uNight: { value: 0 },
    uTime: { value: 0 },
    /** 0 = clear … 1 = storm: clouds close in and darken, the sun disappears. */
    uRain: { value: 0 },
    /** Lightning: a brief white flash in the clouds. */
    uFlash: { value: 0 },
    /** A rainbow opposite the sun (0–1), for a few minutes after rain. */
    uRainbow: { value: 0 },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false, // the sky colours are already picked for the screen
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** The dome travels with the camera, so it is never reached. */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = (performance.now() / 1000) % 100000;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
