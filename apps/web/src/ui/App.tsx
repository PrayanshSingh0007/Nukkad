import { useEffect, useRef, useState } from 'react';
import type { AvatarLook } from '@nukkad/shared';
import type { Game, GameStatus } from '../game/game.ts';
import { saveLook } from '../player/avatar/lookStore.ts';
import { AvatarPanel } from './AvatarPanel.tsx';
import { PlacesPanel } from './PlacesPanel.tsx';
import { Speedometer } from './Speedometer.tsx';
import { MiniMap } from './MiniMap.tsx';
import { BigMap } from './BigMap.tsx';
import { LoadingScreen } from './LoadingScreen.tsx';
import { GameClock } from './GameClock.tsx';
import { StreetBanner } from './StreetBanner.tsx';
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

/** Photo mode looks: CSS filters on the picture (also baked into saved photos). */
const PHOTO_LOOKS: [name: string, filter: string][] = [
  ['Natural', ''],
  ['Golden', 'sepia(0.28) saturate(1.3) brightness(1.04) contrast(1.05)'],
  ['Monsoon', 'saturate(0.72) hue-rotate(-10deg) contrast(1.12) brightness(0.96)'],
  ['Noir', 'grayscale(1) contrast(1.35) brightness(0.95)'],
];

/** Everything drawn on top of the 3D view: loading / error messages and the look panel. */
export function App({ game, initialLook, roomId }: Props) {
  const [players, setPlayers] = useState(1);
  const [riding, setRiding] = useState(false);
  const [driveLabel, setDriveLabel] = useState<string | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [photoLook, setPhotoLook] = useState(0);
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (event.code === 'KeyM') setMapOpen((open) => !open);
      if (event.code === 'KeyP') setPhoto((on) => !on);
      if (event.code === 'Escape') setPhoto(false);
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
    game.setPhotoMode(photo);
    if (photo) game.setPhotoFilter(PHOTO_LOOKS[photoLook][1]);
  }, [game, photo, photoLook]);
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
      {status.phase !== 'playing' && <LoadingScreen message={status.message} error={status.phase === 'error'} onBack={() => location.assign('/')} />}
      {status.phase === 'playing' && photo && (
        <>
          <div className="photoBars" aria-hidden="true" />
          <div className="photoBar" role="toolbar" aria-label="Photo mode">
            {PHOTO_LOOKS.map(([name], index) => (
              <button key={name} type="button" className={index === photoLook ? 'picked' : ''} aria-pressed={index === photoLook} onClick={() => setPhotoLook(index)}>
                {name}
              </button>
            ))}
            <button type="button" className="save" onClick={() => game.takePhoto(PHOTO_LOOKS[photoLook][1])}>
              Save photo
            </button>
            <button type="button" onClick={() => setPhoto(false)}>
              Done
            </button>
            <span className="photoTip">Drag to look around · scroll to zoom · P to close</span>
          </div>
        </>
      )}
      {status.phase === 'playing' && !panelOpen && !photo && (
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
          <button type="button" onClick={() => setPhoto(true)}>
            Photo
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {status.phase === 'playing' && !panelOpen && !mapOpen && !photo && <MiniMap game={game} onOpen={() => setMapOpen(true)} />}
      {status.phase === 'playing' && !panelOpen && !mapOpen && !photo && <GameClock game={game} />}
      {status.phase === 'playing' && !panelOpen && !mapOpen && !photo && <StreetBanner game={game} />}
      {status.phase === 'playing' && mapOpen && <BigMap game={game} onClose={() => setMapOpen(false)} />}
      {status.phase === 'playing' && speed && !photo && <Speedometer speed={speed.v} max={speed.max} label={speed.label} />}
      {status.phase === 'playing' && !panelOpen && !photo && driveLabel && (
        <button type="button" className={driveLabel === 'Get out' ? 'driveButton out' : 'driveButton'} onClick={() => game.toggleDrive()}>
          {driveLabel}
        </button>
      )}
      {status.phase === 'playing' && !panelOpen && !photo && driveLabel !== 'Get out' && (
        <button type="button" className={riding ? 'rideButton on' : 'rideButton'} onClick={() => game.toggleRide()}>
          {riding ? 'Walk' : 'Ride'}
        </button>
      )}
      {status.phase === 'playing' && !panelOpen && !photo && !riding && driveLabel !== 'Get out' && (
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
      {status.phase === 'playing' && !panelOpen && !photo && riding && (
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
      {status.phase === 'playing' && !panelOpen && !photo && riding && (
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
