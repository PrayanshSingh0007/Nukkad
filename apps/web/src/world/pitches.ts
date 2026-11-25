import * as THREE from 'three';
import { type TerrainGrid, heightAt } from '@nukkad/worldgen';

/**
 * Sports pitches and courts from the map, drawn properly: the surface (striped turf, a two-tone
 * court), the white lines to the real proportions (scaled to fit), and the kit — goals with
 * nets, basketball hoops on poles, tennis nets, cricket nets — and tall netting round turf
 * pitches and tennis courts, as Bengaluru's school and apartment grounds have. All static: a
 * few merged meshes for the whole area.
 */

export interface PitchData {
  ring: number[];
  sport: string;
  surface: string;
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const WHITE = rgb('#eeeeea');
const POST = rgb('#f4f4f0');
const STEEL = rgb('#5d6266');
const RIM = rgb('#e0601c');

/** Collects triangles (positions, normals, colours) and net panels for one merged mesh each. */
class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly netPos: number[] = [];
  readonly netUv: number[] = [];
  readonly netCol: number[] = [];

  tri(a: number[], b: number[], c: number[], colour: Rgb): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(colour[0], colour[1], colour[2]);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], colour: Rgb): void {
    this.tri(a, b, c, colour);
    this.tri(a, c, d, colour);
  }

  /** A net panel between two points on the ground, `height` tall (u = metres along, v = metres up). */
  net(a: number[], b: number[], y0: number, height: number, colour: Rgb): void {
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const corners = [
      [a[0], y0, a[2], 0, 0],
      [b[0], y0, b[2], length, 0],
      [b[0], y0 + height, b[2], length, height],
      [a[0], y0 + height, a[2], 0, height],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const c = corners[i];
      this.netPos.push(c[0], c[1], c[2]);
      this.netUv.push(c[3] / 0.6, c[4] / 0.6);
      this.netCol.push(colour[0], colour[1], colour[2]);
    }
  }

  /** A sloping or flat net panel through four corners (goal tops and backs). */
  netQuad(p: number[][], colour: Rgb): void {
    const length = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    const height = Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]);
    const uv = [
      [0, 0],
      [length, 0],
      [length, height],
      [0, height],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.netPos.push(p[i][0], p[i][1], p[i][2]);
      this.netUv.push(uv[i][0] / 0.6, uv[i][1] / 0.6);
      this.netCol.push(colour[0], colour[1], colour[2]);
    }
  }
}

/** A pitch's own frame: centre, the long axis (u) and across (v), its length and width, its level. */
interface Frame {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  L: number;
  W: number;
  y: number;
}

function frameOf(ring: number[], terrain: TerrainGrid): Frame | null {
  const n = ring.length / 2;
  if (n < 3) return null;
  let best = 0;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = ring[j * 2] - ring[i * 2];
    const dz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const l = Math.hypot(dx, dz);
    if (l > best) {
      best = l;
      ux = dx / l;
      uz = dz / l;
    }
  }
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = ring[i * 2];
    const z = ring[i * 2 + 1];
    const a = x * ux + z * uz;
    const b = -x * uz + z * ux;
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
    b0 = Math.min(b0, b);
    b1 = Math.max(b1, b);
  }
  let L = a1 - a0;
  let W = b1 - b0;
  const am = (a0 + a1) / 2;
  const bm = (b0 + b1) / 2;
  const cx = am * ux - bm * uz;
  const cz = am * uz + bm * ux;
  if (W > L) {
    [L, W] = [W, L];
    [ux, uz] = [-uz, ux];
  }
  if (L < 6 || W < 4) return null;
  // Level: the highest ground under it, a little above (a pitch is laid flat).
  let y = -Infinity;
  for (const [a, b] of [
    [0, 0],
    [-0.45, -0.45],
    [0.45, -0.45],
    [0.45, 0.45],
    [-0.45, 0.45],
  ]) {
    y = Math.max(y, heightAt(terrain, cx + ux * a * L - uz * b * W, cz + uz * a * L + ux * b * W));
  }
  return { cx, cz, ux, uz, L, W, y: y + 0.09 };
}

/** Draws in a pitch's frame: a = metres along (from the middle), b = across, y up from its level. */
class PitchPainter {
  private readonly f: Frame;
  private readonly out: Builder;
  private readonly lines: Builder;

