/** The three quality levels of PLAN §8.1. */
export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  level: QualityLevel;
  /** Upper limit for the screen's pixel ratio (sharpness). */
  maxPixelRatio: number;
  /** Chunks closer than this are drawn; the fog ends here. */
  viewDistance: number;
  /** Rings of full-detail chunks around the player. */
  nearRing: number;
  maxTrees: number;
  antialias: boolean;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { level: 'low', maxPixelRatio: 1, viewDistance: 200, nearRing: 1, maxTrees: 300, antialias: false },
  medium: { level: 'medium', maxPixelRatio: 1.5, viewDistance: 350, nearRing: 1, maxTrees: 1000, antialias: false },
  high: { level: 'high', maxPixelRatio: 2, viewDistance: 600, nearRing: 2, maxTrees: 2500, antialias: true },
};

const KEY = 'nukkad.quality';

/** Where the starting level came from. Only a guessed level is changed by the benchmark. */
export type QualitySource = 'address' | 'saved' | 'guess';

/** A first guess from the device; the in-game benchmark corrects it. */
function guessLevel(): QualityLevel {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 4;
  const phone = matchMedia('(pointer: coarse)').matches;
  if (cores <= 4 || memory <= 2) return 'low';
  return phone ? 'medium' : 'high';
}

export function startingQuality(fromAddress: string | null): { level: QualityLevel; source: QualitySource } {
  if (fromAddress && QUALITY_LEVELS.includes(fromAddress as QualityLevel)) return { level: fromAddress as QualityLevel, source: 'address' };
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && QUALITY_LEVELS.includes(saved as QualityLevel)) return { level: saved as QualityLevel, source: 'saved' };
  } catch {
    // storage blocked
  }
  return { level: guessLevel(), source: 'guess' };
}

export function saveQuality(level: QualityLevel): void {
  try {
    localStorage.setItem(KEY, level);
  } catch {
    // storage blocked: the choice lasts until the page closes
  }
}

/**
 * Watches frame times and lowers (or raises) the render scale: if frames are slow for 2 s
 * the picture gets 10 % less sharp (not below 0.6); with headroom it climbs back (PLAN §8.1).
 * Also runs the start-up benchmark: a guessed level steps down while the game cannot reach 30 fps.
 */
export class FrameGovernor {
  renderScale = 1;
  private windowMs = 0;
  private frames = 0;
  private settleMs = 1500;
  private benchmarkWindows = 0;

  /** Returns 'down' when the quality level should drop one step (benchmark only). */
  frame(dtMs: number, benchmarking: boolean): 'down' | null {
    if (this.settleMs > 0) {
      this.settleMs -= dtMs; // ignore the first moments: shaders compile, chunks upload
      return null;
    }
    this.windowMs += dtMs;
    this.frames++;
    if (this.windowMs < 2000) return null;
    const average = this.windowMs / this.frames;
    this.windowMs = 0;
    this.frames = 0;
    if (benchmarking && this.benchmarkWindows < 3) {
      this.benchmarkWindows++;
      if (average > 40) {
        this.settleMs = 1500;
        return 'down';
      }
    }
    if (average > 36) this.renderScale = Math.max(0.6, this.renderScale * 0.9);
    else if (average < 22) this.renderScale = Math.min(1, this.renderScale / 0.9);
    return null;
  }
}
