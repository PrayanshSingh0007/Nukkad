import type { PerspectiveCamera } from 'three';

/**
 * Free-fly camera for the debug page.
 *   Laptop: W A S D move · E / Q up / down · Shift = fast · drag with the mouse to look · wheel = speed
 *   Phone:  left thumb = move stick · right thumb = drag to look
 * You fly in the direction you look, so looking down and pushing forward dives.
 */
const LOOK_SPEED = 0.0045;
const STICK_RADIUS_PX = 60;
const MAX_PITCH = 1.5;

export class FlyControls {
  /** Metres per second. */
  speed = 45;
  yaw = 0;
  pitch = -0.45;
  private readonly camera: PerspectiveCamera;
  private readonly surface: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly keys = new Set<string>();
  private readonly abort = new AbortController();
  private movePointer = -1;
  private lookPointer = -1;
  private stickStart = { x: 0, y: 0 };
  private stickValue = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };

  constructor(camera: PerspectiveCamera, surface: HTMLElement, stick: HTMLElement) {
    this.camera = camera;
    this.surface = surface;
    this.stick = stick;
    this.knob = stick.firstElementChild as HTMLElement;
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', (event) => this.onKey(event, true), options);
    window.addEventListener('keyup', (event) => this.onKey(event, false), options);
    window.addEventListener('blur', () => this.keys.clear(), options);
    surface.addEventListener('pointerdown', (event) => this.onPointerDown(event), options);
    surface.addEventListener('pointermove', (event) => this.onPointerMove(event), options);
    surface.addEventListener('pointerup', (event) => this.onPointerEnd(event), options);
    surface.addEventListener('pointercancel', (event) => this.onPointerEnd(event), options);
    surface.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    surface.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.speed = Math.min(400, Math.max(4, this.speed * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      },
      { signal: this.abort.signal, passive: false },
    );
  }

  /** Moves the camera. `minHeight` tells how high the ground is at a spot, so we never dive under it. */
  update(dt: number, minHeight: (x: number, z: number) => number): void {
    const key = (code: string): number => (this.keys.has(code) ? 1 : 0);
    const forward = key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') - this.stickValue.y;
    const strafe = key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + this.stickValue.x;
    const lift = key('KeyE') + key('Space') - key('KeyQ');
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
    const distance = this.speed * boost * dt;

    const cosPitch = Math.cos(this.pitch);
    const dirX = -Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = -Math.cos(this.yaw) * cosPitch;
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const position = this.camera.position;
    position.x += (dirX * forward + rightX * strafe) * distance;
    position.y += (dirY * forward + lift) * distance;
    position.z += (dirZ * forward + rightZ * strafe) * distance;
    position.y = Math.max(position.y, minHeight(position.x, position.z) + 1.6);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  dispose(): void {
    this.abort.abort();
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (down) this.keys.add(event.code);
    else this.keys.delete(event.code);
  }

  private onPointerDown(event: PointerEvent): void {
    try {
      this.surface.setPointerCapture(event.pointerId); // keep getting moves when the finger slides off
    } catch {
      // Some browsers refuse capture for certain pointers; the controls still work without it.
    }
    const isTouch = event.pointerType === 'touch';
    if (isTouch && event.clientX < window.innerWidth * 0.4 && this.movePointer < 0) {
      this.movePointer = event.pointerId;
      this.stickStart = { x: event.clientX, y: event.clientY };
      this.stick.style.display = 'block';
      this.stick.style.left = `${event.clientX}px`;
      this.stick.style.top = `${event.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (this.lookPointer < 0) {
      this.lookPointer = event.pointerId;
      this.lastLook = { x: event.clientX, y: event.clientY };
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerId === this.movePointer) {
      let dx = event.clientX - this.stickStart.x;
      let dy = event.clientY - this.stickStart.y;
      const length = Math.hypot(dx, dy);
      if (length > STICK_RADIUS_PX) {
        dx *= STICK_RADIUS_PX / length;
        dy *= STICK_RADIUS_PX / length;
      }
      this.stickValue = { x: dx / STICK_RADIUS_PX, y: dy / STICK_RADIUS_PX };
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (event.pointerId === this.lookPointer) {
      this.yaw -= (event.clientX - this.lastLook.x) * LOOK_SPEED;
      this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, this.pitch - (event.clientY - this.lastLook.y) * LOOK_SPEED));
      this.lastLook = { x: event.clientX, y: event.clientY };
    }
  }

  private onPointerEnd(event: PointerEvent): void {
    if (event.pointerId === this.movePointer) {
      this.movePointer = -1;
      this.stickValue = { x: 0, y: 0 };
      this.stick.style.display = 'none';
    } else if (event.pointerId === this.lookPointer) {
      this.lookPointer = -1;
    }
  }
}