  constructor(f: Frame, out: Builder, lines: Builder) {
    this.f = f;
    this.out = out;
    this.lines = lines;
  }

  at(a: number, b: number, y = 0): number[] {
    const f = this.f;
    return [f.cx + f.ux * a - f.uz * b, f.y + y, f.cz + f.uz * a + f.ux * b];
  }

  rect(a0: number, b0: number, a1: number, b1: number, colour: Rgb, y = 0, into = this.out): void {
    into.quad(this.at(a0, b0, y), this.at(a0, b1, y), this.at(a1, b1, y), this.at(a1, b0, y), colour);
  }

  /** A painted spot (centre spot, penalty spot). */
  spot(a: number, b: number, r = 0.11): void {
    this.rect(a - r, b - r, a + r, b + r, WHITE, 0.013, this.lines);
  }

  /** A painted line from (a0, b0) to (a1, b1). */
  line(a0: number, b0: number, a1: number, b1: number, width = 0.08): void {
    const da = a1 - a0;
    const db = b1 - b0;
    const l = Math.hypot(da, db) || 1;
    const na = (-db / l) * (width / 2);
    const nb = (da / l) * (width / 2);
    this.lines.quad(this.at(a0 - na, b0 - nb, 0.012), this.at(a0 + na, b0 + nb, 0.012), this.at(a1 + na, b1 + nb, 0.012), this.at(a1 - na, b1 - nb, 0.012), WHITE);
  }

  outline(a0: number, b0: number, a1: number, b1: number): void {
    this.line(a0, b0, a1, b0);
    this.line(a1, b0, a1, b1);
    this.line(a1, b1, a0, b1);
    this.line(a0, b1, a0, b0);
  }

  arc(ca: number, cb: number, r: number, t0: number, t1: number): void {
    const steps = Math.max(6, Math.round((Math.abs(t1 - t0) * r) / 0.6));
    for (let i = 0; i < steps; i++) {
      const s = t0 + ((t1 - t0) * i) / steps;
      const e = t0 + ((t1 - t0) * (i + 1)) / steps;
      this.line(ca + Math.cos(s) * r, cb + Math.sin(s) * r, ca + Math.cos(e) * r, cb + Math.sin(e) * r);
    }
  }

  /** A solid box in the pitch frame. */
  box(a0: number, b0: number, y0: number, a1: number, b1: number, y1: number, colour: Rgb): void {
    const c = [
      this.at(a0, b0, y0),
      this.at(a1, b0, y0),
      this.at(a1, b1, y0),
      this.at(a0, b1, y0),
      this.at(a0, b0, y1),
      this.at(a1, b0, y1),
      this.at(a1, b1, y1),
      this.at(a0, b1, y1),
    ];
    const o = this.out;
    o.quad(c[4], c[5], c[6], c[7], colour);
    o.quad(c[0], c[3], c[2], c[1], colour);
    o.quad(c[0], c[1], c[5], c[4], colour);
    o.quad(c[1], c[2], c[6], c[5], colour);
    o.quad(c[2], c[3], c[7], c[6], colour);
    o.quad(c[3], c[0], c[4], c[7], colour);
  }

  /** Tall netting on posts round the pitch, with a gap for a gate. */
  fence(height: number, colour: Rgb): void {
    const { L, W } = this.f;
    const a = L / 2 + 0.6;
    const b = W / 2 + 0.6;
    const corners: [number, number][] = [
      [-a, -b],
      [a, -b],
      [a, b],
      [-a, b],
    ];
    for (let k = 0; k < 4; k++) {
      const [pa, pb] = corners[k];
      const [qa, qb] = corners[(k + 1) % 4];
      const length = Math.hypot(qa - pa, qb - pb);
      const posts = Math.max(1, Math.round(length / 3));
      for (let i = 0; i < posts; i++) {
        const s0 = i / posts;
        const s1 = (i + 1) / posts;
        // The gate: one bay open in the middle of a long side.
        if (k === 0 && i === Math.floor(posts / 2)) continue;
        const x0 = pa + (qa - pa) * s0;
        const z0 = pb + (qb - pb) * s0;
        this.out_post(x0, z0, height);
        this.outNet(x0, z0, pa + (qa - pa) * s1, pb + (qb - pb) * s1, height, colour);
      }
    }
  }

  private out_post(a: number, b: number, height: number): void {
    this.box(a - 0.04, b - 0.04, 0, a + 0.04, b + 0.04, height, STEEL);
  }

