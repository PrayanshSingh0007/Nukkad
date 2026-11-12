import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HAIR_COLORS, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, SKIN_TONES } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';

/**
 * Real 3D people: Quaternius' CC0 "Universal Base Characters" (two rigged bodies, real hair
 * models) moved by the CC0 "Universal Animation Library" (idle, walk, jog, sprint, jump,
 * driving, sitting, dancing). Built smaller by tools/characters/build.mjs.
 *
 * The bodies come without clothes, so clothes are painted on in the shader: every vertex
 * knows which bone moves it most (torso, upper arm, thigh, foot…) and how high it sits, and
 * the outfit decides what is shirt, trousers, shoes or skin.
 */

const BASE = '/models/people/';
const HAIR_FILES: Record<(typeof HAIR_STYLES)[number], string | null> = {
  short: 'hair_simpleparted.glb',
  long: 'hair_long.glb',
  bun: 'hair_buns.glb',
  curly: 'hair_buzzedfemale.glb',
  cap: 'hair_buzzed.glb',
  none: null,
};
const PANTS: Record<(typeof OUTFITS)[number], string> = { tee: '#34425e', hoodie: '#3f434b', kurta: '#ece6d6', jacket: '#2b303a' };
const SHOES = '#2a2d34';

/** Regions painted by the clothes shader. */
const REGION = { skin: 0, torso: 1, upperArm: 2, foreArm: 3, hips: 4, thigh: 5, calf: 6, foot: 7 } as const;
function regionOf(bone: string): number {
  if (/^spine|^clavicle/.test(bone)) return REGION.torso;
  if (/^upperarm/.test(bone)) return REGION.upperArm;
  if (/^lowerarm/.test(bone)) return REGION.foreArm;
  if (/^pelvis|^root/.test(bone)) return REGION.hips;
  if (/^thigh/.test(bone)) return REGION.thigh;
  if (/^calf/.test(bone)) return REGION.calf;
  if (/^foot|^ball/.test(bone)) return REGION.foot;
  return REGION.skin; // head, neck, hands, fingers
}

interface Assets {
  bodies: [THREE.Group, THREE.Group];
  darkSkin: [THREE.Texture, THREE.Texture];
  hair: Map<string, THREE.Group>;
  clips: Map<string, THREE.AnimationClip>;
}

let loading: Promise<Assets> | null = null;
let loaded: Assets | null = null;

/** Starts loading once; resolves when everything is ready (about 2.5 MB). */
export function loadPeople(): Promise<Assets> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const textures = new THREE.TextureLoader();
  const glb = (file: string): Promise<THREE.Group> => loader.loadAsync(BASE + file).then((gltf) => {
    gltf.scene.userData.animations = gltf.animations;
    return gltf.scene;
  });
  const texture = (file: string): Promise<THREE.Texture> =>
    textures.loadAsync(BASE + file).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // glTF texture convention
      return t;
    });
  loading = (async () => {
    const hairFiles = [...new Set(Object.values(HAIR_FILES).filter((f): f is string => f !== null))];
    const [male, female, anims, darkMale, darkFemale, ...hairs] = await Promise.all([
      glb('male.glb'),
      glb('female.glb'),
      glb('anims.glb'),
      texture('skin_male_dark.jpg'),
      texture('skin_female_dark.jpg'),
      ...hairFiles.map(glb),
    ]);
    for (const body of [male, female]) prepareBody(body);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of anims.userData.animations as THREE.AnimationClip[]) clips.set(clip.name, clip);
    const hair = new Map<string, THREE.Group>();
    hairFiles.forEach((file, i) => hair.set(file, hairs[i]));
    loaded = { bodies: [male, female], darkSkin: [darkMale, darkFemale], hair, clips };
    return loaded;
  })();
  return loading;
}

export function peopleReady(): Assets | null {
  return loaded;
}

/** Adds the per-vertex region and height the clothes shader needs (once per body). */
function prepareBody(scene: THREE.Group): void {
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.userData.prepared) return;
    mesh.userData.prepared = true;
    const geometry = mesh.geometry;
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const count = geometry.getAttribute('position').count;
    const bones = mesh.skeleton.bones;
    // Heights in the bound pose, in model space (works whatever the file's up axis was).
    mesh.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const heights = new Float32Array(count);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      mesh.applyBoneTransform(i, v.fromBufferAttribute(geometry.getAttribute('position'), i));
      v.applyMatrix4(mesh.matrixWorld);
      heights[i] = v.y;
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    const region = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestWeight = -1;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k);
        if (w > bestWeight) {
          bestWeight = w;
          best = skinIndex.getComponent(i, k);
        }
      }
      region[i * 2] = regionOf(bones[best]?.name ?? '');
      region[i * 2 + 1] = (heights[i] - minY) / (maxY - minY || 1);
    }
    geometry.setAttribute('aCloth', new THREE.BufferAttribute(region, 2));
  });
}

