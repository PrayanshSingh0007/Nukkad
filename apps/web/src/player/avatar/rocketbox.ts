import * as THREE from 'three';
import { OUTFIT_COLORS } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { umbrellaGeometry, umbrellaMaterial } from './umbrella.ts';
import { helmetGeometry } from './helmet.ts';
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
/** How fast each moving clip walks or runs at normal speed, m/s, before the clips are measured. */
const CLIP_SPEED: Partial<Record<RocketboxClip, number>> = { walk: 1.0, jog: 2.7, sprint: 5.5 };

/**
 * The walk, jog and sprint clips carry the body forward (the root bone travels 1.2 m per walk
 * cycle, then the loop snaps it back), so people glided ahead of where they stood and jumped
 * back every step cycle. This takes the straight-line travel out (keeping the bob and sway) and
 * returns how fast the clip really moves, m/s — the speed the feet match at normal playback.
 */
function walkInPlace(clip: THREE.AnimationClip): number | null {
  const track = clip.tracks.find((t) => t.name === 'Bip01.position');
  if (!track || clip.duration <= 0) return null;
  const v = track.values;
  const n = v.length / 3;
  if (n < 2) return null;
  const dx = v[(n - 1) * 3] - v[0];
  const dz = v[(n - 1) * 3 + 2] - v[2];
  const travel = Math.hypot(dx, dz);
  if (travel < 0.2) return null; // stays put already
  for (let i = 0; i < n; i++) {
    const t = (track.times[i] - track.times[0]) / Math.max(1e-6, track.times[n - 1] - track.times[0]);
    v[i * 3] -= dx * t;
    v[i * 3 + 2] -= dz * t;
  }
  return travel / clip.duration;
}

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
  /** Each moving clip's own speed at normal playback (m/s, for a body at scale 1), per sex. */
  speeds: { f: Map<RocketboxClip, number>; m: Map<RocketboxClip, number> };
  /** Per avatar: where its top is in the body texture (tools/characters/rocketbox-masks.mjs), or null. */
  tops: { mask: THREE.Texture; meanLum: number }[] | null;
}

/** Loads the top masks; null (no recolouring) if any is missing. */
async function loadTops(): Promise<{ mask: THREE.Texture; meanLum: number }[] | null> {
  try {
    const response = await fetch(BASE + 'masks.json');
    if (!response.ok) return null;
    const summary = (await response.json()) as Record<string, { meanLum: number }>;
    const loader = new THREE.TextureLoader();
    return await Promise.all(
      ROCKETBOX_AVATARS.map(async (a) => {
        const mask = await loader.loadAsync(`${BASE}${a.file}_top.png`);
        mask.flipY = false; // the same layout as the glTF's own textures
        mask.colorSpace = THREE.NoColorSpace;
        return { mask, meanLum: Math.max(0.01, summary[a.file]?.meanLum ?? 0.2) };
      }),
    );
  } catch {
    return null;
  }
}

/**
 * Light every realistic person shares: a rim of sky light around their outline (so people stand
 * out from the street, the way film lighting does), strongest on the parts facing up, and the
 * city's sky reflections for a little sheen on skin and hair.
 */
const RIM = { value: new THREE.Color(0, 0, 0) };
let sharedEnv: THREE.Texture | null = null;
let envStrength = 0.3;
const living = new Set<RocketboxPerson>();
/** How hard it rains where people are (0 indoors): umbrellas open, clothes and hair get wet. */
let rainNow = 0;

/**
 * Called every frame by the game: rim = the sky's colour (black indoors), env = the city's
 * reflections, rain = 0 … 1 (0 indoors).
 */
export function setPeopleLight(rim: THREE.Color, env: THREE.Texture | null, night: number, rain = 0): void {
  RIM.value.copy(rim);
  rainNow = rain;
  const strength = 0.1 + 0.22 * (1 - night);
  if (env === sharedEnv && Math.abs(strength - envStrength) < 0.01) return;
  const rebuild = env !== sharedEnv;
  sharedEnv = env;
  envStrength = strength;
  for (const person of living) person.relight(rebuild);
}

const RIM_PARS = /* glsl */ `
  uniform vec3 uRim;
  uniform float uWet;
`;
/** Wet clothes, skin and hair are darker (and glossier: the roughness is lowered in update). */
const WET_DARKEN = /* glsl */ `
  diffuseColor.rgb *= 1.0 - 0.24 * uWet;
`;
const LOOK_A = new THREE.Vector3();
const LOOK_B = new THREE.Vector3();
const LOOK_UP = new THREE.Vector3();
const LOOK_RIGHT = new THREE.Vector3();
const LOOK_Q = new THREE.Quaternion();
const HELMET_Q = new THREE.Quaternion();
/** The helmet's axes (+x right, +y up, +z back) in the head bone's space (+x up, +y forward, +z left). */
const HEAD_TO_HELMET = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)),
);
/** Where the hand holds an open umbrella, in the person's own space (+x = their right, −z = ahead), as a share of their height. */
const UMBRELLA_GRIP = new THREE.Vector3(0.17, 0.71, -0.2);
const RIM_LIGHT = /* glsl */ `
  {
    float nkFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    float nkRim = pow(1.0 - nkFacing, 3.0) * (0.55 + 0.45 * normal.y);
    outgoingLight += uRim * nkRim * (0.3 + 0.7 * diffuseColor.rgb);
  }
`;