  private outNet(a0: number, b0: number, a1: number, b1: number, height: number, colour: Rgb): void {
    this.out.net(this.at(a0, b0), this.at(a1, b1), this.f.y, height, colour);
  }

  netPanel(p: [number, number, number][], colour: Rgb): void {
    this.out.netQuad(
      p.map(([a, b, y]) => this.at(a, b, y)),
      colour,
    );
  }
}

function soccer(p: PitchPainter, f: Frame, turf: boolean): void {
  const { L, W } = f;
  // Mown (or laid) stripes across the pitch.
  const stripes = Math.max(6, Math.round(L / 5));
  const light = rgb(turf ? '#3a8a46' : '#5c9a40');
  const dark = rgb(turf ? '#307a3c' : '#528d38');
  for (let i = 0; i < stripes; i++) p.rect(-L / 2 + (L * i) / stripes, -W / 2, -L / 2 + (L * (i + 1)) / stripes, W / 2, i % 2 ? light : dark);
  const m = Math.min(1.2, L * 0.03);
  const a = L / 2 - m;
  const b = W / 2 - m;
  p.outline(-a, -b, a, b);
  p.line(0, -b, 0, b);
  const r = Math.min(9.15, W * 0.14);
  p.arc(0, 0, r, 0, Math.PI * 2);
  p.spot(0, 0, 0.12);
  const pd = Math.min(16.5, L * 0.16);
  const pw = Math.min(40.3, W * 0.6) / 2;
  const gd = Math.min(5.5, L * 0.055);
  const gw = Math.min(18.3, W * 0.28) / 2;
  const goal = Math.min(7.32, W * 0.14) / 2;
  const tall = L > 70 ? 2.44 : 2.0;
  for (const s of [-1, 1]) {
    p.line(s * a, -pw, s * (a - pd), -pw);
    p.line(s * (a - pd), -pw, s * (a - pd), pw);
    p.line(s * (a - pd), pw, s * a, pw);
    p.line(s * a, -gw, s * (a - gd), -gw);
    p.line(s * (a - gd), -gw, s * (a - gd), gw);
    p.line(s * (a - gd), gw, s * a, gw);
    const spot = s * (a - Math.min(11, L * 0.105));
    p.spot(spot, 0);
    p.arc(spot, 0, r, s > 0 ? Math.PI - 0.93 : -0.93, s > 0 ? Math.PI + 0.93 : 0.93);
    for (const c of [-1, 1]) p.arc(s * a, c * b, 1, s > 0 ? (c > 0 ? Math.PI : Math.PI / 2) : c > 0 ? -Math.PI / 2 : 0, s > 0 ? (c > 0 ? Math.PI * 1.5 : Math.PI) : c > 0 ? 0 : Math.PI / 2);
    // The goal: white posts and bar, a frame running back, and the net.
    const back = s * (a + 1.4);
    p.box(s * a - 0.06, -goal - 0.12, 0, s * a + 0.06, -goal, tall, POST);
    p.box(s * a - 0.06, goal, 0, s * a + 0.06, goal + 0.12, tall, POST);
    p.box(s * a - 0.06, -goal - 0.12, tall, s * a + 0.06, goal + 0.12, tall + 0.12, POST);
    p.box(back - 0.03, -goal - 0.05, 0, back + 0.03, -goal + 0.01, tall * 0.6, STEEL);
    p.box(back - 0.03, goal - 0.01, 0, back + 0.03, goal + 0.05, tall * 0.6, STEEL);
    const netWhite = rgb('#f2f2ee');
    p.netPanel(
      [
        [back, -goal, 0],
        [back, goal, 0],
        [back, goal, tall * 0.6],
        [back, -goal, tall * 0.6],
      ],
      netWhite,
    );
    p.netPanel(
      [
        [s * a, -goal, tall],
        [s * a, goal, tall],
        [back, goal, tall * 0.6],
        [back, -goal, tall * 0.6],
      ],
      netWhite,
    );
    for (const c of [-1, 1])
      p.netPanel(
        [
          [s * a, c * goal, 0],
          [back, c * goal, 0],
          [back, c * goal, tall * 0.6],
          [s * a, c * goal, tall],
        ],
        netWhite,
      );
  }
}

