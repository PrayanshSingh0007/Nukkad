import type * as THREE from 'three';
import { FLAG_AWAY, FLAG_GROUNDED } from '@nukkad/shared';
import type { AvatarLook, PlayerInfo, Snapshot } from '@nukkad/shared';
import { Avatar } from '../player/avatar/avatar.ts';
import { NameTag } from '../player/nameTag.ts';
import { ClockSync, SnapshotBuffer } from './interpolation.ts';

const TELEPORT_M = 8; // further off than this: jump instead of gliding
const GLIDE = 12; // how quickly the drawn position catches up (per second)
const TAG_HEIGHT = 2.15;

interface Remote {
  info: PlayerInfo;
  avatar: Avatar;
  tag: NameTag;
  buffer: SnapshotBuffer;
  shown: { x: number; y: number; z: number } | null;
}

/** Everyone else in the room: their avatars, name tags and smoothed movement. */
export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly players = new Map<number, Remote>();
  readonly clock = new ClockSync();
  selfSlot = -1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.players.size;
  }

  /** Called on (re)join: makes the set of players match the server's list. */
  reset(selfSlot: number, players: PlayerInfo[]): void {
    this.selfSlot = selfSlot;
    for (const slot of [...this.players.keys()]) if (!players.some((p) => p.slot === slot && p.slot !== selfSlot)) this.remove(slot);
    for (const player of players) if (player.slot !== selfSlot) this.add(player);
  }

  add(info: PlayerInfo): void {
    const existing = this.players.get(info.slot);
    if (existing) {
      existing.info = info;
      existing.avatar.setLook(info.look);
      return;
    }
    const avatar = new Avatar(info.look);
    const tag = new NameTag(info.name);
    avatar.object.visible = false; // until its first position arrives
    tag.sprite.visible = false;
    this.scene.add(avatar.object, tag.sprite);
    this.players.set(info.slot, { info, avatar, tag, buffer: new SnapshotBuffer(), shown: null });
  }

  remove(slot: number): void {
    const remote = this.players.get(slot);
    if (!remote) return;
    remote.avatar.dispose();
    remote.tag.dispose();
    this.players.delete(slot);
  }

  setLook(slot: number, look: AvatarLook): void {
    const remote = this.players.get(slot);
    if (!remote) return;
    remote.info.look = look;
    remote.avatar.setLook(look);
  }

  onSnapshot(snapshot: Snapshot, localTime: number): void {
    this.clock.observe(snapshot.serverTime, localTime);
    for (const entry of snapshot.players) {
      if (entry.slot !== this.selfSlot) this.players.get(entry.slot)?.buffer.push(snapshot.serverTime, entry);
    }
  }

  update(dt: number, now: number): void {
    if (!this.clock.ready) return;
    const t = this.clock.renderTime(now);
    for (const remote of this.players.values()) {
      const state = remote.buffer.sample(t);
      if (!state) continue;
      let shown = remote.shown;
      if (!shown || Math.hypot(state.x - shown.x, state.z - shown.z) > TELEPORT_M) {
        shown = { x: state.x, y: state.y, z: state.z };
      } else {
        const k = Math.min(1, dt * GLIDE);
        shown = { x: shown.x + (state.x - shown.x) * k, y: shown.y + (state.y - shown.y) * k, z: shown.z + (state.z - shown.z) * k };
      }
      remote.shown = shown;
      const away = (state.flags & FLAG_AWAY) !== 0;
      remote.avatar.object.visible = true;
      remote.tag.sprite.visible = true;
      remote.avatar.setOpacity(away ? 0.4 : 1);
      remote.avatar.update(dt, shown.x, shown.y, shown.z, away ? 0 : state.speed, state.yaw, (state.flags & FLAG_GROUNDED) !== 0);
      remote.tag.sprite.position.set(shown.x, shown.y + TAG_HEIGHT, shown.z);
      remote.tag.set(remote.info.name, away);
    }
  }

  dispose(): void {
    for (const slot of [...this.players.keys()]) this.remove(slot);
  }
}
