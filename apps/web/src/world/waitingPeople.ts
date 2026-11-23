import * as THREE from 'three';
import { makeRng, randomLook } from '@nukkad/shared';
import { buildAvatarGeometry } from '../player/avatar/avatarModel.ts';

/**
 * People waiting at bus stops: one to four at each shelter — some sitting on the bench, some
 * standing at the front, a few turned to look down the road for their bus — the light crowd
 * figures, posed by the graphics card (sitting: thighs forward, knees down), swaying a little
 * as they wait. One draw call per look and pose; seeded, so everyone sees the same people.
 */
const LOOKS = 6;
const HIP_Y = 0.92; // the light avatar's hip joint height (avatarModel JOINTS)
const BENCH_Y = 0.5;

type Pose = 'stand' | 'sit';
const POSES: Record<Pose, { thigh: number; knee: number; shoulder: number; elbow: number }> = {
  stand: { thigh: 0, knee: 0, shoulder: 0.08, elbow: 0.15 },
  sit: { thigh: 1.5, knee: -1.45, shoulder: 0.25, elbow: 0.7 },
};

const POSE_PARS = /* glsl */ `
  uniform vec4 uPose; // thigh, knee, shoulder, elbow
  uniform float uTime;
  attribute vec4 skinIndex;
  vec3 wpTurn(vec3 p, float pivotY, float a) {
    float c = cos(a);
    float s = sin(a);
    float y = p.y - pivotY;
    return vec3(p.x, pivotY + y * c - p.z * s, y * s + p.z * c);
  }
  vec3 wpPose(vec3 p, int b, bool normal, float sway) {
    float hip = normal ? 0.0 : 0.92;
    float knee = normal ? 0.0 : 0.5;
    float shoulder = normal ? 0.0 : 1.42;
    float elbow = normal ? 0.0 : 1.15;
    float waist = normal ? 0.0 : 0.94;
    if (b == 7 || b == 8) p = wpTurn(p, hip, uPose.x);
    else if (b == 9 || b == 10) { p = wpTurn(p, knee, uPose.y); p = wpTurn(p, hip, uPose.x); }
    else if (b == 3 || b == 4) { p = wpTurn(p, shoulder, uPose.z); p = wpTurn(p, waist, sway); }
    else if (b == 5 || b == 6) { p = wpTurn(p, elbow, uPose.w); p = wpTurn(p, shoulder, uPose.z); p = wpTurn(p, waist, sway); }
    else if (b == 1 || b == 2 || b == 11) p = wpTurn(p, waist, sway);
    return p;
  }
`;

export class WaitingPeople {
  readonly group = new THREE.Group();
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private readonly time = { value: 0 };

  /** stops: [x, y, z, angle] per bus shelter (its open side, the model's +z, faces the road). */
  constructor(stops: Float32Array) {
    const random = makeRng(9091);
    const geometries = Array.from({ length: LOOKS }, () => buildAvatarGeometry(randomLook(random), true));
    const places: Record<Pose, THREE.Matrix4[][]> = { stand: geometries.map(() => []), sit: geometries.map(() => []) };
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < stops.length / 4; i++) {
      const [x, y, z, angle] = [stops[i * 4], stops[i * 4 + 1], stops[i * 4 + 2], stops[i * 4 + 3]];
      const r = (salt: number): number => {
        const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
        return v - Math.floor(v);
      };
      const people = 1 + Math.floor(r(1) * 4);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Local (shelter) → world.
      const place = (lx: number, ly: number, lz: number, facing: number): THREE.Matrix4 => {
        at.set(x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos);
        turn.setFromAxisAngle(up, angle + facing);
        return matrix.clone().compose(at, turn, one);
      };
      for (let k = 0; k < people; k++) {
        const look = Math.floor(r(10 + k) * LOOKS);
        const sitting = r(20 + k) < 0.5;
        if (sitting) {
          // On the bench (seat 0.48 m up at the back), facing the road (+z: turn half round).
          const lx = -1.0 + (k + r(30 + k) * 0.6) * 0.65;
          places.sit[look].push(place(Math.min(1.0, lx), BENCH_Y - HIP_Y, -0.32, Math.PI));
        } else {
          // Standing under the front edge, most facing the road, some looking along it.
          const lx = (r(40 + k) - 0.5) * 3.2;
          const facing = Math.PI + (r(50 + k) < 0.35 ? (r(60 + k) < 0.5 ? 1.2 : -1.2) : (r(70 + k) - 0.5) * 0.6);
          places.stand[look].push(place(lx, 0, 0.35 + r(80 + k) * 0.5, facing));
        }
      }
    }
    for (const pose of ['stand', 'sit'] as const) {
      const angles = POSES[pose];
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uPose = { value: new THREE.Vector4(angles.thigh, angles.knee, angles.shoulder, angles.elbow) };
        shader.uniforms.uTime = this.time;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${POSE_PARS}`)
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
            float wpSway = sin(uTime * 0.7 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z) * 0.025;
            objectNormal = wpPose(objectNormal, int(skinIndex.x + 0.5), true, wpSway);`,
          )
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = wpPose(transformed, int(skinIndex.x + 0.5), false, wpSway);');
      };
      material.customProgramCacheKey = () => `nukkad-waiting-${pose}-1`;
      this.materials.push(material);
      places[pose].forEach((list, look) => {
        if (list.length === 0) return;
        const mesh = new THREE.InstancedMesh(geometries[look], material, list.length);
        list.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = false; // the shadow pass would draw them unposed (standing)
        mesh.receiveShadow = true;
        this.group.add(mesh);
      });
    }
  }

  update(dt: number): void {
    this.time.value = (this.time.value + dt) % 1000;
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (mesh.isInstancedMesh) mesh.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
