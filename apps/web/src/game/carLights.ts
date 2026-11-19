import * as THREE from 'three';

/**
 * Lamps on the vehicle you drive: red brake lights when you brake or pull the handbrake, white
 * reversing lights when you back up, dim tail lights and headlights at night. Each lamp is a
 * soft glowing point (bright enough for the bloom pass to give it a halo) placed from the
 * model's size, so it works on every car without knowing where its lamp parts are.
 */
const GLOW = (() => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const g = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // A small hot core and a quick falloff (a lamp, not a ball of light).
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = g;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
})();

/**
 * A pair (or one) of lamps: a tiny point cloud with the glow texture. Points, not sprites: the
 * ambient-occlusion pass skips points, while sprites would be shaded as dark squares.
 */
interface Lamp {
  points: THREE.Points;
  material: THREE.PointsMaterial;
}

function lamps(positions: number[], size: number): Lamp {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ map: GLOW, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geometry, material);
  points.visible = false;
  points.frustumCulled = false;
  points.renderOrder = 3;
  return { points, material };
}

const BRAKE = new THREE.Color(7, 0.45, 0.28);
const TAIL = new THREE.Color(1.4, 0.1, 0.06);
const REVERSE = new THREE.Color(3, 3, 3.2);
const HEAD = new THREE.Color(3.2, 3.0, 2.6);

export class CarLights {
  readonly group = new THREE.Group();
  private tail: Lamp | null = null;
  private reverse: Lamp | null = null;
  private head: Lamp | null = null;

  /** Puts the lamps on a vehicle model (its local −z is the front, +z the back). */
  attach(parent: THREE.Object3D, box: THREE.Box3, single: boolean): void {
    this.detach();
    const halfW = (box.max.x - box.min.x) / 2;
    const height = box.max.y - box.min.y;
    const back = box.max.z - 0.04;
    const front = box.min.z + 0.04;
    const xs = single ? [0] : [-halfW * 0.72, halfW * 0.72];
    const tailY = box.min.y + height * (single ? 0.55 : 0.6);
    const headY = box.min.y + height * (single ? 0.6 : 0.45);
    // (Point sizes are about 1.9× a world size at the game's field of view, hence the small numbers.)
    this.tail = lamps(xs.flatMap((x) => [x, tailY, back]), single ? 0.18 : 0.26);
    this.reverse = lamps(xs.flatMap((x) => [x * 0.6, tailY - 0.08, back]), 0.17);
    this.head = lamps(xs.flatMap((x) => [x * 0.95, headY, front]), single ? 0.28 : 0.34);
    this.group.add(this.tail.points, this.reverse.points, this.head.points);
    parent.add(this.group);
  }

  detach(): void {
    this.group.removeFromParent();
    for (const l of [this.tail, this.reverse, this.head]) {
      l?.points.geometry.dispose();
      l?.material.dispose();
    }
    this.group.clear();
    this.tail = this.reverse = this.head = null;
  }

  /** `speed` m/s (negative = backwards), `brake` 0–1, night 0–1. */
  update(speed: number, brake: number, handbrake: boolean, night: number): void {
    if (!this.tail || !this.reverse || !this.head) return;
    const braking = handbrake || brake > 0.05;
    this.tail.points.visible = braking || night > 0.3;
    this.tail.material.color.copy(braking ? BRAKE : TAIL);
    this.reverse.points.visible = speed < -0.3 && !braking;
    this.reverse.material.color.copy(REVERSE);
    this.head.points.visible = night > 0.3;
    this.head.material.color.copy(HEAD);
  }
}
