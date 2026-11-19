/**
 * Sounds made in code with the browser's Web Audio (no audio files to download or credit):
 * a horn per vehicle, an engine hum that rises with speed, tyre screech, and the city around
 * you (a low traffic hum that swells, far-off horns, birds by day, wind at speed, rain and
 * thunder; muffled indoors). Only you hear them — they are not sent to friends. Audio can only start after a
 * tap or key press (browser rule).
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
  private outdoorFilter: BiquadFilterNode | null = null;
  private outdoorGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private brownNoise: AudioBuffer | null = null;
  private swell = 0;
  private nextHorn = 0;
  private nextBird = 0;
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

    // ---- The city around you. Everything outdoors goes through one filter that muffles it
    // when you step inside a building.
    this.outdoorFilter = context.createBiquadFilter();
    this.outdoorFilter.type = 'lowpass';
    this.outdoorFilter.frequency.value = 16000;
    this.outdoorGain = context.createGain();
    this.outdoorFilter.connect(this.outdoorGain).connect(this.master);
    // Traffic hum: deep "brown" noise (white noise smoothed), low-passed.
    const brown = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    const hum = context.createBufferSource();
    hum.buffer = brown;
    hum.loop = true;
    const humFilter = context.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 380;
    this.humGain = context.createGain();
    this.humGain.gain.value = 0;
    hum.connect(humFilter).connect(this.humGain).connect(this.outdoorFilter);
    hum.start();
    this.brownNoise = brown;
    // Rain: a soft hiss (noise with the deep and the shrill parts taken out).
    const rainSource = context.createBufferSource();
    rainSource.buffer = noise;
    rainSource.loop = true;
    rainSource.playbackRate.value = 0.8;
    const rainLow = context.createBiquadFilter();
    rainLow.type = 'highpass';
    rainLow.frequency.value = 500;
    const rainHigh = context.createBiquadFilter();
    rainHigh.type = 'lowpass';
    rainHigh.frequency.value = 5500;
    this.rainGain = context.createGain();
    this.rainGain.gain.value = 0;
    rainSource.connect(rainLow).connect(rainHigh).connect(this.rainGain).connect(this.outdoorFilter);
    rainSource.start();
    // Wind past the car at speed: soft broadband noise.
    const wind = context.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    wind.playbackRate.value = 0.5;
    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.5;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
  }

  /**
   * The city around you; call every frame while playing. `night` 0–1 (fewer horns, no birds),
   * `indoors` muffles it, `kmh` = your speed in a vehicle (wind), `rain` 0–1.
   */
  ambience(dt: number, night: number, indoors: boolean, kmh: number, rain = 0): void {
    const context = this.context;
    if (!context || !this.humGain || !this.outdoorFilter || !this.outdoorGain || !this.windGain || !this.windFilter) return;
    const now = context.currentTime;
    const day = 1 - night;
    // A slow random swell, like traffic passing a street away.
    this.swell = Math.max(-0.35, Math.min(0.35, this.swell + (Math.random() - 0.5) * dt * 1.2));
    const quiet = this.muted ? 0 : 1;
    const hum = this.humGain.gain;
    hum.cancelScheduledValues(now);
    hum.setTargetAtTime((0.05 + 0.035 * day) * (1 + this.swell) * quiet, now, 0.6);
    hum.setTargetAtTime(0, now + 0.5, 0.3); // watchdog: fades out if the frames stop
    this.outdoorFilter.frequency.cancelScheduledValues(now);
    this.outdoorFilter.frequency.setTargetAtTime(indoors ? 450 : 16000, now, 0.25);
    this.outdoorGain.gain.cancelScheduledValues(now);
    this.outdoorGain.gain.setTargetAtTime(indoors ? 0.5 : 1, now, 0.25);
    const w = Math.min(1, Math.max(0, kmh) / 220);
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setTargetAtTime(0.16 * w * w * quiet, now, 0.2);
    this.windGain.gain.setTargetAtTime(0, now + 0.35, 0.2); // stops if the frames stop
    if (this.rainGain) {
      const g = this.rainGain.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0.2 * Math.pow(rain, 0.8) * quiet, now, 0.5);
      g.setTargetAtTime(0, now + 0.5, 0.3); // watchdog
    }
    this.windFilter.frequency.cancelScheduledValues(now);
    this.windFilter.frequency.setTargetAtTime(450 + 1100 * w, now, 0.2);
    if (this.muted) return;
    if (now > this.nextHorn) {
      if (this.nextHorn > 0) this.distantHorn(now);
      this.nextHorn = now + 2 + Math.random() * (night > 0.5 ? 16 : 6);
    }
    if (day > 0.4 && rain < 0.3 && now > this.nextBird) {
      if (this.nextBird > 0) this.birdCall(now);
      this.nextBird = now + 1.5 + Math.random() * 7;
    }
  }

  /**
   * Thunder after a lightning flash: a crack (if close) and a long low rumble that rolls
   * around. `delay` seconds (light arrives first), `near` 0–1.
   */
  thunder(delay: number, near: number): void {
    const context = this.context;
    if (!context || !this.outdoorFilter || !this.brownNoise || this.muted) return;
    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = this.brownNoise;
    source.playbackRate.value = 0.35 + Math.random() * 0.15;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180 + near * 500;
    const gain = context.createGain();
    gain.gain.value = 0;
    const level = 0.35 + near * 0.45;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.05 + (1 - near) * 0.4);
    // Rolling: a few swells as the sound comes back from the clouds.
    let t = start + 0.4;
    for (let i = 0; i < 4; i++) {
      gain.gain.linearRampToValueAtTime(level * (0.35 + Math.random() * 0.5), t);
      t += 0.4 + Math.random() * 0.6;
    }
    gain.gain.linearRampToValueAtTime(0, t + 1.5);
    source.connect(filter).connect(gain).connect(this.outdoorFilter);
    source.start(start);
    source.stop(t + 1.6);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  /** Somebody honking a street or two away: one to three short beeps, left or right. */
  private distantHorn(now: number): void {
    const context = this.context;
    if (!context || !this.outdoorFilter) return;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800 + Math.random() * 900; // further away = duller
    const gain = context.createGain();
    gain.gain.value = 0;
    const pan = context.createStereoPanner ? context.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    filter.connect(gain).connect(pan ?? this.outdoorFilter);
    if (pan) pan.connect(this.outdoorFilter);
    const base = [330, 392, 440, 523][Math.floor(Math.random() * 4)];
    const level = 0.01 + Math.random() * 0.022;
    let t = now + 0.02;
    const beeps = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < beeps; i++) {
      const length = 0.1 + Math.random() * (i === beeps - 1 ? 0.45 : 0.18);
      gain.gain.setTargetAtTime(level, t, 0.008);
      gain.gain.setTargetAtTime(0, t + length, 0.02);
      t += length + 0.08 + Math.random() * 0.08;
    }
    for (const f of [base, base * 1.26]) {
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start(now);
      osc.stop(t + 0.2);
      osc.onended = () => osc.disconnect();
    }
    window.setTimeout(() => {
      filter.disconnect();
      gain.disconnect();
      pan?.disconnect();
    }, (t - now + 0.5) * 1000);
  }

  /** A small bird: two to five quick whistled notes. */
  private birdCall(now: number): void {
    const context = this.context;
    if (!context || !this.outdoorFilter) return;
    const osc = context.createOscillator();
    osc.type = 'sine';
    const gain = context.createGain();
    gain.gain.value = 0;
    const pan = context.createStereoPanner ? context.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.8 - 0.9;
    osc.connect(gain).connect(pan ?? this.outdoorFilter);
    if (pan) pan.connect(this.outdoorFilter);
    const level = 0.006 + Math.random() * 0.012;
    const f0 = 2600 + Math.random() * 2000;
    let t = now + 0.02;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const length = 0.05 + Math.random() * 0.08;
      const f = f0 * (0.9 + Math.random() * 0.25);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.75), t + length);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.012);
      gain.gain.linearRampToValueAtTime(0, t + length);
      t += length + 0.04 + Math.random() * 0.1;
    }
    osc.start(now);
    osc.stop(t + 0.05);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      pan?.disconnect();
    };
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
