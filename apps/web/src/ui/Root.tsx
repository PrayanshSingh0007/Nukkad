import { useEffect, useState } from 'react';
import { ROOM_ID_PATTERN, TEST_AREA, cleanName, isValidLatLng } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';
import { Game } from '../game/game.ts';
import { startingQuality } from '../game/quality.ts';
import { loadLook } from '../player/avatar/lookStore.ts';
import { App } from './App.tsx';
import { createRoom, getRoom, loadName, saveName } from './api.ts';

type Screen =
  | { kind: 'home'; busy: boolean; error: string }
  | { kind: 'invite'; id: string; lat: number; lng: number; players: number; busy: boolean }
  | { kind: 'loadingRoom' }
  | { kind: 'missing'; message: string }
  | { kind: 'playing'; game: Game; id: string };

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const roomFromPath = (): string | null => {
  const match = /^\/r\/([a-z0-9]{12})\/?$/.exec(location.pathname);
  return match && ROOM_ID_PATTERN.test(match[1]) ? match[1] : null;
};

/** The spot a new room starts at: ?lat=&lng= in the address, else the test area (place picker: Phase 7). */
function startSpot(): [number, number] {
  const params = new URLSearchParams(location.search);
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  return params.has('lat') && isValidLatLng(lat, lng) ? [lat, lng] : [TEST_AREA.lat, TEST_AREA.lng];
}

function startGame(id: string, lat: number, lng: number, name: string, look: AvatarLook): Game {
  const params = new URLSearchParams(location.search);
  const quality = startingQuality(params.get('q'));
  const game = new Game({
    canvas: element<HTMLCanvasElement>('view'),
    stick: element('stick'),
    overlay: element('overlay'),
    logo: element('logo'),
    look,
    quality: quality.level,
    qualitySource: quality.source,
  });
  void game.start(lat, lng);
  game.join(id, name);
  if (import.meta.env.DEV) Object.assign(window, { nukkad: game });
  return game;
}

/** Home → invite → playing. No signup: a name is all you need. */
export function Root() {
  // Read the address once: after "Start a Nukkad" it changes to /r/<id>, which must not reopen the invite.
  const [roomId] = useState(roomFromPath);
  const [screen, setScreen] = useState<Screen>(roomId ? { kind: 'loadingRoom' } : { kind: 'home', busy: false, error: '' });
  const [name, setName] = useState(loadName());
  const [look] = useState(loadLook);

  useEffect(() => {
    if (!roomId) return;
    getRoom(roomId)
      .then((room) => setScreen({ kind: 'invite', id: room.id, lat: room.lat, lng: room.lng, players: room.players, busy: false }))
      .catch((error: Error) => setScreen({ kind: 'missing', message: error.message }));
  }, [roomId]);

  const cleaned = cleanName(name);
  const play = (id: string, lat: number, lng: number): void => {
    if (!cleaned) return;
    saveName(cleaned);
    setScreen({ kind: 'playing', game: startGame(id, lat, lng, cleaned, look), id });
  };

  const start = async (): Promise<void> => {
    if (!cleaned) return;
    setScreen({ kind: 'home', busy: true, error: '' });
    try {
      const [lat, lng] = startSpot();
      const room = await createRoom(lat, lng);
      history.replaceState(null, '', `/r/${room.id}`);
      play(room.id, room.lat, room.lng);
    } catch (error) {
      setScreen({ kind: 'home', busy: false, error: (error as Error).message });
    }
  };

  if (screen.kind === 'playing') return <App game={screen.game} initialLook={look} roomId={screen.id} />;

  const nameField = (
    <label className="field">
      <span>Your name</span>
      <input value={name} maxLength={16} autoComplete="nickname" placeholder="e.g. Ria, Arjun, Sam" onChange={(event) => setName(event.target.value)} />
    </label>
  );

  return (
    <div className="cover">
      <h1>Nukkad</h1>
      {screen.kind === 'home' && (
        <>
          <p>Hang out with your friends in a 3D copy of a real neighbourhood. Pick a name and start one.</p>
          {nameField}
          <button type="button" disabled={!cleaned || screen.busy} onClick={() => void start()}>
            {screen.busy ? 'Starting…' : 'Start a Nukkad'}
          </button>
          {screen.error && <p className="errorText">{screen.error}</p>}
        </>
      )}
      {screen.kind === 'loadingRoom' && <p>Opening the invite…</p>}
      {screen.kind === 'invite' && (
        <>
          <p>
            You're invited! {screen.players > 0 ? `${screen.players} friend${screen.players > 1 ? 's are' : ' is'} already here.` : 'Nobody is here yet.'}
          </p>
          {nameField}
          <button type="button" disabled={!cleaned} onClick={() => play(screen.id, screen.lat, screen.lng)}>
            Join
          </button>
        </>
      )}
      {screen.kind === 'missing' && (
        <>
          <p className="errorText">{screen.message}</p>
          <button
            type="button"
            onClick={() => {
              history.replaceState(null, '', '/');
              setScreen({ kind: 'home', busy: false, error: '' });
            }}
          >
            Start your own Nukkad
          </button>
        </>
      )}
      <small className="privacy">No signup. Your name and look stay on this device. Map © OpenStreetMap contributors.</small>
    </div>
  );
}
