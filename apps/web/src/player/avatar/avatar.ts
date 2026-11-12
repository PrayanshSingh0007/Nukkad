import * as THREE from 'three';
import { OUTFIT_COLORS } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { ScooterModel } from '../scooter.ts';
import { BONE, JOINTS, buildAvatarGeometry, buildSkeleton } from './avatarModel.ts';
import { Person, loadPeople, peopleReady } from './people.ts';

const STRIDE_M = 1.6; // metres walked per full leg cycle
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

/** What the body is doing, for the pose. */
export interface Motion {
  /** Metres per second along the ground. */
  speed: number;
  /** Direction the body should face (radians), or null to keep the current one. */
  heading: number | null;
  grounded: boolean;
  /** Standing on a scooter. */
  riding?: boolean;
  /** Sideways lean on the scooter, radians. */
  lean?: number;
  /** Show your own scooter under you (false when riding someone else's two-wheeler or an auto). */
  scooter?: boolean;
  /** EMOTES index (wave, dance, sit, talk), 0 = none. */
  emote?: number;
}

/**
 * One player on screen: the merged avatar mesh, its 11 bones, a blob shadow, and the
 * walk / idle / ride animation (made with maths, not animation files).
 */
export class Avatar {
  /** True when the sun casts real shadows: the soft blob under the feet is then hidden. */
  static realShadows = false;
  /** Put this in the scene. Its position is the player's feet. */
  readonly object = new THREE.Group();
  /** Lean and riding offset are applied to this inner group. */
  readonly body = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly bones: THREE.Bone[];
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private phase = 0;
  private swing = 0;
  private idleTime = Math.random() * 10;
  private facingAngle = 0;
  private nextBlink = 1 + Math.random() * 3;
  private blob: THREE.Mesh | null = null;
  private readonly scooter: ScooterModel;
  /** The real 3D person (once its files have loaded); until then the built-in body shows. */
  private person: Person | null = null;
  private look: AvatarLook;
  private disposed = false;
  private opacity = 1;