function basketball(p: PitchPainter, f: Frame): void {
  const { L, W } = f;
  const s = Math.min((L - 2) / 28, (W - 2) / 15, 1);
  const a = 14 * s;
  const b = 7.5 * s;
  p.rect(-L / 2, -W / 2, L / 2, W / 2, rgb('#a3442f'));
  p.rect(-a, -b, a, b, rgb('#3e7d58'), 0.004);
  p.outline(-a, -b, a, b);
  p.line(0, -b, 0, b);
  p.arc(0, 0, 1.8 * s, 0, Math.PI * 2);
  for (const e of [-1, 1]) {
    const keyD = 5.8 * s;
    const keyW = 2.45 * s;
    p.rect(e * a, -keyW, e * (a - keyD), keyW, rgb('#a3442f'), 0.006);
    p.line(e * a, -keyW, e * (a - keyD), -keyW);
    p.line(e * (a - keyD), -keyW, e * (a - keyD), keyW);
    p.line(e * (a - keyD), keyW, e * a, keyW);
    p.arc(e * (a - keyD), 0, 1.8 * s, e > 0 ? Math.PI / 2 : -Math.PI / 2, e > 0 ? Math.PI * 1.5 : Math.PI / 2);
    // The three-point line: straight by the sidelines, then the arc round the basket.
    const hoop = e * (a - 1.575 * s);
    const r3 = 6.75 * s;
    const side = Math.min(6.6 * s, b - 0.3);
    const t = Math.asin(Math.min(1, side / r3));
    const straight = Math.cos(t) * r3;
    p.line(e * a, -side, hoop - e * straight, -side);
    p.line(e * a, side, hoop - e * straight, side);
    p.arc(hoop, 0, r3, e > 0 ? Math.PI - t : -t, e > 0 ? Math.PI + t : t);
    // The hoop: a pole behind the baseline, an arm, a white backboard with a square, the rim.
    const pole = e * (a + 0.9);
    p.box(pole - 0.08, -0.08, 0, pole + 0.08, 0.08, 3.55, STEEL);
    p.box(pole, -0.06, 3.35, e * (a - 1.1), 0.06, 3.47, STEEL);
    const board = e * (a - 1.2);
    p.box(board - 0.03, -0.9, 2.9, board + 0.03, 0.9, 3.95, POST);
    p.box(board - 0.035 * e - 0.005, -0.3, 3.05, board - 0.035 * e + 0.005, 0.3, 3.5, rgb('#d14a2a'));
    const rimC = e * (a - 1.575 * s);
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const ra = rimC + Math.cos(ang) * 0.225;
      const rb = Math.sin(ang) * 0.225;
      p.box(ra - 0.04, rb - 0.04, 3.03, ra + 0.04, rb + 0.04, 3.07, RIM);
    }
  }
}

function tennis(p: PitchPainter, f: Frame): void {
  const { L, W } = f;
  const s = Math.min((L - 2) / 23.77, (W - 2) / 10.97, 1);
  const a = (23.77 / 2) * s;
  const b = (10.97 / 2) * s;
  const sb = (8.23 / 2) * s;
  p.rect(-L / 2, -W / 2, L / 2, W / 2, rgb('#3c7a4e'));
  p.rect(-a, -b, a, b, rgb('#2f6a8a'), 0.004);
  p.outline(-a, -b, a, b);
  p.line(-a, -sb, a, -sb);
  p.line(-a, sb, a, sb);
  const service = 6.4 * s;
  p.line(-service, -sb, -service, sb);
  p.line(service, -sb, service, sb);
  p.line(-service, 0, service, 0);
  p.line(-a, 0, -a + 0.2, 0);
  p.line(a, 0, a - 0.2, 0);
  // The net on its posts, with the white band along the top.
  const post = b + 0.9;
  p.box(-0.05, -post - 0.05, 0, 0.05, -post + 0.05, 1.07, STEEL);
  p.box(-0.05, post - 0.05, 0, 0.05, post + 0.05, 1.07, STEEL);
  p.box(-0.02, -post, 0.86, 0.02, post, 0.92, POST);
  p.netPanel(
    [
      [0, -post, 0.02],
      [0, post, 0.02],
      [0, post, 0.88],
      [0, -post, 0.88],
    ],
    rgb('#1d1f22'),
  );
}

