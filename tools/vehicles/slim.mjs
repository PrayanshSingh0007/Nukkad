// Makes a downloaded vehicle .glb small enough for phones.
//
//   node tools/vehicles/slim.mjs <in.glb> <out.glb> [maxTriangles=18000] [maxError=0.012] [dropNodes=a,b]
//
// Keeps only colour textures (512 px WebP), makes bodies and decals solid or cut-out (only
// glass stays see-through), simplifies heavy models down to about maxTriangles and stores the
// geometry quantized (KHR_mesh_quantization, which three.js reads).
import fs from 'node:fs';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions';

const [input, output, maxArg, errorArg, dropArg] = process.argv.slice(2);
const drop = new Set((dropArg ?? '').split(',').filter(Boolean));
const maxTriangles = Number(maxArg ?? 18000);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

const triangles = () => {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(t);
};

// Brand badges and baked ground shadows are separate parts in some models: drop them by name
// (plus any node names given on the command line, found by looking at the model).
for (const node of doc.getRoot().listNodes()) {
  if (/emblem|logo|badge|shadow/i.test(node.getName()) || drop.has(node.getName())) node.dispose();
}
// Badge materials (logos painted on their own little parts): remove those parts.
for (const mesh of doc.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    if (/logo|badge|emblem|paiqi/i.test(primitive.getMaterial()?.getName() ?? '')) primitive.dispose();
  }
}
for (const material of doc.getRoot().listMaterials()) {
  material.setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
  if (material.getAlphaMode() === 'BLEND' && !/glass|window|windshield/i.test(material.getName())) {
    material.setAlphaMode(/decal|logo|sticker/i.test(material.getName()) ? 'MASK' : 'OPAQUE').setAlphaCutoff(0.5);
  }
}
const before = triangles();
await doc.transform(prune(), dedup(), flatten(), join(), weld({ tolerance: 0.0005 }));
if (before > maxTriangles) {
  await MeshoptSimplifier.ready;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTriangles / before, error: Number(errorArg ?? 0.012), lockBorder: false }));
}
await doc.transform(prune(), quantize(), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [512, 512] }));
await io.write(output, doc);
console.log(output.split('/').pop(), before, '→', triangles(), 'triangles', `${Math.round(fs.statSync(output).size / 1024)} KB`);
