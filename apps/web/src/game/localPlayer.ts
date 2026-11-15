import type { AvatarLook } from '@nukkad/shared';
import { CharacterBody } from '../physics/characterBody.ts';
import type { PhysicsWorld } from '../physics/physicsWorld.ts';
import { Avatar } from '../player/avatar/avatar.ts';
import { SCOOTER } from './vehicleSpecs.ts';
import type { VehicleSpec } from './vehicleSpecs.ts';

/** Physics runs in fixed steps of 1/60 s, however fast or slow the screen draws. */
export const STEP_S = 1 / 60;
const RUN_SPEED = 5; // metres per second with the stick fully pushed
const ACCELERATION = 14; // how quickly the player reaches the wanted speed
const MAX_STEPS_PER_FRAME = 5;

const MAX_LEAN = 0.38;

/**
 * The player you control: a physics body, the avatar drawn for it, and the walking logic
 * between them. Positions are smoothed between physics steps so movement looks fluid at any fps.
 */
export class LocalPlayer {
  body: CharacterBody;
  readonly avatar: Avatar;
  /** Where the avatar is drawn this frame (feet). */
  x = 0;
  y = 0;
  z = 0;
  /** Speed along the ground, measured from what really happened (walls included). */
  speed = 0;
  /** The vehicle you are driving, or null when walking. */
  vehicle: VehicleSpec | null = null;
  /** Handbrake held (drift). */
  handbrake = false;
  /** Vehicle direction (radians, avatar convention) and speed (negative = backwards). */
  heading = 0;
  rideSpeed = 0;
  lean = 0;
  /** Body motion from weight transfer, radians: nose up on the throttle, down on the brakes; roll in corners. */
  bodyPitch = 0;
  bodyRoll = 0;
  /** Smoothed forward acceleration, m/s² (for the camera and the engine sound). */
  longAccel = 0;
  /** Throttle you are giving (0–1), for the engine sound. */
  throttle = 0;
  /** How much the tyres are sliding sideways (0 = gripping, 1 = full drift). */
  slip = 0;
  private yawVelocity = 0;
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
  get riding(): boolean {
    return this.vehicle !== null;
  }

  /** Your own scooter (the Ride button). */
  setRiding(on: boolean): void {
    if (on) this.enterVehicle(SCOOTER, this.body.x, this.body.z, this.avatar.facing);
    else this.exitVehicle();
  }

  /** Gets into a vehicle standing at (x, z) facing `heading`. The collision body becomes the vehicle's size. */
  enterVehicle(vehicle: VehicleSpec, x: number, z: number, heading: number): void {
    const y = this.body.y;
    this.swapBody(new CharacterBody(this.physics, x, y + 0.2, z, vehicle.radius, vehicle.radius > 0.5 ? 0.12 : 0.4));
    this.vehicle = vehicle;
    this.heading = heading;
    this.rideSpeed = 0;
    this.yawVelocity = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.longAccel = 0;
    this.slip = 0;
    this.velocityX = 0;
    this.velocityZ = 0;
    this.steerInput = 0;
    this.lean = 0;
  }

  /** Gets out on the left side. Returns where the vehicle was left (for parking it there). */
  exitVehicle(): { x: number; y: number; z: number; heading: number } | null {
    const vehicle = this.vehicle;
    if (!vehicle) return null;
    const left = { x: this.body.x, y: this.body.y, z: this.body.z, heading: this.heading };
    const side = vehicle.radius + 0.7;
    const x = left.x - Math.cos(this.heading) * side;
    const z = left.z + Math.sin(this.heading) * side;
    this.swapBody(new CharacterBody(this.physics, x, left.y + 0.3, z));
    this.vehicle = null;
    this.rideSpeed = 0;
    this.velocityX = 0;
    this.velocityZ = 0;
    return left;
  }

  private swapBody(next: CharacterBody): void {
    this.body.dispose();
    this.body = next;
    this.previous = { x: next.x, y: next.y, z: next.z };
    this.accumulator = 0;
  }

  /** EMOTES index you are doing (0 = none). Any movement ends it. */
  emote = 0;
  /** Sitting on a seat: where, and which way you face. */
  seat: { x: number; y: number; z: number; facing: number } | null = null;

