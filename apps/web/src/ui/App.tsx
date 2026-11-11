import { useEffect, useRef, useState } from 'react';
import type { AvatarLook } from '@nukkad/shared';
import type { Game, GameStatus } from '../game/game.ts';
import { saveLook } from '../player/avatar/lookStore.ts';
import { AvatarPanel } from './AvatarPanel.tsx';

interface Props {
  game: Game;
  initialLook: AvatarLook;
  roomId: string;
}

/** Shares the invite link (phone share sheet), or copies it. */
async function invite(roomId: string): Promise<string> {
  const url = `${location.origin}/r/${roomId}`;
  const data = { title: 'Nukkad', text: 'Come hang out with me on Nukkad!', url };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return '';
    }
    await navigator.clipboard.writeText(url);
    return 'Link copied!';
  } catch (error) {
    if ((error as Error).name === 'AbortError') return '';
    window.prompt('Copy this invite link and send it to your friends:', url);
    return '';
  }
}

/** Everything drawn on top of the 3D view: loading / error messages and the look panel. */
export function App({ game, initialLook, roomId }: Props) {
  const [players, setPlayers] = useState(1);
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState<GameStatus>({ phase: 'loading', message: 'Starting…' });
  const [look, setLook] = useState(initialLook);
  const latest = useRef(initialLook); // always the newest look, even between two fast taps
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => game.onStatus(setStatus), [game]);
  useEffect(() => {
    game.onPlayerCount = setPlayers;
  }, [game]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

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
            <button type="button" onClick={() => location.assign('/')}>
              Back to start
            </button>
          )}
        </div>
      )}
      {status.phase === 'playing' && !panelOpen && (
        <div className="hudButtons">
          <span className="people" aria-label={`${players} in this Nukkad`}>
            {players}/8
          </span>
          <button type="button" onClick={() => void invite(roomId).then(setToast)}>
            Invite friends
          </button>
          <button type="button" onClick={() => setPanelOpen(true)}>
            Your look
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {panelOpen && <AvatarPanel look={look} onChange={changeLook} onClose={() => setPanelOpen(false)} />}
    </>
  );
}
