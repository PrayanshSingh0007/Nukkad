import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HAIR_COLORS, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, SKIN_TONES } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';

/**
 * The avatar is built in code from simple rounded shapes — no downloaded model.
 * All parts are merged into ONE mesh (one draw call per player); each part is glued
 * to one of 11 bones, so knees and elbows bend when walking.
 * Faces -z, feet at y = 0, about 1.78 m tall. Full detail (players) ≈ 9,000 triangles with
 * hands, face and clothing details, and soft bending at elbows, knees and shoulders;
 * the light version for street crowds stays ≈ 450.
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
const LACE = 0xe9e7e1;
const EYE_WHITE = 0xf4f2ee;
const IRIS = 0x4a3221;
const EYE = 0x111317;
const WATCH = 0x23262c;
const BUTTON = 0xd9d4c4;
const BUCKLE = 0xb9b4a6;

interface Place {
  at: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

/** Smooth bending: vertices near a joint are shared with the parent bone. */
interface Blend {
  parent: BoneId;
  /** Height of the joint (at rest), metres. */
  joint: number;
  /** Over how many metres each side of the joint the weight fades. */
  range: number;
  /** 1 when the part hangs BELOW the joint (forearm, shin), -1 when it sits above it (chest over hips). */
  below: 1 | -1;
}

/** 1 = full detail (players) · lower = fewer segments (people in the street). */
let detail = 1;
const full = (): boolean => detail >= 1;
const seg = (n: number): number => Math.max(3, Math.round(n * detail));

/** Collects coloured parts, each glued to one bone. */
class Parts {
  readonly list: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, bone: BoneId, color: number, place: Place, blend?: Blend): void {
    geometry.deleteAttribute('uv');
    if (place.scale) geometry.scale(...place.scale);
    if (place.rot) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...place.rot)));
    geometry.translate(...place.at);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const count = position.count;
    const tint = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // Baked soft shade: surfaces facing down (under the chin, inside the arms) are a little darker.
      const ao = full() ? 1 - 0.16 * Math.max(0, -normal.getY(i) - 0.35) : 1;
      colors.set([tint.r * ao, tint.g * ao, tint.b * ao], i * 3);
      skinIndex[i * 4] = bone;
      skinWeight[i * 4] = 1;
      if (blend && full()) {
        const t = (blend.joint - position.getY(i)) * blend.below;
        const own = Math.min(1, Math.max(0, 0.5 + t / (2 * blend.range)));
        skinIndex[i * 4 + 1] = blend.parent;
        skinWeight[i * 4] = own;
        skinWeight[i * 4 + 1] = 1 - own;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    this.list.push(geometry);
  }

  /** A pill between two heights (limbs). */
  limb(bone: BoneId, color: number, x: number, top: number, bottom: number, radius: number, blend?: Blend, z = 0): void {
    const length = Math.max(0.01, top - bottom - radius * 2);
    this.add(new THREE.CapsuleGeometry(radius, length, detail < 1 ? 1 : 4, seg(12)), bone, color, { at: [x, (top + bottom) / 2, z] }, blend);
  }

  /** A tapered limb (wider at the top), for thighs and upper arms. */
  taper(bone: BoneId, color: number, x: number, top: number, bottom: number, rTop: number, rBottom: number, blend?: Blend): void {
    this.add(new THREE.CylinderGeometry(rTop, rBottom, top - bottom, seg(12), 3, true), bone, color, { at: [x, (top + bottom) / 2, 0] }, blend);
  }

  ball(bone: BoneId, color: number, radius: number, place: Place, segments: [number, number] = [10, 8]): void {
    this.add(new THREE.SphereGeometry(radius, seg(segments[0]), seg(segments[1])), bone, color, place);
  }

  box(bone: BoneId, color: number, size: [number, number, number], place: Place): void {
    this.add(new THREE.BoxGeometry(...size), bone, color, place);
  }

  /** A body shape turned from a side profile [radius, height][] and flattened front-to-back. */
  lathe(bone: BoneId, color: number, profile: [number, number][], depth: number, blend?: Blend): void {
    const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
    this.add(new THREE.LatheGeometry(points, seg(20)), bone, color, { at: [0, 0, 0], scale: [1, 1, depth] }, blend);
  }
}

