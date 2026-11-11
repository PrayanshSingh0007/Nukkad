import type { WebGLRenderer } from 'three';

/** The text behind "Copy report": device facts + the overlay numbers, to paste into a bug report. */
export function buildReport(renderer: WebGLRenderer, lines: string): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const nav = navigator as Navigator & { deviceMemory?: number };
  return [
    'Nukkad debug report',
    `time ${new Date().toISOString()}`,
    `browser ${navigator.userAgent}`,
    `gpu ${gpu}`,
    `screen ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio} · cores ${navigator.hardwareConcurrency ?? '?'} · memory ${nav.deviceMemory ?? '?'} GB`,
    lines,
  ].join('\n');
}
