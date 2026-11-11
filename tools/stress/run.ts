// Stress test (PLAN §12): 8 fake players with random lag (50–400 ms) and packet loss (0–10 %)
// join one room on a real Nukkad server and walk around. A 9th must be turned away.
//
//   npm run stress            (20 seconds)   ·   npm run stress -- 60   (60 seconds)
import type { AddressInfo } from 'node:net';
import { DEFAULT_LOOK, FLAG_GROUNDED, TICK_HZ, decodeSnapshot, encodeState, parseServerMessage } from '@nukkad/shared';
import { AreaService } from '../../apps/server/src/areas/areaService.ts';
import { createApp } from '../../apps/server/src/http/app.ts';
import { RealtimeHub } from '../../apps/server/src/realtime/hub.ts';
import { RoomManager } from '../../apps/server/src/realtime/rooms.ts';
import { MemoryAreaStore } from '../../apps/server/src/store/areaStore.ts';

const SECONDS = Number(process.argv[2]) || 20;
const BOTS = 8;

const rooms = new RoomManager();
const areas = new AreaService({
  store: new MemoryAreaStore(),
  source: { fetchOsm: () => Promise.reject(new Error('not used')), loadSampler: async () => null },
});
const app = createApp({ areas, rooms, allowedOrigins: [], trustProxy: false });
const hub = new RealtimeHub({ rooms, allowedOrigins: [], trustProxy: false });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
hub.attach(server);
const port = (server.address() as AddressInfo).port;
const room = (await (await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: 12.92, lng: 77.69 }) })).json()) as { id: string };

interface BotResult {
  lagMs: number;
  lossPct: number;
  snapshots: number;
  maxGapMs: number;
  maxSeen: number;
  error: string;
}

/** A fake player. Lag delays everything; "loss" on TCP means a resend: that message and the ones behind it wait longer. */
function bot(index: number): Promise<BotResult> {
  const lagMs = 50 + Math.random() * 350;
  const lossPct = Math.random() * 10;
  const result: BotResult = { lagMs, lossPct, snapshots: 0, maxGapMs: 0, maxSeen: 0, error: '' };
  // One ordered queue per bot, like a TCP connection: nothing overtakes anything else.
  const queue: { at: number; fn: () => void }[] = [];
  let timer: NodeJS.Timeout | undefined;
  const pump = (): void => {
    timer = undefined;
    while (queue.length > 0 && queue[0].at <= Date.now()) (queue.shift() as { fn: () => void }).fn();
    if (queue.length > 0) timer = setTimeout(pump, queue[0].at - Date.now());
  };
  const delayed = (fn: () => void): void => {
    const resend = Math.random() * 100 < lossPct ? 200 + lagMs : 0;
    const last = queue.length > 0 ? queue[queue.length - 1].at : 0;
    queue.push({ at: Math.max(Date.now() + lagMs / 2 + resend, last), fn });
    if (!timer) timer = setTimeout(pump, Math.max(0, queue[0].at - Date.now()));
  };
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.binaryType = 'arraybuffer';
    let lastSnapshot = 0;
    let sender: NodeJS.Timeout | undefined;
    let seq = 0;
    const started = Date.now();
    socket.onopen = () => delayed(() => socket.send(JSON.stringify({ t: 'join', room: room.id, name: `Bot ${index}`, look: DEFAULT_LOOK })));
    socket.onmessage = (event) => {
      delayed(() => {
        if (typeof event.data === 'string') {
          const message = parseServerMessage(event.data);
          if (message?.t === 'error') result.error = message.code;
          if (message?.t === 'welcome') {
            sender = setInterval(() => {
              const t = (Date.now() - started) / 1000;
              const angle = t * 0.5 + index;
              const state = { seq: seq++, x: Math.cos(angle) * 20 + index * 5, y: 10, z: Math.sin(angle) * 20, yaw: angle, speed: 4, flags: FLAG_GROUNDED };
              delayed(() => socket.readyState === WebSocket.OPEN && socket.send(encodeState(state)));
            }, 1000 / TICK_HZ);
          }
          return;
        }
        const snapshot = decodeSnapshot(event.data as ArrayBuffer);
        if (!snapshot) return;
        const now = Date.now();
        if (lastSnapshot && now - started > 2000) result.maxGapMs = Math.max(result.maxGapMs, now - lastSnapshot);
        lastSnapshot = now;
        result.snapshots++;
        result.maxSeen = Math.max(result.maxSeen, snapshot.players.length);
      });
    };
    socket.onclose = () => {
      clearInterval(sender);
      resolve(result);
    };
    setTimeout(() => {
      clearInterval(sender);
      socket.close();
    }, SECONDS * 1000);
  });
}

console.log(`Stress test: ${BOTS} bots + 1 extra, ${SECONDS} s, room ${room.id}`);
const cpuBefore = process.cpuUsage();
const t0 = Date.now();
const running = Array.from({ length: BOTS }, (_, i) => bot(i));
await new Promise((resolve) => setTimeout(resolve, 3000));
const ninth = await new Promise<string>((resolve) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ t: 'join', room: room.id, name: 'Ninth', look: DEFAULT_LOOK }));
  socket.onmessage = (event) => resolve(parseServerMessage(String(event.data))?.t === 'error' ? 'turned away (room_full)' : 'LET IN — WRONG');
  setTimeout(() => resolve('no answer — WRONG'), 3000);
});
const results = await Promise.all(running);
const seconds = (Date.now() - t0) / 1000;
const cpu = process.cpuUsage(cpuBefore);
const cpuPct = ((cpu.user + cpu.system) / 1000 / (seconds * 1000)) * 100;
const memoryMb = process.memoryUsage().rss / 1048576;

let pass = ninth.startsWith('turned away');
console.log('\nbot  lag ms  loss %  snapshots/s  worst gap ms  players seen  error');
results.forEach((r, i) => {
  const rate = r.snapshots / (seconds - 0.5);
  const ok = rate >= 12 && r.maxSeen === BOTS && !r.error;
  if (!ok) pass = false;
  console.log(`${String(i).padStart(3)}  ${r.lagMs.toFixed(0).padStart(6)}  ${r.lossPct.toFixed(1).padStart(6)}  ${rate.toFixed(1).padStart(11)}  ${String(r.maxGapMs).padStart(12)}  ${String(r.maxSeen).padStart(12)}  ${r.error || '-'}`);
});
const room0 = rooms.get(room.id);
const rejected = room0?.members.reduce((sum, m) => sum + (m?.rejected ?? 0), 0) ?? 0;
console.log(`\n9th player: ${ninth}`);
console.log(`states rejected by the server's checks: ${rejected}`);
console.log(`server + bots in one process: CPU ${cpuPct.toFixed(1)} % · memory ${memoryMb.toFixed(0)} MB`);
console.log(pass ? '\nPASS' : '\nFAIL');
hub.close();
server.close();
process.exit(pass ? 0 : 1);
