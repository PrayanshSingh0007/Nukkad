import { useEffect, useState } from 'react';
import type { Game } from '../game/game.ts';

/** The game's time of day under the minimap ("18:05 · Evening"), refreshed every second. */
export function GameClock({ game }: { game: Game }) {
  const [text, setText] = useState(() => game.clockText());
  useEffect(() => {
    const id = window.setInterval(() => setText(game.clockText()), 1000);
    return () => window.clearInterval(id);
  }, [game]);
  return <div className="gameClock">{text}</div>;
}
