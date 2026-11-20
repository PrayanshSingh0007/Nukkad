import * as THREE from 'three';
import { makeRng, randomLook } from '@nukkad/shared';
import { VEHICLE_HALF, VEHICLE_KINDS } from '@nukkad/worldgen';
import { buildAvatarGeometry } from '../player/avatar/avatarModel.ts';

/**
 * People driving the traffic: every moving vehicle has someone in it. They are the light crowd
 * figures (about 1,000 triangles, one draw call per look and pose), sat down by the graphics
 * card: thighs forward, knees bent down, arms out to the wheel or the handlebar.
 * - cars, taxis, vans, trucks and buses: the driver sits on the right (India drives on the
 *   left, so steering wheels are on the right), upright, at that vehicle's seat height;
 * - scooters and motorbikes: the rider sits in the middle, leaning a little to the bars;
 * - autos: the driver sits in the front middle.
 */
const LOOKS = 8;
/** The light avatar's hip joint height (avatarModel JOINTS). */
const HIP_Y = 0.92;

type Pose = 'seat' | 'ride';

interface Seat {
  pose: Pose;
  /** Metres to the vehicle's right (+) and how far back from its middle (+ = behind). */
  x: number;
  z: number;
  /** Hip height above the road. */
  hip: number;
}

function seatFor(kind: number): Seat {
  const name = VEHICLE_KINDS[kind];
  const [, hl] = VEHICLE_HALF[kind] ?? [0.9, 2];
  switch (name) {
    case 'two_wheeler':
      return { pose: 'ride', x: 0, z: 0.12, hip: 0.74 };
    case 'motorbike':
      return { pose: 'ride', x: 0, z: 0.16, hip: 0.8 };
    case 'auto':
      return { pose: 'seat', x: 0, z: -0.42, hip: 0.66 };
    case 'suv':
      return { pose: 'seat', x: 0.36, z: 0.05, hip: 0.68 };
    case 'van':
      return { pose: 'seat', x: 0.4, z: -(hl - 1.35), hip: 0.78 };
    case 'ambulance':
      return { pose: 'seat', x: 0.45, z: -(hl - 1.45), hip: 0.95 };
    case 'truck':
      return { pose: 'seat', x: 0.5, z: -(hl - 0.9), hip: 1.5 };
    case 'delivery':
      return { pose: 'seat', x: 0.48, z: -(hl - 0.85), hip: 1.15 };
    case 'bus':
      return { pose: 'seat', x: 0.78, z: -(hl - 1.0), hip: 1.3 };
    default:
      return { pose: 'seat', x: 0.36, z: 0.05, hip: 0.52 }; // hatchback, sedan, taxi
  }
}

/** Joint angles (radians, about the figure's right–left axis) for each pose. */
const POSES: Record<Pose, { thigh: number; knee: number; shoulder: number; elbow: number; lean: number }> = {
  seat: { thigh: 1.5, knee: -1.45, shoulder: 0.85, elbow: 0.55, lean: 0.05 },
  ride: { thigh: 1.2, knee: -1.25, shoulder: 1.05, elbow: 0.3, lean: 0.28 },
};

/** Sits the light avatar down: each bone turns about its joint (children first, then parents). */
const POSE_PARS = /* glsl */ `
  uniform vec4 uPose; // thigh, knee, shoulder, elbow
  uniform float uLean;
  attribute vec4 skinIndex;
  vec3 nkTurn(vec3 p, float pivotY, float a) {
    float c = cos(a);
    float s = sin(a);
    float y = p.y - pivotY;
    return vec3(p.x, pivotY + y * c - p.z * s, y * s + p.z * c);
  }
  vec3 nkPose(vec3 p, int b, bool normal) {
    // Normals turn the same way but about the origin.
    float hip = normal ? 0.0 : 0.92;
    float knee = normal ? 0.0 : 0.5;
    float shoulder = normal ? 0.0 : 1.42;
    float elbow = normal ? 0.0 : 1.15;
    float waist = normal ? 0.0 : 0.94;
    if (b == 7 || b == 8) p = nkTurn(p, hip, uPose.x);
    else if (b == 9 || b == 10) { p = nkTurn(p, knee, uPose.y); p = nkTurn(p, hip, uPose.x); }
    else if (b == 3 || b == 4) { p = nkTurn(p, shoulder, uPose.z); p = nkTurn(p, waist, uLean); }
    else if (b == 5 || b == 6) { p = nkTurn(p, elbow, uPose.w); p = nkTurn(p, shoulder, uPose.z); p = nkTurn(p, waist, uLean); }
    else if (b == 1 || b == 2 || b == 11) p = nkTurn(p, waist, uLean);
    return p;
  }
`;

export class TrafficDrivers {
  readonly group = new THREE.Group();
  /** meshes[pose][look] */
  private readonly meshes: Record<Pose, THREE.InstancedMesh[]> = { seat: [], ride: [] };
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private readonly counts: Record<Pose, number[]> = { seat: new Array(LOOKS).fill(0), ride: new Array(LOOKS).fill(0) };
  private readonly matrix = new THREE.Matrix4();
  private readonly offset = new THREE.Matrix4();

  constructor(capacity: number) {
    const random = makeRng(4242);
    const geometries = Array.from({ length: LOOKS }, () => buildAvatarGeometry(randomLook(random), true));
    for (const pose of ['seat', 'ride'] as const) {
      const angles = POSES[pose];
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uPose = { value: new THREE.Vector4(angles.thigh, angles.knee, angles.shoulder, angles.elbow) };
        shader.uniforms.uLean = { value: angles.lean };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${POSE_PARS}`)
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = nkPose(objectNormal, int(skinIndex.x + 0.5), true);')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = nkPose(transformed, int(skinIndex.x + 0.5), false);');
      };
      material.customProgramCacheKey = () => `nukkad-drivers-${pose}-1`;
      this.materials.push(material);
      for (let look = 0; look < LOOKS; look++) {
        const mesh = new THREE.InstancedMesh(geometries[look], material, Math.max(1, Math.ceil(capacity / LOOKS) + 4));
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = false; // they sit inside the vehicle's own shadow
        this.meshes[pose].push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /** Call before placing this frame's vehicles. */
  begin(): void {
    this.counts.seat.fill(0);
    this.counts.ride.fill(0);
  }

  /** The driver of one vehicle, from the vehicle's own matrix. `id` picks a look. */
  place(kind: number, id: number, vehicle: THREE.Matrix4): void {
    const seat = seatFor(kind);
    const look = id % LOOKS;
    const mesh = this.meshes[seat.pose][look];
    const i = this.counts[seat.pose][look];
    if (i >= mesh.instanceMatrix.count) return;
    this.offset.makeTranslation(seat.x, seat.hip - HIP_Y, seat.z);
    mesh.setMatrixAt(i, this.matrix.multiplyMatrices(vehicle, this.offset));
    this.counts[seat.pose][look] = i + 1;
  }

  /** Call after placing. */
  end(): void {
    for (const pose of ['seat', 'ride'] as const) {
      this.meshes[pose].forEach((mesh, look) => {
        mesh.count = this.counts[pose][look];
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
  }

  dispose(): void {
    for (const pose of ['seat', 'ride'] as const) for (const mesh of this.meshes[pose]) mesh.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
