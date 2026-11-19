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
  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  muted = false;

  /** Call from a tap or key press. Safe to call many times. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended' && document.visibilityState === 'visible') void this.context.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    this.context = context;
    // Silence when the tab is hidden or closed; back when you return to it.
    const follow = (): void => {
      if (document.visibilityState === 'hidden') void context.suspend();
      else void context.resume();
    };
    document.addEventListener('visibilitychange', follow);
    window.addEventListener('pagehide', () => void context.suspend());
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
    // Tyre screech: loud noise squeezed through a narrow band, so it sings like rubber.
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    this.skidFilter = context.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1300;
    this.skidFilter.Q.value = 9;
    this.skidGain = context.createGain();
    this.skidGain.gain.value = 0;
    source.connect(this.skidFilter).connect(this.skidGain).connect(this.master);
    source.start();
  }

  /** Tyre screech, 0 (silent) to 1 (full slide). Fades out by itself if not refreshed. */
  skid(amount: number): void {
    const context = this.context;
    if (!context || !this.skidGain || !this.skidFilter) return;
    const now = context.currentTime;
    const a = this.muted ? 0 : Math.min(1, Math.max(0, amount));
    const gain = this.skidGain.gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(a > 0.12 ? 0.05 + a * 0.22 : 0, now, a > 0.12 ? 0.03 : 0.08);
    gain.setTargetAtTime(0, now + 0.35, 0.1);
    this.skidFilter.frequency.setTargetAtTime(1100 + a * 500 + Math.random() * 120, now, 0.05);
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
   * Engine note. `rpm` = engine speed as a share of the rev range (0–1; the game runs a simple
   * gearbox so it climbs and drops at each gear change); `load` = throttle (0–1), which makes it
   * louder and brighter; `kind` = 'none' on foot, 'electric' for your own scooter (a soft
   * whine), 'engine' for everything else.
   */
  engine(rpm: number, kind: 'none' | 'electric' | 'engine', load = 0): void {
    const context = this.context;
    if (!context || !this.engineGain || !this.engineFilter) return;
    const now = context.currentTime;
    const r = Math.min(1, Math.max(0, rpm));
    const l = Math.min(1, Math.max(0, load));
    const electric = kind === 'electric';
    const base = electric ? 140 + r * 420 : 42 + r * 150;
    this.engineOscs[0]?.frequency.setTargetAtTime(base, now, 0.05);
    this.engineOscs[1]?.frequency.setTargetAtTime(base * 2.01, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(electric ? 900 + r * 1200 : 300 + r * 1500 * (0.55 + 0.45 * l), now, 0.06);
    const level = kind === 'none' || this.muted ? 0 : electric ? 0.015 + r * 0.03 : 0.04 + r * 0.05 + l * 0.03;
    const gain = this.engineGain.gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(level, now, 0.08);
    // Watchdog: the game calls this every frame; if the frames stop (tab in the background,
    // game paused), the engine fades out by itself instead of droning on.
    gain.setTargetAtTime(0, now + 0.35, 0.1);
  }
}
