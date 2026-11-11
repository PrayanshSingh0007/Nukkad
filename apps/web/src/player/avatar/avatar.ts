import * as THREE from 'three';
import type { AvatarLook } from '@nukkad/shared';
import { BONE, JOINTS, buildAvatarGeometry, buildSkeleton } from './avatarModel.ts';

const STRIDE_M = 1.7; // metres walked per full leg cycle
const FULL_SPEED = 4.5; // speed at which the swing is at its widest
const TURN_SPEED = 12; // how quickly the avatar turns to face where it walks

let sharedShadow: THREE.Texture | null = null;

/** A soft dark dot, drawn once and shared by all avatars. */
function shadowTexture(): THREE.Texture {
  if (sharedShadow) return sharedShadow;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.45)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  sharedShadow = new THREE.CanvasTexture(canvas);
  return sharedShadow;
}

/**
 * One player on screen: the merged avatar mesh, its bones, a blob shadow, and the
 * walk animation (made with maths, not with animation files).
 */
export class Avatar {
  /** Put this in the scene. Its position is the player's feet. */
  readonly object = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly bones: THREE.Bone[];
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private phase = 0;
  private swing = 0;
  private idleTime = 0;
  private facing = 0;

  constructor(look: AvatarLook) {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const skeleton = buildSkeleton();
    this.bones = skeleton.bones;
    this.mesh = new THREE.SkinnedMesh(buildAvatarGeometry(look), this.material);
    this.mesh.add(this.bones[BONE.hips]);
    this.mesh.bind(skeleton);
    this.mesh.frustumCulled = false; // bones move the mesh outside its resting box
    this.object.add(this.mesh);

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    this.object.add(shadow);
  }

  /** Changes colours, outfit or hair by rebuilding the (tiny) mesh. */
  setLook(look: AvatarLook): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildAvatarGeometry(look);
  }

  /**
   * Moves the avatar and plays the right animation.
   * @param speed   metres per second along the ground
   * @param heading direction of travel as an angle (same convention as the camera yaw), or null when standing
   */
  update(dt: number, x: number, y: number, z: number, speed: number, heading: number | null, grounded: boolean): void {
    this.object.position.set(x, y, z);
    if (heading !== null) {
      // Turn the short way round towards the heading.
      const difference = Math.atan2(Math.sin(heading - this.facing), Math.cos(heading - this.facing));
      this.facing += difference * Math.min(1, dt * TURN_SPEED);
    }
    this.object.rotation.y = this.facing;

    const target = Math.min(1, speed / FULL_SPEED);
    this.swing += (target - this.swing) * Math.min(1, dt * 10);
    this.phase += (speed * dt * Math.PI * 2) / STRIDE_M;
    this.idleTime += dt;

    const step = Math.sin(this.phase);
    const breathe = Math.sin(this.idleTime * 1.8) * (1 - this.swing);
    const [, hipY] = JOINTS[BONE.hips];
    const bones = this.bones;
    bones[BONE.legL].rotation.x = step * 0.8 * this.swing;
    bones[BONE.legR].rotation.x = -step * 0.8 * this.swing;
    bones[BONE.armL].rotation.x = -step * 0.65 * this.swing;
    bones[BONE.armR].rotation.x = step * 0.65 * this.swing;
    bones[BONE.armL].rotation.z = -0.06 - breathe * 0.02 - (grounded ? 0 : 0.5);
    bones[BONE.armR].rotation.z = 0.06 + breathe * 0.02 + (grounded ? 0 : 0.5);
    bones[BONE.hips].position.y = hipY + Math.abs(Math.cos(this.phase)) * 0.04 * this.swing;
    bones[BONE.chest].rotation.x = -0.07 * this.swing;
    bones[BONE.chest].rotation.y = step * 0.08 * this.swing;
    bones[BONE.chest].scale.y = 1 + breathe * 0.012;
    bones[BONE.head].rotation.x = 0.04 * this.swing + breathe * 0.015;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shadowMaterial.dispose();
    this.object.removeFromParent();
  }
}
