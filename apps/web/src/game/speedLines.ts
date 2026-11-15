/**
 * Speed lines: thin white streaks rushing from the screen edges, like wind past the camera in
 * racing games. Drawn on a small 2D canvas laid over the game (half resolution, no WebGL cost);
 * nothing is drawn below 70 km/h, and they grow in number and strength up to ~250 km/h.
 */
interface Streak {
  angle: number;
  /** 0 = at the screen edge, 1 = gone (it fades as it travels in). */
  life: number;
  speed: number;
  length: number;
  width: number;
}

const START_KMH = 70;
const FULL_KMH = 250;
const MAX_STREAKS = 46;

export class SpeedLines {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly streaks: Streak[] = [];
  private visible = false;

  constructor(over: HTMLElement) {
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '1',
    });
    over.appendChild(this.canvas);
    this.context = this.canvas.getContext('2d');
  }

  update(kmh: number, dt: number): void {
    const context = this.context;
    if (!context) return;
    const strength = Math.min(1, Math.max(0, (kmh - START_KMH) / (FULL_KMH - START_KMH)));
    if (strength <= 0 && this.streaks.length === 0) {
      if (this.visible) {
        context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.visible = false;
      }
      return;
    }
    this.visible = true;
    const w = Math.max(1, Math.round(this.canvas.clientWidth / 2));
    const h = Math.max(1, Math.round(this.canvas.clientHeight / 2));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    // New streaks, more when faster.
    const wanted = Math.round(strength * MAX_STREAKS);
    while (this.streaks.length < wanted) {
      this.streaks.push({ angle: Math.random() * Math.PI * 2, life: Math.random() * 0.3, speed: 1.6 + Math.random() * 1.6, length: 0.14 + Math.random() * 0.2, width: 1 + Math.random() * 1.6 });
    }
    context.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.hypot(cx, cy);
    context.lineCap = 'round';
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.life += dt * s.speed * (0.6 + strength);
      if (s.life >= 1) {
        if (this.streaks.length > wanted) this.streaks.splice(i, 1);
        else Object.assign(s, { angle: Math.random() * Math.PI * 2, life: 0, speed: 1.6 + Math.random() * 1.6 });
        continue;
      }
      // From the edge (r = 1) inwards to about 55 % of the way to the centre.
      const outer = 1.05 - s.life * 0.45;
      const inner = outer - s.length;
      const dx = Math.cos(s.angle);
      const dy = Math.sin(s.angle);
      const alpha = (0.15 + strength * 0.4) * Math.sin(s.life * Math.PI);
      context.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      context.lineWidth = s.width;
      context.beginPath();
      context.moveTo(cx + dx * reach * outer, cy + dy * reach * outer);
      context.lineTo(cx + dx * reach * inner, cy + dy * reach * inner);
      context.stroke();
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
