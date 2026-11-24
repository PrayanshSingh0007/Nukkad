import * as THREE from 'three';
import { OUTFIT_COLORS } from '@nukkad/shared';
import { ROCKETBOX_AVATARS, RocketboxPerson, loadRocketbox, rocketboxReady } from '../player/avatar/rocketbox.ts';

/** A place someone may be inside a building (world): sitting on a seat or standing at work. */
export interface InsideSpot {
  x: number;
  y: number;
  z: number;
  /** Which way they face (the avatar's facing angle). */
  facing: number;
  pose: 'sit' | 'stand';
  /** 0–1, fixed per spot: who is there, whether anyone is, what they wear. */
  seed: number;
}

const NEAR_M = 16;
const LOOK_M = 4.5;

/**
 * People inside the building you are in or at: shopkeepers behind their counters, the barber at
 * the chair, the receptionist, people on sofas and benches, at office desks, in pews, at the
 * darshini's standing tables. Realistic (Rocketbox) people, the nearest few on your floor; most
 * work places are staffed, about a third of the seats taken. Anyone close turns to look at you.
 */
export class InsidePeople {
  readonly group = new THREE.Group();
  private readonly pool: { person: RocketboxPerson; at: number }[] = [];
  private spots: InsideSpot[] = [];
  private limit = 0;
  private searchIn = 0;
  private readonly look = new THREE.Vector3();

  setLimit(limit: number): void {
    this.limit = limit;
    if (limit > 0) void loadRocketbox();
  }

  /** The building's spots (empty when none is open). */
  setSpots(spots: InsideSpot[]): void {
    this.spots = spots;
    for (const slot of this.pool) {
      slot.at = -1;
      slot.person.root.visible = false;
    }
    this.searchIn = 0;
  }

  /** (x, y, z) = you. */
  update(dt: number, x: number, y: number, z: number): void {
    const assets = this.limit > 0 && this.spots.length > 0 ? rocketboxReady() : null;
    if (!assets) {
      for (const slot of this.pool) slot.person.root.visible = false;
      return;
    }
    this.searchIn -= dt;
    if (this.searchIn <= 0) {
      this.searchIn = 0.5;
      const wanted = this.spots
        .map((s, i) => ({ i, d: Math.hypot(s.x - x, s.z - z), s }))
        .filter(({ s, d }) => d < NEAR_M && Math.abs(s.y - y) < 2.2 && (s.seed * 9.73) % 1 < (s.pose === 'stand' ? 0.85 : 0.35))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.limit)
        .map((n) => n.i);
      for (const slot of this.pool) {
        if (slot.at >= 0 && !wanted.includes(slot.at)) {
          slot.at = -1;
          slot.person.root.visible = false;
        }
      }
      for (const i of wanted) {
        if (this.pool.some((slot) => slot.at === i)) continue;
        const spot = this.spots[i];
        const avatar = (i * 5 + Math.floor(spot.seed * 8)) % ROCKETBOX_AVATARS.length;
        let slot = this.pool.find((s) => s.at < 0 && s.person.avatar === avatar) ?? null;
        if (!slot) {
          const person = new RocketboxPerson(assets, avatar, spot.seed);
          this.group.add(person.root);
          const free = this.pool.find((s) => s.at < 0);
          if (free) {
            free.person.dispose();
            free.person = person;
            slot = free;
          } else {
            slot = { person, at: -1 };
            this.pool.push(slot);
          }
        }
        slot.at = i;
        const dye = (spot.seed * 7.13) % 1;
        slot.person.setTint(dye < 0.34 ? 0 : 1 + Math.floor(((dye - 0.34) / 0.66) * OUTFIT_COLORS.length));
        slot.person.setUmbrella(null);
        slot.person.root.position.set(spot.x, spot.y, spot.z);
        slot.person.root.rotation.set(0, spot.facing, 0);
        slot.person.root.visible = true;
      }
    }
    for (const slot of this.pool) {
      if (slot.at < 0) continue;
      const spot = this.spots[slot.at];
      // Someone close turns to look at you (the head turns, within reach).
      const near = Math.hypot(spot.x - x, spot.z - z) < LOOK_M && Math.abs(spot.y - y) < 1.5;
      slot.person.lookAt(near ? this.look.set(x, y + 1.55, z) : null);
      // Seated ones sit; some standing customers chat; workers stand ready.
      const chatting = spot.pose === 'stand' && (spot.seed * 13.7) % 1 < 0.3;
      slot.person.update(dt, 0, spot.pose === 'sit' ? 3 : chatting ? 4 : 0);
    }
  }

  dispose(): void {
    for (const slot of this.pool) slot.person.dispose();
    this.group.removeFromParent();
  }
}
