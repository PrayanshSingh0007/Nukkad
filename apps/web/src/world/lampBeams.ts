import * as THREE from 'three';

/**
 * Light you can see in the air under each street lamp at night: a soft cone from the lamp head
 * down to the road, brightest at the lamp and fading towards the ground and at its edges. In
 * rain it is much stronger (light scatters off the drops) and drops glint as they fall through it.
 * One instanced draw call, additive, never written to depth; the ambient-occlusion pass skips it.
 */
const HEIGHT = 5;
const RADIUS_TOP = 0.16;
const RADIUS_GROUND = 2.7;

const PARS_VERTEX = /* glsl */ `
  varying float vNkT;
  varying vec3 vNkNormal;
  varying vec3 vNkView;
  varying vec3 vNkWorld;
  varying float vNkAngle;
`;
const MAIN_VERTEX = /* glsl */ `
  vNkT = clamp(-position.y / ${HEIGHT.toFixed(1)}, 0.0, 1.0);
  vNkNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vNkView = -mvPosition.xyz;
  vNkWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  vNkAngle = atan(position.z, position.x);
`;
const PARS_FRAGMENT = /* glsl */ `
  uniform float uStrength;
  uniform float uRain;
  uniform float uTime;
  varying float vNkT;
  varying vec3 vNkNormal;
  varying vec3 vNkView;
  varying vec3 vNkWorld;
  varying float vNkAngle;
  float nkHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
`;
const MAIN_FRAGMENT = /* glsl */ `
  // Looking straight through the cone you see the most air; its outline fades to nothing.
  float nkFacing = abs(dot(normalize(vNkNormal), normalize(vNkView)));
  float nkBody = pow(max(nkFacing, 0.0), 1.6);
  // Brightest at the lamp, fading down, and gone just before the ground (no hard ring there).
  float nkT = clamp(vNkT, 0.0, 1.0); // interpolation can step just past 1, and pow() of a negative is NaN
  float nkFall = mix(0.3, 1.0, pow(1.0 - nkT, 1.5)) * (1.0 - smoothstep(0.86, 1.0, nkT));
  // Rain: thin bright streaks falling through the light (~9 m/s).
  float nkCol = vNkAngle * 38.0;
  float nkColId = floor(nkCol);
  float nkRow = vNkWorld.y * 1.6 + uTime * 14.0 + nkHash(vec2(nkColId, 3.0)) * 50.0;
  float nkLine = 1.0 - smoothstep(0.06, 0.18, abs(fract(nkCol) - 0.5));
  float nkDrop = step(0.84, nkHash(vec2(nkColId, floor(nkRow)))) * nkLine * smoothstep(0.0, 0.6, fract(nkRow)) * uRain * 3.0;
  // Fades out far away (fog would add its own colour to added light, so it is done here) and
  // right in front of the camera (standing inside a cone).
  float nkDist = length(vNkView);
  float nkNearFar = smoothstep(0.6, 2.2, nkDist) * (1.0 - smoothstep(70.0, 170.0, nkDist));
  float nkGlow = uStrength * nkBody * nkFall * nkNearFar * (1.0 + nkDrop);
  diffuseColor.rgb *= nkGlow;
`;

export class LampBeams {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly uniforms = { uStrength: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 } };

  /** heads: [x, y, z] of each lamp head; grounds: the ground height under each. */
  constructor(heads: Float32Array, grounds: Float32Array) {
    const count = grounds.length;
    const geometry = new THREE.CylinderGeometry(RADIUS_TOP, RADIUS_GROUND, HEIGHT, 28, 1, true).translate(0, -HEIGHT / 2, 0);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffc98a,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PARS_VERTEX}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${MAIN_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PARS_FRAGMENT}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${MAIN_FRAGMENT}`);
    };
    this.material.customProgramCacheKey = () => 'nukkad-lamp-beams-1';
    this.mesh = new THREE.InstancedMesh(geometry, this.material, Math.max(1, count));
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      position.set(heads[i * 3], heads[i * 3 + 1], heads[i * 3 + 2]);
      const drop = Math.max(1.5, position.y - grounds[i]);
      // Taller drops spread wider, the way a real light cone does.
      const spread = drop / HEIGHT;
      this.mesh.setMatrixAt(i, matrix.compose(position, rotation, scale.set(spread, drop / HEIGHT, spread)));
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    // The ambient-occlusion pass hides lines (and Line2 meshes) while it draws the scene's
    // shapes; flagging the beams like one keeps it from shading the road around them.
    (this.mesh as unknown as { isLine2: boolean }).isLine2 = true;
  }

  /** night: 0 day … 1 night; rain: 0 … 1. */
  setLevel(night: number, rain: number): void {
    const strength = THREE.MathUtils.smoothstep(night, 0.35, 0.9) * (0.07 + 0.2 * rain);
    this.uniforms.uStrength.value = strength;
    this.uniforms.uRain.value = rain;
    this.mesh.visible = strength > 0.004;
  }

  update(dt: number): void {
    this.uniforms.uTime.value = (this.uniforms.uTime.value + dt) % 1000;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
