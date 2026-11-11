import * as THREE from 'three';
import { OSM_ATTRIBUTION, TEST_AREA, isValidLatLng } from '@nukkad/shared';
import { areaUrl } from '../world/areaUrl.ts';
import { heightAt } from '@nukkad/worldgen';
import type { ReadyMessage, WorldInfo } from '../workers/protocol.ts';
import { WorldClient } from '../world/worldClient.ts';
import { WorldView } from '../world/worldView.ts';
import { FlyControls } from './flyControls.ts';
import { StatsMeter, formatStats } from './statsHud.ts';

/**
 * Phase 1 debug page: loads any place (lat/lng in the address bar or the form),
 * shows it in 3D with a free-fly camera and live counters.
 *
 * Address options:  ?lat=12.92&lng=77.69   place        &r=300        smaller area
 *                   &trees=300             tree limit   &windows=0    plain walls
 *                   &pr=1                  pixel ratio  &aa=0         no anti-aliasing
 */
const SKY = 0xbcd9f5;
const MAX_CHUNKS_IN_FLIGHT = 2; // PLAN §7: at most 2 chunks being built at a time

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const numberParam = (name: string, fallback: number): number => {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) ? value : fallback;
};

const canvas = $<HTMLCanvasElement>('view');
const statsBox = $('stats');
const statusBox = $('status');
const creditsBox = $('credits');
const latInput = $<HTMLInputElement>('lat');
const lngInput = $<HTMLInputElement>('lng');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: params.get('aa') !== '0', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, numberParam('pr', 1.5)));
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 250, 1500);
scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x8f8672, 2.2));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(-0.55, 1, 0.35);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2500);
const controls = new FlyControls(camera, canvas, $('stick'));

let view: WorldView | null = null;
let client: WorldClient | null = null;
let info: WorldInfo | null = null;
let chunksMs = 0;
let loadToken = 0;

const meter = new StatsMeter(renderer, (stats) => {
  const extra: string[] = [];
  if (view && info) {
    const total = info.chunksPerSide * info.chunksPerSide;
    extra.push(
      `chunks ${view.chunkCount}/${total} · ${view.counts.trees} trees · ${view.counts.lamps} lamps`,
      `${info.stats.buildings} buildings (${info.stats.heightsGuessed} heights guessed) · ${info.stats.roadKm} km roads`,
      `pack ${Math.round((info.downloadBytes || info.packBytes) / 1024)} KB${info.downloadBytes ? ' zipped' : ''} · get ${info.fetchMs.toFixed(0)} ms · build ${info.prepareMs.toFixed(0)} + ${chunksMs.toFixed(0)} ms`,
      `${info.id}${info.flatTerrain ? ' · FLAT (no elevation data)' : ''}`,
    );
  }
  statsBox.textContent = formatStats(stats, extra);
});

function setStatus(text: string, isError = false): void {
  statusBox.textContent = text;
  statusBox.hidden = text === '';
  statusBox.classList.toggle('error', isError);
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

/** Asks the worker for every chunk, nearest to the centre first, a couple at a time. */
async function loadChunks(ready: ReadyMessage, worldClient: WorldClient, worldView: WorldView, token: number): Promise<void> {
  const n = ready.info.chunksPerSide;
  const queue: [number, number][] = [];
  for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) queue.push([cx, cz]);
  const centre = (n - 1) / 2;
  queue.sort((a, b) => Math.hypot(a[0] - centre, a[1] - centre) - Math.hypot(b[0] - centre, b[1] - centre));
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next && token === loadToken; next = queue.shift()) {
      const message = await worldClient.requestChunk(next[0], next[1]);
      if (token !== loadToken) return;
      chunksMs += message.buildMs;
      worldView.addChunk(message.chunk);
    }
  };
  await Promise.all(Array.from({ length: MAX_CHUNKS_IN_FLIGHT }, worker));
}

async function loadPlace(lat: number, lng: number): Promise<void> {
  const token = ++loadToken;
  client?.dispose();
  view?.dispose();
  view = null;
  info = null;
  chunksMs = 0;
  latInput.value = String(lat);
  lngInput.value = String(lng);

  const url = areaUrl(lat, lng, numberParam('r', 0));
  const worldClient = new WorldClient();
  client = worldClient;
  setStatus('Getting the map… a brand-new place can take up to a minute (OpenStreetMap is a free, shared server).');
  try {
    const ready = await worldClient.load(url, (stage) => {
      if (stage === 'build' && token === loadToken) setStatus('Building the world…');
    });
    if (token !== loadToken) return;
    const worldView = new WorldView(ready, {
      maxTrees: numberParam('trees', 1000),
      windows: params.get('windows') !== '0',
      anisotropy: Math.min(4, renderer.capabilities.getMaxAnisotropy()),
    });
    view = worldView;
    info = ready.info;
    scene.add(worldView.group);
    worldView.setWireframe($<HTMLInputElement>('wireframe').checked);
    worldView.setChunkBorders($<HTMLInputElement>('borders').checked);
    creditsBox.querySelector('span')!.textContent = ready.info.attribution.slice(1).map((line) => ` · ${line}`).join('');

    // Start above the southern edge, looking north across the neighbourhood.
    const span = ready.info.halfSize;
    camera.position.set(0, heightAt(worldView.terrain, 0, span * 0.6) + span * 0.35, span * 0.6);
    controls.yaw = 0;
    controls.pitch = -0.5;
    setStatus('');
    await loadChunks(ready, worldClient, worldView, token);
  } catch (error) {
    if (token === loadToken) setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

$('place').addEventListener('submit', (event) => {
  event.preventDefault();
  const lat = Number(latInput.value);
  const lng = Number(lngInput.value);
  if (!isValidLatLng(lat, lng)) {
    setStatus('Type a latitude (-84 to 84) and a longitude (-180 to 180).', true);
    return;
  }
  const next = new URLSearchParams(location.search);
  next.set('lat', String(lat));
  next.set('lng', String(lng));
  history.replaceState(null, '', `?${next}`);
  void loadPlace(lat, lng);
});
$('testArea').addEventListener('click', () => void loadPlace(TEST_AREA.lat, TEST_AREA.lng));
$<HTMLInputElement>('wireframe').addEventListener('change', (event) => view?.setWireframe((event.target as HTMLInputElement).checked));
$<HTMLInputElement>('borders').addEventListener('change', (event) => view?.setChunkBorders((event.target as HTMLInputElement).checked));
$('togglePanel').addEventListener('click', () => $('panel').classList.toggle('closed'));
if (window.innerWidth < 600) $('panel').classList.add('closed'); // phones: keep the view free

// Handy in the browser console while developing: `nukkadDebug.camera.position`, etc.
if (import.meta.env.DEV) {
  Object.assign(window, { nukkadDebug: { camera, controls, renderer, scene, meter } });
}

window.addEventListener('resize', resize);
resize();
creditsBox.querySelector('a')!.textContent = OSM_ATTRIBUTION;

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dtMs = Math.min(100, now - last);
  last = now;
  const terrain = view?.terrain;
  controls.update(dtMs / 1000, (x, z) => (terrain ? heightAt(terrain, x, z) : 0));
  renderer.render(scene, camera);
  meter.frame(dtMs);
});

const startLat = numberParam('lat', TEST_AREA.lat);
const startLng = numberParam('lng', TEST_AREA.lng);
void loadPlace(isValidLatLng(startLat, startLng) ? startLat : TEST_AREA.lat, isValidLatLng(startLat, startLng) ? startLng : TEST_AREA.lng);