const shade = (hex: number, factor: number): number => new THREE.Color(hex).multiplyScalar(factor).getHex();
const mix = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

function addLegs(p: Parts, pants: number, hips: number, outfit: (typeof OUTFITS)[number]): void {
  const seam = shade(pants, 0.78);
  for (const [thigh, shin, x] of [
    [BONE.thighL, BONE.shinL, -0.095],
    [BONE.thighR, BONE.shinR, 0.095],
  ] as const) {
    if (full()) {
      p.taper(thigh, pants, x, 0.95, 0.5, 0.088, 0.066, { parent: BONE.hips, joint: 0.9, range: 0.05, below: 1 });
      p.limb(shin, pants, x, 0.56, 0.1, 0.064, { parent: thigh, joint: 0.5, range: 0.06, below: 1 });
      p.ball(shin, pants, 0.066, { at: [x, 0.5, -0.004] }); // knee
      p.box(thigh, seam, [0.006, 0.42, 0.012], { at: [x + Math.sign(x) * 0.077, 0.71, 0] }); // outer seam
      p.box(shin, seam, [0.006, 0.36, 0.012], { at: [x + Math.sign(x) * 0.064, 0.3, 0] });
      p.add(new THREE.CylinderGeometry(0.068, 0.07, 0.035, seg(12)), shin, shade(pants, 0.9), { at: [x, 0.12, 0] }); // turned-up hem
    } else {
      p.limb(thigh, pants, x, 0.93, 0.48, 0.078);
      p.limb(shin, pants, x, 0.52, 0.09, 0.062);
    }
    // Sneaker: upper, rounded toe, white sole; laces and a heel tab up close.
    p.box(shin, SHOE, [0.115, 0.075, 0.2], { at: [x, 0.055, -0.02] });
    p.ball(shin, SHOE, 0.058, { at: [x, 0.05, -0.12], scale: [1, 0.72, 1] }, [10, 6]);
    p.box(shin, SOLE, [0.122, 0.026, 0.27], { at: [x, 0.013, -0.045] });
    if (full()) {
      for (let k = 0; k < 3; k++) p.box(shin, LACE, [0.06, 0.008, 0.012], { at: [x, 0.083 - k * 0.006, -0.055 - k * 0.03], rot: [0.5, 0, 0] });
      p.box(shin, SOLE, [0.004, 0.022, 0.12], { at: [x + Math.sign(x) * 0.059, 0.055, 0.0] }); // side stripe (plain, no logo)
      p.box(shin, shade(SHOE, 1.6), [0.05, 0.05, 0.012], { at: [x, 0.08, 0.083] }); // heel tab
    }
  }
  if (full()) {
    p.lathe(BONE.hips, hips, [[0.0, 0.84], [0.13, 0.845], [0.16, 0.88], [0.165, 0.94], [0.155, 1.0], [0.0, 1.0]], 0.72);
    if (outfit !== 'kurta') {
      p.add(new THREE.CylinderGeometry(0.158, 0.162, 0.04, seg(20), 1, true), BONE.hips, 0x2a221c, { at: [0, 0.985, 0], scale: [1, 1, 0.73] }); // belt
      p.box(BONE.hips, BUCKLE, [0.045, 0.032, 0.01], { at: [0, 0.985, -0.118] });
      for (const side of [-1, 1]) p.box(BONE.hips, shade(pants, 0.85), [0.09, 0.1, 0.006], { at: [side * 0.075, 0.9, 0.118] }); // back pockets
    }
  } else {
    p.add(new THREE.CylinderGeometry(0.155, 0.15, 0.18, 14), BONE.hips, hips, { at: [0, 0.92, 0], scale: [1, 1, 0.72] });
  }
}

