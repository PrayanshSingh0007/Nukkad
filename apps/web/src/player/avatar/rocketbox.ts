import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Realistic people: eight avatars from the Microsoft Rocketbox Avatar Library (MIT, see
 * CREDITS.md) — clothed, rigged (3ds Max "Bip01" skeleton) — moved by Rocketbox's own motion
 * clips for that skeleton (walk, jog, sprint, idle, sit, wave, dance, talk), separate ones
 * for men and women. Converted by Blender (tools/characters/README in NOTES.md) and slimmed by
 * tools/characters/rocketbox-anims.mjs.
 */
const BASE = '/models/people/rocketbox/';
export const ROCKETBOX_AVATARS = [
  { file: 'Female_Adult_01', female: true },
  { file: 'Female_Adult_03', female: true },
  { file: 'Female_Adult_13', female: true },
  { file: 'Female_Adult_17', female: true },
  { file: 'Male_Adult_06', female: false },
  { file: 'Male_Adult_08', female: false },
  { file: 'Male_Adult_09', female: false },
  { file: 'Male_Adult_16', female: false },
] as const;

export type RocketboxClip = 'idle' | 'walk' | 'jog' | 'sprint' | 'sit' | 'wave' | 'dance' | 'talk';
const CLIPS: RocketboxClip[] = ['idle', 'walk', 'jog', 'sprint', 'sit', 'wave', 'dance', 'talk'];
/** How fast each moving clip walks or runs at normal speed, m/s (for matching the feet to the ground). */
const CLIP_SPEED: Partial<Record<RocketboxClip, number>> = { walk: 1.35, jog: 3.2, sprint: 5.6 };

interface Limb {
  upper: THREE.Bone;
  lower: THREE.Bone;
  end: THREE.Bone;
}

/** Where every vehicle's seat expects the rider's hips, metres above the rider's origin. */
const SEAT_HIPS_M = 0.52;
/** The scooter's handlebar grips, metres above the rider's feet on the deck. */
const SCOOTER_GRIP_M = 0.88;

