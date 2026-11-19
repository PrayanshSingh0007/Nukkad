interface Props {
  /** Metres per second (negative = reversing). */
  speed: number;
  /** Top speed of the vehicle, m/s (the dial's end). */
  max: number;
  label: string;
}

const START = 135; // degrees, the dial runs clockwise from bottom-left…
const SWEEP = 270; // …to bottom-right

function arc(fraction: number, r: number): string {
  const end = START + SWEEP * Math.max(0.001, Math.min(1, fraction));
  const point = (deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${50 + r * Math.cos(a)} ${50 + r * Math.sin(a)}`;
  };
  return `M ${point(START)} A ${r} ${r} 0 ${end - START > 180 ? 1 : 0} 1 ${point(end)}`;
}

const TICKS = Array.from({ length: 11 }, (_, i) => i);

/** A short line on the dial at `step` of 10 (0 = start, 10 = end), from radius `inner` to 37. */
function tick(step: number, inner: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = ((START + (SWEEP * step) / 10) * Math.PI) / 180;
  return { x1: 50 + inner * Math.cos(a), y1: 50 + inner * Math.sin(a), x2: 50 + 37 * Math.cos(a), y2: 50 + 37 * Math.sin(a) };
}

/** The last 15 % of the dial, in red. */
function redline(): string {
  const point = (deg: number): string => `${50 + 47 * Math.cos((deg * Math.PI) / 180)} ${50 + 47 * Math.sin((deg * Math.PI) / 180)}`;
  return `M ${point(START + SWEEP * 0.85)} A 47 47 0 0 1 ${point(START + SWEEP)}`;
}

/** A round speed dial in km/h, shown while you ride or drive. */
export function Speedometer({ speed, max, label }: Props) {
  const kmh = Math.round(Math.abs(speed) * 3.6);
  const top = Math.round(max * 3.6);
  const fraction = Math.abs(speed) / max;
  return (
    <div className="speedo" aria-label={`${kmh} kilometres per hour`}>
      <svg viewBox="0 0 100 100">
        <defs>
          <linearGradient id="speedoGrad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#3fd8ff" />
            <stop offset="0.6" stopColor="#ffd34a" />
            <stop offset="1" stopColor="#ff4a3a" />
          </linearGradient>
        </defs>
        <path d={arc(1, 42)} className="speedoTrack" />
        <path d={redline()} className="speedoRed" />
        {TICKS.map((t) => (
          <line key={t} {...tick(t, t % 2 === 0 ? 30 : 33)} className={t % 2 === 0 ? 'speedoTick major' : 'speedoTick'} />
        ))}
        <path d={arc(fraction, 42)} className={fraction > 0.85 ? 'speedoFill hot' : 'speedoFill'} />
      </svg>
      <div className="speedoText">
        <strong>{speed < -0.3 ? 'R' : kmh}</strong>
        <span>km/h</span>
        <small>
          {label} · {top}
        </small>
      </div>
    </div>
  );
}
