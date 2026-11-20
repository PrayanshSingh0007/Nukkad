// Slims the Rocketbox animation clips (exported from Blender, one .glb per clip) for the web:
//   node tools/characters/rocketbox-anims.mjs <folder with the clip .glb files>
// - drops the face bones' tracks (eyes, jaw, lips…: our people do not talk with their faces yet);
// - drops position tracks except the root's and the pelvis' (every Rocketbox body has slightly
//   different bone lengths, and moving bones would stretch them);
// - removes keyframes that change nothing (resample) and unused data.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample } from '@gltf-transform/functions';

const folder = process.argv[2];
const FACE = /(Eye|Jaw|Lip|Tongue|Mouth|Masseter|Brow|Cheek|Nose|Lid|Ear|Teeth|Forehead|Chin|Nostril)/i;
const KEEP_POSITION = new Set(['Bip01', 'Bip01 Pelvis']);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.glb'))) {
  const full = path.join(folder, file);
  const before = fs.statSync(full).size;
  const doc = await io.read(full);
  let dropped = 0;
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const name = channel.getTargetNode()?.getName() ?? '';
      const p = channel.getTargetPath();
      if (FACE.test(name) || (p === 'translation' && !KEEP_POSITION.has(name)) || p === 'scale') {
        channel.getSampler()?.dispose();
        channel.dispose();
        dropped++;
      }
    }
  }
  await doc.transform(resample({ tolerance: 0.0005 }), prune());
  await io.write(full, doc);
  console.log(file, Math.round(before / 1024), '→', Math.round(fs.statSync(full).size / 1024), 'KB', `(${dropped} tracks dropped)`);
}