function addTorso(p: Parts, outfit: (typeof OUTFITS)[number], cloth: number, skin: number): void {
  const dark = shade(cloth, 0.72);
  const hipBlend: Blend = { parent: BONE.hips, joint: 1.02, range: 0.05, below: -1 };
  if (full()) {
    // Waist in, chest out, shoulders rounded off.
    p.lathe(BONE.chest, cloth, [[0.0, 0.97], [0.155, 0.97], [0.158, 1.04], [0.152, 1.1], [0.165, 1.2], [0.185, 1.3], [0.19, 1.37], [0.165, 1.425], [0.1, 1.455], [0.06, 1.465]], 0.62, hipBlend);
    p.ball(BONE.chest, cloth, 0.066, { at: [-0.183, 1.395, 0], scale: [1, 0.85, 1] });
    p.ball(BONE.chest, cloth, 0.066, { at: [0.183, 1.395, 0], scale: [1, 0.85, 1] });
  } else {
    p.add(new THREE.CylinderGeometry(0.19, 0.155, 0.46, 16), BONE.chest, cloth, { at: [0, 1.21, 0], scale: [1, 1, 0.62] });
    p.ball(BONE.chest, cloth, 0.072, { at: [-0.18, 1.4, 0] });
    p.ball(BONE.chest, cloth, 0.072, { at: [0.18, 1.4, 0] });
  }
  p.add(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 12), BONE.chest, skin, { at: [0, 1.46, 0] }); // neckline
  switch (outfit) {
    case 'tee':
      p.box(BONE.chest, shade(cloth, 1.15), [0.16, 0.05, 0.01], { at: [0, 1.25, -0.118] }); // a simple stripe print
      if (full()) {
        p.add(new THREE.TorusGeometry(0.064, 0.009, 6, seg(16)), BONE.chest, dark, { at: [0, 1.458, -0.004], rot: [Math.PI / 2, 0, 0], scale: [1, 0.75, 1] }); // collar rib
        p.add(new THREE.CylinderGeometry(0.157, 0.157, 0.025, seg(20), 1, true), BONE.chest, dark, { at: [0, 0.985, 0], scale: [1, 1, 0.64] }); // hem
      }
      break;
    case 'hoodie':
      p.add(new THREE.TorusGeometry(0.1, 0.038, 6, 14), BONE.chest, dark, { at: [0, 1.46, 0.05], rot: [Math.PI / 2.4, 0, 0] });
      p.box(BONE.chest, dark, [0.22, 0.09, 0.012], { at: [0, 1.06, -0.1] });
      p.box(BONE.chest, 0xf1f1ee, [0.012, 0.11, 0.012], { at: [-0.035, 1.38, -0.118] });
      p.box(BONE.chest, 0xf1f1ee, [0.012, 0.11, 0.012], { at: [0.035, 1.38, -0.118] });
      if (full()) {
        p.ball(BONE.chest, 0xf1f1ee, 0.011, { at: [-0.035, 1.32, -0.118] }); // drawstring tips
        p.ball(BONE.chest, 0xf1f1ee, 0.011, { at: [0.035, 1.32, -0.118] });
        p.ball(BONE.chest, dark, 0.11, { at: [0, 1.42, 0.09], scale: [1.1, 0.75, 0.6] }); // hood lying on the back
        p.add(new THREE.CylinderGeometry(0.16, 0.16, 0.05, seg(20), 1, true), BONE.chest, dark, { at: [0, 0.99, 0], scale: [1, 1, 0.65] }); // waistband
      }
      break;
    case 'kurta':
      p.add(new THREE.CylinderGeometry(0.158, 0.215, 0.42, seg(18), 1, true), BONE.hips, cloth, { at: [0, 0.81, 0], scale: [1, 1, 0.72] });
      p.box(BONE.chest, dark, [0.02, 0.2, 0.012], { at: [0, 1.36, -0.118] }); // placket
      if (full()) {
        for (let k = 0; k < 3; k++) p.ball(BONE.chest, BUTTON, 0.008, { at: [0, 1.43 - k * 0.06, -0.126] });
        p.add(new THREE.CylinderGeometry(0.058, 0.064, 0.05, seg(12), 1, true), BONE.chest, dark, { at: [0, 1.475, 0] }); // band collar
        p.add(new THREE.CylinderGeometry(0.216, 0.216, 0.03, seg(18), 1, true), BONE.hips, dark, { at: [0, 0.615, 0], scale: [1, 1, 0.72] }); // hem border
      }
      break;
    case 'jacket':
      p.box(BONE.chest, 0xf1f1ee, [0.1, 0.4, 0.012], { at: [0, 1.2, -0.115] }); // shirt showing in front
      p.box(BONE.chest, dark, [0.07, 0.12, 0.02], { at: [-0.075, 1.4, -0.105], rot: [0, 0, 0.35] }); // collar
      p.box(BONE.chest, dark, [0.07, 0.12, 0.02], { at: [0.075, 1.4, -0.105], rot: [0, 0, -0.35] });
      if (full()) {
        for (const side of [-1, 1]) {
          p.box(BONE.chest, dark, [0.012, 0.36, 0.014], { at: [side * 0.056, 1.2, -0.117] }); // front edges
          p.box(BONE.chest, dark, [0.07, 0.008, 0.01], { at: [side * 0.11, 1.08, -0.105], rot: [0, side * 0.35, 0] }); // pocket flaps
        }
        for (let k = 0; k < 3; k++) p.ball(BONE.chest, 0x2b2b2b, 0.007, { at: [0, 1.32 - k * 0.08, -0.123] }); // shirt buttons
      }
      break;
  }
}

