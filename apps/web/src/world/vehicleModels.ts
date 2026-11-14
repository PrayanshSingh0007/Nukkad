import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Street models built in code: cars, auto-rickshaw, two-wheeler, bus, food cart, bus stop.
 * Car bodies are cut from a real side silhouette (with wheel arches), extruded across the
 * width with rounded edges, and narrowed above the windows like a real cabin.
 * Every model is ONE geometry with: colour per vertex, and `aPaint` per vertex —
 * 0 matte · 1 car paint (takes the per-copy colour, glossy) · 2 glass/lights (glossy).
 * Models face -z, wheels on y = 0. No files to download.
 */
const MATTE = 0;
const PAINT = 1;
const GLOSS = 2;

type Finish = typeof MATTE | typeof PAINT | typeof GLOSS;

class Parts {
  readonly list: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, hex: number, finish: Finish = MATTE, at: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
    g.translate(...at);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const count = g.getAttribute('position').count;
    const color = new THREE.Color(hex);
    const colors = new Float32Array(count * 3);
    const paint = new Float32Array(count).fill(finish);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aPaint', new THREE.BufferAttribute(paint, 1));
    this.list.push(g);
  }

  box(size: [number, number, number], hex: number, finish: Finish, at: [number, number, number], radius = 0.02, rot: [number, number, number] = [0, 0, 0]): void {
    // Small parts are plain boxes; only bigger ones get rounded edges (triangles matter on phones).
    const geometry =
      radius >= 0.03 && Math.min(...size) > 0.08
        ? new RoundedBoxGeometry(size[0], size[1], size[2], 1, Math.min(radius, Math.min(...size) / 2 - 0.001))
        : new THREE.BoxGeometry(size[0], size[1], size[2]);
    this.add(geometry, hex, finish, at, rot);
  }

  wheel(x: number, z: number, radius: number, width: number): void {
    const side: [number, number, number] = [0, 0, Math.PI / 2];
    this.add(new THREE.CylinderGeometry(radius, radius, width, 14, 1), TYRE, MATTE, [x, radius, z], side);
    this.add(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, width + 0.012, 10, 1), RIM, GLOSS, [x, radius, z], side);
    this.add(new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, width + 0.02, 6, 1), TRIM, MATTE, [x, radius, z], side);
  }

  finish(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.list);
    for (const g of this.list) g.dispose();
    merged.computeBoundingSphere();
    return merged;
  }
}

const TYRE = 0x18191b;
const RIM = 0xb7bcc2;
const TRIM = 0x1f2125;
const GLASS = 0x1c2630;
const HEAD = 0xf4f1e6;
const TAIL = 0xb3121b;
const PLATE = 0xf2f2ea;
const WHITE = 0xffffff;

/**
 * Extrudes a side outline. Outline points are (forward, height) in metres; the result is
 * centred across `width`, rounded at the edges, and points to -z. Vertices higher than
 * `taperFrom` are pulled in towards the middle by `taper` (a narrower cabin).
 */
function sideExtrude(outline: THREE.Shape, width: number, bevel: number, taperFrom = Infinity, taper = 1): THREE.BufferGeometry {
  const depth = Math.max(0.01, width - bevel * 2);
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 5,
  });
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const forward = p.getX(i);
    const height = p.getY(i);
    let across = p.getZ(i) - depth / 2;
    if (height > taperFrom) across *= 1 - (1 - taper) * Math.min(1, (height - taperFrom) / 0.35);
    p.setXYZ(i, across, height, -forward);
  }
  geometry.computeVertexNormals();
  return geometry;
}

interface CarShape {
  length: number;
  width: number;
  wheelRadius: number;
  /** Wheel centres, distance forward from the middle. */
  front: number;
  rear: number;
  /** Outline from the front bumper over the roof to the rear bumper, as (forward, height). */
  top: [number, number][];
  /** The window area: front-bottom corner of the windscreen → roof → bottom of the rear window. */
  windows: [number, number][];
  belt: number;
}

