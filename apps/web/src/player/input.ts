/**
 * Player input for both kinds of device.
 *   Phone:  left side of the screen = move stick (appears under the thumb) · anywhere else = drag to look
 *   Laptop: W A S D or arrow keys = move · drag with the mouse = look · Shift = walk slowly
 */
const STICK_RADIUS_PX = 56;
const STICK_ZONE = 0.45; // the left 45 % of the screen starts the stick

export class PlayerInput {
  /** Sideways (-1 left … 1 right) and forward (-1 back … 1 forward). Length is at most 1. */
  moveX = 0;
  moveY = 0;
  /** Look sensitivity multiplier (settings, Phase 7). */
  sensitivity = 1;
  private lookX = 0;
  private lookY = 0;
  private readonly keys = new Set<string>();
  private readonly surface: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly abort = new AbortController();
  private movePointer = -1;
  private lookPointer = -1;
  private stickStart = { x: 0, y: 0 };
  private stickValue = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };

  constructor(surface: HTMLElement, stick: HTMLElement) {
    this.surface = surface;
    this.stick = stick;
    this.knob = stick.firstElementChild as HTMLElement;
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', (event) => this.onKey(event, true), options);
    window.addEventListener('keyup', (event) => this.onKey(event, false), options);
    window.addEventListener('blur', () => this.releaseAll(), options);
    document.addEventListener('visibilitychange', () => this.releaseAll(), options);
    surface.addEventListener('pointerdown', (event) => this.onPointerDown(event), options);
    surface.addEventListener('pointermove', (event) => this.onPointerMove(event), options);
    surface.addEventListener('pointerup', (event) => this.onPointerEnd(event), options);
    surface.addEventListener('pointercancel', (event) => this.onPointerEnd(event), options);
    surface.addEventListener('contextmenu', (event) => event.preventDefault(), options);
  }

  /** Call once per frame before reading moveX / moveY. */
  update(): void {
    const key = (code: string): number => (this.keys.has(code) ? 1 : 0);
    let x = key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + this.stickValue.x;
    let y = key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') - this.stickValue.y;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    const slow = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 0.45 : 1;
    this.moveX = x * slow;
    this.moveY = y * slow;
  }

  /** How far the view was dragged since the last call, in pixels. */
  consumeLook(): { dx: number; dy: number } {
    const look = { dx: this.lookX * this.sensitivity, dy: this.lookY * this.sensitivity };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  dispose(): void {
    this.abort.abort();
  }

  private releaseAll(): void {
    this.keys.clear();
    this.movePointer = -1;
    this.lookPointer = -1;
    this.stickValue = { x: 0, y: 0 };
    this.stick.style.display = 'none';
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (down) this.keys.add(event.code);
    else this.keys.delete(event.code);
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
  }

  private onPointerDown(event: PointerEvent): void {
    try {
      this.surface.setPointerCapture(event.pointerId); // keep getting moves when the finger slides off
    } catch {
      // Some browsers refuse capture for certain pointers; the controls still work without it.
    }
    const isTouch = event.pointerType === 'touch';
    if (isTouch && event.clientX < window.innerWidth * STICK_ZONE && this.movePointer < 0) {
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
      this.lookX += event.clientX - this.lastLook.x;
      this.lookY += event.clientY - this.lastLook.y;
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