/** Skin tones 0–2 use the light skin picture, 3–5 the dark one, each with a small tint. */
const SKIN_TINT: [number, number, number][] = [
  [1.06, 1.04, 1.02],
  [1.0, 0.95, 0.9],
  [0.96, 0.86, 0.76],
  [1.12, 1.06, 1.0],
  [0.95, 0.92, 0.9],
  [0.72, 0.68, 0.66],
];

const clothShader = (material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>): void => {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCloth;\nvarying vec2 vCloth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = aCloth;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vCloth;
uniform vec3 uShirt; uniform vec3 uPants; uniform vec3 uShoes; uniform vec3 uSkinTint;
uniform float uSleeve; uniform float uLong; uniform float uHood;
float nkCloth; float nkShirt;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float r = floor(vCloth.x + 0.5);
  float h = vCloth.y;
  // Shirt: torso, upper arms, forearms (long sleeves), the top of the hips; a kurta reaches the knees.
  float shirt = step(abs(r - 1.0), 0.1) + step(abs(r - 2.0), 0.1) + step(abs(r - 3.0), 0.1) * uSleeve
              + step(abs(r - 4.0), 0.1) * step(0.53, h)
              + (step(abs(r - 4.0), 0.1) + step(abs(r - 5.0), 0.1)) * uLong * step(0.3, h);
  shirt = min(shirt, 1.0);
  float shoes = step(abs(r - 7.0), 0.1) + step(abs(r - 6.0), 0.1) * step(h, 0.06);
  shoes = min(shoes, 1.0);
  float pants = (step(abs(r - 4.0), 0.1) + step(abs(r - 5.0), 0.1) + step(abs(r - 6.0), 0.1)) * (1.0 - shirt) * (1.0 - shoes);
  // A hood or collar edge: the top of the torso near the neck.
  float hood = step(abs(r - 1.0), 0.1) * step(0.79, h) * uHood;
  nkShirt = shirt;
  nkCloth = min(1.0, shirt + pants + shoes);
  // A slightly darker band at the shirt's hem and the trouser waist.
  float hem = (1.0 - smoothstep(0.0, 0.012, abs(h - 0.535))) * step(abs(r - 4.0), 0.1);
  vec3 cloth = uShirt * shirt * (1.0 - hood * 0.25) + uPants * pants + uShoes * shoes;
  cloth *= 1.0 - hem * 0.35;
  diffuseColor.rgb = mix(diffuseColor.rgb * uSkinTint, cloth, nkCloth);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.88, nkCloth);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize(mix(normal, nonPerturbedNormal, nkCloth * 0.9));`,
      );
  };
  material.customProgramCacheKey = () => 'nukkad-people-1';
};

const hairShader = (material: THREE.MeshStandardMaterial, color: { value: THREE.Color }): void => {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHair = color;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHair;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{ float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = uHair * (0.45 + l * 1.4); }`,
      );
  };
  material.customProgramCacheKey = () => 'nukkad-hair-1';
};

const ACTIONS = { idle: 'Idle_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', air: 'Jump_Loop', drive: 'Driving_Loop', sit: 'Sitting_Idle_Loop', dance: 'Dance_Loop', wave: 'Interact', talk: 'Idle_Talking_Loop' } as const;
type ActionName = keyof typeof ACTIONS;
/** How fast each clip walks at speed 1 (metres per second), to match feet to the ground. */
const CLIP_SPEED: Partial<Record<ActionName, number>> = { walk: 1.45, jog: 3.4, sprint: 6 };

/** One person: a body, hair, painted clothes and an animation mixer. */
export class Person {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ActionName, THREE.AnimationAction>();
  private current: ActionName | null = null;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly uniforms = {
    uShirt: { value: new THREE.Color() },
    uPants: { value: new THREE.Color() },
    uShoes: { value: new THREE.Color(SHOES) },
    uSkinTint: { value: new THREE.Color() },
    uSleeve: { value: 0 },
    uLong: { value: 0 },
    uHood: { value: 0 },
  };
  private readonly hairColor = { value: new THREE.Color() };
  /** Arm bones, for the scooter handlebar pose laid over the idle clip. */
  private readonly arms: { upper: THREE.Bone; lower: THREE.Bone }[] = [];