function carBody(spec: CarShape): THREE.Shape {
  const shape = new THREE.Shape();
  const bottom = 0.28;
  const arch = spec.wheelRadius + 0.07;
  const [first] = spec.top;
  shape.moveTo(first[0], bottom);
  for (const [s, h] of spec.top) shape.lineTo(s, h);
  const last = spec.top[spec.top.length - 1];
  shape.lineTo(last[0], bottom);
  // Bottom edge from the back to the front, with an arch over each wheel.
  shape.lineTo(spec.rear - arch, bottom);
  shape.absarc(spec.rear, bottom, arch, Math.PI, 0, true);
  shape.lineTo(spec.front - arch, bottom);
  shape.absarc(spec.front, bottom, arch, Math.PI, 0, true);
  shape.lineTo(first[0], bottom);
  return shape;
}

function polygon(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([s, h], i) => (i === 0 ? shape.moveTo(s, h) : shape.lineTo(s, h)));
  shape.closePath();
  return shape;
}

function car(spec: CarShape): THREE.BufferGeometry {
  const p = new Parts();
  const { width, length } = spec;
  p.add(sideExtrude(carBody(spec), width, 0.07, spec.belt, 0.86), WHITE, PAINT);
  // Side windows sit just proud of the body; windscreen and rear window just proud of the slopes.
  p.add(sideExtrude(polygon(spec.windows), width + 0.04, 0.02, spec.belt, 0.86), GLASS, GLOSS);
  const grown = spec.windows.map(([s, h]): [number, number] => [s * 1.012, spec.belt + (h - spec.belt) * 1.015]);
  p.add(sideExtrude(polygon(grown), width * 0.74, 0.03, spec.belt, 0.92), GLASS, GLOSS);
  // Pillar between the doors.
  const roof = Math.max(...spec.windows.map(([, h]) => h));
  const pillarAt = (spec.windows[0][0] + spec.windows[spec.windows.length - 1][0]) / 2 + 0.1;
  for (const x of [-1, 1]) p.box([0.03, roof - spec.belt - 0.04, 0.09], WHITE, PAINT, [x * (width * 0.43 + 0.012), (roof + spec.belt) / 2, -pillarAt], 0.01);
  const frontZ = -length / 2;
  const rearZ = length / 2;
  const lampY = spec.belt - 0.12;
  for (const x of [-1, 1]) {
    p.box([0.36, 0.11, 0.08], HEAD, GLOSS, [x * width * 0.33, lampY, frontZ + 0.06], 0.03);
    p.box([0.38, 0.1, 0.08], TAIL, GLOSS, [x * width * 0.34, lampY + 0.02, rearZ - 0.06], 0.03);
    p.box([0.07, 0.07, 0.14], WHITE, PAINT, [x * (width / 2 + 0.03), spec.belt + 0.08, -(spec.windows[0][0] - 0.1)], 0.02); // mirror
  }
  p.box([width * 0.5, 0.14, 0.06], TRIM, MATTE, [0, lampY - 0.12, frontZ + 0.04], 0.02); // grille
  p.box([0.5, 0.11, 0.03], PLATE, MATTE, [0, 0.42, frontZ + 0.02], 0.01); // blank plates, no text
  p.box([0.5, 0.11, 0.03], PLATE, MATTE, [0, 0.5, rearZ - 0.02], 0.01);
  p.box([width * 0.96, 0.12, length * 0.55], TRIM, MATTE, [0, 0.3, 0], 0.04); // dark sills between the wheels
  for (const x of [-1, 1]) {
    p.wheel(x * (width / 2 - 0.13), -spec.front, spec.wheelRadius, 0.21);
    p.wheel(x * (width / 2 - 0.13), -spec.rear, spec.wheelRadius, 0.21);
  }
  return p.finish();
}

const HATCHBACK: CarShape = {
  length: 3.8,
  width: 1.66,
  wheelRadius: 0.3,
  front: 1.28,
  rear: -1.22,
  belt: 0.92,
  top: [[1.9, 0.42], [1.92, 0.66], [1.55, 0.86], [0.85, 0.96], [0.25, 1.42], [-1.35, 1.46], [-1.8, 1.18], [-1.9, 0.78], [-1.88, 0.42]],
  windows: [[0.8, 0.98], [0.27, 1.38], [-1.32, 1.42], [-1.72, 1.14], [-1.75, 0.98]],
};

