import * as THREE from 'three';

/**
 * Birds over the city by day, the ones you see in Bengaluru:
 * - black kites (wings about 1.5 m) circling high on warm air, 35–80 m up, banked into the turn,
 *   gliding with a lazy flap now and then — a few thermals in every ~260 m of city;
 * - flocks of pigeons and of crows sweeping round in loops lower down (12–30 m), flapping fast,
 *   gliding together now and then.
 * They thin out at dusk (roosting) and in rain, and are gone at night. One draw call; the wings
 * flap on the graphics card. Thermals are seeded by place, so everyone sees the same kites in the
 * same spots; the flocks loop around a point that slowly follows you.
 */
const CELL_M = 260;
/** Flocks loop around a point that trails after you at walking pace (so they pass overhead and never jump). */
const FLOCK_FOLLOW_MS = 2.5;
const KITES_PER_CELL = 2;
const FLOCKS = 3;
const FLOCK_SIZE = 12;
const CAPACITY = 9 * KITES_PER_CELL * 3 + FLOCKS * FLOCK_SIZE;

type Kind = 'kite' | 'pigeon' | 'crow';
const LOOK: Record<Kind, { colour: number; span: number; rate: number }> = {
  kite: { colour: 0x3b2c22, span: 1.0, rate: 5 },
  pigeon: { colour: 0x6f737b, span: 0.42, rate: 44 },
  crow: { colour: 0x17181b, span: 0.6, rate: 30 },
};

const hash = (a: number, b: number, salt: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A bird 1.56 m from wingtip to wingtip, facing −z, wings in two parts (inner, outer) that flap. */
function birdGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const spans: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    for (const p of [a, b, c]) {
      positions.push(p[0], p[1], p[2]);
      spans.push(Math.min(1, Math.abs(p[0]) / 0.78));
    }
  };
  // Body and tail.
  tri([0, 0, -0.36], [-0.06, 0, 0.05], [0.06, 0, 0.05]);
  tri([-0.06, 0, 0.05], [0, 0, 0.34], [0.06, 0, 0.05]);
  tri([0, 0, 0.26], [-0.11, 0, 0.42], [0.11, 0, 0.42]);
  for (const side of [-1, 1]) {
    const rootFront = [side * 0.05, 0, -0.13];
    const rootBack = [side * 0.05, 0, 0.12];
    const elbowFront = [side * 0.4, 0, -0.07];
    const elbowBack = [side * 0.4, 0, 0.13];
    const tip = [side * 0.78, 0, 0.1];
    tri(rootFront, rootBack, elbowFront);
    tri(elbowFront, rootBack, elbowBack);
    tri(elbowFront, elbowBack, tip);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSpan', new THREE.Float32BufferAttribute(spans, 1));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geometry;
}

interface Bird {
  kind: Kind;
  /** 0–1: shows while it is below the birds' presence (fewer at dusk and in rain). */
  keen: number;
  phase: number;
}

export class BirdsView {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly flap: THREE.InstancedBufferAttribute;
  private readonly time = { value: 0 };
  private presence = 1;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  /** Ground height near the player (eased), so birds stay above the city wherever it is. */
  private ground: number | null = null;
  private readonly flockCentre = { x: 0, z: 0, set: false };
  private lastSeconds = 0;

