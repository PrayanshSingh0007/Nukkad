import type { WebGLRenderer } from 'three';

/** Numbers measured over the last half second. */
export interface FrameStats {
  fps: number;
  /** Average and worst frame time, in milliseconds. */
  frameMs: number;
  worstMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** JavaScript memory in MB (Chrome only; 0 elsewhere). */
  heapMb: number;
}

const WINDOW_MS = 500;

/** Counts frames and reads the renderer's own counters. Call `frame()` once per frame, after rendering. */
export class StatsMeter {
  latest: FrameStats = { fps: 0, frameMs: 0, worstMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, heapMb: 0 };
  private readonly renderer: WebGLRenderer;
  private readonly onUpdate: (stats: FrameStats) => void;
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  constructor(renderer: WebGLRenderer, onUpdate: (stats: FrameStats) => void) {
    this.renderer = renderer;
    this.onUpdate = onUpdate;
  }

  frame(dtMs: number): void {
    this.frames++;
    this.elapsed += dtMs;
    this.worst = Math.max(this.worst, dtMs);
    if (this.elapsed < WINDOW_MS) return;
    const { render, memory } = this.renderer.info;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.latest = {
      fps: (this.frames * 1000) / this.elapsed,
      frameMs: this.elapsed / this.frames,
      worstMs: this.worst,
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      heapMb: heap ? heap.usedJSHeapSize / 1048576 : 0,
    };
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    this.onUpdate(this.latest);
  }
}

const whole = (value: number): string => Math.round(value).toLocaleString('en-US');

/** The text of the on-screen counter box. */
export function formatStats(stats: FrameStats, extra: string[]): string {
  const lines = [
    `${stats.fps.toFixed(0)} fps · ${stats.frameMs.toFixed(1)} ms (worst ${stats.worstMs.toFixed(0)})`,
    `${whole(stats.drawCalls)} draw calls · ${whole(stats.triangles)} triangles`,
    `${stats.geometries} geometries · ${stats.textures} textures${stats.heapMb ? ` · ${stats.heapMb.toFixed(0)} MB JS` : ''}`,
  ];
  return [...lines, ...extra].join('\n');
}