const SEDAN: CarShape = {
  length: 4.5,
  width: 1.76,
  wheelRadius: 0.31,
  front: 1.42,
  rear: -1.38,
  belt: 0.9,
  top: [[2.24, 0.4], [2.26, 0.64], [1.9, 0.82], [1.05, 0.92], [0.35, 1.4], [-0.75, 1.43], [-1.4, 0.98], [-2.1, 0.92], [-2.25, 0.74], [-2.22, 0.4]],
  windows: [[1.0, 0.95], [0.37, 1.36], [-0.73, 1.39], [-1.32, 0.97]],
};

const SUV: CarShape = {
  length: 4.6,
  width: 1.86,
  wheelRadius: 0.36,
  front: 1.45,
  rear: -1.42,
  belt: 1.08,
  top: [[2.28, 0.48], [2.3, 0.86], [1.85, 1.02], [1.15, 1.1], [0.55, 1.68], [-1.85, 1.72], [-2.25, 1.5], [-2.3, 0.86], [-2.27, 0.48]],
  windows: [[1.1, 1.12], [0.57, 1.63], [-1.82, 1.67], [-2.18, 1.42], [-2.2, 1.12]],
};

/**
 * The classic green-and-yellow Bengaluru auto-rickshaw (no operator markings):
 * rounded green tub, yellow canvas roof with black edging, driver's cab with a windscreen,
 * headlamp on the nose, mudguard over the front wheel, passenger bench, rolled side curtains,
 * spare wheel on the back, meter box, mirrors.
 */
