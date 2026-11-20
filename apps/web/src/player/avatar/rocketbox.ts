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

  /** speed in m/s; `emote` 1 wave · 2 dance · 3 sit · 4 talk (when standing still). */
  update(dt: number, speed: number, emote = 0): void {
    let clip: RocketboxClip = 'idle';
    if (speed > 4.2) clip = 'sprint';
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
