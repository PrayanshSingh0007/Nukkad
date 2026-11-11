import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TEST_AREA, isValidLatLng } from '@nukkad/shared';
import { Game } from './game/game.ts';
import { startingQuality } from './game/quality.ts';
import { loadLook } from './player/avatar/lookStore.ts';
import { App } from './ui/App.tsx';
import './ui/ui.css';

/**
 * The game page. Until the place picker exists (Phase 7) the place comes from the
 * address bar: ?lat=..&lng=..  (default: the built-in test area).
 * Other options: &r=300 smaller area · &q=low|medium|high quality
 */
const params = new URLSearchParams(location.search);
const numberParam = (name: string, fallback: number): number => {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) ? value : fallback;
};
const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const look = loadLook();
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

createRoot(element('ui')).render(
  <StrictMode>
    <App game={game} initialLook={look} />
  </StrictMode>,
);

const lat = numberParam('lat', TEST_AREA.lat);
const lng = numberParam('lng', TEST_AREA.lng);
const valid = isValidLatLng(lat, lng);
void game.start(valid ? lat : TEST_AREA.lat, valid ? lng : TEST_AREA.lng, numberParam('r', 0));

// Handy in the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { nukkad: game });
