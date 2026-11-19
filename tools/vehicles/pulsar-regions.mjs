// The Bajaj Pulsar 150 download colours almost the whole bike with product photos spread over
// three big parts. Without the photos (we remove them: no other people's pictures, no logos)
// those parts are one white blob. This splits them by where each triangle sits on the bike
// (its side view: x along the bike, front at small x; y up), into real parts with flat colours:
// tyres, rims, hubs, engine, exhaust, fork, handlebars, seat, frame and the painted body.
//
//   node tools/vehicles/pulsar-regions.mjs <flat.glb from repaint.mjs> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [input, output] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

// Measured from the model (units ≈ 4.16 per metre): the tyres touch the ground at x ≈ 1.0
// (front, under the windscreen and speedo) and x ≈ 6.6 (rear).
const WHEELS = [
  [1.0, 1.27],
  [6.6, 1.27],
];
const R = 1.27;
const SPLIT = new Set(['Body_Paint', 'Body_Paint_2', 'Engine', 'Frame']);

const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const colour = (hex) => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255));
const PARTS = {
  Body_Paint: { color: '#ffffff', metal: 0.3, rough: 0.4 },
  Tyre: { color: '#101010', metal: 0, rough: 0.92 },
  Rim: { color: '#1d1e21', metal: 0.6, rough: 0.35 },
  Hub: { color: '#8c9096', metal: 0.9, rough: 0.3 },
  Engine: { color: '#3b3d42', metal: 0.7, rough: 0.45 },
  Exhaust: { color: '#6d7076', metal: 0.95, rough: 0.25 },
  Fork: { color: '#a9adb3', metal: 0.95, rough: 0.2 },
  Bars: { color: '#18191b', metal: 0.5, rough: 0.5 },
  Seat: { color: '#141416', metal: 0, rough: 0.85 },
  Frame: { color: '#202124', metal: 0.4, rough: 0.55 },
};
const materials = Object.fromEntries(
  Object.entries(PARTS).map(([name, p]) => [name, doc.createMaterial(name).setBaseColorFactor([...colour(p.color), 1]).setMetallicFactor(p.metal).setRoughnessFactor(p.rough)]),
);

/** Which part a triangle belongs to, from its centre (x, y) and how much it faces up. */
function part(x, y, up) {
  for (const [wx, wy] of WHEELS) {
    const d = Math.hypot(x - wx, y - wy);
    if (d < R * 1.02) return d > R * 0.74 ? 'Tyre' : d < R * 0.2 ? 'Hub' : 'Rim';
  }
  if (x > 4.5 && x < 7.2 && y < 1.9) return 'Exhaust';
  if (x > 2.3 && x < 5.0 && y < 2.5) return 'Engine';
  if (x > 0.5 && x < 2.3 && y > 1.2 && y < 3.2) return 'Fork';
  if (x > 1.4 && x < 3.0 && y > 3.9) return 'Bars';
  if (x > 4.1 && x < 6.8 && y > 2.9 && up > 0.55) return 'Seat';
  if (y > 2.3) return 'Body_Paint';
  return 'Frame';
}

const counts = {};
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  const world = (v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  for (const primitive of mesh.listPrimitives()) {
    const name = primitive.getMaterial()?.getName() ?? '';
    if (!SPLIT.has(name)) continue;
    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    const index = (i) => (indices ? indices.getScalar(i) : i);
    const count = indices ? indices.getCount() : position.getCount();
    const buckets = {};
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    for (let t = 0; t < count; t += 3) {
      const i0 = index(t);
      const i1 = index(t + 1);
      const i2 = index(t + 2);
      const p0 = world(position.getElement(i0, a));
      const p1 = world(position.getElement(i1, b));
      const p2 = world(position.getElement(i2, c));
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
      const which = part((p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, up);
      (buckets[which] ??= []).push(i0, i1, i2);
      counts[which] = (counts[which] ?? 0) + 1;
    }
    for (const [which, list] of Object.entries(buckets)) {
      const piece = doc.createPrimitive().setMaterial(materials[which]).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)));
      for (const semantic of primitive.listSemantics()) piece.setAttribute(semantic, primitive.getAttribute(semantic));
      mesh.addPrimitive(piece);
    }
    primitive.dispose();
  }
}
console.log('triangles per part', counts);
await doc.transform(prune());
await io.write(output, doc);
