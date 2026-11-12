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

/** A round speed dial in km/h, shown while you ride or drive. */
export function Speedometer({ speed, max, label }: Props) {
  const kmh = Math.round(Math.abs(speed) * 3.6);
  const top = Math.round(max * 3.6);
  const fraction = Math.abs(speed) / max;
  return (
    <div className="speedo" aria-label={`${kmh} kilometres per hour`}>
      <svg viewBox="0 0 100 100">
        <path d={arc(1, 42)} className="speedoTrack" />
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
