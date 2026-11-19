import { useEffect, useState } from 'react';
import type { Game } from '../game/game.ts';

/** Parts of the day in Kannada, shown small under the clock. */
const KANNADA: Record<string, string> = { Morning: 'ಬೆಳಗ್ಗೆ', Afternoon: 'ಮಧ್ಯಾಹ್ನ', Evening: 'ಸಂಜೆ', Night: 'ರಾತ್ರಿ' };

/** The game's time of day under the minimap ("18:05 · Evening"), refreshed every second. */
export function GameClock({ game }: { game: Game }) {
  const [text, setText] = useState(() => game.clockText());
  useEffect(() => {
    const id = window.setInterval(() => setText(game.clockText()), 1000);
    return () => window.clearInterval(id);
  }, [game]);
  const part = Object.keys(KANNADA).find((p) => text.includes(p));
  return (
    <div className="gameClock">
      {text}
      {part && <span className="kannada">{KANNADA[part]}{text.includes('Rain') || text.includes('Storm') ? ' · ಮಳೆ' : ''}</span>}
    </div>
  );
}
