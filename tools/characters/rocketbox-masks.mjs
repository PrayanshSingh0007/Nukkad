// Paints a clothing mask for each Rocketbox person, so the game can recolour their top.
//   node tools/characters/rocketbox-masks.mjs <folder with the avatar .glb files>
// For each avatar:
// - the skin tone is measured from the middle of its head (face) texture;
// - every triangle of the body mesh is classed by the bones that move it: spine, neck,
//   shoulders and arms = the upper body (not hands, hips or legs);
// - those triangles are drawn into the body texture's layout (UV space), and inside them every
//   texel that is not skin-coloured is the top (shirt, tee, blouse, sweater);
// - the top's own colour range is measured there (its chromaticity: the hue and how strong it
//   is, with dark texels damped so shadows do not count as colour), texels far outside it are
//   dropped (tattoos, bare-skin blotches), and it fills out over every connected texel of the
//   same fabric (long tunics' hems, which the hip and thigh bones move, collars and straps,
//   and the padding around each piece) — never into hands, head or feet;
// - widened 4 px for filtering, softened, and saved as <name>_top.png (512 px), with the top's
//   average brightness in masks.json (the game keeps the fabric's shading around it).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const folder = process.argv[2];
const SIZE = 512;
const UPPER = /(Spine|Neck|Clavicle|UpperArm|Forearm|ForeTwist|UpArmTwist)/i;
const NOT_UPPER = /(Hand|Finger|Head|Pelvis|Thigh|Calf|Foot|Toe)/i;
/** Never the top: hands, fingers, head and feet. */
const NEVER = /(Hand|Finger|Head|Foot|Toe)/i;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const summary = {};

async function rgba(texture, size) {
  const { data } = await sharp(Buffer.from(texture.getImage())).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

/** Skin tone: average of mid-bright pixels in the middle of the face texture. */
function skinTone(head) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 64; y < 192; y++)
    for (let x = 64; x < 192; x++) {
      const i = (y * 256 + x) * 4;
      const l = (head[i] + head[i + 1] + head[i + 2]) / 3;
      if (l > 60 && l < 230) {
        r += head[i];
        g += head[i + 1];
        b += head[i + 2];
        n++;
      }
    }
  return [r / n, g / n, b / n];
}

/** Skin-coloured: close in hue (chromaticity) and not wildly brighter or darker than the face. */
function isSkin(r, g, b, skin) {
  const s = r + g + b + 1;
  const t = skin[0] + skin[1] + skin[2] + 1;
  const dr = r / s - skin[0] / t;
  const dg = g / s - skin[1] / t;
  const ratio = s / t;
  return Math.hypot(dr, dg) < 0.03 && ratio > 0.42 && ratio < 1.55;
}

