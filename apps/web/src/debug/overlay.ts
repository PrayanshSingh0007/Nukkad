import { QUALITY_LEVELS } from '../game/quality.ts';
import type { QualityLevel } from '../game/quality.ts';

/**
 * The hidden debug overlay (PLAN §12). Open it with 5 quick taps on the Nukkad logo,
 * or the ` key on a laptop. "Copy report" puts all numbers on the clipboard to paste to Claude.
 */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly buttons = new Map<QualityLevel, HTMLButtonElement>();
  private taps: number[] = [];
  private report = '';

  constructor(root: HTMLElement, logo: HTMLElement, onQuality: (level: QualityLevel) => void, onTime: (hour: number | null) => void) {
    this.root = root;
    root.innerHTML =
      '<pre></pre><div class="overlayButtons"></div>' +
      '<label class="overlayTime">Time <input type="range" min="0" max="24" step="0.25" value="12" /> <button type="button">real</button></label>';
    const slider = root.querySelector('.overlayTime input') as HTMLInputElement;
    slider.addEventListener('input', () => onTime(Number(slider.value)));
    (root.querySelector('.overlayTime button') as HTMLButtonElement).addEventListener('click', () => onTime(null));
    this.text = root.querySelector('pre') as HTMLElement;
    const row = root.querySelector('.overlayButtons') as HTMLElement;
    for (const level of QUALITY_LEVELS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = level;
      button.addEventListener('click', () => onQuality(level));
      row.append(button);
      this.buttons.set(level, button);
    }
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy report';
    copy.addEventListener('click', () => void this.copy(copy));
    row.append(copy);

    logo.addEventListener('pointerdown', () => {
      const now = performance.now();
      this.taps = [...this.taps.filter((t) => now - t < 2000), now];
      if (this.taps.length >= 5) {
        this.taps = [];
        this.toggle();
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Backquote') this.toggle();
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  /** Shows the latest numbers; `report` is the longer text that "Copy report" copies. */
  update(lines: string, report: string, level: QualityLevel): void {
    this.report = report;
    if (!this.visible) return;
    this.text.textContent = lines;
    for (const [name, button] of this.buttons) button.classList.toggle('picked', name === level);
  }

  private async copy(button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.report);
      button.textContent = 'Copied!';
    } catch {
      // The clipboard needs https. On plain http, show the text so it can be copied by hand.
      window.prompt('Copy this report:', this.report);
    }
    setTimeout(() => (button.textContent = 'Copy report'), 1500);
  }
}
