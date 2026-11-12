import type * as THREE from 'three';
import { FLAG_AWAY, FLAG_GROUNDED, FLAG_RIDING } from '@nukkad/shared';
import type { AvatarLook, PlayerInfo, Snapshot } from '@nukkad/shared';
import { Avatar } from '../player/avatar/avatar.ts';
import { NameTag } from '../player/nameTag.ts';
import { specByCode } from '../game/vehicleSpecs.ts';
import * as THREE_RUNTIME from 'three';
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
  lastYaw: number;
  lean: number;
  vehicle: THREE.Mesh | null;
  vehicleCode: number;
}

/** Gives the geometry + material for a vehicle model name (from the street-life models). */
export type VehicleModelSource = (model: string) => { geometry: THREE.BufferGeometry; material: THREE.Material } | null;

/** Everyone else in the room: their avatars, name tags and smoothed movement. */
export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly players = new Map<number, Remote>();
  readonly clock = new ClockSync();
  selfSlot = -1;
  vehicleModels: VehicleModelSource | null = null;

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

  nameOf(slot: number): string | undefined {
    return this.players.get(slot)?.info.name;
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
    this.players.set(info.slot, { info, avatar, tag, buffer: new SnapshotBuffer(), shown: null, lastYaw: 0, lean: 0, vehicle: null, vehicleCode: 0 });
  }

  remove(slot: number): void {
    const remote = this.players.get(slot);
    if (!remote) return;
    remote.avatar.dispose();
    remote.tag.dispose();
    remote.vehicle?.removeFromParent();
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

  /** Decides who you can see right now (set by the game: inside vs outside). */
  canSee: ((x: number, y: number, z: number) => boolean) | null = null;

  update(dt: number, now: number): void {
    if (!this.clock.ready) return;
    const t = this.clock.renderTime(now);
    for (const remote of this.players.values()) {
      const state = remote.buffer.sample(t);
      if (!state) continue;
      let shown = remote.shown;
      if (!shown || Math.hypot(state.x - shown.x, state.z - shown.z) > TELEPORT_M || Math.abs(state.y - shown.y) > 5) {
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
      const riding = (state.flags & FLAG_RIDING) !== 0;
      const code = riding ? (state.flags >> 4) & 15 : 0;
      const spec = specByCode(code);
      this.showVehicle(remote, spec && spec.model ? code : 0, shown, state.yaw);
      remote.avatar.object.visible = !spec || spec.driverVisible;
      // Lean is not sent: it is worked out from how fast the rider is turning.
      const yawRate = dt > 0 ? Math.atan2(Math.sin(state.yaw - remote.lastYaw), Math.cos(state.yaw - remote.lastYaw)) / dt : 0;
      remote.lastYaw = state.yaw;
      const leanTarget = riding ? Math.max(-0.38, Math.min(0.38, yawRate * state.speed * 0.05)) : 0;
      remote.lean += (leanTarget - remote.lean) * Math.min(1, dt * 6);
      remote.avatar.update(dt, shown.x, shown.y, shown.z, {
        speed: away ? 0 : state.speed,
        heading: state.yaw,
        grounded: (state.flags & FLAG_GROUNDED) !== 0,
        riding: riding && (!spec || spec.driverVisible),
        scooter: !spec || spec.model === '',
        lean: remote.lean,
      });
      remote.tag.sprite.position.set(shown.x, shown.y + TAG_HEIGHT, shown.z);
      remote.tag.set(remote.info.name, away);
      // Friends inside a building are only seen by those in the same room (and the other way round).
      if (this.canSee && !this.canSee(shown.x, shown.y, shown.z)) {
        remote.avatar.object.visible = false;
        remote.tag.sprite.visible = false;
        if (remote.vehicle) remote.vehicle.visible = false;
      } else if (remote.vehicle) remote.vehicle.visible = true;
    }
  }

  /** Puts the right vehicle model under a friend who is driving one (code 0 = none). */
  private showVehicle(remote: Remote, code: number, at: { x: number; y: number; z: number }, yaw: number): void {
    if (remote.vehicleCode !== code) {
      remote.vehicle?.removeFromParent();
      remote.vehicle = null;
      remote.vehicleCode = code;
      const spec = specByCode(code);
      const model = spec && this.vehicleModels ? this.vehicleModels(spec.model) : null;
      if (model) {
        remote.vehicle = new THREE_RUNTIME.Mesh(model.geometry, model.material);
        remote.vehicle.castShadow = true;
        this.scene.add(remote.vehicle);
      }
    }
    if (remote.vehicle) {
      remote.vehicle.position.set(at.x, at.y, at.z);
      remote.vehicle.rotation.set(0, yaw, 0);
    }
  }

  dispose(): void {
    for (const slot of [...this.players.keys()]) this.remove(slot);
  }
}