for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.glb'))) {
  const name = file.replace('.glb', '');
  const doc = await io.read(path.join(folder, file));
  const node = doc.getRoot().listNodes().find((n) => n.getMesh() && n.getSkin());
  const joints = node.getSkin().listJoints().map((j) => j.getName());
  const prims = node.getMesh().listPrimitives();
  const body = prims.find((p) => /body/i.test(p.getMaterial()?.getName() ?? ''));
  const headPrim = prims.find((p) => /head/i.test(p.getMaterial()?.getName() ?? ''));
  const colour = await rgba(body.getMaterial().getBaseColorTexture(), SIZE);
  const skin = skinTone(await rgba(headPrim.getMaterial().getBaseColorTexture(), 256));
  const uv = body.getAttribute('TEXCOORD_0');
  const jn = body.getAttribute('JOINTS_0');
  const wt = body.getAttribute('WEIGHTS_0');
  const index = body.getIndices();
  const boneOf = (v) => {
    const j = jn.getElement(v, []);
    const w = wt.getElement(v, []);
    let best = 0;
    for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
    return joints[j[best]] ?? '';
  };
  const upperVertex = (v) => UPPER.test(boneOf(v)) && !NOT_UPPER.test(boneOf(v));
  const neverVertex = (v) => NEVER.test(boneOf(v));
  const inside = new Uint8Array(SIZE * SIZE);
  const never = new Uint8Array(SIZE * SIZE);
  /** Texels on (or within 3 px of) any part of the body: the empty background between pieces is
   * often black, and a dark top must not fill across it into other pieces (shoes, belts). */
  let near = new Uint8Array(SIZE * SIZE);
  for (let t = 0; t < index.getCount(); t += 3) {
    const vs = [index.getScalar(t), index.getScalar(t + 1), index.getScalar(t + 2)];
    raster(vs, near);
    if (vs.filter(upperVertex).length >= 2) raster(vs, inside);
    if (vs.filter(neverVertex).length >= 2) raster(vs, never);
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = near.slice();
    for (let i = SIZE; i < SIZE * (SIZE - 1); i++) if (!near[i] && (near[i - 1] || near[i + 1] || near[i - SIZE] || near[i + SIZE])) next[i] = 1;
    near = next;
  }
  function raster(vs, into) {
    const a = [], b = [], c = [];
    uv.getElement(vs[0], a);
    uv.getElement(vs[1], b);
    uv.getElement(vs[2], c);
    const P = [a, b, c].map(([u, v]) => [u * SIZE, v * SIZE]);
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
    const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
    const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) into[y * SIZE + x] = 1;
      }
  }
  const mask = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (!inside[i] || never[i]) continue;
    if (isSkin(colour[i * 4], colour[i * 4 + 1], colour[i * 4 + 2], skin)) continue;
    mask[i] = 255;
  }
  // Drop specks: blotchy bits of bare skin that are not quite the face's tone (a real garment
  // is a big solid area, so a texel with few masked neighbours in a 7 × 7 window goes).
  {
    const kept = mask.slice();
    for (let y = 3; y < SIZE - 3; y++)
      for (let x = 3; x < SIZE - 3; x++) {
        const i = y * SIZE + x;
        if (!mask[i]) continue;
        let n = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (mask[i + dy * SIZE + dx]) n++;
        if (n < 22) kept[i] = 0;
      }
    mask.set(kept);
  }
  // The top's colour range: chromaticity with dark texels damped (+45), so deep shadow and
  // black fabric all sit near the middle instead of jumping about.
  const feature = (i) => {
    const r = colour[i * 4];
    const g = colour[i * 4 + 1];
    const bl = colour[i * 4 + 2];
    const s = r + g + bl + 45;
    return [r / s, g / s, bl / s];
  };
  const stats = (keep) => {
    const mean = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (!keep(i)) continue;
      const f = feature(i);
      for (let k = 0; k < 3; k++) mean[k] += f[k];
      n++;
    }
    for (let k = 0; k < 3; k++) mean[k] /= Math.max(1, n);
    let spread = 0;
    for (let i = 0; i < SIZE * SIZE; i++) if (keep(i)) spread += distance(feature(i), mean) ** 2;
    return { mean, sigma: Math.sqrt(spread / Math.max(1, n)) };
  };
  const distance = (f, m) => Math.hypot(f[0] - m[0], f[1] - m[1], f[2] - m[2]);
  let { mean, sigma } = stats((i) => mask[i] > 0);
  // Once more without the outliers (a tattoo, a blotch of skin), for a cleaner range.
  ({ mean, sigma } = stats((i) => mask[i] > 0 && distance(feature(i), mean) < 2.5 * sigma));
  const limit = Math.max(0.035, 2.6 * sigma);
  // Skin in the same terms (a blotch nearer the skin than the top is skin).
  const skinFeature = (() => {
    const t = skin[0] + skin[1] + skin[2] + 45;
    return [skin[0] / t, skin[1] / t, skin[2] / t];
  })();
  const like = (i) => {
    if (never[i] || !near[i]) return false;
    const f = feature(i);
    const d = distance(f, mean);
    return d < limit && d < distance(f, skinFeature) && !isSkin(colour[i * 4], colour[i * 4 + 1], colour[i * 4 + 2], skin);
  };
  for (let i = 0; i < SIZE * SIZE; i++) if (mask[i] && !like(i)) mask[i] = 0;
  // Fill out over the connected fabric.
  const queue = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (mask[i]) queue.push(i);
  while (queue.length) {
    const i = queue.pop();
    const x = i % SIZE;
    for (const j of [x > 0 ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE]) {
      if (j < 0 || j >= SIZE * SIZE || mask[j] || !like(j)) continue;
      mask[j] = 255;
      queue.push(j);
    }
  }
  // Separate pieces of the same garment (side panels, a tunic's skirt), which only the texture's
  // padding joined to the rest: whole pieces whose colour on average sits well inside the range.
  {
    const seen = new Uint8Array(SIZE * SIZE);
    for (let start = 0; start < SIZE * SIZE; start++) {
      if (mask[start] || seen[start] || !like(start)) continue;
      const piece = [start];
      seen[start] = 1;
      let sum = 0;
      for (let k = 0; k < piece.length; k++) {
        const i = piece[k];
        sum += distance(feature(i), mean);
        const x = i % SIZE;
        for (const j of [x > 0 ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE]) {
          if (j < 0 || j >= SIZE * SIZE || mask[j] || seen[j] || !like(j)) continue;
          seen[j] = 1;
          piece.push(j);
        }
      }
      if (piece.length >= 300 && sum / piece.length < 0.45 * limit) for (const i of piece) mask[i] = 255;
    }
  }
  // Only big pieces stay (garment panels, sleeves, collars): small islands are blotches of skin
  // or bits of trim elsewhere.
  {
    const seen = new Uint8Array(SIZE * SIZE);
    for (let start = 0; start < SIZE * SIZE; start++) {
      if (!mask[start] || seen[start]) continue;
      const piece = [start];
      seen[start] = 1;
      for (let k = 0; k < piece.length; k++) {
        const i = piece[k];
        const x = i % SIZE;
        for (const j of [x > 0 ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE]) {
          if (j < 0 || j >= SIZE * SIZE || !mask[j] || seen[j]) continue;
          seen[j] = 1;
          piece.push(j);
        }
      }
      if (piece.length < 160) for (const i of piece) mask[i] = 0;
    }
  }
  let lumSum = 0;
  let count = 0;
  const lin = (v) => Math.pow(v / 255, 2.2);
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (!mask[i]) continue;
    lumSum += 0.2126 * lin(colour[i * 4]) + 0.7152 * lin(colour[i * 4 + 1]) + 0.0722 * lin(colour[i * 4 + 2]);
    count++;
  }
  // Widen by 4 px (texture filtering and mipmaps at the seams).
  let grown = mask;
  for (let pass = 0; pass < 4; pass++) {
    const next = grown.slice();
    for (let y = 1; y < SIZE - 1; y++)
      for (let x = 1; x < SIZE - 1; x++) {
        const i = y * SIZE + x;
        if (grown[i]) continue;
        if (grown[i - 1] || grown[i + 1] || grown[i - SIZE] || grown[i + SIZE]) next[i] = 255;
      }
    grown = next;
  }
  const out = path.join(folder, `${name}_top.png`);
  await sharp(Buffer.from(grown), { raw: { width: SIZE, height: SIZE, channels: 1 } }).blur(0.8).png({ compressionLevel: 9 }).toFile(out);
  summary[name] = { meanLum: +(lumSum / Math.max(1, count)).toFixed(4), coverage: +(count / (SIZE * SIZE)).toFixed(3), spread: +sigma.toFixed(3), skin: skin.map(Math.round) };
  console.log(name, summary[name], Math.round(fs.statSync(out).size / 1024), 'KB');
}
fs.writeFileSync(path.join(folder, 'masks.json'), JSON.stringify(summary, null, 2) + '\n');
