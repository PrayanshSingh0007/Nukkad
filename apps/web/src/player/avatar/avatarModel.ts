import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HAIR_COLORS, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, SKIN_TONES } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';

/**
 * The avatar is built in code from simple rounded shapes — no downloaded model.
 * All parts are merged into ONE mesh (one draw call per player); each part is glued
 * to one of 11 bones, so knees and elbows bend when walking.
 * Faces -z, feet at y = 0, about 1.78 m tall. ≈ 3,000 triangles.
 */
export const BONE = {
  hips: 0,
  chest: 1,
  head: 2,
  upperArmL: 3,
  upperArmR: 4,
  foreArmL: 5,
  foreArmR: 6,
  thighL: 7,
  thighR: 8,
  shinL: 9,
  shinR: 10,
} as const;
export type BoneId = (typeof BONE)[keyof typeof BONE];

/** Joint positions in model space, and each bone's parent. */
export const JOINTS: Record<BoneId, [number, number, number]> = {
  [BONE.hips]: [0, 0.94, 0],
  [BONE.chest]: [0, 1.02, 0],
  [BONE.head]: [0, 1.5, 0],
  [BONE.upperArmL]: [-0.205, 1.42, 0],
  [BONE.upperArmR]: [0.205, 1.42, 0],
  [BONE.foreArmL]: [-0.215, 1.15, 0],
  [BONE.foreArmR]: [0.215, 1.15, 0],
  [BONE.thighL]: [-0.095, 0.92, 0],
  [BONE.thighR]: [0.095, 0.92, 0],
  [BONE.shinL]: [-0.095, 0.5, 0],
  [BONE.shinR]: [0.095, 0.5, 0],
};
const PARENT: Record<BoneId, BoneId | null> = {
  [BONE.hips]: null,
  [BONE.chest]: BONE.hips,
  [BONE.head]: BONE.chest,
  [BONE.upperArmL]: BONE.chest,
  [BONE.upperArmR]: BONE.chest,
  [BONE.foreArmL]: BONE.upperArmL,
  [BONE.foreArmR]: BONE.upperArmR,
  [BONE.thighL]: BONE.hips,
  [BONE.thighR]: BONE.hips,
  [BONE.shinL]: BONE.thighL,
  [BONE.shinR]: BONE.thighR,
};

const PANTS: Record<(typeof OUTFITS)[number], number> = { tee: 0x34425e, hoodie: 0x3f434b, kurta: 0xece6d6, jacket: 0x2b303a };
const SHOE = 0x2a2d34;
const SOLE = 0xf2f2ef;
const EYE_WHITE = 0xf7f7f4;
const EYE = 0x1d2128;
const MOUTH = 0x9c4a4a;

interface Place {
  at: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

/** Collects coloured parts, each glued to one bone. */
class Parts {
  readonly list: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, bone: BoneId, color: number, place: Place): void {
    geometry.deleteAttribute('uv');
    if (place.scale) geometry.scale(...place.scale);
    if (place.rot) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...place.rot)));
    geometry.translate(...place.at);
    const count = geometry.getAttribute('position').count;
    const tint = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      colors.set([tint.r, tint.g, tint.b], i * 3);
      skinIndex[i * 4] = bone;
      skinWeight[i * 4] = 1;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    this.list.push(geometry);
  }

  /** A pill between two heights (limbs). */
  limb(bone: BoneId, color: number, x: number, top: number, bottom: number, radius: number): void {
    const length = Math.max(0.01, top - bottom - radius * 2);
    this.add(new THREE.CapsuleGeometry(radius, length, 3, 10), bone, color, { at: [x, (top + bottom) / 2, 0] });
  }

  ball(bone: BoneId, color: number, radius: number, place: Place, detail: [number, number] = [10, 8]): void {
    this.add(new THREE.SphereGeometry(radius, detail[0], detail[1]), bone, color, place);
  }

  box(bone: BoneId, color: number, size: [number, number, number], place: Place): void {
    this.add(new THREE.BoxGeometry(...size), bone, color, place);
  }
}

const shade = (hex: number, factor: number): number => new THREE.Color(hex).multiplyScalar(factor).getHex();

