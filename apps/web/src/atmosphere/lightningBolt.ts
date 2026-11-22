import * as THREE from 'three';

/**
 * A lightning bolt you can see: when a storm flashes, a jagged, forking bolt runs from the
 * cloud base down to the ground a few hundred metres away, roughly where you are looking
 * (somewhere ahead, never straight overhead). A bright core ribbon and a wide, faint glow
 * around it, both turned to face you, brighter than white so the bloom catches them; buildings
 * in front hide it. It flickers with the flash and is gone in a fraction of a second.
 */
const CLOUD_BASE_M = 230;

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  width: number;
}

export class LightningBolt {
  readonly group = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  /** How far away the last bolt struck, metres. */
  distance = 0;

  constructor() {
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    this.core = new THREE.Mesh(new THREE.BufferGeometry(), this.coreMaterial);
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMaterial);
    for (const mesh of [this.core, this.glow]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      // The ambient-occlusion pass hides lines (and Line2 meshes) while it draws shapes.
      (mesh as unknown as { isLine2: boolean }).isLine2 = true;
      this.group.add(mesh);
    }
    this.group.visible = false;
  }

  /**
   * A new bolt. `camera` decides where (ahead of it), `ground` is the ground height near you,
   * `far` the furthest it may be (inside the camera's far plane).
   */
  strike(camera: THREE.Camera, ground: number, far: number): void {
    const look = camera.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(look.x, look.z) + (Math.random() - 0.5) * 1.6; // within ~45° of where you look
    this.distance = Math.min(far * 0.82, 220 + Math.random() * 300);
    const foot = new THREE.Vector3(camera.position.x + Math.sin(yaw) * this.distance, ground, camera.position.z + Math.cos(yaw) * this.distance);
    const top = foot.clone().add(new THREE.Vector3((Math.random() - 0.5) * 120, CLOUD_BASE_M, (Math.random() - 0.5) * 120));
    const segments: Segment[] = [];
    const main = jagged(top, foot, 7, 0.22);
    for (let i = 0; i + 1 < main.length; i++) segments.push({ a: main[i], b: main[i + 1], width: 2.4 });
    // Forks: branches off the upper part of the bolt that die out before the ground.
    const forks = 2 + Math.floor(Math.random() * 3);
    for (let f = 0; f < forks; f++) {
      const from = main[Math.floor(main.length * (0.1 + Math.random() * 0.5))];
      const drop = (from.y - ground) * (0.25 + Math.random() * 0.35);
      const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * drop * 1.3, -drop, (Math.random() - 0.5) * drop * 1.3));
      const fork = jagged(from, to, 5, 0.25);
      for (let i = 0; i + 1 < fork.length; i++) segments.push({ a: fork[i], b: fork[i + 1], width: 1.1 * (1 - i / fork.length) + 0.3 });
    }
    setRibbons(this.core.geometry, segments, camera.position, 1);
    setRibbons(this.glow.geometry, segments, camera.position, 9);
  }

  /** The flash's brightness this frame (0–1). */
  update(flash: number): void {
    this.group.visible = flash > 0.03;
    if (!this.group.visible) return;
    this.coreMaterial.color.setRGB(6, 6.4, 8).multiplyScalar(flash);
    this.glowMaterial.color.setRGB(0.35, 0.4, 0.6).multiplyScalar(flash);
  }

  dispose(): void {
    this.core.geometry.dispose();
    this.glow.geometry.dispose();
    this.coreMaterial.dispose();
    this.glowMaterial.dispose();
    this.group.removeFromParent();
  }
}

/** A path from a to b, kinked by repeatedly pushing midpoints sideways. */
function jagged(a: THREE.Vector3, b: THREE.Vector3, depth: number, roughness: number): THREE.Vector3[] {
  let points = [a.clone(), b.clone()];
  for (let level = 0; level < depth; level++) {
    const next: THREE.Vector3[] = [points[0]];
    for (let i = 0; i + 1 < points.length; i++) {
      const p = points[i];
      const q = points[i + 1];
      const length = p.distanceTo(q);
      const mid = p.clone().lerp(q, 0.4 + Math.random() * 0.2);
      mid.x += (Math.random() - 0.5) * length * roughness * 2;
      mid.z += (Math.random() - 0.5) * length * roughness * 2;
      mid.y += (Math.random() - 0.5) * length * roughness * 0.6;
      next.push(mid, q);
    }
    points = next;
  }
  return points;
}

/** Flat ribbons along the segments, each turned to face the eye. */
function setRibbons(geometry: THREE.BufferGeometry, segments: Segment[], eye: THREE.Vector3, widthScale: number): void {
  const positions = new Float32Array(segments.length * 6 * 3);
  const along = new THREE.Vector3();
  const toEye = new THREE.Vector3();
  const side = new THREE.Vector3();
  segments.forEach(({ a, b, width }, i) => {
    along.subVectors(b, a).normalize();
    toEye.subVectors(eye, a).normalize();
    side.crossVectors(along, toEye).normalize().multiplyScalar((width * widthScale) / 2);
    const quad = [a.clone().sub(side), a.clone().add(side), b.clone().add(side), a.clone().sub(side), b.clone().add(side), b.clone().sub(side)];
    quad.forEach((v, k) => positions.set([v.x, v.y, v.z], (i * 6 + k) * 3));
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
}