function addHand(p: Parts, bone: BoneId, x: number, skin: number): void {
  if (!full()) {
    p.ball(bone, skin, 0.05, { at: [x, 0.885, 0], scale: [0.8, 1.15, 0.95] });
    return;
  }
  const side = Math.sign(x);
  p.box(bone, skin, [0.032, 0.08, 0.075], { at: [x, 0.89, 0] }); // palm (faces the leg)
  p.ball(bone, skin, 0.038, { at: [x, 0.905, 0], scale: [0.45, 1, 1] });
  for (let k = 0; k < 4; k++) {
    const length = [0.05, 0.056, 0.053, 0.044][k];
    p.add(new THREE.CapsuleGeometry(0.0085, length - 0.017, 2, 6), bone, skin, { at: [x - side * 0.004, 0.85 - length / 2 + 0.01, -0.027 + k * 0.018], rot: [0, 0, side * 0.12] });
  }
  p.add(new THREE.CapsuleGeometry(0.0105, 0.035, 2, 6), bone, skin, { at: [x - side * 0.012, 0.875, -0.042], rot: [0.5, 0, -side * 0.25] }); // thumb
}

function addArms(p: Parts, outfit: (typeof OUTFITS)[number], cloth: number, skin: number): void {
  const longSleeves = outfit !== 'tee';
  for (const [upper, fore, x] of [
    [BONE.upperArmL, BONE.foreArmL, -0.21],
    [BONE.upperArmR, BONE.foreArmR, 0.21],
  ] as const) {
    const shoulder: Blend = { parent: BONE.chest, joint: 1.42, range: 0.04, below: 1 };
    const elbow: Blend = { parent: upper, joint: 1.15, range: 0.05, below: 1 };
    if (full()) {
      p.taper(upper, longSleeves ? cloth : skin, x, 1.43, 1.14, 0.055, 0.045, shoulder);
      p.ball(upper, longSleeves ? cloth : skin, 0.047, { at: [x, 1.145, 0] }); // elbow
      p.limb(fore, longSleeves ? cloth : skin, x, 1.17, 0.93, 0.045, elbow);
      if (!longSleeves) p.taper(upper, cloth, x, 1.45, 1.3, 0.062, 0.054, shoulder); // short sleeve
      else p.add(new THREE.CylinderGeometry(0.047, 0.047, 0.03, seg(12), 1, true), fore, shade(cloth, 0.75), { at: [x, 0.95, 0] }); // cuff
      if (x < 0) {
        p.add(new THREE.CylinderGeometry(0.044, 0.044, 0.02, seg(12), 1, true), fore, WATCH, { at: [x, 0.97, 0] }); // watch strap
        p.box(fore, 0x3b4048, [0.012, 0.028, 0.028], { at: [x - 0.04, 0.97, 0] }); // watch face
      }
    } else {
      p.limb(upper, longSleeves ? cloth : skin, x, 1.43, 1.13, 0.052);
      if (!longSleeves) p.limb(upper, cloth, x, 1.44, 1.3, 0.06);
      p.limb(fore, longSleeves ? cloth : skin, x, 1.17, 0.93, 0.046);
    }
    addHand(p, fore, x, skin);
  }
}