function autoRickshaw(): THREE.BufferGeometry {
  const p = new Parts();
  const green = 0x2a8a3a;
  const greenDark = 0x1f6b2c;
  const yellow = 0xf2c230;
  const black = 0x1b1c1e;
  // Lower body: rounded green tub with the nose sloping up to the cab.
  const tub = polygon([[1.42, 0.32], [1.47, 0.62], [1.36, 0.9], [1.12, 1.08], [0.92, 1.1], [0.8, 0.74], [-1.15, 0.72], [-1.28, 0.58], [-1.28, 0.32]]);
  p.add(sideExtrude(tub, 1.34, 0.08), green, PAINT);
  p.box([1.38, 0.08, 2.6], greenDark, MATTE, [0, 0.33, 0.05], 0.03); // skirt line
  p.box([1.38, 0.05, 1.95], 0xe8e2cf, MATTE, [0, 0.74, 0.25], 0.02); // chrome-ish side strip
  // Yellow canvas roof: an arch front to back, black edging, black rear cover with a little window.
  const arch = new THREE.Shape();
  arch.moveTo(-0.72, 0);
  arch.lineTo(-0.72, 0.16);
  arch.quadraticCurveTo(0, 0.48, 0.72, 0.16);
  arch.lineTo(0.72, 0);
  arch.lineTo(0.66, 0);
  arch.lineTo(0.66, 0.13);
  arch.quadraticCurveTo(0, 0.4, -0.66, 0.13);
  arch.lineTo(-0.66, 0);
  arch.closePath();
  p.add(new THREE.ExtrudeGeometry(arch, { depth: 2.1, bevelEnabled: false, curveSegments: 8 }), yellow, MATTE, [0, 1.56, -0.95]);
  p.add(new THREE.ExtrudeGeometry(arch, { depth: 0.08, bevelEnabled: false, curveSegments: 8 }), black, MATTE, [0, 1.555, -0.98]);
  p.add(new THREE.ExtrudeGeometry(arch, { depth: 0.08, bevelEnabled: false, curveSegments: 8 }), black, MATTE, [0, 1.555, 1.1]);
  p.box([1.42, 0.9, 0.05], black, MATTE, [0, 1.15, 1.13], 0.03);
  p.box([0.7, 0.26, 0.02], GLASS, GLOSS, [0, 1.35, 1.16], 0.01);
  // Rolled-up side curtains under the roof edge.
  for (const x of [-0.7, 0.7]) p.add(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8), black, MATTE, [x, 1.58, 0.25], [Math.PI / 2, 0, 0]);
  // Cab: windscreen in a frame, roof posts, wiper.
  p.box([1.08, 0.62, 0.035], GLASS, GLOSS, [0, 1.33, -0.92], 0.02, [0.18, 0, 0]);
  p.box([1.14, 0.05, 0.06], black, MATTE, [0, 1.63, -0.97], 0.02);
  p.box([0.03, 0.4, 0.02], black, MATTE, [0.18, 1.33, -0.955], 0.01, [0.18, 0, 0.5]);
  for (const x of [-0.68, 0.68]) {
    p.add(new THREE.CylinderGeometry(0.024, 0.024, 0.92, 8), black, MATTE, [x, 1.12, -0.9]);
    p.add(new THREE.CylinderGeometry(0.022, 0.022, 0.88, 8), black, MATTE, [x, 1.14, 1.05]);
    // Mirrors on stalks.
    p.add(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6), black, MATTE, [x * 1.08, 1.2, -1.0], [0, 0, x > 0 ? -0.8 : 0.8]);
    p.box([0.1, 0.07, 0.02], GLASS, GLOSS, [x * 1.2, 1.28, -1.0], 0.01);
  }
  // Nose: headlamp, indicators, a black bumper, a blank plate.
  p.add(new THREE.CylinderGeometry(0.09, 0.1, 0.06, 14), HEAD, GLOSS, [0, 0.98, -1.44], [Math.PI / 2, 0, 0]);
  p.add(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 14), RIM, GLOSS, [0, 0.98, -1.42], [Math.PI / 2, 0, 0]);
  for (const x of [-0.2, 0.2]) p.box([0.07, 0.05, 0.04], 0xf2a12a, GLOSS, [x, 0.84, -1.44], 0.01);
  p.box([0.34, 0.12, 0.02], PLATE, MATTE, [0, 0.6, -1.49], 0.01);
  p.box([1.0, 0.07, 0.08], black, MATTE, [0, 0.38, -1.46], 0.02);
  // Front wheel with its mudguard and fork.
  p.add(new THREE.CylinderGeometry(0.29, 0.29, 0.2, 14, 1, true, 0, Math.PI), green, PAINT, [0, 0.26, -1.05], [0, 0, Math.PI / 2]);
  p.add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), RIM, GLOSS, [0.1, 0.5, -1.05]);
  // Inside: driver's seat, handlebar with grips, meter box; passenger bench and backrest.
  p.box([0.5, 0.12, 0.36], 0x2a2a2c, MATTE, [0, 0.88, -0.36], 0.05);
  p.add(new THREE.CylinderGeometry(0.018, 0.018, 0.66, 8), RIM, GLOSS, [0, 1.06, -0.62], [0, 0, Math.PI / 2]);
  for (const x of [-0.34, 0.34]) p.add(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8), black, MATTE, [x, 1.06, -0.62], [0, 0, Math.PI / 2]);
  p.box([0.16, 0.12, 0.08], 0x111214, GLOSS, [0.42, 1.18, -0.8], 0.02); // meter
  p.box([1.24, 0.16, 0.55], 0x23395b, MATTE, [0, 0.82, 0.55], 0.06); // bench (blue rexine)
  p.box([1.24, 0.55, 0.12], 0x23395b, MATTE, [0, 1.08, 0.86], 0.05);
  p.add(new THREE.CylinderGeometry(0.016, 0.016, 1.2, 8), RIM, GLOSS, [0, 1.42, 0.2], [0, 0, Math.PI / 2]); // grab rail
  // Back: tail lamps, the spare wheel, the engine cover underneath.
  for (const x of [-0.52, 0.52]) p.box([0.1, 0.08, 0.04], TAIL, GLOSS, [x, 0.62, 1.31], 0.02);
  p.add(new THREE.CylinderGeometry(0.23, 0.23, 0.12, 14), TYRE, MATTE, [0, 0.78, 1.33], [Math.PI / 2, 0, 0]);
  p.add(new THREE.CylinderGeometry(0.14, 0.14, 0.13, 10), RIM, GLOSS, [0, 0.78, 1.33], [Math.PI / 2, 0, 0]);
  p.box([0.9, 0.22, 0.5], 0x2c2d30, MATTE, [0, 0.3, 0.95], 0.04);
  p.wheel(0, -1.05, 0.23, 0.14);
  p.wheel(-0.62, 0.72, 0.23, 0.14);
  p.wheel(0.62, 0.72, 0.23, 0.14);
  return p.finish();
}

