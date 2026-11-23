import * as THREE from 'three';
import { VEHICLE_KINDS } from '@nukkad/worldgen';
import { VEHICLES } from '../game/vehicleSpecs.ts';
import { OUTFIT_COLORS } from '@nukkad/shared';
import { ROCKETBOX_AVATARS, RocketboxPerson, loadRocketbox, rocketboxReady } from '../player/avatar/rocketbox.ts';
import { helmetColour } from '../player/avatar/helmet.ts';

/**
 * Realistic riders on the nearest traffic scooters and motorbikes: a Rocketbox person sat on the
 * seat, hands on the grips and feet on the pegs (by IK, from the same seat, grip and peg points
 * your own riding uses), wearing a helmet. Everyone further off keeps the light rider figure.
 */
const NEAR_M = 18;
const TWO_WHEELERS = new Set(['two_wheeler', 'motorbike']);

interface Rider {
  /** The vehicle frame (at the vehicle, turned to its heading) and the seat offset inside it. */
  frame: THREE.Group;
  seat: THREE.Group;
  person: RocketboxPerson;
  /** Which traffic vehicle (by its lane object) it rides now, or null. */
  lane: object | null;
}

export class TrafficRiders {
  readonly group = new THREE.Group();
  private readonly riders: Rider[] = [];
  private limit = 0;
  private wanted = new Set<object>();

  /** How many realistic riders at most (0 = none). */
  setLimit(limit: number): void {
    this.limit = limit;
    if (limit > 0) void loadRocketbox();
  }

  /** Is this vehicle ridden by a realistic person this frame? (then skip its light rider) */
  has(lane: object): boolean {
    return this.wanted.has(lane);
  }

  /**
   * Call once per frame before placing vehicles, with the vehicles near you last frame
   * (nearest first): picks which two-wheelers get a realistic rider.
   */
  choose(near: { lane: object; kind: number; d: number }[]): void {
    this.wanted = new Set();
    if (this.limit <= 0 || !rocketboxReady()) return;
    for (const n of near) {
      if (this.wanted.size >= this.limit) break;
      if (n.d < NEAR_M && TWO_WHEELERS.has(VEHICLE_KINDS[n.kind])) this.wanted.add(n.lane);
    }
    // Free riders whose vehicles are no longer wanted.
    for (const rider of this.riders) {
      if (rider.lane && !this.wanted.has(rider.lane)) {
        rider.lane = null;
        rider.frame.visible = false;
      }
    }
  }

  /** Seat a realistic rider on this vehicle (x, y = wheels, z, heading); `seed` picks the person. */
  place(lane: object, kind: number, seed: number, x: number, y: number, z: number, heading: number, speed: number, dt: number): void {
    const assets = rocketboxReady();
    const spec = VEHICLES[VEHICLE_KINDS[kind]];
    if (!assets || !spec) return;
    let rider = this.riders.find((r) => r.lane === lane) ?? null;
    if (!rider) {
      const avatar = Math.floor(seed * 8) % ROCKETBOX_AVATARS.length;
      rider = this.riders.find((r) => r.lane === null && r.person.avatar === avatar) ?? this.riders.find((r) => r.lane === null) ?? null;
      if (rider && rider.person.avatar !== avatar) {
        rider.person.dispose();
        rider.person = new RocketboxPerson(assets, avatar, seed);
        rider.seat.add(rider.person.root);
      }
      if (!rider) {
        const frame = new THREE.Group();
        const seatGroup = new THREE.Group();
        frame.add(seatGroup);
        const person = new RocketboxPerson(assets, avatar, seed);
        seatGroup.add(person.root);
        this.group.add(frame);
        rider = { frame, seat: seatGroup, person, lane: null };
        this.riders.push(rider);
      }
      rider.lane = lane;
      const dye = (seed * 7.13) % 1;
      rider.person.setTint(dye < 0.34 ? 0 : 1 + Math.floor(((dye - 0.34) / 0.66) * OUTFIT_COLORS.length));
      rider.person.setHelmet(helmetColour((seed * 3.3) % 1));
    }
    rider.frame.visible = true;
    rider.frame.position.set(x, y, z);
    rider.frame.rotation.set(0, heading, 0);
    const [seatUp, seatZ] = spec.seat ?? [0, 0];
    rider.seat.position.set(0, 0.16 + seatUp, seatZ);
    rider.frame.updateMatrixWorld(true);
    // Grips and pegs in the vehicle's frame (as your own riding uses them).
    const pair = (point: readonly [number, number, number] | undefined): THREE.Vector3[] | null =>
      point ? [rider.frame.localToWorld(new THREE.Vector3(-point[0], point[1], point[2])), rider.frame.localToWorld(new THREE.Vector3(point[0], point[1], point[2]))] : null;
    rider.person.update(dt, speed, true, 'seat', 0, pair(spec.hands), pair(spec.feet));
  }

  dispose(): void {
    for (const rider of this.riders) rider.person.dispose();
    this.group.removeFromParent();
  }
}