function addHead(p: Parts, skin: number, hair: number): void {
  const h = BONE.head;
  p.add(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), h, skin, { at: [0, 1.51, 0] });
  if (!full()) {
    p.ball(h, skin, 0.13, { at: [0, 1.64, 0], scale: [0.95, 1.1, 1] }, [16, 12]);
    for (const x of [-0.045, 0.045]) p.ball(h, EYE, 0.016, { at: [x, 1.657, -0.118], scale: [1, 1, 0.5] }, [6, 4]);
    return;
  }
  const lip = mix(skin, 0xa0414a, 0.35);
  // Skull, then a softer jaw and chin so the face is not a perfect ball.
  p.ball(h, skin, 0.13, { at: [0, 1.65, 0.004], scale: [0.94, 1.08, 1.02] }, [24, 18]);
  p.ball(h, skin, 0.098, { at: [0, 1.588, -0.018], scale: [0.98, 0.8, 1] }, [20, 14]);
  p.ball(h, skin, 0.03, { at: [0, 1.54, -0.082], scale: [1.25, 0.8, 0.9] }, [12, 8]); // chin
  for (const side of [-1, 1]) {
    // Ear with a darker inside.
    p.ball(h, skin, 0.032, { at: [side * 0.122, 1.635, 0.008], scale: [0.45, 1, 0.85] }, [10, 8]);
    p.ball(h, shade(skin, 0.82), 0.018, { at: [side * 0.133, 1.633, 0.004], scale: [0.35, 1, 0.8] }, [8, 6]);
  }
  // Nose: one soft wedge with a rounded tip and two small dark nostrils underneath.
  p.add(new THREE.ConeGeometry(0.019, 0.06, 10), h, skin, { at: [0, 1.622, -0.118], rot: [-0.32, 0, 0], scale: [1, 1, 0.75] });
  p.ball(h, skin, 0.0145, { at: [0, 1.597, -0.127], scale: [1.15, 0.9, 1] }, [12, 8]);
  for (const side of [-1, 1]) p.ball(h, shade(skin, 0.6), 0.0055, { at: [side * 0.0085, 1.588, -0.124], scale: [1.2, 0.6, 1] }, [6, 4]);
  // Eyes: white, iris, pupil, a highlight, a thin upper lid and a brow.
  for (const x of [-0.045, 0.045]) {
    p.ball(h, EYE_WHITE, 0.02, { at: [x, 1.655, -0.107], scale: [1.25, 0.95, 0.55] }, [12, 8]);
    p.ball(h, IRIS, 0.0115, { at: [x, 1.655, -0.1155], scale: [1, 1, 0.4] }, [10, 8]);
    p.ball(h, EYE, 0.006, { at: [x, 1.655, -0.12], scale: [1, 1, 0.4] }, [8, 6]);
    p.ball(h, 0xffffff, 0.0028, { at: [x + 0.004, 1.659, -0.122] }, [4, 3]);
    p.add(new THREE.SphereGeometry(0.0215, 12, 4, 0, Math.PI * 2, 0, Math.PI * 0.3), h, shade(skin, 0.86), { at: [x, 1.661, -0.105], rot: [-1.25, 0, 0], scale: [1.3, 1, 0.55] }); // upper lid
    p.box(h, hair, [0.05, 0.009, 0.012], { at: [x, 1.69, -0.117], rot: [0, 0, x < 0 ? 0.12 : -0.12] }); // eyebrow
  }
  // Lips: thin upper lip, slightly fuller lower lip.
  p.add(new THREE.CapsuleGeometry(0.0048, 0.03, 2, 6), h, lip, { at: [0, 1.568, -0.117], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.8] });
  p.add(new THREE.CapsuleGeometry(0.0058, 0.026, 2, 6), h, shade(lip, 1.06), { at: [0, 1.5585, -0.114], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.8] });
}