/**
 * A step-through scooter, the most common two-wheeler in Bengaluru: front apron and leg
 * shield, flat floorboard, long padded seat, curved rear body with side panels, headlamp in
 * the handlebar cowl, mirrors, mudguard, grab rail, exhaust, number plates (blank).
 */
function twoWheeler(): THREE.BufferGeometry {
  const p = new Parts();
  const black = 0x1b1c1e;
  // Rear body (paint), side profile: from the floorboard up and back over the rear wheel.
  const rear = polygon([[0.08, 0.36], [0.14, 0.62], [-0.1, 0.78], [-0.62, 0.8], [-0.86, 0.66], [-0.9, 0.5], [-0.7, 0.4], [-0.3, 0.36]]);
  p.add(sideExtrude(rear, 0.38, 0.07), WHITE, PAINT);
  // Front apron and leg shield, rising to the steering column.
  const apron = polygon([[0.34, 0.3], [0.5, 0.36], [0.62, 0.86], [0.56, 0.98], [0.44, 0.96], [0.32, 0.6], [0.24, 0.32]]);
  p.add(sideExtrude(apron, 0.4, 0.06), WHITE, PAINT);
  p.box([0.3, 0.42, 0.04], black, MATTE, [0, 0.62, -0.31], 0.02, [-0.25, 0, 0]); // inner leg shield
  // Floorboard with rubber mat.
  p.box([0.34, 0.05, 0.5], 0x2a2b2e, MATTE, [0, 0.33, -0.08], 0.02);
  // Seat: long, padded, with a lip.
  const seat = polygon([[0.12, 0.8], [0.16, 0.88], [-0.15, 0.93], [-0.66, 0.91], [-0.74, 0.84], [-0.66, 0.8]]);
  p.add(sideExtrude(seat, 0.3, 0.05), 0x232325, MATTE);
  // Handlebar cowl with the headlamp, the bar and grips, mirrors.
  p.box([0.5, 0.12, 0.16], WHITE, PAINT, [0, 1.06, -0.56], 0.05);
  p.box([0.16, 0.08, 0.03], HEAD, GLOSS, [0, 1.06, -0.645], 0.02);
  p.add(new THREE.CylinderGeometry(0.016, 0.016, 0.7, 8), RIM, GLOSS, [0, 1.08, -0.52], [0, 0, Math.PI / 2]);
  for (const x of [-0.32, 0.32]) {
    p.add(new THREE.CylinderGeometry(0.022, 0.022, 0.11, 8), black, MATTE, [x, 1.08, -0.52], [0, 0, Math.PI / 2]);
    p.add(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), black, MATTE, [x * 0.8, 1.2, -0.52], [0, 0, x > 0 ? -0.35 : 0.35]);
    p.box([0.08, 0.06, 0.015], GLASS, GLOSS, [x * 0.92, 1.31, -0.52], 0.01);
    p.box([0.05, 0.03, 0.03], 0xf2a12a, GLOSS, [x * 0.55, 1.03, -0.64], 0.01); // indicators
  }
  // Front: fork, mudguard, plate.
  for (const x of [-0.06, 0.06]) p.add(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), RIM, GLOSS, [x, 0.5, -0.6], [0.2, 0, 0]);
  p.add(new THREE.CylinderGeometry(0.28, 0.28, 0.13, 14, 1, true, Math.PI * 0.15, Math.PI * 0.8), WHITE, PAINT, [0, 0.26, -0.62], [0, 0, Math.PI / 2]);
  p.box([0.16, 0.1, 0.01], PLATE, MATTE, [0, 0.72, -0.6], 0.005);
  // Back: tail lamp, grab rail, plate, exhaust, kickstand.
  p.box([0.18, 0.06, 0.05], TAIL, GLOSS, [0, 0.72, 0.88], 0.02);
  p.box([0.18, 0.1, 0.01], PLATE, MATTE, [0, 0.55, 0.92], 0.005);
  p.add(new THREE.TorusGeometry(0.14, 0.012, 6, 12, Math.PI), black, MATTE, [0, 0.9, 0.6], [Math.PI / 2, 0, 0]);
  p.add(new THREE.CylinderGeometry(0.04, 0.045, 0.42, 10), 0x6b6f75, GLOSS, [0.17, 0.3, 0.42], [Math.PI / 2, 0, 0]);
  p.add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), black, MATTE, [-0.14, 0.14, 0.02], [0, 0, 0.5]);
  p.wheel(0.0, -0.62, 0.24, 0.1);
  p.wheel(0.0, 0.58, 0.24, 0.11);
  return p.finish();
}

