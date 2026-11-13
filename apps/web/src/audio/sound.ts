/**
 * Sounds made in code with the browser's Web Audio (no audio files to download or credit):
 * a horn per vehicle and an engine hum that rises with speed. Only you hear them for now —
 * they are not sent to friends. Audio can only start after a tap or key press (browser rule).
 */
type HornVoice = 'scooter' | 'car' | 'heavy';

const HORNS: Record<HornVoice, [number, number]> = {
  scooter: [520, 655],
  car: [405, 510],
  heavy: [300, 360],
};

export class Sound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private hornGain: GainNode | null = null;
  private hornOscs: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOscs: OscillatorNode[] = [];
  muted = false;

  /** Call from a tap or key press. Safe to call many times. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(context.destination);

    // Horn: two notes a third apart, a little buzzy, through a filter so it is not harsh.
    const hornFilter = context.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 2200;
    this.hornGain = context.createGain();
    this.hornGain.gain.value = 0;
    hornFilter.connect(this.hornGain).connect(this.master);
    for (const frequency of HORNS.car) {
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.value = frequency;
      osc.connect(hornFilter);
      osc.start();
      this.hornOscs.push(osc);
    }

    // Engine: a low saw wave and a quieter one an octave up, muffled; pitch follows speed.
    this.engineFilter = context.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    for (const [type, level] of [
      ['sawtooth', 1],
      ['square', 0.35],
    ] as const) {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.value = 50;
      const gain = context.createGain();
      gain.gain.value = level;
      osc.connect(gain).connect(this.engineFilter);
      osc.start();
      this.engineOscs.push(osc);
    }
  }

  /** Press (true) or release (false) the horn. */
  horn(on: boolean, voice: HornVoice = 'car'): void {
    const context = this.context;
    if (!context || !this.hornGain) return;
    const now = context.currentTime;
    if (on) HORNS[voice].forEach((frequency, i) => this.hornOscs[i]?.frequency.setValueAtTime(frequency, now));
    this.hornGain.gain.cancelScheduledValues(now);
    this.hornGain.gain.setTargetAtTime(on && !this.muted ? 0.16 : 0, now, on ? 0.012 : 0.04);
  }

  /**
   * Engine hum. `share` = speed as a share of top speed (0–1); `kind` = 'none' on foot,
   * 'electric' for your own scooter (a soft whine), 'engine' for everything else.
   */
  engine(share: number, kind: 'none' | 'electric' | 'engine'): void {
    const context = this.context;
    if (!context || !this.engineGain || !this.engineFilter) return;
    const now = context.currentTime;
    const s = Math.min(1, Math.max(0, share));
    const electric = kind === 'electric';
    const base = electric ? 140 + s * 420 : 46 + s * 105;
    this.engineOscs[0]?.frequency.setTargetAtTime(base, now, 0.08);
    this.engineOscs[1]?.frequency.setTargetAtTime(base * 2.01, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(electric ? 900 + s * 1200 : 320 + s * 900, now, 0.1);
    const level = kind === 'none' || this.muted ? 0 : electric ? 0.015 + s * 0.03 : 0.05 + s * 0.05;
    this.engineGain.gain.setTargetAtTime(level, now, 0.12);
  }
}
