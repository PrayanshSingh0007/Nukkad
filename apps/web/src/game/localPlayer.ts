import type { AvatarLook } from '@nukkad/shared';
import { CharacterBody } from '../physics/characterBody.ts';
import type { PhysicsWorld } from '../physics/physicsWorld.ts';
import { Avatar } from '../player/avatar/avatar.ts';

/** Physics runs in fixed steps of 1/60 s, however fast or slow the screen draws. */
export const STEP_S = 1 / 60;
const RUN_SPEED = 5; // metres per second with the stick fully pushed
const ACCELERATION = 14; // how quickly the player reaches the wanted speed
const MAX_STEPS_PER_FRAME = 5;

/** Scooter feel (arcade, not a full vehicle simulation). */
export const RIDE_MAX = 9; // m/s ≈ 32 km/h
const RIDE_ACCEL = 4.5;
const RIDE_BRAKE = 9;
const RIDE_COAST = 1.2; // slowing down with no throttle
const RIDE_REVERSE = 2;
const RIDE_TURN = 1.9; // rad/s at walking pace; less at full speed
const RIDE_GRIP = 9; // how fast the wheels pull the motion back in line (lower = more slide)
const RIDE_MAX_LEAN = 0.38;

/**
 * The player you control: a physics body, the avatar drawn for it, and the walking logic
 * between them. Positions are smoothed between physics steps so movement looks fluid at any fps.
 */
export class LocalPlayer {
  readonly body: CharacterBody;
  readonly avatar: Avatar;
  /** Where the avatar is drawn this frame (feet). */
  x = 0;
  y = 0;
  z = 0;
  /** Speed along the ground, measured from what really happened (walls included). */
  speed = 0;
  /** On the scooter? */
  riding = false;
  /** Scooter direction (radians, avatar convention) and speed (negative = backwards). */
  heading = 0;
  rideSpeed = 0;
  lean = 0;
  private steer = 0;
  private readonly physics: PhysicsWorld;
  private readonly limit: number;
  private velocityX = 0;
  private velocityZ = 0;
  private previous = { x: 0, y: 0, z: 0 };
  private accumulator = 0;
  private smoothY: number;

  /** @param limit players cannot walk further than this from the centre (the soft world edge) */
  constructor(physics: PhysicsWorld, look: AvatarLook, x: number, y: number, z: number, limit: number) {
    this.physics = physics;
    this.limit = limit;
    this.body = new CharacterBody(physics, x, y, z);
    this.avatar = new Avatar(look);
    this.previous = { x, y, z };
    this.smoothY = y;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * Advances the player by one drawn frame.
   * @param moveX,moveY the stick / keys (-1…1)   @param yaw the camera direction: "forward" on the stick means "away from the camera"
   */
  setRiding(on: boolean): void {
    this.riding = on;
    this.heading = this.avatar.facing;
    this.rideSpeed = 0;
    this.velocityX = 0;
    this.velocityZ = 0;
  }

  update(dt: number, moveX: number, moveY: number, yaw: number, groundAt: (x: number, z: number) => number): void {
    if (this.riding) {
      this.updateRide(dt, moveX, moveY, groundAt);
      return;
    }
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const wantX = (rightX * moveX + forwardX * moveY) * RUN_SPEED;
    const wantZ = (rightZ * moveX + forwardZ * moveY) * RUN_SPEED;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP_S && steps < MAX_STEPS_PER_FRAME) {
      this.step(wantX, wantZ, groundAt);
      this.accumulator -= STEP_S;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // a very slow frame: don't try to catch up

    const blend = this.accumulator / STEP_S;
    const body = this.body;
    this.x = this.previous.x + (body.x - this.previous.x) * blend;
    this.z = this.previous.z + (body.z - this.previous.z) * blend;
    const y = this.previous.y + (body.y - this.previous.y) * blend;
    // Kerbs and steps are climbed in one physics step; easing the height hides the pop.
    this.smoothY += (y - this.smoothY) * Math.min(1, dt * 18);
    if (Math.abs(y - this.smoothY) > 1.5) this.smoothY = y;
    this.y = this.smoothY;

    const moving = Math.hypot(moveX, moveY) > 0.08;
    const heading = moving ? Math.atan2(-wantX, -wantZ) : null;
    this.avatar.update(dt, this.x, this.y, this.z, this.speed, heading, body.grounded);
  }

  /** Stick up/down = throttle and brake, left/right = steer. */
  private updateRide(dt: number, moveX: number, moveY: number, groundAt: (x: number, z: number) => number): void {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP_S && steps < MAX_STEPS_PER_FRAME) {
      this.rideStep(moveX, moveY, groundAt);
      this.accumulator -= STEP_S;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.smoothDrawnPosition(dt);
    const leanTarget = -this.steer * Math.min(1, Math.abs(this.rideSpeed) / RIDE_MAX) * RIDE_MAX_LEAN * Math.sign(this.rideSpeed || 1);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);
    this.avatar.update(dt, this.x, this.y, this.z, { speed: Math.abs(this.rideSpeed), heading: this.heading, grounded: this.body.grounded, riding: true, lean: this.lean });
  }

