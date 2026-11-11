import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import { MAX_JSON_BYTES, TICK_HZ, decodeState, encodeSnapshot, parseClientMessage } from '@nukkad/shared';
import type { ServerMessage } from '@nukkad/shared';
import { TokenBuckets } from '../security/tokenBuckets.ts';
import type { RoomManager } from './rooms.ts';

export interface HubOptions {
  rooms: RoomManager;
  /** Allowed page origins. Empty = only same-host pages (dev). */
  allowedOrigins: string[];
  trustProxy: boolean;
  log?: (message: string) => void;
}

const SKIP_IF_BUFFERED = 64 * 1024; // a slow phone skips snapshots instead of piling them up
const MAX_DROPPED = 300; // a client that keeps flooding us is disconnected

interface Connection {
  socket: WebSocket;
  roomId: string | null;
  slot: number;
  stateBucket: TokenBuckets;
  jsonBucket: TokenBuckets;
  dropped: number;
}

/**
 * The realtime side: one WebSocket per player on /ws. Runs the 15 Hz snapshot loop
 * and enforces the guards of PLAN §6.4 (size caps, rate limits, validation, origin).
 */
export class RealtimeHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_JSON_BYTES });
  private readonly connections = new Set<Connection>();
  private readonly joinsPerIp = new TokenBuckets(20, 10);
  private readonly options: HubOptions;
  private readonly startedAt = Date.now();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly log: (message: string) => void;

  constructor(options: HubOptions) {
    this.options = options;
    this.log = options.log ?? (() => {});
    this.wss.on('connection', (socket, request) => this.onConnection(socket, request));
    this.timers.push(setInterval(() => this.broadcastSnapshots(), 1000 / TICK_HZ));
    this.timers.push(setInterval(() => this.sweep(), 2000));
  }

  /** Hooks the hub into the HTTP server: upgrades requests for /ws. */
  attach(server: Server): void {
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '/', 'http://local');
      if (url.pathname !== '/ws' || !this.originAllowed(request)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit('connection', ws, request));
    });
  }

  get playerCount(): number {
    return this.connections.size;
  }

  close(): void {
    for (const timer of this.timers) clearInterval(timer);
    for (const connection of this.connections) connection.socket.terminate();
    this.wss.close();
  }

  private originAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return true; // not a browser (stress test, tools): other guards still apply
    if (this.options.allowedOrigins.includes(origin)) return true;
    try {
      const host = request.headers['x-forwarded-host'] ?? request.headers.host;
      return new URL(origin).host === host; // same host (the Vite dev proxy keeps the Host header)
    } catch {
      return false;
    }
  }

  private ipOf(request: IncomingMessage): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (this.options.trustProxy && typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return request.socket.remoteAddress ?? 'unknown';
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private toRoom(roomId: string, message: ServerMessage, except?: Connection): void {
    for (const c of this.connections) if (c.roomId === roomId && c !== except) this.send(c.socket, message);
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const connection: Connection = {
      socket,
      roomId: null,
      slot: -1,
      stateBucket: new TokenBuckets(60, 20 * 60), // 4 s of catch-up after a network stall
      jsonBucket: new TokenBuckets(20, 10 * 60),
      dropped: 0,
    };
    this.connections.add(connection);
    const ip = this.ipOf(request);
    socket.on('message', (data, isBinary) => this.onMessage(connection, data, isBinary, ip));
    socket.on('close', () => {
      this.connections.delete(connection);
      if (connection.roomId) this.options.rooms.disconnect(connection.roomId, connection.slot);
    });
    socket.on('error', () => socket.terminate());
  }

  private drop(connection: Connection): void {
    if (++connection.dropped > MAX_DROPPED) connection.socket.close(1008, 'too many messages');
  }

  private onMessage(c: Connection, data: RawData, isBinary: boolean, ip: string): void {
    const rooms = this.options.rooms;
    if (isBinary) {
      if (!c.roomId || !c.stateBucket.consume('s')) return this.drop(c);
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      const state = decodeState(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      if (!state) return this.drop(c);
      rooms.applyState(c.roomId, c.slot, state);
      return;
    }
    if (!c.jsonBucket.consume('j')) return this.drop(c);
    const message = parseClientMessage(data.toString());
    if (!message) {
      this.send(c.socket, { t: 'error', code: 'bad_message', message: 'That message was not understood.' });
      return this.drop(c);
    }
    if (message.t === 'ping') {
      this.send(c.socket, { t: 'pong', c: message.c, s: Date.now() - this.startedAt });
    } else if (message.t === 'join') {
      if (c.roomId) return;
      if (!this.joinsPerIp.consume(ip)) {
        this.send(c.socket, { t: 'error', code: 'slow_down', message: 'Too many joins. Wait a minute and try again.' });
        return;
      }
      const result = rooms.join(message.room, message.name, message.look, message.token);
      if (!result.ok) {
        const text = result.code === 'room_full' ? 'This Nukkad is full (8 friends max).' : 'This invite link has expired or is wrong.';
        this.send(c.socket, { t: 'error', code: result.code, message: text });
        c.socket.close(1000);
        return;
      }
      // A rejoin replaces any older connection still holding the same slot.
      for (const other of this.connections) {
        if (other !== c && other.roomId === message.room && other.slot === result.member.slot) {
          other.roomId = null;
          other.socket.close(4000, 'replaced');
        }
      }
      c.roomId = message.room;
      c.slot = result.member.slot;
      const room = rooms.get(message.room);
      this.send(c.socket, { t: 'welcome', slot: c.slot, token: result.member.token, room: room!.info, players: rooms.players(message.room) });
      if (!result.rejoined) this.toRoom(message.room, { t: 'joined', player: { slot: c.slot, name: result.member.name, look: result.member.look } }, c);
      else this.toRoom(message.room, { t: 'look', slot: c.slot, look: result.member.look }, c);
    } else if (message.t === 'leave' && c.roomId) {
      rooms.leave(c.roomId, c.slot);
      this.toRoom(c.roomId, { t: 'left', slot: c.slot }, c);
      c.roomId = null;
      c.socket.close(1000);
    } else if (message.t === 'look' && c.roomId) {
      rooms.setLook(c.roomId, c.slot, message.look);
      this.toRoom(c.roomId, { t: 'look', slot: c.slot, look: message.look }, c);
    }
  }

  private broadcastSnapshots(): void {
    const serverTime = Date.now() - this.startedAt;
    const cache = new Map<string, ArrayBuffer>();
    for (const c of this.connections) {
      if (!c.roomId || c.socket.readyState !== c.socket.OPEN || c.socket.bufferedAmount > SKIP_IF_BUFFERED) continue;
      let packet = cache.get(c.roomId);
      if (!packet) {
        packet = encodeSnapshot({ serverTime, players: this.options.rooms.snapshot(c.roomId) });
        cache.set(c.roomId, packet);
      }
      c.socket.send(packet);
    }
  }

  private sweep(): void {
    for (const { roomId, slot } of this.options.rooms.sweep()) {
      this.toRoom(roomId, { t: 'left', slot });
      this.log(`slot ${slot} freed in a room`);
    }
  }
}