  constructor(assets: Assets, look: AvatarLook) {
    const source = assets.bodies[look.build] ?? assets.bodies[0];
    const body = cloneSkinned(source) as THREE.Group;
    // Scale to 1.75 m and face -z like the rest of the game.
    const box = new THREE.Box3().setFromObject(source);
    const scale = 1.75 / Math.max(0.1, box.max.y - box.min.y);
    body.scale.setScalar(scale);
    body.position.y = -box.min.y * scale;
    body.rotation.y = Math.PI;
    this.root.add(body);

    let skinned: THREE.SkinnedMesh | null = null;
    body.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = material;
      this.materials.push(material);
      if (mesh.geometry.getAttribute('aCloth') && material.name.startsWith('MI_Superhero')) {
        skinned = mesh;
        if (look.skin >= 3) material.map = assets.darkSkin[look.build] ?? assets.darkSkin[0];
        clothShader(material, this.uniforms);
      } else if (material.name.startsWith('MI_Hair')) hairShader(material, this.hairColor);
    });

    // Hair: a separate rigged model, re-bound to this body's skeleton by bone name.
    const hairFile = HAIR_FILES[HAIR_STYLES[look.hair] ?? 'short'];
    const hairScene = hairFile ? assets.hair.get(hairFile) : undefined;
    const bodyMesh = skinned as THREE.SkinnedMesh | null;
    if (hairScene && bodyMesh) {
      const byName = new Map(bodyMesh.skeleton.bones.map((bone) => [bone.name, bone]));
      hairScene.traverse((object) => {
        const hair = object as THREE.SkinnedMesh;
        if (!hair.isSkinnedMesh) return;
        const copy = new THREE.SkinnedMesh(hair.geometry, (hair.material as THREE.MeshStandardMaterial).clone());
        const material = copy.material as THREE.MeshStandardMaterial;
        hairShader(material, this.hairColor);
        this.materials.push(material);
        const bones = hair.skeleton.bones.map((bone) => byName.get(bone.name) ?? bone);
        copy.bind(new THREE.Skeleton(bones, hair.skeleton.boneInverses), hair.bindMatrix);
        copy.castShadow = true;
        copy.frustumCulled = false;
        bodyMesh.parent?.add(copy);
      });
    }

    for (const side of ['l', 'r']) {
      const upper = body.getObjectByName(`upperarm_${side}`) as THREE.Bone | undefined;
      const lower = body.getObjectByName(`lowerarm_${side}`) as THREE.Bone | undefined;
      if (upper && lower) this.arms.push({ upper, lower });
    }
    this.mixer = new THREE.AnimationMixer(body);
    for (const [name, clipName] of Object.entries(ACTIONS) as [ActionName, string][]) {
      const clip = assets.clips.get(clipName);
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.setLook(look);
    this.play('idle', 0);
  }

  /** Colours only (body build, skin picture and hairstyle need a new Person). */
  setLook(look: AvatarLook): void {
    const outfit = OUTFITS[look.outfit] ?? 'tee';
    const u = this.uniforms;
    u.uShirt.value.set(OUTFIT_COLORS[look.color]).convertSRGBToLinear();
    u.uPants.value.set(PANTS[outfit]).convertSRGBToLinear();
    u.uSleeve.value = outfit === 'tee' ? 0 : 1;
    u.uLong.value = outfit === 'kurta' ? 1 : 0;
    u.uHood.value = outfit === 'hoodie' ? 1 : 0;
    const tint = SKIN_TINT[look.skin] ?? SKIN_TINT[2];
    u.uSkinTint.value.setRGB(tint[0], tint[1], tint[2]);
    this.hairColor.value.set(HAIR_COLORS[look.hairColor]).convertSRGBToLinear();
    void SKIN_TONES;
  }

  private play(name: ActionName, fade = 0.2): void {
    if (this.current === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.actions.get(this.current)?.fadeOut(fade);
    this.current = name;
  }

  /** speed in m/s; riding: 'stand' (own scooter), 'seat' (two-wheeler / auto), or null. */
  update(dt: number, speed: number, grounded: boolean, riding: 'stand' | 'seat' | null, emote = 0): void {
    let name: ActionName = 'idle';
    const emoteName = (['idle', 'wave', 'dance', 'sit', 'talk'] as const)[emote] ?? 'idle';
    if (riding === 'seat') name = 'drive';
    else if (!riding && emote > 0 && speed < 0.4) name = emoteName;
    else if (riding === 'stand') name = 'idle';
    else if (!grounded) name = 'air';
    else if (speed > 4.6) name = 'sprint';
    else if (speed > 2.2) name = 'jog';
    else if (speed > 0.25) name = 'walk';
    this.play(name);
    const action = this.actions.get(name);
    const clipSpeed = CLIP_SPEED[name];
    if (action) action.timeScale = clipSpeed ? Math.max(0.5, Math.min(1.6, speed / clipSpeed)) : 1;
    this.mixer.update(dt);
    if (riding === 'stand') this.handlebarPose();
  }

  /** Standing on the scooter: both arms reach forward to the handlebar (on top of the idle clip). */
  private handlebarPose(): void {
    this.root.updateMatrixWorld(true);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    const turn = (bone: THREE.Bone, angle: number): void => {
      const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      // The same turn about the body's right-hand axis, written in the parent bone's own axes.
      const delta = new THREE.Quaternion().setFromAxisAngle(right, angle);
      const local = parent.clone().invert().multiply(delta).multiply(parent);
      bone.quaternion.premultiply(local);
      bone.updateMatrixWorld(true);
    };
    for (const { upper, lower } of this.arms) {
      turn(upper, 0.6);
      turn(lower, 0.4);
    }
  }

  setOpacity(opacity: number): void {
    for (const material of this.materials) {
      const transparent = opacity < 1;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }
}
