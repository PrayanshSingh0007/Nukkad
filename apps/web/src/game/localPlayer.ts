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

  update(dt: number, moveX: number, moveY: number, yaw: number, groundAt: (x: number, z: number) => number): void {
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

    const moving = Math.hypot(moveX, moveY) > 0.08;
    const heading = moving ? Math.atan2(-wantX, -wantZ) : null;
    this.avatar.update(dt, this.x, this.y, this.z, this.speed, heading, body.grounded);
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
    this.avatar.update(dt, this.x, this.y, this.z, { speed: Math.abs(this.rideSpeed), heading: this.heading, grounded: this.body.grounded, riding: vehicle.driverVisible, scooter: vehicle === SCOOTER, lean: this.lean });
  }

  private steerInput = 0;

  /** One physics step of driving: throttle, brakes, a bicycle-model turn, and grip. */
  private rideStep(vehicle: VehicleSpec, moveX: number, moveY: number, groundAt: (x: number, z: number) => number): void {
    const throttle = moveY;
    this.steerInput += (moveX - this.steerInput) * Math.min(1, STEP_S * 7);
    let v = this.rideSpeed;
    if (throttle > 0.05) v += (v < 0 ? vehicle.brake : vehicle.accel * (1 - Math.max(0, v) / (vehicle.maxSpeed * 1.12))) * throttle * STEP_S;
    else if (throttle < -0.05) v -= (v > 0 ? vehicle.brake : vehicle.accel * 0.6) * -throttle * STEP_S;
    else v -= Math.sign(v) * Math.min(Math.abs(v), (this.handbrake ? 4 : 1.2) * STEP_S);
    this.rideSpeed = Math.min(vehicle.maxSpeed, Math.max(-vehicle.reverse, v));

    // Less steering lock at speed, like a real car; the turn rate follows from the wheelbase.
    const share = Math.min(1, Math.abs(this.rideSpeed) / vehicle.maxSpeed);
    const angle = this.steerInput * vehicle.maxSteer * (1 - 0.55 * share);
    const yawRate = (this.rideSpeed / vehicle.wheelbase) * Math.tan(angle);
    this.heading -= yawRate * STEP_S * (this.handbrake ? 1.35 : 1);

    const wantX = -Math.sin(this.heading) * this.rideSpeed;
    const wantZ = -Math.cos(this.heading) * this.rideSpeed;
    this.step(wantX, wantZ, groundAt, this.handbrake ? vehicle.driftGrip : vehicle.grip);
    // Compare with the distance we actually tried to move (the slide-smoothed velocity), not the throttle speed.
    const tried = Math.hypot(this.velocityX, this.velocityZ) * STEP_S;
    const moved = Math.hypot(this.body.x - this.previous.x, this.body.z - this.previous.z);
    if (tried > 0.05 && moved < tried * 0.3) this.rideSpeed *= 0.6; // bumped into something
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