  private rideStep(moveX: number, moveY: number, groundAt: (x: number, z: number) => number): void {
    const throttle = moveY;
    this.steer += (moveX - this.steer) * Math.min(1, STEP_S * 8);
    let v = this.rideSpeed;
    if (throttle > 0.05) v += (v < 0 ? RIDE_BRAKE : RIDE_ACCEL * (1 - Math.max(0, v) / (RIDE_MAX * 1.15))) * throttle * STEP_S;
    else if (throttle < -0.05) v -= (v > 0 ? RIDE_BRAKE : RIDE_ACCEL * 0.5) * -throttle * STEP_S;
    else v -= Math.sign(v) * Math.min(Math.abs(v), RIDE_COAST * STEP_S);
    this.rideSpeed = Math.min(RIDE_MAX, Math.max(-RIDE_REVERSE, v));

    // Steering bites more at low speed; you can't spin on the spot.
    const pace = Math.min(1, Math.abs(this.rideSpeed) / 2.5);
    const turn = this.steer * RIDE_TURN * pace * (1 - 0.45 * (Math.abs(this.rideSpeed) / RIDE_MAX)) * Math.sign(this.rideSpeed);
    this.heading -= turn * STEP_S;

    const wantX = -Math.sin(this.heading) * this.rideSpeed;
    const wantZ = -Math.cos(this.heading) * this.rideSpeed;
    const expected = Math.abs(this.rideSpeed) * STEP_S;
    this.step(wantX, wantZ, groundAt, RIDE_GRIP);
    const moved = Math.hypot(this.body.x - this.previous.x, this.body.z - this.previous.z);
    if (expected > 0.04 && moved < expected * 0.35) this.rideSpeed *= 0.5; // bumped into something
  }

  private smoothDrawnPosition(dt: number): void {
    const blend = this.accumulator / STEP_S;
    const body = this.body;
    this.x = this.previous.x + (body.x - this.previous.x) * blend;
    this.z = this.previous.z + (body.z - this.previous.z) * blend;
    const y = this.previous.y + (body.y - this.previous.y) * blend;
    this.smoothY += (y - this.smoothY) * Math.min(1, dt * 18);
    if (Math.abs(y - this.smoothY) > 1.5) this.smoothY = y;
    this.y = this.smoothY;
  }

  private step(wantX: number, wantZ: number, groundAt: (x: number, z: number) => number, grip = ACCELERATION): void {
    const body = this.body;
    this.previous = { x: body.x, y: body.y, z: body.z };
    const ease = Math.min(1, grip * STEP_S);
    this.velocityX += (wantX - this.velocityX) * ease;
    this.velocityZ += (wantZ - this.velocityZ) * ease;

    // The soft edge of the world: you simply cannot walk past it.
    const targetX = Math.min(this.limit, Math.max(-this.limit, body.x + this.velocityX * STEP_S));
    const targetZ = Math.min(this.limit, Math.max(-this.limit, body.z + this.velocityZ * STEP_S));
    body.move(targetX - body.x, targetZ - body.z, STEP_S);
    this.physics.step();

    const moved = Math.hypot(body.x - this.previous.x, body.z - this.previous.z);
    this.speed += (moved / STEP_S - this.speed) * 0.25;

    // Safety net: anyone who ends up under the ground is put back on it.
    const ground = groundAt(body.x, body.z);
    if (body.y < ground - 3) {
      body.teleport(body.x, ground + 0.5, body.z);
      this.previous = { x: body.x, y: body.y, z: body.z };
    }
  }

  dispose(): void {
    this.body.dispose();
    this.avatar.dispose();
  }
}
