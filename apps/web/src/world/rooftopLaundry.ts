import * as THREE from 'three';

/**
 * Washing drying on the terraces: on about a third of the roofs with a water tank, a line
 * strung 1.7 m up with four to six things pegged on it (shirts, towels, now and then a long
 * sari) in the colours of everyday clothes, swinging in the breeze and whipping about in a
 * storm. Taken in when it rains. Only lines within 120 m whose building is on screen are drawn
 * (it waits for the roof like the water tanks do).
 */
const NEAR_M = 120;
const PALETTE = [0xb32f45, 0xe0a12b, 0x1f7a7a, 0xe86fa4, 0xf2efe6, 0x2f5fb3, 0x7a3d8f, 0x3b8c4a, 0xd9562a, 0xc9c2b0, 0x1d2230, 0xf0d64a];

interface Item {
  /** Where the top edge's middle hangs (world), the line's direction (radians). */
  x: number;
  y: number;
  z: number;
  angle: number;
  width: number;
  height: number;
  colour: number;
}

interface Line {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  bz: number;
  items: Item[];
}

export class RooftopLaundry {
  readonly group = new THREE.Group();
  private readonly cloth: THREE.InstancedMesh;
  private readonly wires: THREE.LineSegments;
  private readonly lines: Line[] = [];
  private readonly time = { value: 0 };
  private readonly wind = { value: 0 };
  private searchIn = 0;
  private dry = 1;
  /** Is the building under (x, z) on screen yet? */
  roofReady: ((x: number, z: number) => boolean) | null = null;

  /** tanks: [x, roof y, z, rotation] per rooftop water tank. */
  constructor(tanks: Float32Array) {
    for (let i = 0; i < tanks.length / 4; i++) {
      const [x, y, z, rotation] = [tanks[i * 4], tanks[i * 4 + 1], tanks[i * 4 + 2], tanks[i * 4 + 3]];
      const hash = (salt: number): number => {
        const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
        return v - Math.floor(v);
      };
      if (hash(1) > 0.34) continue;
      // The line runs beside the tank, about 3.5 m long.
      const angle = rotation + (hash(2) < 0.5 ? 0 : Math.PI / 2);
      const ux = Math.cos(angle);
      const uz = -Math.sin(angle);
      const off = 2.4;
      const cx = x - uz * off;
      const cz = z + ux * off;
      const half = 1.6 + hash(3) * 0.4;
      const line: Line = { ax: cx - ux * half, ay: y + 1.7, az: cz - uz * half, bx: cx + ux * half, bz: cz + uz * half, items: [] };
      const n = 4 + Math.floor(hash(4) * 3);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n + (hash(10 + k) - 0.5) * 0.08;
        const sari = hash(20 + k) < 0.15;
        const width = sari ? 0.9 : 0.35 + hash(30 + k) * 0.25;
        const height = sari ? 1.25 : 0.45 + hash(40 + k) * 0.35;
        line.items.push({
          x: line.ax + (line.bx - line.ax) * t,
          y: line.ay - 0.04 * Math.sin(Math.PI * t), // the line sags a little
          z: line.az + (line.bz - line.az) * t,
          angle,
          width,
          height,
          colour: PALETTE[Math.floor(hash(50 + k) * PALETTE.length)],
        });
      }
      this.lines.push(line);
    }
    // Cloth: a sheet hanging from its top edge; the lower it is, the more it swings.
    const sheet = new THREE.PlaneGeometry(1, 1, 1, 4).translate(0, -0.5, 0);
    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.uniforms.uWind = this.wind;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying vec2 vRl;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float rlPhase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 1.3;
        float rlDown = -position.y; // 0 at the line, 1 at the hem
        vRl = vec2(position.x + instanceMatrix[3].x * 0.37, rlDown);
        float rlSwing = sin(uTime * (1.6 + uWind) + rlPhase) * 0.18 + sin(uTime * 4.3 + rlPhase * 2.0) * 0.05;
        transformed.z += rlDown * rlDown * rlSwing * (0.6 + 1.6 * uWind);
        transformed.x += rlDown * sin(uTime * 2.2 + rlPhase + position.x * 3.0) * 0.03 * (1.0 + uWind);`,
      );
      // Soft vertical folds, a darker hem where it is still damp, and a fold over the line.
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRl;').replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float rlFold = 0.84 + 0.16 * (0.5 + 0.5 * sin(vRl.x * 21.0)) * (0.6 + 0.4 * sin(vRl.x * 7.0 + 1.3));
        diffuseColor.rgb *= rlFold * (1.0 - 0.18 * smoothstep(0.75, 1.0, vRl.y)) * (1.0 - 0.15 * (1.0 - smoothstep(0.0, 0.06, vRl.y)));`,
      );
    };
    material.customProgramCacheKey = () => 'nukkad-laundry-2';
    const capacity = Math.max(1, this.lines.reduce((sum, line) => sum + line.items.length, 0));
    this.cloth = new THREE.InstancedMesh(sheet, material, Math.min(capacity, 900));
    this.cloth.count = 0;
    this.cloth.frustumCulled = false;
    this.cloth.castShadow = true;
    this.cloth.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cloth.instanceMatrix.count * 3), 3);
    const wireGeometry = new THREE.BufferGeometry();
    wireGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.min(this.lines.length, 200) * 6), 3).setUsage(THREE.DynamicDrawUsage));
    wireGeometry.setDrawRange(0, 0);
    this.wires = new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: 0x2a2a2c, fog: true }));
    this.wires.frustumCulled = false;
    this.group.add(this.cloth, this.wires);
  }

  get count(): number {
    return this.lines.length;
  }

  /** In rain the washing is taken in; storms whip it about (wind 0–1). */
  setWorld(rain: number): void {
    this.dry = rain < 0.2 ? 1 : 0;
    this.wind.value = Math.min(1, rain * 1.5);
  }

  update(dt: number, x: number, z: number): void {
    this.time.value = (this.time.value + dt) % 1000;
    this.group.visible = this.dry > 0;
    if (!this.group.visible) return;
    this.searchIn -= dt;
    if (this.searchIn > 0) return;
    this.searchIn = 0.5;
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const size = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const colour = new THREE.Color();
    const wire = (this.wires.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let n = 0;
    let w = 0;
    for (const line of this.lines) {
      const mx = (line.ax + line.bx) / 2;
      const mz = (line.az + line.bz) / 2;
      if (Math.hypot(mx - x, mz - z) > NEAR_M) continue;
      if (this.roofReady && !this.roofReady(mx, mz)) continue;
      if (w * 6 + 6 <= wire.length) {
        wire.set([line.ax, line.ay, line.az, line.bx, line.ay, line.bz], w * 6);
        w++;
      }
      for (const item of line.items) {
        if (n >= this.cloth.instanceMatrix.count) break;
        turn.setFromAxisAngle(up, item.angle);
        this.cloth.setMatrixAt(n, matrix.compose(at.set(item.x, item.y, item.z), turn, size.set(item.width, item.height, 1)));
        this.cloth.setColorAt(n, colour.setHex(item.colour));
        n++;
      }
    }
    this.cloth.count = n;
    this.cloth.instanceMatrix.needsUpdate = true;
    if (this.cloth.instanceColor) this.cloth.instanceColor.needsUpdate = true;
    this.wires.geometry.setDrawRange(0, w * 2);
    (this.wires.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.cloth.geometry.dispose();
    (this.cloth.material as THREE.Material).dispose();
    this.wires.geometry.dispose();
    (this.wires.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