  constructor(look: AvatarLook) {
    this.look = look;
    // Soft sheen on skin, hair and cloth (players only; street crowds stay on the cheap material).
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 });
    const skeleton = buildSkeleton();
    this.bones = skeleton.bones;
    this.mesh = new THREE.SkinnedMesh(buildAvatarGeometry(look), this.material);
    this.mesh.add(this.bones[BONE.hips]);
    this.mesh.bind(skeleton);
    this.mesh.frustumCulled = false; // bones move the mesh outside its resting box
    this.mesh.castShadow = true;
    this.body.add(this.mesh);
    this.object.add(this.body);
    this.scooter = new ScooterModel(new THREE.Color(OUTFIT_COLORS[look.color]).getHex());
    this.object.add(this.scooter.mesh);

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), this.shadowMaterial);
    this.blob = shadow;
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    this.object.add(shadow);

    const assets = peopleReady();
    if (assets) this.makePerson();
    else
      loadPeople()
        .then(() => this.makePerson())
        .catch(() => {}); // stays on the built-in body
  }

  private makePerson(): void {
    const assets = peopleReady();
    if (!assets || this.disposed) return;
    this.person?.dispose();
    this.person = new Person(assets, this.look);
    this.person.setOpacity(this.opacity);
    this.body.add(this.person.root);
    this.mesh.visible = false;
  }

  /** The direction the avatar faces, radians (0 = towards -z). */
  get facing(): number {
    return this.facingAngle;
  }

  setLook(look: AvatarLook): void {
    const old = this.look;
    this.look = look;
    if (this.person) {
      // Build, hairstyle and light/dark skin picture are part of the model; colours are not.
      if (old.build !== look.build || old.hair !== look.hair || old.skin >= 3 !== look.skin >= 3) this.makePerson();
      else this.person.setLook(look);
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildAvatarGeometry(look);
    this.scooter.setAccent(new THREE.Color(OUTFIT_COLORS[look.color]).getHex());
  }

  /** Faded = this player's connection is shaky ("reconnecting…"). */
  setOpacity(opacity: number): void {
    const transparent = opacity < 1;
    if (this.material.transparent !== transparent) {
      this.material.transparent = transparent;
      this.material.needsUpdate = true;
    }
    this.material.opacity = opacity;
    this.opacity = opacity;
    this.person?.setOpacity(opacity);
  }

  update(dt: number, x: number, y: number, z: number, speedOrMotion: number | Motion, heading: number | null = null, grounded = true): void {
    const motion: Motion = typeof speedOrMotion === 'number' ? { speed: speedOrMotion, heading, grounded } : speedOrMotion;
    this.object.position.set(x, y, z);
    if (this.blob) this.blob.visible = !Avatar.realShadows;
    if (motion.heading !== null) {
      const difference = Math.atan2(Math.sin(motion.heading - this.facingAngle), Math.cos(motion.heading - this.facingAngle));
      this.facingAngle += difference * Math.min(1, dt * TURN_SPEED);
    }
    this.object.rotation.y = this.facingAngle;
    this.body.rotation.z = motion.lean ?? 0;
    this.body.position.y = motion.riding ? 0.16 : 0; // standing on the scooter deck
    this.scooter.mesh.visible = motion.riding === true && motion.scooter !== false;
    this.scooter.mesh.rotation.z = (motion.lean ?? 0) * 0.9;
    if (motion.riding) this.ridePose(dt);
    else this.walkPose(dt, motion.speed, motion.grounded);
    this.person?.update(dt, motion.speed, motion.grounded, motion.riding ? (motion.scooter === false ? 'seat' : 'stand') : null, motion.emote ?? 0);
    // Blink every few seconds (a quick 0.12 s), sometimes twice.
    this.nextBlink -= dt;
    const closed = this.nextBlink < 0.12 && this.nextBlink > 0;
    if (this.nextBlink <= 0) this.nextBlink = Math.random() < 0.2 ? 0.35 : 2.5 + Math.random() * 3.5;
    this.bones[BONE.lids].scale.setScalar(closed ? 1 : 0.001);
  }

  private walkPose(dt: number, speed: number, grounded: boolean): void {
    const target = Math.min(1, speed / FULL_SPEED);
    this.swing += (target - this.swing) * Math.min(1, dt * 10);
    this.phase += (speed * dt * Math.PI * 2) / STRIDE_M;
    this.idleTime += dt;

    const s = this.swing;
    const step = Math.sin(this.phase);
    const lift = Math.cos(this.phase);
    const breathe = Math.sin(this.idleTime * 1.8) * (1 - s);
    const b = this.bones;
    b[BONE.thighL].rotation.x = step * 0.7 * s;
    b[BONE.thighR].rotation.x = -step * 0.7 * s;
    // Knees bend while a leg swings forward.
    b[BONE.shinL].rotation.x = -Math.max(0, lift) * 1.1 * s;
    b[BONE.shinR].rotation.x = -Math.max(0, -lift) * 1.1 * s;
    b[BONE.upperArmL].rotation.x = -step * 0.55 * s;
    b[BONE.upperArmR].rotation.x = step * 0.55 * s;
    b[BONE.foreArmL].rotation.x = 0.15 + 0.35 * s + Math.max(0, -step) * 0.3 * s;
    b[BONE.foreArmR].rotation.x = 0.15 + 0.35 * s + Math.max(0, step) * 0.3 * s;
    const out = grounded ? 0 : 0.6;
    b[BONE.upperArmL].rotation.z = -0.07 - breathe * 0.02 - out;
    b[BONE.upperArmR].rotation.z = 0.07 + breathe * 0.02 + out;
    b[BONE.hips].position.y = JOINTS[BONE.hips][1] + Math.abs(lift) * 0.035 * s;
    b[BONE.hips].rotation.y = -step * 0.08 * s;
    b[BONE.chest].rotation.x = -0.06 * s;
    b[BONE.chest].rotation.y = step * 0.14 * s;
    b[BONE.chest].scale.y = 1 + breathe * 0.012;
    // Standing still you look around a little; walking, the hips sway side to side.
    const look = (1 - s) * (Math.sin(this.idleTime * 0.37) * 0.25 + Math.sin(this.idleTime * 0.91) * 0.08);
    b[BONE.head].rotation.x = 0.03 * s + breathe * 0.015;
    b[BONE.head].rotation.y = -step * 0.06 * s + look;
    b[BONE.hips].rotation.z = step * 0.04 * s;
    b[BONE.chest].rotation.z = -step * 0.03 * s;
  }

  /** Standing on a scooter: knees soft, both hands forward on the handlebar. */
  private ridePose(dt: number): void {
    this.idleTime += dt;
    this.swing = 0;
    const b = this.bones;
    const bob = Math.sin(this.idleTime * 3) * 0.02;
    b[BONE.hips].position.y = JOINTS[BONE.hips][1] - 0.05 + bob;
    b[BONE.hips].rotation.y = 0;
    b[BONE.thighL].rotation.x = 0.25;
    b[BONE.thighR].rotation.x = -0.15;
    b[BONE.shinL].rotation.x = -0.35;
    b[BONE.shinR].rotation.x = -0.1;
    b[BONE.chest].rotation.set(-0.12, 0, 0);
    b[BONE.upperArmL].rotation.set(0.95, 0, -0.12);
    b[BONE.upperArmR].rotation.set(0.95, 0, 0.12);
    b[BONE.foreArmL].rotation.x = 0.35;
    b[BONE.foreArmR].rotation.x = 0.35;
    b[BONE.head].rotation.set(0.1, 0, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.person?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shadowMaterial.dispose();
    this.scooter.dispose();
    this.object.removeFromParent();
  }
}