/** A city bus in our own colours (no operator logos). */
function bus(): THREE.BufferGeometry {
  const p = new Parts();
  p.box([2.55, 2.75, 11.2], 0xeef1f3, MATTE, [0, 1.8, 0], 0.18);
  p.box([2.57, 0.42, 11.15], 0x2b6cb3, MATTE, [0, 0.95, 0], 0.06);
  p.box([2.58, 0.95, 10.1], GLASS, GLOSS, [0, 2.2, 0.35], 0.05);
  p.box([2.32, 1.35, 0.06], GLASS, GLOSS, [0, 2.05, -5.6], 0.04);
  p.box([1.6, 0.26, 0.06], 0x15171a, GLOSS, [0, 2.95, -5.61], 0.02);
  p.box([2.1, 0.8, 0.06], GLASS, GLOSS, [0, 2.3, 5.6], 0.04);
  for (const z of [-3.95, 1.0]) p.box([0.05, 2.1, 1.1], 0x30343a, MATTE, [1.285, 1.5, z], 0.02);
  for (const x of [-0.95, 0.95]) {
    p.box([0.34, 0.14, 0.06], HEAD, GLOSS, [x, 0.9, -5.62], 0.03);
    p.box([0.26, 0.22, 0.06], TAIL, GLOSS, [x, 1.0, 5.62], 0.03);
  }
  for (const x of [-1.13, 1.13]) {
    p.wheel(x, -3.4, 0.5, 0.3);
    p.wheel(x, 3.0, 0.5, 0.3);
  }
  return p.finish();
}

/** A fruit / street-food cart. Customers stand on the +z side (the game's front). */
function stall(): THREE.BufferGeometry {
  const p = new Parts();
  p.box([1.8, 0.75, 1.0], 0x8a5a32, MATTE, [0, 0.75, 0], 0.04);
  p.box([1.95, 0.06, 1.1], 0xc9ccd0, GLOSS, [0, 1.16, 0], 0.02);
  p.wheel(-0.95, 0, 0.34, 0.08);
  p.wheel(0.95, 0, 0.34, 0.08);
  for (const x of [-0.85, 0.85]) for (const z of [-0.45, 0.45]) p.add(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 6), TRIM, MATTE, [x, 1.7, z]);
  for (let i = 0; i < 5; i++) p.box([0.44, 0.05, 1.5], i % 2 === 0 ? 0xd23c2c : 0xf3e6c8, MATTE, [-0.88 + i * 0.44, 2.24, 0], 0.01);
  const fruit = [0xf08a1c, 0x6aa83a, 0xf2d23b];
  for (let i = 0; i < 12; i++) p.add(new THREE.SphereGeometry(0.075, 6, 4), fruit[i % 3], GLOSS, [-0.75 + (i % 6) * 0.3, 1.26, -0.25 + Math.floor(i / 6) * 0.3]);
  return p.finish();
}

