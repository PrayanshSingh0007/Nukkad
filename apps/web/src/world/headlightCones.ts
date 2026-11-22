import * as THREE from 'three';

/**
 * The light of headlights in the air at night: a soft cone reaching ~14 m ahead of each
 * headlight, tipped a little down, brightest at the lamp. Faint on a dry night; strong in rain
 * (with drops glinting as they fall through it) and in mist. Traffic draws all of theirs with one
 * instanced draw call (`HeadlightCones`); your own vehicle carries a pair (`headlightConePair`).
 * Additive, never written to depth; the ambient-occlusion pass skips them.
 */
const LENGTH = 14;
const RADIUS = 2.6;

const uniforms = { uStrength: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 } };

let geometry: THREE.BufferGeometry | null = null;
let material: THREE.MeshBasicMaterial | null = null;

/** Apex at the lamp, opening towards −z (the vehicle's front), tipped 4° down. */
function coneGeometry(): THREE.BufferGeometry {
  if (!geometry) {
    geometry = new THREE.ConeGeometry(RADIUS, LENGTH, 20, 1, true)
      .translate(0, -LENGTH / 2, 0)
      .rotateX(Math.PI / 2)
      .rotateX(-0.07);
  }
  return geometry;
}

function coneMaterial(): THREE.MeshBasicMaterial {
  if (material) return material;
  material = new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vNkT;
        varying vec3 vNkNormal;
        varying vec3 vNkView;
        varying vec3 vNkWorld;
        varying float vNkAngle;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vNkT = clamp(-position.z / ${LENGTH.toFixed(1)}, 0.0, 1.0);
        #ifdef USE_INSTANCING
          mat3 nkTurn = mat3(modelMatrix) * mat3(instanceMatrix);
        #else
          mat3 nkTurn = mat3(modelMatrix);
        #endif
        vNkNormal = normalize(mat3(viewMatrix) * nkTurn * normal);
        vNkView = -mvPosition.xyz;
        vNkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #ifdef USE_INSTANCING
          vNkWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        vNkAngle = atan(position.y, position.x);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uStrength;
        uniform float uRain;
        uniform float uTime;
        varying float vNkT;
        varying vec3 vNkNormal;
        varying vec3 vNkView;
        varying vec3 vNkWorld;
        varying float vNkAngle;
        float nkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Looking through the middle of the cone you see the most lit air; its outline fades out.
        float nkFacing = abs(dot(normalize(vNkNormal), normalize(vNkView)));
        float nkBody = pow(max(nkFacing, 0.0), 1.4);
        float nkT = clamp(vNkT, 0.0, 1.0); // pow() of a negative is NaN, and NaN blacks out the frame
        float nkFall = pow(1.0 - nkT, 2.2) * smoothstep(0.0, 0.05, nkT);
        // Rain: thin streaks falling through the light.
        float nkCol = vNkAngle * 30.0;
        float nkColId = floor(nkCol);
        float nkRow = vNkWorld.y * 1.6 + uTime * 14.0 + nkHash(vec2(nkColId, 5.0)) * 50.0;
        float nkLine = 1.0 - smoothstep(0.06, 0.2, abs(fract(nkCol) - 0.5));
        float nkDrop = step(0.84, nkHash(vec2(nkColId, floor(nkRow)))) * nkLine * uRain * 2.5;
        float nkDist = length(vNkView);
        float nkNearFar = smoothstep(0.8, 3.0, nkDist) * (1.0 - smoothstep(60.0, 130.0, nkDist));
        diffuseColor.rgb *= uStrength * nkBody * nkFall * nkNearFar * (1.0 + nkDrop);`,
      );
  };
  material.customProgramCacheKey = () => 'nukkad-headlight-cones-1';
  return material;
}

/** Hides a mesh from the ambient-occlusion pass (it hides lines and Line2 meshes while it draws shapes). */
function skipAmbientOcclusion(mesh: THREE.Object3D): void {
  (mesh as unknown as { isLine2: boolean }).isLine2 = true;
}

/** How visible headlight light is in the air: night 0–1, rain 0–1, mist 0–1. Call every frame. */
export function setHeadlightHaze(night: number, rain: number, mist: number, dt: number): void {
  const dark = THREE.MathUtils.smoothstep(night, 0.3, 0.85);
  uniforms.uStrength.value = dark * (0.05 + 0.22 * rain + 0.16 * mist);
  uniforms.uRain.value = rain;
  uniforms.uTime.value = (uniforms.uTime.value + dt) % 1000;
}

export function headlightsVisible(): boolean {
  return uniforms.uStrength.value > 0.004;
}

/** Your own vehicle's pair of cones, as children of it (lamp positions in its own space). */
export function headlightConePair(lamps: THREE.Vector3[]): THREE.Group {
  const group = new THREE.Group();
  for (const lamp of lamps) {
    const cone = new THREE.Mesh(coneGeometry(), coneMaterial());
    cone.position.copy(lamp);
    cone.frustumCulled = false;
    cone.renderOrder = 2;
    skipAmbientOcclusion(cone);
    group.add(cone);
  }
  return group;
}

/** Traffic's cones: fill with `begin` / `add` / `commit` every frame. */
export class HeadlightCones {
  readonly mesh: THREE.InstancedMesh;
  private used = 0;

  constructor(capacity: number) {
    this.mesh = new THREE.InstancedMesh(coneGeometry(), coneMaterial(), Math.max(1, capacity));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    skipAmbientOcclusion(this.mesh);
  }

  begin(): void {
    this.used = 0;
  }

  /** One headlight: its world matrix (the cone opens along the matrix's −z). */
  add(matrix: THREE.Matrix4): void {
    if (this.used >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.used++, matrix);
  }

  commit(): void {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.used > 0 && headlightsVisible();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    // The geometry and material are shared with your own vehicle's cones: kept.
  }
}