function addLegs(p: Parts, pants: number, hips: number): void {
  for (const [thigh, shin, x] of [
    [BONE.thighL, BONE.shinL, -0.095],
    [BONE.thighR, BONE.shinR, 0.095],
  ] as const) {
    p.limb(thigh, pants, x, 0.93, 0.48, 0.078);
    p.limb(shin, pants, x, 0.52, 0.09, 0.062);
    // Sneaker: upper, rounded toe, white sole.
    p.box(shin, SHOE, [0.115, 0.075, 0.2], { at: [x, 0.055, -0.02] });
    p.ball(shin, SHOE, 0.058, { at: [x, 0.05, -0.12], scale: [1, 0.72, 1] }, [10, 6]);
    p.box(shin, SOLE, [0.122, 0.026, 0.27], { at: [x, 0.013, -0.045] });
  }
  p.add(new THREE.CylinderGeometry(0.155, 0.15, 0.18, 14), BONE.hips, hips, { at: [0, 0.92, 0], scale: [1, 1, 0.72] });
}

function addTorso(p: Parts, outfit: (typeof OUTFITS)[number], cloth: number, skin: number): void {
  p.add(new THREE.CylinderGeometry(0.19, 0.155, 0.46, 16), BONE.chest, cloth, { at: [0, 1.21, 0], scale: [1, 1, 0.62] });
  p.ball(BONE.chest, cloth, 0.072, { at: [-0.18, 1.4, 0] });
  p.ball(BONE.chest, cloth, 0.072, { at: [0.18, 1.4, 0] });
  p.add(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 12), BONE.chest, skin, { at: [0, 1.46, 0] }); // neckline
  const dark = shade(cloth, 0.72);
  switch (outfit) {
    case 'tee':
      p.box(BONE.chest, shade(cloth, 1.15), [0.16, 0.05, 0.01], { at: [0, 1.25, -0.118] }); // a simple stripe print
      break;
    case 'hoodie':
      p.add(new THREE.TorusGeometry(0.1, 0.038, 6, 14), BONE.chest, dark, { at: [0, 1.46, 0.05], rot: [Math.PI / 2.4, 0, 0] });
      p.box(BONE.chest, dark, [0.22, 0.09, 0.012], { at: [0, 1.06, -0.1] });
      p.box(BONE.chest, 0xf1f1ee, [0.012, 0.11, 0.012], { at: [-0.035, 1.38, -0.118] });
      p.box(BONE.chest, 0xf1f1ee, [0.012, 0.11, 0.012], { at: [0.035, 1.38, -0.118] });
      break;
    case 'kurta':
      p.add(new THREE.CylinderGeometry(0.165, 0.205, 0.4, 16), BONE.hips, cloth, { at: [0, 0.82, 0], scale: [1, 1, 0.72] });
      p.box(BONE.chest, dark, [0.02, 0.2, 0.012], { at: [0, 1.36, -0.118] }); // placket
      break;
    case 'jacket':
      p.box(BONE.chest, 0xf1f1ee, [0.1, 0.4, 0.012], { at: [0, 1.2, -0.115] }); // shirt showing in front
      p.box(BONE.chest, dark, [0.07, 0.12, 0.02], { at: [-0.075, 1.4, -0.105], rot: [0, 0, 0.35] }); // collar
      p.box(BONE.chest, dark, [0.07, 0.12, 0.02], { at: [0.075, 1.4, -0.105], rot: [0, 0, -0.35] });
      break;
  }
}

function addArms(p: Parts, outfit: (typeof OUTFITS)[number], cloth: number, skin: number): void {
  const longSleeves = outfit !== 'tee';
  for (const [upper, fore, x] of [
    [BONE.upperArmL, BONE.foreArmL, -0.21],
    [BONE.upperArmR, BONE.foreArmR, 0.21],
  ] as const) {
    p.limb(upper, longSleeves ? cloth : skin, x, 1.43, 1.13, 0.052);
    if (!longSleeves) p.limb(upper, cloth, x, 1.44, 1.3, 0.06); // short sleeve
    p.limb(fore, longSleeves ? cloth : skin, x, 1.17, 0.93, 0.046);
    p.ball(fore, skin, 0.05, { at: [x, 0.885, 0], scale: [0.8, 1.15, 0.95] });
  }
}

function addHead(p: Parts, skin: number, hair: number): void {
  const h = BONE.head;
  p.add(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), h, skin, { at: [0, 1.51, 0] });
  p.ball(h, skin, 0.13, { at: [0, 1.64, 0], scale: [0.95, 1.1, 1] }, [16, 12]);
  p.ball(h, skin, 0.03, { at: [-0.123, 1.63, 0.005], scale: [0.6, 1, 1] }, [8, 6]);
  p.ball(h, skin, 0.03, { at: [0.123, 1.63, 0.005], scale: [0.6, 1, 1] }, [8, 6]);
  p.add(new THREE.ConeGeometry(0.02, 0.045, 6), h, shade(skin, 0.94), { at: [0, 1.618, -0.135], rot: [-Math.PI / 2, 0, 0] }); // nose
  for (const x of [-0.045, 0.045]) {
    p.ball(h, EYE_WHITE, 0.022, { at: [x, 1.657, -0.112], scale: [1, 1, 0.5] }, [8, 6]);
    p.ball(h, EYE, 0.013, { at: [x, 1.657, -0.122], scale: [1, 1.15, 0.5] }, [8, 6]);
    p.box(h, hair, [0.05, 0.011, 0.012], { at: [x, 1.698, -0.118], rot: [0, 0, x < 0 ? 0.08 : -0.08] }); // eyebrow
  }
  p.box(h, MOUTH, [0.045, 0.009, 0.01], { at: [0, 1.578, -0.123] });
}

