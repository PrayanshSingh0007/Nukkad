import { useEffect, useRef, useState } from 'react';
import type { AvatarLook } from '@nukkad/shared';
import type { Game, GameStatus } from '../game/game.ts';
import { saveLook } from '../player/avatar/lookStore.ts';
import { AvatarPanel } from './AvatarPanel.tsx';

interface Props {
  game: Game;
  initialLook: AvatarLook;
}

/** Everything drawn on top of the 3D view: loading / error messages and the look panel. */
export function App({ game, initialLook }: Props) {
  const [status, setStatus] = useState<GameStatus>({ phase: 'loading', message: 'Starting…' });
  const [look, setLook] = useState(initialLook);
  const latest = useRef(initialLook); // always the newest look, even between two fast taps
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => game.onStatus(setStatus), [game]);

  const changeLook = (change: Partial<AvatarLook>): void => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setLook(next);
    saveLook(next);
    game.setLook(next);
  };

  return (
    <>
      {status.phase !== 'playing' && (
        <div className={status.phase === 'error' ? 'cover error' : 'cover'} role="status">
          <h1>Nukkad</h1>
          <p>{status.message}</p>
          {status.phase === 'error' && (
            <button type="button" onClick={() => location.reload()}>
              Try again
            </button>
          )}
        </div>
      )}
      {status.phase === 'playing' && !panelOpen && (
        <button type="button" className="lookButton" onClick={() => setPanelOpen(true)}>
          Your look
        </button>
      )}
      {panelOpen && <AvatarPanel look={look} onChange={changeLook} onClose={() => setPanelOpen(false)} />}
    </>
  );
}
