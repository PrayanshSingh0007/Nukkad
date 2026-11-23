import * as THREE from 'three';

/**
 * Birds sitting on the overhead cables — crows, pigeons and mynas, as on any Bengaluru street —
 * that take off when you come close (or rush past, or honk): a flurry of beating wings up and
 * away, and about a minute later, once you have moved on, they are back on the wire.
 * Only perches within 70 m are drawn (two draw calls: sitting, flying).
 */
const NEAR_M = 70;
const FLY_S = 4;
const AWAY_S = 60;

type Kind = 0 | 1 | 2; // crow, pigeon, myna
const KIND_COLOUR = [0x16171a, 0x6d7179, 0x4a3524];
const KIND_SIZE = [1.55, 1.2, 0.95];

/** A sitting bird about 0.27 m long at size 1, facing −z, feet at the origin. */
function sittingGeometry(): THREE.BufferGeometry {
  const p: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    p.push(...a, ...b, ...c);
  };
  // Body: an elongated diamond.
  const f = [0, 0.075, -0.12];
  const bk = [0, 0.045, 0.1];
  const t = [0, 0.105, -0.02];
  const bo = [0, 0.015, -0.01];
  const l = [-0.036, 0.06, -0.015];
  const r = [0.036, 0.06, -0.015];
  for (const [a, b] of [[t, l], [l, bo], [bo, r], [r, t]] as const) {
    tri(f, a, b);
    tri(bk, b, a);
  }
  // Head.
  const h = [0, 0.125, -0.115];
  const hs = 0.026;
  const hp = [[h[0], h[1] + hs, h[2]], [h[0] - hs, h[1], h[2]], [h[0], h[1] - hs, h[2]], [h[0] + hs, h[1], h[2]]];
  const hf = [h[0], h[1], h[2] - hs * 1.6];
  const hb = [h[0], h[1], h[2] + hs];
  for (let k = 0; k < 4; k++) {
    tri(hf, hp[k], hp[(k + 1) % 4]);
    tri(hb, hp[(k + 1) % 4], hp[k]);
  }
  // Tail, both faces (it is seen from below), and a beak.
  tri([0, 0.055, 0.07], [-0.028, 0.025, 0.25], [0.028, 0.025, 0.25]);
  tri([0, 0.055, 0.07], [0.028, 0.025, 0.25], [-0.028, 0.025, 0.25]);
  tri([0, 0.13, -0.135], [-0.008, 0.12, -0.135], [0, 0.122, -0.175]);
  tri([0, 0.13, -0.135], [0, 0.122, -0.175], [0.008, 0.12, -0.135]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** A flying bird with open wings (tips flap in the shader), 0.5 m across at size 1. */
function flyingGeometry(): THREE.BufferGeometry {
  const p: number[] = [];
  const span: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    for (const v of [a, b, c]) {
      p.push(...v);
      span.push(Math.min(1, Math.abs(v[0]) / 0.25));
    }
  };
  tri([0, 0, -0.12], [-0.03, 0, 0.06], [0.03, 0, 0.06]);
  tri([0, 0, 0.04], [-0.04, 0, 0.16], [0.04, 0, 0.16]);
  for (const s of [-1, 1]) {
    tri([s * 0.02, 0, -0.05], [s * 0.02, 0, 0.05], [s * 0.25, 0, 0.03]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(p.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

export class PerchedBirds {
  readonly group = new THREE.Group();
  private readonly sitting: THREE.InstancedMesh;
  private readonly flying: THREE.InstancedMesh;
  private readonly time = { value: 0 };
  /** Per perch: x, y, z, heading. */
  private readonly perches: Float32Array;
  private readonly kinds: Uint8Array;
  /** Per perch: 0 sitting, > 0 seconds into its flight, < 0 seconds until it may come back. */
  private readonly state: Float32Array;
  /** Where each flight goes: x, z direction. */
  private readonly flee: Float32Array;
  private near: number[] = [];
  private searchIn = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly at = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly size = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private visible = 1;

  constructor(perches: Float32Array) {
    this.perches = perches;
    const count = perches.length / 4;
    this.kinds = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const h = Math.sin(perches[i * 4] * 3.7 + perches[i * 4 + 2] * 1.3) * 43758.5453;
      const r = h - Math.floor(h);
      this.kinds[i] = (r < 0.45 ? 0 : r < 0.8 ? 1 : 2) as Kind;
    }
    this.state = new Float32Array(count);
    this.flee = new Float32Array(count * 2);
    const capacity = 220;
    this.sitting = new THREE.InstancedMesh(sittingGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff }), capacity);
    const flyMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    flyMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSpan;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float pbBeat = sin(uTime * 26.0 + instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7);
          transformed.y += aSpan * pbBeat * 0.14 + aSpan * 0.02;`,
        );
    };
    flyMaterial.customProgramCacheKey = () => 'nukkad-perched-birds-fly-1';
    this.flying = new THREE.InstancedMesh(flyingGeometry(), flyMaterial, 60);
    for (const mesh of [this.sitting, this.flying]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      // Small and up against the sky: the ambient-occlusion pass hides lines (and Line2 meshes)
      // while it draws shapes; flagging the birds like one keeps dark rims off them.
      (mesh as unknown as { isLine2: boolean }).isLine2 = true;
      this.group.add(mesh);
    }
  }

  /** Birds sit out heavy rain and go to roost at night. */
  setWorld(night: number, rain: number): void {
    this.visible = (1 - THREE.MathUtils.smoothstep(night, 0.4, 0.8)) * (1 - THREE.MathUtils.smoothstep(rain, 0.4, 0.8));
  }

  /** (x, z) = you; scare = how close you may come before they fly (metres; more for traffic and horns). */
  /** Returns how many birds took off this frame (for the sound of wings). */
  update(dt: number, x: number, z: number, scare: number): number {
    this.time.value = (this.time.value + dt) % 1000;
    this.group.visible = this.visible > 0.05;
    if (!this.group.visible) return 0;
    let tookOff = 0;
    this.searchIn -= dt;
    if (this.searchIn <= 0) {
      this.searchIn = 0.5;
      this.near = [];
      for (let i = 0; i < this.perches.length / 4; i++) {
        if (Math.hypot(this.perches[i * 4] - x, this.perches[i * 4 + 2] - z) < NEAR_M) this.near.push(i);
      }
    }
    let sitting = 0;
    let flying = 0;
    for (const i of this.near) {
      const px = this.perches[i * 4];
      const py = this.perches[i * 4 + 1];
      const pz = this.perches[i * 4 + 2];
      const d = Math.hypot(px - x, pz - z);
      const kind = this.kinds[i];
      // Seeded share sitting out the weather or the evening.
      const keen = ((i * 2654435761) >>> 0) / 4294967296;
      if (keen > this.visible) continue;
      let s = this.state[i];
      if (s === 0 && d < scare * (0.8 + 0.4 * keen)) {
        // Off it goes, away from you and a little to one side.
        s = 0.0001;
        if (d < 30) tookOff++;
        const ax = (px - x) / (d || 1);
        const az = (pz - z) / (d || 1);
        const veer = (keen - 0.5) * 1.2;
        this.flee[i * 2] = ax * Math.cos(veer) - az * Math.sin(veer);
        this.flee[i * 2 + 1] = ax * Math.sin(veer) + az * Math.cos(veer);
      } else if (s > 0) {
        s += dt;
        if (s > FLY_S) s = -AWAY_S;
      } else if (s < 0) {
        s += dt;
        if (s >= 0) s = d > 25 ? 0 : -5; // back only once you are not right there
      }
      this.state[i] = s;
      this.colour.setHex(KIND_COLOUR[kind]);
      const scale = KIND_SIZE[kind];
      if (s === 0 && sitting < this.sitting.instanceMatrix.count) {
        this.turn.setFromAxisAngle(UP, this.perches[i * 4 + 3]);
        this.sitting.setMatrixAt(sitting, this.matrix.compose(this.at.set(px, py, pz), this.turn, this.size.setScalar(scale)));
        this.sitting.setColorAt(sitting, this.colour);
        sitting++;
      } else if (s > 0 && flying < this.flying.instanceMatrix.count) {
        const fx = this.flee[i * 2];
        const fz = this.flee[i * 2 + 1];
        const run = s * 7 + s * s * 0.6;
        this.at.set(px + fx * run, py + s * 2.6 + s * s * 0.4, pz + fz * run);
        this.turn.setFromEuler(EULER.set(-0.35, Math.atan2(-fx, -fz), Math.sin(s * 3 + i) * 0.25, 'YXZ'));
        this.flying.setMatrixAt(flying, this.matrix.compose(this.at, this.turn, this.size.setScalar(scale * 1.15)));
        this.flying.setColorAt(flying, this.colour);
        flying++;
      }
    }
    this.sitting.count = sitting;
    this.flying.count = flying;
    for (const mesh of [this.sitting, this.flying]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return tookOff;
  }

  dispose(): void {
    for (const mesh of [this.sitting, this.flying]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const EULER = new THREE.Euler();