/** Turns a bone by `angle` about a world-space axis (keeps the rest of the pose). */
function turnAbout(bone: THREE.Bone, axis: THREE.Vector3, angle: number): void {
  const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  bone.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK per limb (shoulder + elbow, or hip + knee) to world points: each limb takes the
 * point nearest its own hand or foot. The elbow or knee keeps the bend plane the clip gave it.
 */
function reach(root: THREE.Object3D, limbs: Limb[], targets: THREE.Vector3[]): void {
  root.updateMatrixWorld(true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const clampCos = (v: number): number => Math.max(-1, Math.min(1, v));
  const free = [...targets];
  for (const { upper, lower, end } of limbs) {
    if (free.length === 0) break;
    upper.getWorldPosition(a);
    lower.getWorldPosition(b);
    end.getWorldPosition(c);
    free.sort((p, q) => p.distanceToSquared(c) - q.distanceToSquared(c));
    const t = free.shift() as THREE.Vector3;
    const lab = b.distanceTo(a);
    const lcb = c.distanceTo(b);
    const lat = Math.max(0.01, Math.min(lab + lcb - 0.002, t.distanceTo(a)));
    const ac = c.clone().sub(a).normalize();
    const ab = b.clone().sub(a).normalize();
    const ba = a.clone().sub(b).normalize();
    const bc = c.clone().sub(b).normalize();
    const at = t.clone().sub(a).normalize();
    const acAb0 = Math.acos(clampCos(ac.dot(ab)));
    const baBc0 = Math.acos(clampCos(ba.dot(bc)));
    const acAt0 = Math.acos(clampCos(ac.dot(at)));
    const acAb1 = Math.acos(clampCos((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
    const baBc1 = Math.acos(clampCos((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
    const axis0 = ac.clone().cross(ab);
    if (axis0.lengthSq() < 1e-8) axis0.set(0, 1, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).cross(ac);
    axis0.normalize();
    const axis1 = ac.clone().cross(at);
    const upperWorld = upper.getWorldQuaternion(new THREE.Quaternion());
    const lowerWorld = lower.getWorldQuaternion(new THREE.Quaternion());
    const local = (world: THREE.Quaternion, r: THREE.Quaternion): THREE.Quaternion => world.clone().invert().multiply(r).multiply(world);
    upper.quaternion.multiply(local(upperWorld, new THREE.Quaternion().setFromAxisAngle(axis0, acAb1 - acAb0)));
    lower.quaternion.multiply(local(lowerWorld, new THREE.Quaternion().setFromAxisAngle(axis0, baBc1 - baBc0)));
    if (axis1.lengthSq() > 1e-10) upper.quaternion.multiply(local(upperWorld, new THREE.Quaternion().setFromAxisAngle(axis1.normalize(), acAt0)));
    upper.updateMatrixWorld(true);
  }
}

export interface RocketboxAssets {
  bodies: THREE.Group[];
  clips: { f: Map<RocketboxClip, THREE.AnimationClip>; m: Map<RocketboxClip, THREE.AnimationClip> };
}

let loading: Promise<RocketboxAssets | null> | null = null;
let loaded: RocketboxAssets | null = null;

/** Starts loading (once); resolves to null if the files are missing (the old people are used). */
export function loadRocketbox(): Promise<RocketboxAssets | null> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const glb = (file: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> => loader.loadAsync(BASE + file);
  loading = Promise.all([
    Promise.all(ROCKETBOX_AVATARS.map((a) => glb(`${a.file}.glb`).then((g) => prepare(g.scene)))),
    Promise.all((['f', 'm'] as const).flatMap((sex) => CLIPS.map((clip) => glb(`anims/${sex}_${clip}.glb`).then((g) => [sex, clip, g.animations[0]] as const)))),
  ])
    .then(([bodies, clips]) => {
      const f = new Map<RocketboxClip, THREE.AnimationClip>();
      const m = new Map<RocketboxClip, THREE.AnimationClip>();
      // Tracks for bones the bodies do not have (tiny end "Nub" bones) are dropped.
      const bones = new Set<string>();
      bodies[0]?.traverse((object) => bones.add(object.name));
      for (const [sex, clip, animation] of clips) {
        if (!animation) continue;
        animation.name = clip;
        animation.tracks = animation.tracks.filter((track) => bones.has(track.name.split('.')[0]));
        (sex === 'f' ? f : m).set(clip, animation);
      }
      loaded = { bodies, clips: { f, m } };
      return loaded;
    })
    .catch((error: unknown) => {
      console.warn('Nukkad: Rocketbox people could not be loaded — using the simple ones', error);
      return null;
    });
  return loading;
}

export function rocketboxReady(): RocketboxAssets | null {
  return loaded;
}

/** Materials: hair and lashes are cut-out cards seen from both sides; everything casts shadows. */
function prepare(scene: THREE.Group): THREE.Group {
  scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.alphaTest > 0 || standard.transparent) {
        standard.side = THREE.DoubleSide;
        standard.transparent = false;
        standard.alphaTest = Math.max(0.5, standard.alphaTest);
      }
      standard.roughness = 0.7;
      standard.metalness = 0;
    }
  });
  return scene;
}

/**
 * One Rocketbox person. `speed` (m/s) picks idle, walk, jog or sprint and sets the clip speed so
 * the feet do not slide; actions cross-fade. Height is set per person (seeded), and they face −z
 * like everything else in the game.
 */
export class RocketboxPerson {
  readonly root = new THREE.Group();
  readonly avatar: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<RocketboxClip, THREE.AnimationAction>();
  private current: RocketboxClip | null = null;
  private readonly materials: THREE.Material[] = [];
  private readonly body: THREE.Group;
  /** Shoulder → elbow → hand and hip → knee → foot, left then right. */
  private readonly arms: Limb[] = [];
  private readonly legs: Limb[] = [];
  /** The upper back (leans over the handlebar). In this skeleton the legs hang off the lower spine. */
  private readonly spine: THREE.Bone | null;
  private spineBefore: THREE.Quaternion | null = null;
  private readonly pelvis: THREE.Bone | null;

  constructor(assets: RocketboxAssets, avatar: number, seed = 0.5) {
    this.avatar = avatar % ROCKETBOX_AVATARS.length;
    const info = ROCKETBOX_AVATARS[this.avatar];
    const body = cloneSkinned(assets.bodies[this.avatar]) as THREE.Group;
    // Real heights: women around 1.62 m, men around 1.73 m, a few centimetres either way.
    body.updateMatrixWorld(true);
    const head = body.getObjectByName('Bip01_Head') ?? body.getObjectByName('Bip01 Head');
    const headY = head ? new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y : 1.6;
    const target = (info.female ? 1.62 : 1.73) + (seed - 0.5) * 0.12;
    const scale = (target * 0.93) / Math.max(0.5, headY); // the head bone sits at about 93 % of the height
    body.scale.multiplyScalar(scale);
    body.rotation.y = Math.PI; // the models face +z; the game's people face −z
    body.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Own material copies, so fading one person does not fade everyone wearing the same body.
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.materials.push(material);
    });
    this.root.add(body);
    this.body = body;
    const bone = (name: string): THREE.Bone | null => (body.getObjectByName(name) as THREE.Bone | undefined) ?? null;
    for (const side of ['L', 'R']) {
      const arm = [bone(`Bip01_${side}_UpperArm`), bone(`Bip01_${side}_Forearm`), bone(`Bip01_${side}_Hand`)];
      const leg = [bone(`Bip01_${side}_Thigh`), bone(`Bip01_${side}_Calf`), bone(`Bip01_${side}_Foot`)];
      if (arm.every(Boolean)) this.arms.push({ upper: arm[0] as THREE.Bone, lower: arm[1] as THREE.Bone, end: arm[2] as THREE.Bone });
      if (leg.every(Boolean)) this.legs.push({ upper: leg[0] as THREE.Bone, lower: leg[1] as THREE.Bone, end: leg[2] as THREE.Bone });
    }
    this.spine = bone('Bip01_Spine1');
    this.pelvis = bone('Bip01_Pelvis');
    this.mixer = new THREE.AnimationMixer(body);
    const clips = info.female ? assets.clips.f : assets.clips.m;
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
    // Not everyone steps in time with everyone else.
    this.mixer.setTime(seed * 10);
    this.play('idle', 0);
  }

  get female(): boolean {
    return ROCKETBOX_AVATARS[this.avatar].female;
  }

  private play(name: RocketboxClip, fade = 0.25): void {
    if (this.current === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.actions.get(this.current)?.fadeOut(fade);
    this.current = name;
  }

  /** Colours are part of these models (nothing to recolour yet). */
  setLook(): void {}

  /**
   * speed in m/s; riding: 'stand' (own scooter: hands forward on the handlebar), 'seat' (bike,
   * auto: seated, feet on the footrests and hands on the grips by IK), or null; `emote`
   * 1 wave · 2 dance · 3 sit · 4 talk (standing still). grips / feet in world space.
   */
  update(dt: number, speed: number, groundedOrEmote: boolean | number = true, riding: 'stand' | 'seat' | null = null, emote = 0, grips: THREE.Vector3[] | null = null, feet: THREE.Vector3[] | null = null): void {
    // (The street crowd calls update(dt, speed, emote).)
    const grounded = typeof groundedOrEmote === 'boolean' ? groundedOrEmote : true;
    if (typeof groundedOrEmote === 'number') emote = groundedOrEmote;
    if (this.spine && this.spineBefore) {
      this.spine.quaternion.copy(this.spineBefore);
      this.spineBefore = null;
    }
    let clip: RocketboxClip = 'idle';
    if (riding === 'seat') clip = 'sit';
    else if (riding === 'stand' || !grounded) clip = 'idle';
    else if (speed > 4.2) clip = 'sprint';
    else if (speed > 2.1) clip = 'jog';
    else if (speed > 0.15) clip = 'walk';
    else if (emote === 1) clip = 'wave';
    else if (emote === 2) clip = 'dance';
    else if (emote === 3) clip = 'sit';
    else if (emote === 4) clip = 'talk';
    this.play(clip);
    const natural = CLIP_SPEED[clip];
    const action = this.actions.get(clip);
    if (action) action.timeScale = natural ? THREE.MathUtils.clamp(speed / natural, 0.6, 1.6) : 1;
    this.mixer.update(dt);
    // Seated on a vehicle: the hips at the same height as every vehicle's seat expects (0.52 m
    // above the rider's origin; the chair clip sits a little higher).
    this.body.position.y = 0;
    if (riding === 'seat' && this.pelvis) {
      this.root.updateMatrixWorld(true);
      const hips = this.root.worldToLocal(this.pelvis.getWorldPosition(new THREE.Vector3())).y;
      this.body.position.y = SEAT_HIPS_M - hips;
    }
    // In the air (a jump, a fall): knees tucked up, arms lifted a little and out — eased in
    // and out, laid over the clip (the library has no jump of its own).
    this.air += ((riding === null && !grounded ? 1 : 0) - this.air) * Math.min(1, dt * 9);
    if (this.air > 0.01) this.jumpPose(this.air);
    if (riding === 'stand') this.handlebarPose();
    if (riding === 'seat' && feet) reach(this.root, this.legs, feet);
    if (riding === 'seat' && grips) {
      this.leanTo(grips);
      reach(this.root, this.arms, grips);
    }
  }

  private air = 0;

  private jumpPose(amount: number): void {
    this.root.updateMatrixWorld(true);
    const turn = this.root.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
    this.legs.forEach(({ upper, lower }, i) => {
      turnAbout(upper, right, (i === 0 ? 0.75 : 0.45) * amount); // one knee a little higher
      turnAbout(lower, right, -1.15 * amount);
    });
    this.arms.forEach(({ upper, lower }, i) => {
      turnAbout(upper, forward, (i === 0 ? 0.55 : -0.55) * amount); // left arm out to the left, right to the right
      turnAbout(upper, right, 0.35 * amount);
      turnAbout(lower, right, 0.4 * amount);
    });
  }

  /** Standing on the scooter: both hands on its handlebar grips (just in front, at waist height). */
  private handlebarPose(): void {
    this.root.updateMatrixWorld(true);
    const grips = [-1, 1].map((side) => this.root.localToWorld(new THREE.Vector3(side * 0.24, SCOOTER_GRIP_M, -0.4)));
    reach(this.root, this.arms, grips);
  }

  /** Bend forward from the upper back until the hands can reach the grips (undone next update). */
  private leanTo(grips: THREE.Vector3[]): void {
    const spine = this.spine;
    if (!spine) return;
    this.spineBefore = spine.quaternion.clone();
    const up = new THREE.Vector3(0, 1, 0);
    let total = 0;
    for (let pass = 0; pass < 3 && total < 0.4; pass++) {
      this.root.updateMatrixWorld(true);
      const base = spine.getWorldPosition(new THREE.Vector3());
      let excess = 0;
      let height = 0.35;
      for (const { upper, lower, end } of this.arms) {
        const a = upper.getWorldPosition(new THREE.Vector3());
        const b = lower.getWorldPosition(new THREE.Vector3());
        const c = end.getWorldPosition(new THREE.Vector3());
        const t = grips.reduce((best, g) => (g.distanceToSquared(c) < best.distanceToSquared(c) ? g : best));
        excess = Math.max(excess, a.distanceTo(t) - 0.97 * (a.distanceTo(b) + b.distanceTo(c)));
        height = Math.max(0.2, a.y - base.y);
      }
      if (excess < 0.004) return;
      const toward = grips.reduce((sum, g) => sum.add(g), new THREE.Vector3()).multiplyScalar(1 / grips.length).sub(base);
      toward.y = 0;
      const axis = up.clone().cross(toward);
      if (axis.lengthSq() < 1e-8) return;
      const angle = Math.min(0.4 - total, excess / height);
      total += angle;
      turnAbout(spine, axis.normalize(), angle);
    }
  }

  setOpacity(opacity: number): void {
    for (const material of this.materials) {
      material.transparent = opacity < 0.99;
      material.opacity = opacity;
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }
}
