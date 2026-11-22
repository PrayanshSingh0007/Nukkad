import * as THREE from 'three';

/**
 * Spray behind traffic on wet roads: a soft cloud of fine water thrown up behind each moving
 * vehicle near you, lowest and thickest at the back wheels, thinning out behind and above,
 * churning as it drifts. One instanced draw call of soft volumes (a squashed sphere each, drawn
 * as mist: dense where you look through the middle, fading to nothing at its outline).
 */
const uniforms = { uStrength: { value: 0 }, uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } };

export class TrafficSpray {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private used = 0;

  constructor(capacity: number) {
    // A unit volume: its front at z = 0 (the vehicle's back), reaching back to z = 1, from the
    // road (y = 0) up to y = 1.
    const geometry = new THREE.SphereGeometry(0.5, 14, 8).scale(1, 1, 1).translate(0, 0.35, 0.5);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vSpLocal;
          varying vec3 vSpNormal;
          varying vec3 vSpView;
          varying vec3 vSpWorld;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vSpLocal = position;
          vSpNormal = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vSpView = -mvPosition.xyz;
          vSpWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uStrength;
          uniform float uTime;
          uniform vec3 uLight;
          varying vec3 vSpLocal;
          varying vec3 vSpNormal;
          varying vec3 vSpView;
          varying vec3 vSpWorld;
          float spHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float spNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(spHash(i), spHash(i + vec2(1.0, 0.0)), f.x), mix(spHash(i + vec2(0.0, 1.0)), spHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Thick through the middle, nothing at the outline (a cloud, not a shell).
          float spFacing = abs(dot(normalize(vSpNormal), normalize(vSpView)));
          float spBody = pow(max(spFacing, 0.0), 1.2);
          // Densest low down at the wheels, thinning out behind and upwards, eased in at the bumper.
          float spBack = clamp(vSpLocal.z, 0.0, 1.0);
          float spUp = clamp(vSpLocal.y / 0.85, 0.0, 1.0);
          float spShape = smoothstep(0.0, 0.12, spBack) * (1.0 - spBack) * pow(1.0 - spUp, 1.5);
          // A plume behind each wheel (left and right), joining into one further back.
          float spSide = abs(vSpLocal.x) * 2.0;
          float spPlumes = mix(exp(-pow((spSide - 0.62) / 0.28, 2.0)), 1.0, spBack * 0.7);
          // Wisps streaming back from the tyres and churning.
          vec2 spP = vec2(vSpLocal.x * 7.0 + vSpWorld.x * 0.3, vSpLocal.z * 3.5 - uTime * 5.0);
          float spWisp = spNoise(spP) * 0.55 + spNoise(spP * 2.1 + vec2(3.0, -uTime * 3.0)) * 0.45;
          spWisp = smoothstep(0.3, 0.8, spWisp);
          float spDist = length(vSpView);
          float spNear = smoothstep(1.5, 4.0, spDist);
          diffuseColor.rgb = uLight;
          diffuseColor.a = clamp(uStrength * spBody * spShape * spPlumes * (0.25 + 1.4 * spWisp) * spNear, 0.0, 0.55);`,
        );
    };
    this.material.customProgramCacheKey = () => 'nukkad-traffic-spray-2';
    this.mesh = new THREE.InstancedMesh(geometry, this.material, Math.max(1, capacity));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    // The ambient-occlusion pass hides lines (and Line2 meshes) while it draws the scene's
    // shapes; flagging the spray like one keeps it from darkening the road around it.
    (this.mesh as unknown as { isLine2: boolean }).isLine2 = true;
  }

  /** How wet the road is (0–1), the daylight colour, and the frame time. */
  setLevel(wet: number, light: THREE.Color, dt: number): void {
    uniforms.uStrength.value = THREE.MathUtils.smoothstep(wet, 0.15, 0.7) * 1.6;
    uniforms.uLight.value.copy(light);
    uniforms.uTime.value = (uniforms.uTime.value + dt) % 1000;
  }

  get active(): boolean {
    return uniforms.uStrength.value > 0.01;
  }

  begin(): void {
    this.used = 0;
  }

  /** One vehicle's spray: its back-centre on the road, heading, half width, speed (m/s). */
  add(matrix: THREE.Matrix4): void {
    if (this.used >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.used++, matrix);
  }

  commit(): void {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.used > 0 && this.active;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
