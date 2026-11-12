// Builds the game's people from Quaternius' CC0 "Universal Base Characters" and
// "Universal Animation Library" (free Standard packs, see CREDITS.md):
//   node tools/characters/build.mjs <folder with the two unzipped packs>
// Writes small phone-friendly files to apps/web/public/models/people/:
//   male.glb / female.glb (body + eyes + eyebrows, 1024 px textures, light skin),
//   skin_male_dark.jpg / skin_female_dark.jpg, hair_*.glb (512 px), anims.glb (only the clips we use).
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample } from '@gltf-transform/functions';

const source = process.argv[2];
if (!source) throw new Error('usage: node tools/characters/build.mjs <folder with the unzipped packs>');
const chars = join(source, 'chars/Universal Base Characters[Standard]');
const anims = join(source, 'anim/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb');
const out = 'apps/web/public/models/people';
const work = join(tmpdir(), 'nukkad-people');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

/** Resizes an image (longest side = size) and returns the new file's bytes. */
async function shrink(file, size, format) {
  const image = sharp(file).resize(size, size, { fit: 'inside' });
  return new Uint8Array(await (format === 'jpeg' ? image.jpeg({ quality: 82, mozjpeg: true }) : image.png({ compressionLevel: 9 })).toBuffer());
}

const textures = join(chars, 'Base Characters/Textures');
// glTF wants OpenGL-style normal maps: the "Unity - Godot" ones.
const glNormals = join(textures, 'Normals Unity - Godot');
const io = new NodeIO();

/** Copies a .gltf's folder to the work area and fills in images it names but the pack lacks ("X_png.png" → "X.png"). */
function readable(folder, file) {
  const copy = join(work, folder.replace(/[^a-z0-9]/gi, '_'));
  if (!existsSync(copy)) cpSync(folder, copy, { recursive: true });
  const json = JSON.parse(readFileSync(join(copy, file), 'utf8'));
  for (const image of json.images ?? []) {
    const target = join(copy, decodeURIComponent(image.uri));
    if (existsSync(target)) continue;
    const candidates = [image.uri.replace('_png.png', '.png'), image.uri.replace('_png', '')].map((u) => [join(copy, u), join(textures, u), join(glNormals, u), join(chars, 'Hairstyles/Textures', u)]).flat();
    const found = candidates.find((c) => existsSync(c));
    if (!found) throw new Error('missing image ' + image.uri);
    copyFileSync(found, target);
  }
  return join(copy, file);
}

async function body(name, skinLight, skinDark, normal, outName) {
  const doc = await io.read(readable(join(chars, 'Base Characters/Godot - UE'), `${name}.gltf`));
  for (const material of doc.getRoot().listMaterials()) {
    const isBody = material.getName().startsWith('MI_Superhero');
    if (isBody) {
      material.getBaseColorTexture()?.setImage(await shrink(join(textures, skinLight), 1024, 'jpeg')).setMimeType('image/jpeg');
      material.getNormalTexture()?.setImage(await shrink(join(glNormals, normal), 1024, 'jpeg')).setMimeType('image/jpeg');
      material.setMetallicRoughnessTexture(null).setRoughnessFactor(0.62);
    } else if (material.getName() === 'MI_Eyes') {
      material.getBaseColorTexture()?.setImage(await shrink(join(textures, 'T_Eye_Brown.png'), 256, 'jpeg')).setMimeType('image/jpeg');
      material.setNormalTexture(null);
    } else {
      material.getBaseColorTexture()?.setImage(await shrink(join(textures, 'T_Hair_1_BaseColor.png'), 256, 'jpeg')).setMimeType('image/jpeg');
      material.setNormalTexture(null);
    }
  }
  for (const texture of doc.getRoot().listTextures()) texture.setURI('');
  await doc.transform(dedup(), prune());
  await io.write(join(out, `${outName}.glb`), doc);
  await sharp(join(textures, skinDark)).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(out, `skin_${outName}_dark.jpg`));
}

async function hair(name) {
  const doc = await io.read(readable(join(chars, 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)'), `${name}.gltf`));
  for (const material of doc.getRoot().listMaterials()) {
    const color = material.getBaseColorTexture();
    const file = color?.getURI().includes('Hair_2') ? 'T_Hair_2_BaseColor.png' : 'T_Hair_1_BaseColor.png';
    color?.setImage(await shrink(join(chars, 'Hairstyles/Textures', file), 512, 'jpeg')).setMimeType('image/jpeg');
    material.setNormalTexture(null);
  }
  for (const texture of doc.getRoot().listTextures()) texture.setURI('');
  await doc.transform(dedup(), prune());
  await io.write(join(out, `hair_${name.replace('Hair_', '').toLowerCase()}.glb`), doc);
}

const KEEP = new Set(['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Driving_Loop', 'Sitting_Idle_Loop', 'Idle_Talking_Loop', 'Dance_Loop', 'Interact']);

async function animations() {
  const doc = await io.read(anims);
  for (const animation of doc.getRoot().listAnimations()) {
    if (KEEP.has(animation.getName())) continue;
    for (const sampler of animation.listSamplers()) sampler.dispose();
    for (const channel of animation.listChannels()) channel.dispose();
    animation.dispose();
  }
  // Only the skeleton and the clips: the demo mannequin's mesh is not needed.
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()) {
      node.getMesh().dispose();
      node.setSkin(null);
    }
  }
  for (const skin of doc.getRoot().listSkins()) skin.dispose();
  // Fingers barely move in these clips: their tracks go (hands keep their rest pose).
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const name = channel.getTargetNode()?.getName() ?? '';
      if (/^(index|middle|pinky|ring|thumb)_/.test(name) || name.endsWith('_leaf_l') || name.endsWith('_leaf_r')) channel.dispose();
      // Only the hips move up and down; other bones only turn.
      else if (channel.getTargetPath() === 'translation' && name !== 'pelvis') channel.dispose();
      else if (channel.getTargetPath() === 'scale') channel.dispose();
    }
  }
  for (const animation of doc.getRoot().listAnimations()) {
    const used = new Set(animation.listChannels().map((channel) => channel.getSampler()));
    for (const sampler of animation.listSamplers()) {
      if (used.has(sampler)) continue;
      sampler.dispose(); // its key data goes with prune() below
    }
  }
  await doc.transform(resample({ tolerance: 0.0005 }), dedup(), prune({ keepLeaves: true }));
  await io.write(join(out, 'anims.glb'), doc);
}

await body('Superhero_Male_FullBody', 'T_Superhero_Male_Ligh.png', 'T_Superhero_Male_Dark.png', 'T_Superhero_Male_Normal.png', 'male');
await body('Superhero_Female_FullBody', 'T_Superhero_Female_Light_BaseColor.png', 'T_Superhero_Female_Dark_BaseColor.png', 'T_Superhero_Female_Normal.png', 'female');
for (const name of ['Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Beard']) await hair(name);
await animations();
execFileSync('ls', ['-la', out], { stdio: 'inherit' });
console.log('total', Math.round(['male.glb', 'female.glb', 'anims.glb'].reduce((s, f) => s + statSync(join(out, f)).size, 0) / 1024), 'KB (bodies + animations)');
