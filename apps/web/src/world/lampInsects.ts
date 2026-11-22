import * as THREE from 'three';

/**
 * Insects round the street lamps at night: tiny moths circling and darting just under each of
 * the nearest lamp heads, catching the lamp's warm light. Not in rain (they shelter). One draw
 * call of points (the ambient-occlusion pass skips points).
 */
const LAMPS = 6;
const PER_LAMP = 36;
const COUNT = LAMPS * PER_LAMP;
const NEAR_M = 45;

export class LampInsects {
  readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;
  /** Lamp heads: x, y, z per lamp. */
  private readonly heads: Float32Array;
  private readonly position = new Float32Array(COUNT * 3);
  /** Per insect: orbit radius, speed (rad/s, signed), phase, height offset. */
  private readonly seeds = new Float32Array(COUNT * 4);
  private readonly nearest: number[] = [];
  private time = 0;
  private level = 0;
  private searchIn = 0;

  constructor(heads: Float32Array) {
    this.heads = heads;
    for (let i = 0; i < COUNT; i++) {
      this.seeds.set([0.25 + Math.random() * 0.75, (Math.random() < 0.5 ? -1 : 1) * (1.8 + Math.random() * 3.5), Math.random() * 6.283, -0.15 - Math.random() * 0.7], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    // A soft round speck (points are square otherwise).
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 16, 16);
    this.material = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(canvas), color: new THREE.Color(2.4, 1.9, 1.25), size: 0.032, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** night 0–1, rain 0–1. */
  setLevel(night: number, rain: number): void {
    this.level = THREE.MathUtils.smoothstep(night, 0.5, 0.9) * (1 - THREE.MathUtils.smoothstep(rain, 0.05, 0.3));
  }

  update(dt: number, x: number, z: number): void {
    this.points.visible = this.level > 0.02;
    if (!this.points.visible) return;
    this.time = (this.time + dt) % 10000;
    // Which lamps are nearest (looked up twice a second).
    this.searchIn -= dt;
    if (this.searchIn <= 0) {
      this.searchIn = 0.5;
      const found: { i: number; d: number }[] = [];
      for (let i = 0; i < this.heads.length / 3; i++) {
        const d = Math.hypot(this.heads[i * 3] - x, this.heads[i * 3 + 2] - z);
        if (d < NEAR_M) found.push({ i, d });
      }
      found.sort((a, b) => a.d - b.d);
      this.nearest.length = 0;
      for (const f of found.slice(0, LAMPS)) this.nearest.push(f.i);
    }
    const shown = Math.round(PER_LAMP * this.level);
    let n = 0;
    const t = this.time;
    this.nearest.forEach((lamp) => {
      const hx = this.heads[lamp * 3];
      const hy = this.heads[lamp * 3 + 1];
      const hz = this.heads[lamp * 3 + 2];
      for (let k = 0; k < shown; k++) {
        const s = (lamp * 7 + k) % COUNT;
        const radius = this.seeds[s * 4];
        const speed = this.seeds[s * 4 + 1];
        const phase = this.seeds[s * 4 + 2];
        const below = this.seeds[s * 4 + 3];
        // Circling, with sudden darts in and out and a bob up and down.
        const a = phase + t * speed;
        const r = radius * (0.65 + 0.35 * Math.sin(t * 2.3 + phase * 3.1)) + 0.08 * Math.sin(t * 17 + phase * 5);
        this.position[n * 3] = hx + Math.cos(a) * r;
        this.position[n * 3 + 1] = hy + below + Math.sin(t * speed * 1.4 + phase) * 0.22;
        this.position[n * 3 + 2] = hz + Math.sin(a) * r;
        n++;
      }
    });
    this.points.geometry.setDrawRange(0, n);
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