/**
 * Dyes the top: inside the mask, the fabric takes the new colour but keeps its own light and
 * shade (folds, seams, print) — its brightness relative to the top's average brightness.
 */
const TOP_PARS = /* glsl */ `
  uniform sampler2D uTopMask;
  uniform vec3 uTop;
  uniform float uTint;
  uniform float uMeanLum;
`;
const TOP_DYE = /* glsl */ `
  #ifdef USE_MAP
  {
    float nkTop = texture2D(uTopMask, vMapUv).r * uTint;
    if (nkTop > 0.004) {
      float nkLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float nkShade = clamp(mix(1.0, nkLum / uMeanLum, 0.8), 0.3, 1.9);
      diffuseColor.rgb = mix(diffuseColor.rgb, uTop * nkShade, nkTop);
    }
  }
  #endif
`;

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
    loadTops(),
  ])
    .then(([bodies, clips, tops]) => {
      const f = new Map<RocketboxClip, THREE.AnimationClip>();
      const m = new Map<RocketboxClip, THREE.AnimationClip>();
      const speeds = { f: new Map<RocketboxClip, number>(), m: new Map<RocketboxClip, number>() };
      // Tracks for bones the bodies do not have (tiny end "Nub" bones) are dropped.
      const bones = new Set<string>();
      bodies[0]?.traverse((object) => bones.add(object.name));
      for (const [sex, clip, animation] of clips) {
        if (!animation) continue;
        animation.name = clip;
        animation.tracks = animation.tracks.filter((track) => bones.has(track.name.split('.')[0]));
        const speed = walkInPlace(animation);
        if (speed) speeds[sex].set(clip, speed);
        (sex === 'f' ? f : m).set(clip, animation);
      }
      loaded = { bodies, clips: { f, m }, speeds, tops };
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
      // Face and hair a little glossier than clothes (skin has an oily sheen, hair a shine).
      standard.roughness = /head/i.test(standard.name) ? 0.52 : standard.alphaTest > 0 ? 0.6 : 0.78;
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
  private readonly neck: THREE.Bone | null;
  private readonly head: THREE.Bone | null;
  /** Where they look (world space), or null; the head and neck turn towards it within reach. */
  private lookTarget: THREE.Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookWeight = 0;
  /** The head and neck as the clip left them, put back before the next frame's turn. */
  private lookBefore: [THREE.Quaternion, THREE.Quaternion] | null = null;
  /** The top's dye (shared with the body material's shader). */
  private readonly top = { colour: { value: new THREE.Color() }, tint: { value: 0 }, tintIndex: 0 };
  /** 0 dry … 1 soaked (eases with the rain; less under an umbrella). */
  private readonly wet = { value: 0 };
  /** Each material's dry roughness. */
  private readonly roughness: number[] = [];
  private readonly height: number;
  /** The moving clips' own speeds for this person's size, m/s. */
  private readonly speeds = new Map<RocketboxClip, number>();
  private umbrella: THREE.Mesh | null = null;
  private umbrellaColour: number | null = null;
  /** A helmet while riding a two-wheeler (null = none). */
  private helmet: THREE.Mesh | null = null;

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
    this.height = target;
    body.scale.multiplyScalar(scale);
    body.rotation.y = Math.PI; // the models face +z; the game's people face −z
    body.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Own material copies, so fading one person does not fade everyone wearing the same body.
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.materials.push(material);
        this.roughness.push((material as THREE.MeshStandardMaterial).roughness ?? 0.7);
        const top = assets.tops?.[this.avatar];
        this.shade(material, top && /body/i.test(material.name) && (material as THREE.MeshStandardMaterial).map ? top : null);
      }
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
    this.neck = bone('Bip01_Neck');
    this.head = bone('Bip01_Head');
    this.mixer = new THREE.AnimationMixer(body);
    const clips = info.female ? assets.clips.f : assets.clips.m;
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
    for (const [name, speed] of info.female ? assets.speeds.f : assets.speeds.m) this.speeds.set(name, speed * scale);
    // Not everyone steps in time with everyone else.
    this.mixer.setTime(seed * 10);
    this.play('idle', 0);
    living.add(this);
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

  /** Rim light on every material, and on the body the top's dye (one shader each for everyone). */
  private shade(material: THREE.Material, top: { mask: THREE.Texture; meanLum: number } | null): void {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRim = RIM;
      shader.uniforms.uWet = this.wet;
      let pars = RIM_PARS;
      let afterMap = WET_DARKEN;
      if (top) {
        shader.uniforms.uTopMask = { value: top.mask };
        shader.uniforms.uTop = this.top.colour;
        shader.uniforms.uTint = this.top.tint;
        shader.uniforms.uMeanLum = { value: top.meanLum };
        pars += TOP_PARS;
        afterMap = TOP_DYE + WET_DARKEN;
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>\n${afterMap}`)
        .replace('#include <common>', `#include <common>\n${pars}`)
        .replace('#include <opaque_fragment>', `${RIM_LIGHT}\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => (top ? 'nukkad-rocketbox-3-top' : 'nukkad-rocketbox-3');
    const standard = material as THREE.MeshStandardMaterial;
    standard.envMap = sharedEnv;
    standard.envMapIntensity = envStrength;
  }

  /** New sky reflections (rebuild: the reflection texture itself changed). */
  relight(rebuild: boolean): void {
    for (const material of this.materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (rebuild) {
        if ((standard.envMap === null) !== (sharedEnv === null)) standard.needsUpdate = true;
        standard.envMap = sharedEnv;
      }
      standard.envMapIntensity = envStrength;
    }
  }

  /** The top's colour: 0 = as the person comes, 1–10 = OUTFIT_COLORS[tint − 1]. */
  setTint(tint: number): void {
    if (tint === this.top.tintIndex) return;
    this.top.tintIndex = tint;
    const hex = OUTFIT_COLORS[tint - 1];
    this.top.tint.value = hex ? 1 : 0;
    if (!hex) return;
    // Dyed cloth is never quite the pure swatch: a touch less saturated.
    const hsl = { h: 0, s: 0, l: 0 };
    this.top.colour.value.set(hex).getHSL(hsl);
    this.top.colour.value.setHSL(hsl.h, hsl.s * 0.82, hsl.l);
  }

  /**
   * Whether this person carries an umbrella (and its colour). It opens by itself in the rain
   * while they stand or walk, held in the right hand over their head.
   */
  setUmbrella(colour: number | null): void {
    if (colour === this.umbrellaColour) return;
    this.umbrellaColour = colour;
    this.umbrella?.removeFromParent();
    this.umbrella = null;
    if (colour === null) return;
    this.umbrella = new THREE.Mesh(umbrellaGeometry(), umbrellaMaterial(colour));
    this.umbrella.castShadow = true;
    this.umbrella.visible = false;
    this.root.add(this.umbrella);
  }

  /** Put a helmet on (a colour) or take it off (null). */
  setHelmet(colour: number | null): void {
    if (colour === null) {
      if (this.helmet) this.helmet.visible = false;
      return;
    }
    if (!this.helmet) {
      this.helmet = new THREE.Mesh(helmetGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 }));
      this.helmet.castShadow = true;
      this.root.add(this.helmet);
      this.materials.push(this.helmet.material as THREE.Material);
      this.roughness.push(0.35);
    }
    (this.helmet.material as THREE.MeshStandardMaterial).color.setHex(colour);
    this.helmet.visible = true;
  }

  /** The open umbrella over the head, the right hand on its handle (by IK). */
  private holdUmbrella(): void {
    const umbrella = this.umbrella;
    if (!umbrella) return;
    const grip = UMBRELLA_GRIP.clone();
    grip.y *= this.height;
    umbrella.position.copy(grip);
    // Leaning a little ahead and in over the head (the hand is off to the right).
    umbrella.rotation.set(-0.14, 0, 0.13);
    const right = this.arms.find((limb) => /_R_/i.test(limb.upper.name));
    if (!right) return;
    this.root.updateMatrixWorld(true);
    reach(this.root, [right], [this.root.localToWorld(grip.add(new THREE.Vector3(0, 0.05, 0)))]);
  }

  /**
   * Look at a point (world space), or stop looking (null). The head and neck turn towards it
   * when it is in front or to the side (up to about 65° either way, a little up or down); a point
   * behind them is ignored. Turns ease in and out.
   */
  lookAt(target: THREE.Vector3 | null): void {
    if (!target) this.lookTarget = null;
    else (this.lookTarget ??= new THREE.Vector3()).copy(target);
  }

  private applyLook(dt: number): void {
    const head = this.head;
    if (!head) return;
    let yaw = 0;
    let pitch = 0;
    let want = 0;
    if (this.lookTarget) {
      this.root.updateMatrixWorld(true);
      const from = this.root.worldToLocal(head.getWorldPosition(LOOK_A));
      const to = this.root.worldToLocal(LOOK_B.copy(this.lookTarget)).sub(from);
      const flat = Math.hypot(to.x, to.z);
      const side = Math.atan2(to.x, -to.z); // + = to their right (they face −z)
      if (Math.abs(side) < 1.75 && flat > 0.3) {
        yaw = THREE.MathUtils.clamp(-side, -1.15, 1.15);
        pitch = THREE.MathUtils.clamp(Math.atan2(to.y, flat), -0.45, 0.5);
        want = 1;
      }
    }
    const k = Math.min(1, dt * 4);
    this.lookWeight += (want - this.lookWeight) * k;
    if (want) {
      this.lookYaw += (yaw - this.lookYaw) * k;
      this.lookPitch += (pitch - this.lookPitch) * k;
    }
    if (this.lookWeight < 0.01 || !this.neck) return;
    this.lookBefore = [this.neck.quaternion.clone(), head.quaternion.clone()];
    const turn = this.root.getWorldQuaternion(LOOK_Q);
    const up = LOOK_UP.set(0, 1, 0).applyQuaternion(turn);
    const right = LOOK_RIGHT.set(1, 0, 0).applyQuaternion(turn);
    const w = this.lookWeight;
    turnAbout(this.neck, up, this.lookYaw * 0.4 * w);
    turnAbout(this.neck, right, this.lookPitch * 0.35 * w);
    turnAbout(head, up, this.lookYaw * 0.6 * w);
    turnAbout(head, right, this.lookPitch * 0.65 * w);
  }

  /** Only the top's colour changes on these models (the rest is the person's own). */
  setLook(look: AvatarLook): void {
    this.setTint(look.tint ?? 0);
  }

  /**
   * speed in m/s; riding: 'stand' (own scooter: hands forward on the handlebar), 'seat' (bike,
   * auto: seated, feet on the footrests and hands on the grips by IK), or null; `emote`
   * 1 wave · 2 dance · 3 sit · 4 talk (standing still). grips / feet in world space.
   */
  update(dt: number, speed: number, groundedOrEmote: boolean | number = true, riding: 'stand' | 'seat' | null = null, emote = 0, grips: THREE.Vector3[] | null = null, feet: THREE.Vector3[] | null = null): void {
    // (The street crowd calls update(dt, speed, emote).)
    const grounded = typeof groundedOrEmote === 'boolean' ? groundedOrEmote : true;
    if (typeof groundedOrEmote === 'number') emote = groundedOrEmote;
    if (this.lookBefore && this.neck && this.head) {
      this.neck.quaternion.copy(this.lookBefore[0]);
      this.head.quaternion.copy(this.lookBefore[1]);
      this.lookBefore = null;
    }
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
    const natural = this.speeds.get(clip) ?? CLIP_SPEED[clip];
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
    this.applyLook(dt);
    // The helmet sits on the head wherever the pose has put it, tilted with it (leaning over the
    // bars, looking round). The head bone's own +x runs up through the skull and +y out of the face.
    if (this.helmet?.visible && this.head) {
      this.root.updateMatrixWorld(true);
      const s = this.height / 1.7;
      this.head.getWorldQuaternion(HELMET_Q);
      const at = this.head.getWorldPosition(LOOK_A);
      at.addScaledVector(LOOK_UP.set(1, 0, 0).applyQuaternion(HELMET_Q), 0.03 * s);
      at.addScaledVector(LOOK_RIGHT.set(0, 1, 0).applyQuaternion(HELMET_Q), 0.004 * s);
      this.helmet.position.copy(this.root.worldToLocal(at));
      this.helmet.quaternion.copy(this.root.getWorldQuaternion(LOOK_Q).invert()).multiply(HELMET_Q).multiply(HEAD_TO_HELMET);
      this.helmet.scale.setScalar(s);
    }
    // Rain: the umbrella opens while standing or walking (not riding, in the air, running or
    // dancing), and everyone slowly gets wet — much less under an umbrella — and slowly dries.
    const open = this.umbrella !== null && rainNow > 0.15 && riding === null && grounded && emote === 0 && speed < 3.5;
    if (this.umbrella) {
      this.umbrella.visible = open;
      if (open) this.holdUmbrella();
    }
    const soak = rainNow * (open ? 0.3 : 1);
    this.wet.value += (soak - this.wet.value) * Math.min(1, dt / (soak > this.wet.value ? 10 : 45));
    this.materials.forEach((material, i) => {
      (material as THREE.MeshStandardMaterial).roughness = this.roughness[i] * (1 - 0.45 * this.wet.value);
    });
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
    living.delete(this);
    this.umbrella?.removeFromParent(); // its geometry and material are shared
    this.mixer.stopAllAction();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }
}
