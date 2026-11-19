import { useEffect, useState } from 'react';

/**
 * The loading screen: the title over a dusk city skyline, a progress bar that follows the
 * real loading stages (map → world → almost there), and a tip about the controls every few
 * seconds. The bar only moves when a stage really finishes; it never pretends.
 */
const STAGES: [prefix: string, progress: number][] = [
  ['Starting', 0.06],
  ['Getting the map', 0.28],
  ['Building the world', 0.6],
  ['Almost there', 0.88],
];

const TIPS = [
  'Press E next to a parked car to get in. E again gets you out.',
  'Hold Space while turning to drift.',
  'Press R to hop on your own scooter.',
  'Press M for the big map of the neighbourhood.',
  'H sounds the horn.',
  'Walk up to a front door and press E to go inside.',
  'Invite friends: everyone in your room sees each other live.',
];

// A skyline drawn once: blocks of different heights, some windows lit.
const BLOCKS = Array.from({ length: 34 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: i * 30, w: 22 + r(1) * 14, h: 40 + r(2) * r(3) * 150, lit: Array.from({ length: 6 }, (_, k) => r(4 + k) > 0.72) };
});

export function LoadingScreen({ message, error, onBack }: { message: string; error: boolean; onBack: () => void }) {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % TIPS.length), 4000);
    return () => window.clearInterval(id);
  }, []);
  const progress = STAGES.find(([prefix]) => message.startsWith(prefix))?.[1] ?? 0.15;

  return (
    <div className={error ? 'cover loading error' : 'cover loading'} role="status">
      <svg className="skyline" viewBox="0 0 1020 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        {BLOCKS.map((b) => (
          <g key={b.x}>
            <rect x={b.x} y={200 - b.h} width={b.w} height={b.h} />
            {b.lit.map((on, k) =>
              on ? <rect key={k} className="lit" x={b.x + 4 + (k % 2) * 9} y={200 - b.h + 10 + Math.floor(k / 2) * 16} width="5" height="7" /> : null,
            )}
          </g>
        ))}
      </svg>
      <h1>Nukkad</h1>
      <p>{message}</p>
      {!error && (
        <>
          <div className="loadBar" aria-hidden="true">
            <div className="loadFill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="tip" key={tip}>
            {TIPS[tip]}
          </p>
        </>
      )}
      {error && (
        <button type="button" onClick={onBack}>
          Back to start
        </button>
      )}
    </div>
  );
}