  update(dt: number, moveX: number, moveY: number, yaw: number, groundAt: (x: number, z: number) => number): void {
    const moving = Math.hypot(moveX, moveY) > 0.08;
    if (this.seat) {
      if (!moving) {
        // Sitting: no physics, the body stays put.
        this.x = this.seat.x;
        this.y = this.seat.y;
        this.z = this.seat.z;
        this.speed = 0;
        this.avatar.update(dt, this.x, this.y, this.z, { speed: 0, heading: this.seat.facing, grounded: true, emote: 3 });
        return;
      }
      // Standing up: step forward off the seat.
      const f = this.seat.facing;
      this.body.teleport(this.seat.x - Math.sin(f) * 0.7, this.seat.y + 0.9, this.seat.z - Math.cos(f) * 0.7);
      this.resetMotion();
      this.seat = null;
      this.emote = 0;
    }
    if (moving) this.emote = 0;
    if (this.vehicle) {
      this.updateRide(dt, this.vehicle, moveX, moveY, groundAt);
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

    const heading = moving ? Math.atan2(-wantX, -wantZ) : null;
    this.avatar.update(dt, this.x, this.y, this.z, { speed: this.speed, heading, grounded: body.grounded, emote: this.emote });
  }

  /** Stick up/down = throttle and brake, left/right = steer. */
  private updateRide(dt: number, vehicle: VehicleSpec, moveX: number, moveY: number, groundAt: (x: number, z: number) => number): void {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP_S && steps < MAX_STEPS_PER_FRAME) {
      this.rideStep(vehicle, moveX, moveY, groundAt);
      this.accumulator -= STEP_S;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.smoothDrawnPosition(dt);
    const share = Math.min(1, Math.abs(this.rideSpeed) / vehicle.maxSpeed);
    const leanTarget = vehicle.leans ? -this.steerInput * share * MAX_LEAN * Math.sign(this.rideSpeed || 1) : 0;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);
    this.avatar.object.visible = vehicle.driverVisible;
    this.avatar.update(dt, this.x, this.y, this.z, { speed: Math.abs(this.rideSpeed), heading: this.heading, grounded: this.body.grounded, riding: vehicle.driverVisible, scooter: vehicle === SCOOTER, lean: this.lean, grip: vehicle.hands, feet: vehicle.feet, seat: vehicle.seat });
  }

  private steerInput = 0;