/** The top of the hair: a dome tilted back so the forehead stays free. */
function hairDome(p: Parts, color: number, radius: number, cover = 0.5): void {
  p.add(new THREE.SphereGeometry(radius, seg(16), seg(8), 0, Math.PI * 2, 0, Math.PI * cover), BONE.head, color, {
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
      if (full()) p.add(new THREE.CapsuleGeometry(0.022, 0.15, 3, 8), h, color, { at: [0, 1.735, -0.098], rot: [0.5, 0, Math.PI / 2], scale: [1, 1, 0.7] }); // fringe
      else p.box(h, color, [0.2, 0.035, 0.05], { at: [0, 1.73, -0.1], rot: [0.5, 0, 0] });
      break;
    case 'long':
      hairDome(p, color, 0.14, 0.55);
      if (full()) {
        // Rounded fall of hair down the back, side locks framing the face, a soft parting.
        p.add(new THREE.CapsuleGeometry(0.11, 0.2, 4, 16), h, color, { at: [0, 1.5, 0.085], scale: [1.22, 1, 0.42] });
        p.ball(h, shade(color, 0.92), 0.12, { at: [0, 1.36, 0.1], scale: [1.1, 0.35, 0.36] }, [14, 6]);
        for (const side of [-1, 1]) p.add(new THREE.CapsuleGeometry(0.03, 0.2, 3, 8), h, color, { at: [side * 0.125, 1.55, -0.02], scale: [0.7, 1, 1.25], rot: [0.08, 0, side * 0.05] });
      } else {
        p.box(h, color, [0.27, 0.36, 0.07], { at: [0, 1.5, 0.1] });
        p.ball(h, color, 0.135, { at: [0, 1.33, 0.1], scale: [1, 0.3, 0.27] });
        p.box(h, color, [0.04, 0.26, 0.11], { at: [-0.13, 1.56, -0.01] });
        p.box(h, color, [0.04, 0.26, 0.11], { at: [0.13, 1.56, -0.01] });
      }
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

/** Builds the merged avatar geometry for a look. `light` = the cheap version for crowds. */
export function buildAvatarGeometry(look: AvatarLook, light = false): THREE.BufferGeometry {
  detail = light ? 0.5 : 1;
  const p = new Parts();
  const skin = new THREE.Color(SKIN_TONES[look.skin]).getHex();
  const hair = new THREE.Color(HAIR_COLORS[look.hairColor]).getHex();
  const cloth = new THREE.Color(OUTFIT_COLORS[look.color]).getHex();
  const outfit = OUTFITS[look.outfit];
  addLegs(p, PANTS[outfit], outfit === 'kurta' ? cloth : PANTS[outfit], outfit);
  addTorso(p, outfit, cloth, skin);
  addArms(p, outfit, cloth, skin);
  addHead(p, skin, hair);
  addHair(p, HAIR_STYLES[look.hair], hair);
  const merged = mergeGeometries(p.list);
  for (const part of p.list) part.dispose();
  merged.computeBoundingSphere();
  detail = 1;
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
