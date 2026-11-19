import { useEffect, useState } from 'react';
import type { Game } from '../game/game.ts';

/**
 * The name of the road you have just turned onto, like a satnav or an open-world game: it
 * slides in at the lower left, stays a few seconds and fades. Names come from OpenStreetMap.
 */
export function StreetBanner({ game }: { game: Game }) {
  const [shown, setShown] = useState<{ name: string; key: number } | null>(null);
  useEffect(() => {
    let hide = 0;
    game.onStreet = (name) => {
      if (!name) return;
      setShown({ name, key: performance.now() });
      window.clearTimeout(hide);
      hide = window.setTimeout(() => setShown(null), 4500);
    };
    return () => {
      game.onStreet = null;
      window.clearTimeout(hide);
    };
  }, [game]);
  if (!shown) return null;
  return (
    <div className="streetBanner" key={shown.key} role="status">
      <span className="streetLabel">Now on</span>
      <span className="streetName">{shown.name}</span>
    </div>
  );
}