/** A bus shelter whose open side faces +z (towards the road). */
function busStop(): THREE.BufferGeometry {
  const p = new Parts();
  p.box([4.0, 0.1, 1.75], 0x2f6f8f, MATTE, [0, 2.5, -0.05], 0.03, [0.07, 0, 0]);
  p.box([3.9, 1.7, 0.05], GLASS, GLOSS, [0, 1.35, -0.78], 0.02);
  for (const x of [-1.92, 1.92]) {
    p.add(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 10), TRIM, MATTE, [x, 1.25, -0.75]);
    p.add(new THREE.CylinderGeometry(0.04, 0.04, 2.45, 10), TRIM, MATTE, [x, 1.22, 0.7]);
  }
  p.box([2.6, 0.06, 0.38], 0x8a5a32, MATTE, [0, 0.48, -0.45], 0.02);
  for (const x of [-1.1, 1.1]) p.box([0.06, 0.45, 0.32], TRIM, MATTE, [x, 0.24, -0.45], 0.01);
  p.box([0.55, 0.38, 0.05], PLATE, MATTE, [1.92, 2.15, -0.7], 0.01);
  return p.finish();
}

/** The black plastic terrace water tank, on a small steel stand. */
function waterTank(): THREE.BufferGeometry {
  const p = new Parts();
  p.add(new THREE.CylinderGeometry(0.55, 0.6, 1.15, 14, 1), 0x1c1d20, MATTE, [0, 0.95, 0]);
  p.add(new THREE.CylinderGeometry(0.25, 0.3, 0.12, 12, 1), 0x2a2b2e, MATTE, [0, 1.58, 0]);
  for (const r of [0.38, 0.5, 0.62]) p.add(new THREE.TorusGeometry(0.585, 0.02, 4, 16), 0x111214, MATTE, [0, r + 0.25, 0], [Math.PI / 2, 0, 0]);
  p.box([1.3, 0.08, 1.3], 0x6b6f75, MATTE, [0, 0.34, 0]);
  for (const x of [-0.55, 0.55]) for (const z of [-0.55, 0.55]) p.box([0.06, 0.32, 0.06], 0x6b6f75, MATTE, [x, 0.16, z]);
  return p.finish();
}

const BUILDERS: Record<string, () => THREE.BufferGeometry> = {
  water_tank: waterTank,
  hatchback: () => car(HATCHBACK),
  sedan: () => car(SEDAN),
  suv: () => car(SUV),
  auto: autoRickshaw,
  two_wheeler: twoWheeler,
  bus,
  stall,
  bus_stop: busStop,
};

const built = new Map<string, THREE.BufferGeometry>();

/** The geometry for a street model, built once. Null for names we have no builder for. */
export function streetModel(name: string): THREE.BufferGeometry | null {
  const builder = BUILDERS[name];
  if (!builder) return null;
  let geometry = built.get(name);
  if (!geometry) {
    geometry = builder();
    built.set(name, geometry);
  }
  return geometry;
}

/**
 * Car paint that reflects its surroundings. `aPaint`: 0 matte, 1 paint (per-copy colour,
 * glossy), 2 glass and lights (glossy, own colour).
 */
export function createVehicleMaterial(envMap: THREE.Texture | null = null): THREE.MeshStandardMaterial {
  // The reflection picture is a bright studio: keep it gentle or it washes the colours out.
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMap, envMapIntensity: 0.4 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;\nvarying float vPaint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = aPaint;')
      // The per-copy colour only tints "paint" parts (aPaint = 1), not tyres, glass or lamps.
      // (The stock code lives in an #include, so the whole include is replaced.)
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
         #ifdef USE_COLOR
           vColor.rgb *= color;
         #endif
         #ifdef USE_INSTANCING_COLOR
           vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, step(0.5, aPaint) * (1.0 - step(1.5, aPaint)));
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPaint;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPaint > 1.5 ? 0.12 : (vPaint > 0.5 ? 0.28 : 0.75);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPaint > 0.5 && vPaint < 1.5 ? 0.35 : 0.0;');
  };
  material.customProgramCacheKey = () => 'nukkad-vehicle-2';
  return material;
}
