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
  varying vec3 vDir;

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
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** The dome travels with the camera, so it is never reached. */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
