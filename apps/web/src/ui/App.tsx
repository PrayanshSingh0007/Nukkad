import { useEffect, useRef, useState } from 'react';
import type { AvatarLook } from '@nukkad/shared';
import type { Game, GameStatus } from '../game/game.ts';
import { saveLook } from '../player/avatar/lookStore.ts';
import { AvatarPanel } from './AvatarPanel.tsx';
import { PlacesPanel } from './PlacesPanel.tsx';
import { Speedometer } from './Speedometer.tsx';
import { MiniMap } from './MiniMap.tsx';
import { BigMap } from './BigMap.tsx';
import { setAutojoin } from './api.ts';

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
  const [riding, setRiding] = useState(false);
  const [driveLabel, setDriveLabel] = useState<string | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.code === 'KeyM' && (event.target as HTMLElement | null)?.tagName !== 'INPUT') setMapOpen((open) => !open);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const [speed, setSpeed] = useState<{ v: number; max: number; label: string } | null>(null);
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState<GameStatus>({ phase: 'loading', message: 'Starting…' });
  const [look, setLook] = useState(initialLook);
  const latest = useRef(initialLook); // always the newest look, even between two fast taps
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => game.onStatus(setStatus), [game]);
  useEffect(() => {
    game.onPlayerCount = setPlayers;
    game.onRiding = setRiding;
    game.onDriveHint = setDriveLabel;
    game.onToast = setToast;
    game.onSpeed = (v, max, label) => setSpeed(max > 0 ? { v, max, label } : null);
    // The room is moving: show who is taking everyone where, then load the new place.
    game.onTravel = (place, by) => {
      setPlacesOpen(false);
      setToast(`${by} ${by === 'You' ? 'are' : 'is'} taking everyone to ${place}…`);
      setAutojoin(roomId);
      setTimeout(() => location.reload(), 1500);
    };
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
          <button type="button" onClick={() => setPlacesOpen(true)}>
            Places
          </button>
          <button type="button" onClick={() => void invite(roomId).then(setToast)}>
            Invite friends
          </button>
          <button type="button" onClick={() => setPanelOpen(true)}>
            Your look
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {status.phase === 'playing' && !panelOpen && !mapOpen && <MiniMap game={game} onOpen={() => setMapOpen(true)} />}
      {status.phase === 'playing' && mapOpen && <BigMap game={game} onClose={() => setMapOpen(false)} />}
      {status.phase === 'playing' && speed && <Speedometer speed={speed.v} max={speed.max} label={speed.label} />}
      {status.phase === 'playing' && !panelOpen && driveLabel && (
        <button type="button" className="driveButton" onClick={() => game.toggleDrive()}>
          {driveLabel}
        </button>
      )}
      {status.phase === 'playing' && !panelOpen && driveLabel !== 'Get out' && (
        <button type="button" className={riding ? 'rideButton on' : 'rideButton'} onClick={() => game.toggleRide()}>
          {riding ? 'Walk' : 'Ride'}
        </button>
      )}
      {status.phase === 'playing' && !panelOpen && !riding && driveLabel !== 'Get out' && (
        <div className="emotes">
          {emoteOpen && (
            <div className="emoteMenu">
              {(
                [
                  ['wave', 'Wave'],
                  ['dance', 'Dance'],
                  ['sit', 'Sit'],
                  ['talk', 'Talk'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    game.doEmote(id);
                    setEmoteOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="emoteButton" onClick={() => setEmoteOpen(!emoteOpen)}>
            {emoteOpen ? 'Close' : 'Emote'}
          </button>
        </div>
      )}
      {status.phase === 'playing' && !panelOpen && riding && (
        <button
          type="button"
          className="hornButton"
          onPointerDown={() => game.setHorn(true)}
          onPointerUp={() => game.setHorn(false)}
          onPointerLeave={() => game.setHorn(false)}
        >
          Horn
        </button>
      )}
      {status.phase === 'playing' && !panelOpen && riding && (
        <button
          type="button"
          className="driftButton"
          onPointerDown={() => game.setHandbrake(true)}
          onPointerUp={() => game.setHandbrake(false)}
          onPointerLeave={() => game.setHandbrake(false)}
        >
          Drift
        </button>
      )}
      {placesOpen && <PlacesPanel action="Go with everyone" onPick={(place) => game.travel(place.lat, place.lng, place.name)} onClose={() => setPlacesOpen(false)} />}
      {panelOpen && <AvatarPanel look={look} onChange={changeLook} onClose={() => setPanelOpen(false)} />}
    </>
  );
}