  /**
   * One physics step of driving, tuned to feel like an arcade racer rather than a simulator:
   * - power is strongest at low speed and fades towards top speed (air drag), and lifting off
   *   slows you with engine braking and drag, more the faster you go;
   * - steering is quick at low speed and calmer at speed, and the turn is limited by how much
   *   sideways grip the tyres have (≈ 1 g), so a 250 km/h car cannot turn like a scooter;
   * - the car's yaw has some inertia (weight) instead of snapping to the wheel;
   * - with the handbrake the rear lets go: it rotates more and slides, and sliding scrubs speed.
   */
  private rideStep(vehicle: VehicleSpec, moveX: number, moveY: number, groundAt: (x: number, z: number) => number): void {
    const throttle = moveY;
    const before = this.rideSpeed;
    const speed = Math.abs(before);
    const quickness = 8 - 4 * Math.min(1, speed / 40);
    this.steerInput += (moveX - this.steerInput) * Math.min(1, STEP_S * quickness);

    let v = before;
    const share = Math.max(0, v) / vehicle.maxSpeed;
    if (throttle > 0.05) {
      if (v < -0.3) v += vehicle.brake * throttle * STEP_S;
      else v += vehicle.accel * Math.max(0, 1 - Math.pow(share, 2.2)) * throttle * STEP_S;
    } else if (throttle < -0.05) {
      if (v > 0.3) v -= vehicle.brake * (1 + 0.25 * share) * -throttle * STEP_S;
      else v -= vehicle.accel * 0.6 * -throttle * STEP_S;
    } else {
      const coast = 0.7 + 2.4 * share * share + (this.handbrake ? 4.5 : 0);
      v -= Math.sign(v) * Math.min(Math.abs(v), coast * STEP_S);
    }
    if (this.handbrake && throttle <= 0.05) v -= Math.sign(v) * Math.min(Math.abs(v), 2 * STEP_S);
    this.rideSpeed = Math.min(vehicle.maxSpeed, Math.max(-vehicle.reverse, v));
    this.throttle = Math.max(0, throttle);

    // The turn: bicycle model, less lock at speed, capped by tyre grip, with yaw inertia.
    const absShare = Math.min(1, Math.abs(this.rideSpeed) / vehicle.maxSpeed);
    const angle = this.steerInput * vehicle.maxSteer * (1 - 0.35 * absShare);
    let targetYaw = (this.rideSpeed / vehicle.wheelbase) * Math.tan(angle);
    const lateralGrip = (vehicle.leans ? 11 : 12.5) * (this.handbrake ? 1.6 : 1); // m/s²: about 1.2 g, arcade-friendly
    const abs = Math.abs(this.rideSpeed);
    if (abs > 1) targetYaw = Math.max(-lateralGrip / abs, Math.min(lateralGrip / abs, targetYaw));
    const weight = vehicle.leans ? 12 : this.handbrake ? 4 : 7;
    this.yawVelocity += (targetYaw * (this.handbrake ? 1.35 : 1) - this.yawVelocity) * Math.min(1, STEP_S * weight);
    this.heading -= this.yawVelocity * STEP_S;

    const wantX = -Math.sin(this.heading) * this.rideSpeed;
    const wantZ = -Math.cos(this.heading) * this.rideSpeed;
    this.step(wantX, wantZ, groundAt, this.handbrake ? vehicle.driftGrip : vehicle.grip);

    // Sliding: the angle between where the car points and where it goes. It scrubs speed.
    const going = Math.hypot(this.velocityX, this.velocityZ);
    if (going > 2) {
      const along = (this.velocityX * wantX + this.velocityZ * wantZ) / (going * (Math.abs(this.rideSpeed) || 1));
      this.slip += (Math.min(1, Math.max(0, 1 - along) * 4) - this.slip) * Math.min(1, STEP_S * 8);
      this.rideSpeed *= 1 - this.slip * 0.35 * STEP_S;
    } else this.slip *= 0.9;

    // Weight transfer, for the body and the camera.
    this.longAccel += ((this.rideSpeed - before) / STEP_S - this.longAccel) * Math.min(1, STEP_S * 6);
    if (!vehicle.leans) {
      const pitchTarget = Math.max(-0.05, Math.min(0.04, this.longAccel * 0.0055));
      const rollTarget = Math.max(-0.06, Math.min(0.06, this.yawVelocity * this.rideSpeed * 0.0055));
      this.bodyPitch += (pitchTarget - this.bodyPitch) * Math.min(1, STEP_S * 6);
      this.bodyRoll += (rollTarget - this.bodyRoll) * Math.min(1, STEP_S * 6);
    }

    // Hitting things: keep only the part of the speed that still goes forward. Grazing a wall
    // or a kerb slides along it with little loss; a head-on hit stops you.
    const tried = Math.hypot(this.velocityX, this.velocityZ) * STEP_S;
    const mx = this.body.x - this.previous.x;
    const mz = this.body.z - this.previous.z;
    const moved = Math.hypot(mx, mz);
    if (tried > 0.05 && moved < tried * 0.85) {
      const forward = (mx * -Math.sin(this.heading) + mz * -Math.cos(this.heading)) / STEP_S;
      const kept = Math.sign(this.rideSpeed) * Math.max(0, Math.abs(forward)) * 0.97;
      this.rideSpeed = Math.abs(kept) < Math.abs(this.rideSpeed) ? kept : this.rideSpeed;
      this.velocityX = mx / STEP_S;
      this.velocityZ = mz / STEP_S;
    }

    // Stability assist: when sliding without the handbrake and without steering into it,
    // the car gently lines up with where it is going, so slides are easy to catch.
    if (!this.handbrake && this.slip > 0.15 && going > 3) {
      const travel = Math.atan2(-this.velocityX, -this.velocityZ) + (this.rideSpeed < 0 ? Math.PI : 0);
      const diff = Math.atan2(Math.sin(travel - this.heading), Math.cos(travel - this.heading));
      const assist = (1 - Math.min(1, Math.abs(this.steerInput) * 1.5)) * 2.2;
      this.heading += diff * Math.min(1, STEP_S * assist);
    }
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

  /** Forget speed and the last position (after being moved through a door). */
  resetMotion(): void {
    const body = this.body;
    this.velocityX = 0;
    this.velocityZ = 0;
    this.speed = 0;
    this.previous = { x: body.x, y: body.y, z: body.z };
    this.smoothY = body.y;
  }

  dispose(): void {
    this.body.dispose();
    this.avatar.dispose();
  }
}
