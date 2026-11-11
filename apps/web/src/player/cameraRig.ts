import type { PerspectiveCamera } from 'three';

/**
 * Third-person camera: it circles around a point above the player's shoulders.
 * A ray from that point towards the camera finds walls; the camera then moves
 * in front of the wall instead of looking through it.
 */
const LOOK_SPEED = 0.005; // radians per dragged pixel
const MIN_PITCH = -1.2; // looking almost straight down at the player
const MAX_PITCH = 0.45; // looking slightly up
const TARGET_HEIGHT = 1.45;
const WALL_GAP = 0.25;
const MIN_DISTANCE = 0.6;

export type CameraRay = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => number | null;

export class CameraRig {
  /** Direction the camera looks along the ground (0 = north, towards -z). */
  yaw = 0;
  pitch = -0.28;
  /** How far behind the player the camera wants to be, in metres. */
  distance = 5.2;
  private readonly camera: PerspectiveCamera;
  private current = 5.2;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Applies a drag of (dx, dy) pixels. */
  look(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SPEED;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch - dy * LOOK_SPEED));
  }

  /**
   * Places the camera for this frame. (x, y, z) are the player's feet.
   * `minY(x, z)` is the ground height, so the camera never dips under the ground.
   */
  update(x: number, y: number, z: number, dt: number, castRay: CameraRay, minY: (x: number, z: number) => number): void {
    const targetY = y + TARGET_HEIGHT;
    const cosPitch = Math.cos(this.pitch);
    // Unit vector from the target back to the camera.
    const bx = Math.sin(this.yaw) * cosPitch;
    const by = -Math.sin(this.pitch);
    const bz = Math.cos(this.yaw) * cosPitch;

    const hit = castRay(x, targetY, z, bx, by, bz, this.distance + WALL_GAP);
    const allowed = hit === null ? this.distance : Math.max(MIN_DISTANCE, hit - WALL_GAP);
    // Jump in at once when something is in the way; drift back out slowly.
    this.current = allowed < this.current ? allowed : Math.min(allowed, this.current + dt * 4);

    const position = this.camera.position;
    position.set(x + bx * this.current, targetY + by * this.current, z + bz * this.current);
    position.y = Math.max(position.y, minY(position.x, position.z) + 0.35);
    this.camera.lookAt(x, targetY, z);
  }
}
