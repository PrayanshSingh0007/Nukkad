// Replaces a model's photo textures with flat colours (some downloads are textured with
// product photos, which may show brand logos or be other people's pictures — we keep only the
// modeller's own geometry).
//
//   node tools/vehicles/repaint.mjs <in.glb> <out.glb> <map.json>
//
// map.json: { "<regex on material name>": { "name": "Body_Paint", "color": "#ffffff",
//             "metal": 0.3, "rough": 0.4 }, … }. Materials named like SketchUp's
// "edge_color189189191255" (r, g, b, alpha in 0–255) get that colour back (some exporters
// lose it). Everything else keeps its colour factor. All textures, texture coordinates and
// line primitives are removed.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [input, output, mapFile] = process.argv.slice(2);
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fromHex = (hex) => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255));

/** "edge_color189189191255" → [189, 189, 191]; only unambiguous lengths (2 or 3 digits each). */
function sketchupColour(name) {
  const match = /^edge_color(\d+)255$/.exec(name);
  if (!match) return null;
  const d = match[1];
  if (d.length === 9) return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].map(Number);
  if (d.length === 6) return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6)].map(Number);
  return null;
}

for (const material of doc.getRoot().listMaterials()) {
  const name = material.getName();
  material.setBaseColorTexture(null).setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
  const rule = Object.entries(map).find(([pattern]) => new RegExp(pattern).test(name))?.[1];
  const alpha = material.getBaseColorFactor()[3];
  if (rule) {
    material.setBaseColorFactor([...fromHex(rule.color), alpha]);
    if (rule.metal !== undefined) material.setMetallicFactor(rule.metal);
    if (rule.rough !== undefined) material.setRoughnessFactor(rule.rough);
    if (rule.name) material.setName(rule.name);
  } else {
    const rgb = sketchupColour(name);
    if (rgb) material.setBaseColorFactor([...rgb.map((v) => linear(v / 255)), alpha]).setMetallicFactor(0.2).setRoughnessFactor(0.55);
  }
  console.log(name, '→', material.getName(), material.getBaseColorFactor().map((v) => v.toFixed(2)).join(','));
}
// SketchUp exports often carry the drawing's edge lines as line primitives; the game draws
// surfaces only. Without textures the texture coordinates are not needed either.
let lines = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    if (primitive.getMode() !== 4) {
      primitive.dispose();
      lines++;
      continue;
    }
    for (const semantic of primitive.listSemantics()) if (semantic.startsWith('TEXCOORD')) primitive.setAttribute(semantic, null);
  }
}
if (lines) console.log('removed', lines, 'line/point primitives');
await doc.transform(prune());
await io.write(output, doc);
console.log(output, Math.round(fs.statSync(output).size / 1024), 'KB');
