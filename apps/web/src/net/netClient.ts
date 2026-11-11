import { decodeSnapshot, encodeState, parseServerMessage } from '@nukkad/shared';
import type { AvatarLook, ClientMessage, ErrorCode, PlayerInfo, PlayerState, RoomInfo, ServerMessage, Snapshot } from '@nukkad/shared';

export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'closed';

export interface NetEvents {
  onWelcome?: (slot: number, room: RoomInfo, players: PlayerInfo[]) => void;
  onJoined?: (player: PlayerInfo) => void;
  onLeft?: (slot: number) => void;
  onLook?: (slot: number, look: AvatarLook) => void;
  onSnapshot?: (snapshot: Snapshot, localTime: number) => void;
  onError?: (code: ErrorCode | 'offline', message: string) => void;
  onStatus?: (status: NetStatus) => void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const PING_MS = 2000;
const FATAL: ErrorCode[] = ['room_not_found', 'room_full', 'bad_name'];

/** The socket address: the server's own host in production, the dev proxy otherwise. */
function socketUrl(): string {
  const base: string = import.meta.env.VITE_SERVER_URL ?? '';
  if (base) return `${base.replace(/^http/, 'ws')}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/**
 * One player's connection: joins a room, sends your state, receives snapshots, and
 * reconnects by itself (0.5, 1, 2, 4, 8 s…) keeping your slot with a session token.
 */
export class NetClient {
  status: NetStatus = 'connecting';
  slot = -1;
  /** Round-trip time in ms (0 until the first pong). */
  rtt = 0;
  private socket: WebSocket | null = null;
  private readonly events: NetEvents;
  private roomId = '';
  private name = '';
  private look: AvatarLook | null = null;
  private attempt = 0;
  private seq = 0;
  private stopped = false;
  private pingTimer = 0;
  private retryTimer = 0;

  constructor(events: NetEvents) {
    this.events = events;
  }

  /** The reconnect token lives only in this tab (sessionStorage) and only for this room. */
  private get token(): string | undefined {
    try {
      return sessionStorage.getItem(`nukkad.token.${this.roomId}`) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private set token(value: string) {
    try {
      sessionStorage.setItem(`nukkad.token.${this.roomId}`, value);
    } catch {
      // storage blocked: a reconnect then simply takes a new slot
    }
  }

  connect(roomId: string, name: string, look: AvatarLook): void {
    this.roomId = roomId;
    this.name = name;
    this.look = look;
    this.open();
  }

  private setStatus(status: NetStatus): void {
    this.status = status;
    this.events.onStatus?.(status);
  }

  private open(): void {
    const socket = new WebSocket(socketUrl());
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onopen = () => {
      this.sendJson({ t: 'join', room: this.roomId, name: this.name, look: this.look as AvatarLook, token: this.token });
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data === 'string') {
        const message = parseServerMessage(event.data);
        if (message) this.handle(message);
      } else {
        const snapshot = decodeSnapshot(event.data);
        if (snapshot) this.events.onSnapshot?.(snapshot, performance.now());
      }
    };
    socket.onclose = () => {
      window.clearInterval(this.pingTimer);
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return this.setStatus('closed');
      this.setStatus('reconnecting');
      const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
      this.attempt++;
      if (this.attempt === 4) this.events.onError?.('offline', 'Connection lost. Trying to reconnect…');
      this.retryTimer = window.setTimeout(() => this.open(), wait);
    };
  }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.slot = message.slot;
        this.token = message.token;
        this.attempt = 0;
        this.setStatus('online');
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.sendJson({ t: 'ping', c: performance.now() }), PING_MS);
        this.events.onWelcome?.(message.slot, message.room, message.players);
        break;
      case 'joined':
        this.events.onJoined?.(message.player);
        break;
      case 'left':
        this.events.onLeft?.(message.slot);
        break;
      case 'look':
        this.events.onLook?.(message.slot, message.look);
        break;
      case 'pong':
        this.rtt = performance.now() - message.c;
        break;
      case 'error':
        if (FATAL.includes(message.code)) this.stopped = true;
        this.events.onError?.(message.code, message.message);
        break;
    }
  }

  private sendJson(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  sendState(state: PlayerState): void {
    if (this.status !== 'online' || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeState({ ...state, seq: this.seq++ & 0xffff }));
  }

  setLook(look: AvatarLook): void {
    this.look = look;
    this.sendJson({ t: 'look', look });
  }

  /** Leaving on purpose frees your slot at once. */
  leave(): void {
    this.stopped = true;
    this.sendJson({ t: 'leave' });
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.socket?.close();
  }
}