function cricketNets(p: PitchPainter, f: Frame): void {
  const { L, W } = f;
  p.rect(-L / 2, -W / 2, L / 2, W / 2, rgb('#9c8a6a'));
  const lanes = Math.max(1, Math.floor(W / 3.2));
  for (let i = 0; i < lanes; i++) {
    const b0 = -W / 2 + (W * i) / lanes;
    const b1 = -W / 2 + (W * (i + 1)) / lanes;
    p.rect(-L / 2 + 1, b0 + 0.5, L / 2 - 0.5, b1 - 0.5, rgb('#3f8a4a'), 0.004);
    p.line(-L / 2 + 3, b0 + 0.5, -L / 2 + 3, b1 - 0.5);
    p.box(L / 2 - 1.2, (b0 + b1) / 2 - 0.12, 0, L / 2 - 1.15, (b0 + b1) / 2 + 0.12, 0.71, POST); // stumps
  }
  p.fence(3.2, rgb('#1f3a2a'));
}

function track(p: PitchPainter, f: Frame): void {
  const { L, W } = f;
  p.rect(-L / 2, -W / 2, L / 2, W / 2, rgb('#a8452e'));
  const lanes = Math.max(2, Math.min(8, Math.floor(W / 1.22)));
  for (let i = 0; i <= lanes; i++) {
    const b = -W / 2 + (W * i) / lanes;
    p.line(-L / 2, b, L / 2, b, 0.05);
  }
  p.line(L / 2 - 3, -W / 2, L / 2 - 3, W / 2, 0.08);
}

/** A plain court or ground for any other game (or none named): a hard surface with a border line. */
function plain(p: PitchPainter, f: Frame, surface: string): void {
  const { L, W } = f;
  const grassy = surface === 'grass' || surface === '';
  p.rect(-L / 2, -W / 2, L / 2, W / 2, rgb(grassy ? '#5c9a40' : surface === 'dirt' || surface === 'ground' || surface === 'sand' ? '#a0825a' : '#8a8f8c'));
  if (!grassy) p.outline(-L / 2 + 0.6, -W / 2 + 0.6, L / 2 - 0.6, W / 2 - 0.6);
}

function netTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.clearRect(0, 0, 64, 64);
  c.strokeStyle = 'rgba(255,255,255,1)';
  c.lineWidth = 1.5;
  for (let i = 0; i <= 64; i += 8) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i, 64);
    c.stroke();
    c.beginPath();
    c.moveTo(0, i);
    c.lineTo(64, i);
    c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export class Pitches {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(pitches: PitchData[], terrain: TerrainGrid) {
    const solid = new Builder();
    const lines = new Builder();
    for (const pitch of pitches) {
      const f = frameOf(pitch.ring, terrain);
      if (!f) continue;
      const p = new PitchPainter(f, solid, lines);
      const sport = pitch.sport;
      const surface = pitch.surface;
      if (sport === 'soccer' || sport === 'football' || ((sport === 'multi' || sport === '') && f.L > 40 && f.W > 25)) {
        soccer(p, f, surface === 'artificial_turf');
        if (surface === 'artificial_turf') p.fence(Math.min(6, 3 + f.L * 0.04), rgb('#1f3a2a'));
      } else if (sport === 'basketball') basketball(p, f);
      else if (sport === 'tennis' || sport === 'badminton') {
        tennis(p, f);
        p.fence(3.5, rgb('#1f3a2a'));
      } else if (sport === 'cricket_nets') cricketNets(p, f);
      else if (sport === 'running' || sport === 'athletics') track(p, f);
      else plain(p, f, surface);
    }
    const mesh = (b: Builder, material: THREE.Material): THREE.Mesh | null => {
      if (b.pos.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      this.disposables.push(g, material);
      return m;
    };
    const surfaces = mesh(solid, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    if (surfaces) {
      surfaces.receiveShadow = true;
      surfaces.castShadow = true;
      this.group.add(surfaces);
    }
    const painted = mesh(lines, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    if (painted) {
      painted.receiveShadow = true;
      this.group.add(painted);
    }
    if (solid.netPos.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(solid.netPos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(solid.netUv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(solid.netCol, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const texture = netTexture();
      // See-through: the strands are opaque, the holes clear; far off it fades to a light haze.
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: texture, transparent: true, depthWrite: false, alphaTest: 0.02, side: THREE.DoubleSide });
      const nets = new THREE.Mesh(g, material);
      nets.castShadow = true;
      this.group.add(nets);
      this.disposables.push(g, material, texture);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
