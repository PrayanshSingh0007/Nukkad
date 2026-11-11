import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HAIR_COLORS, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, SKIN_TONES } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';

/**
 * The avatar is built in code from a few boxes — no downloaded model.
 * All boxes are merged into ONE mesh (one draw call per player). Each box belongs
 * to one "bone" (hips, chest, head, two arms, two legs); moving a bone moves its boxes.
 * The avatar faces -z and stands with its feet at y = 0. Height ≈ 1.8 m.
 */
export const BONE = { hips: 0, chest: 1, head: 2, armL: 3, armR: 4, legL: 5, legR: 6 } as const;
type BoneId = (typeof BONE)[keyof typeof BONE];

/** Where each bone's joint sits (model space). */
export const JOINTS: Record<BoneId, [number, number, number]> = {
  [BONE.hips]: [0, 0.82, 0],
  [BONE.chest]: [0, 0.82, 0],
  [BONE.head]: [0, 1.44, 0],
  [BONE.armL]: [-0.29, 1.38, 0],
  [BONE.armR]: [0.29, 1.38, 0],
  [BONE.legL]: [-0.1, 0.82, 0],
  [BONE.legR]: [0.1, 0.82, 0],
};

const PANTS: Record<(typeof OUTFITS)[number], number> = { tee: 0x3b4a66, hoodie: 0x4a4d55, kurta: 0xe8e2d0, jacket: 0x2f3440 };
const SHOES = 0x2b2d33;
const EYES = 0x20242a;

/** One coloured box attached to one bone. */
function box(parts: THREE.BufferGeometry[], bone: BoneId, color: number, w: number, h: number, d: number, x: number, y: number, z: number): void {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.deleteAttribute('uv');
  geometry.translate(x, y, z);
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
  parts.push(geometry);
}

/** Builds the merged avatar geometry for a look. */
export function buildAvatarGeometry(look: AvatarLook): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const skin = new THREE.Color(SKIN_TONES[look.skin]).getHex();
  const hair = new THREE.Color(HAIR_COLORS[look.hairColor]).getHex();
  const cloth = new THREE.Color(OUTFIT_COLORS[look.color]).getHex();
  const outfit = OUTFITS[look.outfit];
  const pants = PANTS[outfit];

  // Legs and shoes.
  for (const [bone, x] of [
    [BONE.legL, -0.1],
    [BONE.legR, 0.1],
  ] as const) {
    box(parts, bone, pants, 0.15, 0.72, 0.17, x, 0.46, 0);
    box(parts, bone, SHOES, 0.17, 0.1, 0.27, x, 0.05, -0.04);
  }

  // Body.
  box(parts, BONE.chest, cloth, 0.44, 0.6, 0.25, 0, 1.12, 0);
  if (outfit === 'kurta') box(parts, BONE.hips, cloth, 0.46, 0.28, 0.27, 0, 0.7, 0);
  if (outfit === 'jacket') box(parts, BONE.chest, 0xf1f1ee, 0.12, 0.52, 0.02, 0, 1.14, -0.125);
  if (outfit === 'hoodie') box(parts, BONE.chest, cloth, 0.3, 0.16, 0.1, 0, 1.4, 0.16);

  // Arms: a tee has short sleeves, everything else long ones.
  const sleeve = outfit === 'tee' ? 0.2 : 0.5;
  for (const [bone, x] of [
    [BONE.armL, -0.29],
    [BONE.armR, 0.29],
  ] as const) {
    box(parts, bone, cloth, 0.13, sleeve, 0.14, x, 1.4 - sleeve / 2, 0);
    box(parts, bone, skin, 0.115, 0.6 - sleeve, 0.125, x, 1.4 - sleeve - (0.6 - sleeve) / 2, 0);
  }

  // Head with two simple eyes.
  box(parts, BONE.head, skin, 0.34, 0.34, 0.32, 0, 1.61, 0);
  box(parts, BONE.head, EYES, 0.045, 0.05, 0.02, -0.075, 1.63, -0.165);
  box(parts, BONE.head, EYES, 0.045, 0.05, 0.02, 0.075, 1.63, -0.165);

  // Hair (or a cap in the hair colour).
  switch (HAIR_STYLES[look.hair]) {
    case 'short':
      box(parts, BONE.head, hair, 0.36, 0.09, 0.34, 0, 1.815, 0);
      box(parts, BONE.head, hair, 0.36, 0.2, 0.05, 0, 1.69, 0.175);
      break;
    case 'long':
      box(parts, BONE.head, hair, 0.37, 0.09, 0.35, 0, 1.815, 0);
      box(parts, BONE.head, hair, 0.38, 0.52, 0.07, 0, 1.53, 0.185);
      box(parts, BONE.head, hair, 0.04, 0.3, 0.2, -0.185, 1.66, 0.06);
      box(parts, BONE.head, hair, 0.04, 0.3, 0.2, 0.185, 1.66, 0.06);
      break;
    case 'bun':
      box(parts, BONE.head, hair, 0.36, 0.09, 0.34, 0, 1.815, 0);
      box(parts, BONE.head, hair, 0.36, 0.2, 0.05, 0, 1.69, 0.175);
      box(parts, BONE.head, hair, 0.15, 0.15, 0.15, 0, 1.9, 0.08);
      break;
    case 'curly':
      box(parts, BONE.head, hair, 0.44, 0.2, 0.42, 0, 1.85, 0.01);
      box(parts, BONE.head, hair, 0.42, 0.26, 0.09, 0, 1.68, 0.19);
      break;
    case 'cap':
      box(parts, BONE.head, hair, 0.37, 0.1, 0.35, 0, 1.82, 0);
      box(parts, BONE.head, hair, 0.3, 0.03, 0.17, 0, 1.775, -0.24);
      break;
    case 'none':
      break;
  }

  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** Creates the bones in their resting places. Index = bone id. */
export function buildSkeleton(): THREE.Skeleton {
  const bones = Object.values(BONE).map(() => new THREE.Bone());
  const parent: Record<BoneId, BoneId | null> = {
    [BONE.hips]: null,
    [BONE.chest]: BONE.hips,
    [BONE.head]: BONE.chest,
    [BONE.armL]: BONE.chest,
    [BONE.armR]: BONE.chest,
    [BONE.legL]: BONE.hips,
    [BONE.legR]: BONE.hips,
  };
  for (const id of Object.values(BONE)) {
    const up = parent[id];
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
