import type { PlayerState } from '@nukkad/shared';

/**
 * Smooth movement of other players (PLAN §6.3). Snapshots arrive unevenly (and on TCP,
 * loss shows up as a pause then a burst), so others are drawn slightly in the past and
 * we blend between the two snapshots around that moment.
 */
const TICK_MS = 1000 / 15;
const MIN_DELAY_MS = TICK_MS * 2; // ≈ 133 ms: there are always two snapshots to blend
const MAX_DELAY_MS = 400;
const MAX_EXTRAPOLATE_MS = 250;
const KEEP_MS = 3000;

/** Maps server time to local time, and measures how unevenly snapshots arrive. */
export class ClockSync {
  /** local − server, using the fastest recent arrival (least delayed). */
  private offset: number | null = null;
  private jitter = 0;

  /** Call for every snapshot: `local` = performance.now() on arrival. */
  observe(serverTime: number, local: number): void {
    const sample = local - serverTime;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += 0.02; // drift slowly up so an old lucky sample doesn't stick forever
    this.jitter += (sample - this.offset - this.jitter) * 0.1;
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  /** How far in the past others are drawn: grows on a shaky network, up to 400 ms. */
  get delay(): number {
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, MIN_DELAY_MS + this.jitter * 2));
  }

  /** The server time to draw others at, now. */
  renderTime(local: number): number {
    return local - (this.offset ?? 0) - this.delay;
  }
}

interface Sample {
  t: number;
  s: PlayerState;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/** The recent snapshots of one player. */
export class SnapshotBuffer {
  private readonly samples: Sample[] = [];

  push(serverTime: number, state: PlayerState): void {
    const last = this.samples[this.samples.length - 1];
    if (last && serverTime <= last.t) return; // late or duplicate: a newer one already arrived
    this.samples.push({ t: serverTime, s: state });
    while (this.samples.length > 2 && this.samples[0].t < serverTime - KEEP_MS) this.samples.shift();
  }

  get latest(): PlayerState | null {
    return this.samples[this.samples.length - 1]?.s ?? null;
  }

  /** The state at server time `t`: blended, or carried forward for up to 250 ms. */
  sample(t: number): PlayerState | null {
    const n = this.samples.length;
    if (n === 0) return null;
    if (t <= this.samples[0].t) return this.samples[0].s;
    for (let i = n - 1; i > 0; i--) {
      const a = this.samples[i - 1];
      const b = this.samples[i];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t);
        return {
          x: lerp(a.s.x, b.s.x, k),
          y: lerp(a.s.y, b.s.y, k),
          z: lerp(a.s.z, b.s.z, k),
          yaw: lerpAngle(a.s.yaw, b.s.yaw, k),
          speed: lerp(a.s.speed, b.s.speed, k),
          flags: b.s.flags,
        };
      }
    }
    // Newer than anything we have: keep going the same way for a moment, then stop.
    const last = this.samples[n - 1];
    if (n < 2) return last.s;
    const before = this.samples[n - 2];
    const span = last.t - before.t;
    const ahead = Math.min(t - last.t, MAX_EXTRAPOLATE_MS);
    const k = span > 0 ? ahead / span : 0;
    const fading = t - last.t > MAX_EXTRAPOLATE_MS;
    return {
      ...last.s,
      x: last.s.x + (last.s.x - before.s.x) * k,
      y: last.s.y + (last.s.y - before.s.y) * k,
      z: last.s.z + (last.s.z - before.s.z) * k,
      speed: fading ? 0 : last.s.speed,
    };
  }
}
