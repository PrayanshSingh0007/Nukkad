// Splits a Sketchfab vehicle pack (.glb) into one small .glb per vehicle for the game.
//
//   node tools/vehicles/split.mjs <pack.glb> <outDir> <out=Node name>[,<out=Node name>…]
//
// The packs keep each body under "RootNode"; wheels are either inside the body node or
// separate nodes beside it ("Wheel_*"), matched to the body they sit under. Textures are
// shrunk to 512 px and only colour textures are kept, so a car stays small.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, textureCompress } from '@gltf-transform/functions';

const [input, outDir, spec] = process.argv.slice(2);
const wanted = spec.split(',').map((pair) => pair.split('='));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(outDir, { recursive: true });

const rootOf = (doc) => doc.getRoot().listNodes().find((n) => n.getName() === 'RootNode');

const source = await io.read(input);
const kids = rootOf(source).listChildren();
const bounds = kids.map((n) => getBounds(n));
const isWheel = (n) => /^wheel/i.test(n.getName());

for (const [out, name] of wanted) {
  const bodyIndex = kids.findIndex((n) => n.getName() === name);
  if (bodyIndex < 0) throw new Error(`no node "${name}"`);
  const b = bounds[bodyIndex];
  const pad = [0.02, 0.6, 0.02].map((f, i) => (b.max[i] - b.min[i]) * f);
  const keep = new Set([bodyIndex]);
  kids.forEach((n, i) => {
    if (!isWheel(n)) return;
    const c = [0, 1, 2].map((k) => (bounds[i].min[k] + bounds[i].max[k]) / 2);
    if ([0, 1, 2].every((k) => c[k] > b.min[k] - pad[k] && c[k] < b.max[k] + pad[k])) keep.add(i);
  });

  const doc = await io.readBinary(await io.writeBinary(source)); // a fresh copy
  rootOf(doc).listChildren().forEach((n, i) => {
    if (!keep.has(i)) n.dispose();
  });
  // The game only uses each material's colour texture: drop the rest. Bodies and decals
  // become solid or cut-out (only glass stays see-through), which sorts well when instanced.
  for (const material of doc.getRoot().listMaterials()) {
    material.setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    if (material.getAlphaMode() === 'BLEND' && !/glass/i.test(material.getName())) {
      material.setAlphaMode(/decal/i.test(material.getName()) ? 'MASK' : 'OPAQUE').setAlphaCutoff(0.5);
    }
  }
  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [512, 512] }),
  );
  const file = path.join(outDir, `${out}.glb`);
  await io.write(file, doc);
  console.log(out, `${keep.size - 1} wheels`, `${Math.round(fs.statSync(file).size / 1024)} KB`);
}
