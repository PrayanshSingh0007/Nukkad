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
  varying vec3 vDir;

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
    vec3 color = mix(uHorizon, uTop, pow(up, 0.55));
    if (dir.y < 0.0) color = mix(uHorizon, uHorizon * 0.7, min(1.0, -dir.y * 4.0));

    float sun = dot(dir, uSunDir);
    color += uSunColor * (smoothstep(0.9993, 0.9997, sun) * 4.0 + pow(max(sun, 0.0), 64.0) * 0.35);

    // Clouds: a flat layer high above, drifting slowly; puffy by day, dim grey at night.
    if (dir.y > 0.02) {
      vec2 cp = dir.xz / (dir.y + 0.12) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
      float cover = fbm(cp);
      float body = smoothstep(0.5, 0.78, cover);
      float thick = smoothstep(0.55, 0.95, fbm(cp + uSunDir.xz * 0.06)); // denser towards the sun = shaded side
      vec3 lit = mix(vec3(1.0, 0.99, 0.96), uSunColor, 0.25) * (1.0 - uNight * 0.86);
      vec3 shade = mix(uHorizon, vec3(0.62, 0.66, 0.74), 0.5) * (1.0 - uNight * 0.8);
      vec3 cloud = mix(lit, shade, thick * 0.6);
      float fadeOut = smoothstep(0.02, 0.22, dir.y); // thin out towards the horizon haze
      color = mix(color, cloud, body * fadeOut * 0.92);
    }

    float moon = dot(dir, uMoonDir);
    color = mix(color, vec3(0.92, 0.94, 1.0), smoothstep(0.9994, 0.9997, moon) * uNight);

    vec3 cell = floor(dir * 220.0);
    float star = step(0.9975, hash(cell)) * smoothstep(0.02, 0.25, dir.y);
    color += vec3(star) * smoothstep(0.7, 1.0, uNight) * 0.9; // stars only once it is properly dark

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