/** The top of the hair: a dome tilted back so the forehead stays free. */
function hairDome(p: Parts, color: number, radius: number, cover = 0.5): void {
  p.add(new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.PI * cover), BONE.head, color, {
    at: [0, 1.645, 0.005],
    rot: [0.5, 0, 0], // front edge up (clears the forehead), back edge down
    scale: [0.97, 1.12, 1.03],
  });
}

function addHair(p: Parts, style: (typeof HAIR_STYLES)[number], color: number): void {
  const h = BONE.head;
  switch (style) {
    case 'short':
      hairDome(p, color, 0.137);
      p.box(h, color, [0.2, 0.035, 0.05], { at: [0, 1.73, -0.1], rot: [0.5, 0, 0] }); // fringe
      break;
    case 'long':
      hairDome(p, color, 0.14, 0.55);
      p.box(h, color, [0.27, 0.36, 0.07], { at: [0, 1.5, 0.1] });
      p.ball(h, color, 0.135, { at: [0, 1.33, 0.1], scale: [1, 0.3, 0.27] });
      p.box(h, color, [0.04, 0.26, 0.11], { at: [-0.13, 1.56, -0.01] });
      p.box(h, color, [0.04, 0.26, 0.11], { at: [0.13, 1.56, -0.01] });
      break;
    case 'bun':
      hairDome(p, color, 0.138);
      p.ball(h, color, 0.065, { at: [0, 1.8, 0.07] });
      break;
    case 'curly': {
      hairDome(p, color, 0.145, 0.55);
      const curls: [number, number, number][] = [
        [-0.1, 1.74, -0.02],
        [0.1, 1.74, -0.02],
        [0, 1.79, 0],
        [-0.06, 1.77, 0.08],
        [0.06, 1.77, 0.08],
        [-0.12, 1.66, 0.07],
        [0.12, 1.66, 0.07],
        [0, 1.7, 0.12],
        [-0.05, 1.76, -0.08],
        [0.05, 1.76, -0.08],
      ];
      for (const at of curls) p.ball(h, color, 0.055, { at }, [8, 6]);
      break;
    }
    case 'cap':
      hairDome(p, shade(color, 1), 0.143, 0.48);
      p.box(h, shade(color, 0.85), [0.19, 0.014, 0.12], { at: [0, 1.715, -0.17], rot: [-0.12, 0, 0] }); // brim
      p.ball(h, shade(color, 0.85), 0.014, { at: [0, 1.795, 0] }, [6, 4]); // button on top
      break;
    case 'none':
      break;
  }
}

/** Builds the merged avatar geometry for a look. */
export function buildAvatarGeometry(look: AvatarLook): THREE.BufferGeometry {
  const p = new Parts();
  const skin = new THREE.Color(SKIN_TONES[look.skin]).getHex();
  const hair = new THREE.Color(HAIR_COLORS[look.hairColor]).getHex();
  const cloth = new THREE.Color(OUTFIT_COLORS[look.color]).getHex();
  const outfit = OUTFITS[look.outfit];
  addLegs(p, PANTS[outfit], outfit === 'kurta' ? cloth : PANTS[outfit]);
  addTorso(p, outfit, cloth, skin);
  addArms(p, outfit, cloth, skin);
  addHead(p, skin, hair);
  addHair(p, HAIR_STYLES[look.hair], hair);
  const merged = mergeGeometries(p.list);
  for (const part of p.list) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Creates the bones in their resting places. Index = bone id. */
export function buildSkeleton(): THREE.Skeleton {
  const ids = Object.values(BONE) as BoneId[];
  const bones = ids.map(() => new THREE.Bone());
  for (const id of ids) {
    const up = PARENT[id];
    const [x, y, z] = JOINTS[id];
    if (up === null) {
      bones[id].position.set(x, y, z);
    } else {
      const [px, py, pz] = JOINTS[up];
      bones[id].position.set(x - px, y - py, z - pz);
      bones[up].add(bones[id]);
    }
  }
  bones[BONE.hips].updateMatrixWorld(true);
  return new THREE.Skeleton(bones);
}