  constructor() {
    this.material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, fog: true });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          attribute float aSpan;
          attribute vec3 aFlap; // phase, rate (rad/s), amplitude`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float nkBeat = sin(uTime * aFlap.y + aFlap.x) * aFlap.z;
          // The outer wing lags and swings further; wings rest in a shallow V.
          transformed.y += aSpan * 0.1 + nkBeat * (aSpan * 0.45 + aSpan * aSpan * 0.35);
          transformed.z += nkBeat * aSpan * 0.06;`,
        );
    };
    this.material.customProgramCacheKey = () => 'nukkad-birds-1';
    const geometry = birdGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFlap', this.flap);
    this.mesh = new THREE.InstancedMesh(geometry, this.material, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    // Small and against the sky: the ambient-occlusion pass hides lines (and Line2 meshes)
    // while it draws the scene's shapes, so flagging the birds like one keeps dark rims off them.
    (this.mesh as unknown as { isLine2: boolean }).isLine2 = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  }

  /** 0 = day … 1 = night, rain 0 … 1. */
  setWorld(night: number, rain: number): void {
    const day = 1 - THREE.MathUtils.smoothstep(night, 0.15, 0.7);
    this.presence = day * (1 - 0.85 * rain);
  }

  setGround(y: number): void {
    this.ground = this.ground === null ? y : this.ground + (y - this.ground) * 0.02;
  }

  /** seconds: the room's shared clock, so everyone's birds are in the same places. */
  update(seconds: number, px: number, pz: number): void {
    this.time.value = seconds % 10000;
    this.mesh.visible = this.presence > 0.02 && this.ground !== null;
    if (this.ground === null || !this.mesh.visible) return;
    const ground = this.ground;
    let n = 0;
    const flap = this.flap.array as Float32Array;
    const place = (bird: Bird, x: number, y: number, z: number, heading: number, bank: number, pitch: number, beat: number): void => {
      if (n >= CAPACITY || bird.keen > this.presence) return;
      const look = LOOK[bird.kind];
      this.position.set(x, y, z);
      this.euler.set(pitch, heading, bank);
      this.rotation.setFromEuler(this.euler);
      this.scale.setScalar(look.span);
      this.mesh.setMatrixAt(n, this.matrix.compose(this.position, this.rotation, this.scale));
      this.mesh.setColorAt(n, this.colour.setHex(look.colour));
      flap[n * 3] = bird.phase;
      flap[n * 3 + 1] = look.rate;
      flap[n * 3 + 2] = beat;
      n++;
    };

    // Kites over the thermals in the 3 × 3 cells around the player.
    const cx = Math.floor(px / CELL_M);
    const cz = Math.floor(pz / CELL_M);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++)
        for (let k = 0; k < KITES_PER_CELL; k++) {
          const thermalX = (gx + 0.15 + 0.7 * hash(gx, gz, k * 2 + 1)) * CELL_M;
          const thermalZ = (gz + 0.15 + 0.7 * hash(gx, gz, k * 2 + 2)) * CELL_M;
          const birds = 1 + Math.floor(hash(gx, gz, k + 9) * 3);
          for (let b = 0; b < birds; b++) {
            const seed = hash(gx * 7 + b, gz * 13 + k, 5);
            const radius = 18 + 30 * hash(gx, gz + b, k + 21);
            const dir = seed < 0.5 ? -1 : 1;
            const speed = 8 + 3 * hash(gx + b, gz, k + 31);
            const angle = seed * 40 + (dir * seconds * speed) / radius;
            const height = 36 + 40 * hash(gx, gz, b * 5 + k + 41) + Math.sin(seconds * 0.04 + seed * 30) * 6;
            const x = thermalX + Math.cos(angle) * radius;
            const z = thermalZ + Math.sin(angle) * radius;
            // Heading along the circle (the model faces −z: heading 0 looks along −z).
            const vx = -Math.sin(angle) * dir;
            const vz = Math.cos(angle) * dir;
            const heading = Math.atan2(-vx, -vz);
            // Mostly gliding; now and then a few slow beats.
            const beat = Math.sin(seconds * 0.35 + seed * 60) > 0.82 ? 0.55 : 0.04;
            place({ kind: 'kite', keen: hash(gx, gz, b + k * 3 + 51) * 0.95, phase: seed * 20 }, x, ground + height, z, heading, dir * -0.38, 0, beat);
          }
        }

    // Flocks of pigeons and crows sweeping loops near the player (centres seeded by cell).
    const step = Math.min(0.2, Math.max(0, seconds - this.lastSeconds));
    this.lastSeconds = seconds;
    const centre = this.flockCentre;
    if (!centre.set) Object.assign(centre, { x: px, z: pz, set: true });
    const away = Math.hypot(px - centre.x, pz - centre.z);
    if (away > 400) Object.assign(centre, { x: px, z: pz }); // travelled somewhere new
    else if (away > 1) {
      const move = Math.min(away, FLOCK_FOLLOW_MS * step) / away;
      centre.x += (px - centre.x) * move;
      centre.z += (pz - centre.z) * move;
    }
    for (let f = 0; f < FLOCKS; f++) {
      const kind: Kind = f === 1 ? 'crow' : 'pigeon';
      const fx = centre.x + (hash(f, 1, 61) - 0.5) * 120;
      const fz = centre.z + (hash(f, 2, 71) - 0.5) * 120;
      const radius = 35 + 40 * hash(f, 3, 81);
      const speed = kind === 'crow' ? 10 : 14;
      const t = (seconds * speed) / radius + f * 2.1;
      // A wobbly loop (figure-ish), rising and dipping.
      const lx = fx + Math.cos(t) * radius;
      const lz = fz + Math.sin(t * 2) * radius * 0.45;
      const dx = -Math.sin(t) * radius;
      const dz = Math.cos(t * 2) * radius * 0.9;
      const heading = Math.atan2(-dx, -dz);
      const height = 14 + 10 * hash(f, 4, 91) + Math.sin(t * 1.3) * 4;
      const gliding = Math.sin(seconds * 0.5 + f * 3) > 0.55;
      const turn = Math.sin(t * 2) * 0.35;
      for (let b = 0; b < FLOCK_SIZE; b++) {
        const side = (hash(f, b, 101) - 0.5) * 9;
        const back = hash(f, b, 111) * 10;
        const up = (hash(f, b, 121) - 0.5) * 3 + Math.sin(seconds * 1.7 + b) * 0.4;
        const ch = Math.cos(heading);
        const sh = Math.sin(heading);
        // Back is +z in the bird's frame, side is +x.
        const x = lx + ch * side + sh * back;
        const z = lz - sh * side + ch * back;
        place({ kind, keen: hash(f, b, 131) * 0.9, phase: b * 1.7 + f }, x, ground + height + up, z, heading, turn, 0, gliding ? 0.06 : 0.75);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.flap.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
