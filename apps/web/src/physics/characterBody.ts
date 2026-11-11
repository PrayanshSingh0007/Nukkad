import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './physicsWorld.ts';

/** The player's body is a capsule: a pill 1.7 m tall and 0.6 m wide. */
export const BODY_RADIUS = 0.3;
const BODY_HALF_HEIGHT = 0.55;
const CENTRE_HEIGHT = BODY_HALF_HEIGHT + BODY_RADIUS;

const GRAVITY = 22; // a bit stronger than real life: feels snappier
const MAX_FALL_SPEED = 40;
const STEP_HEIGHT = 0.4; // kerbs and low steps are climbed without stopping
const STEP_MIN_WIDTH = 0.15;
const SNAP_DISTANCE = 0.4; // stay glued to the ground when walking downhill or off a kerb
const MAX_CLIMB = (50 * Math.PI) / 180;
const MIN_SLIDE = (45 * Math.PI) / 180;

/**
 * A walking body driven by Rapier's character controller: it slides along walls,
 * climbs slopes and small steps, and never passes through buildings.
 * `x, y, z` is the position of the FEET.
 */
export class CharacterBody {
  x: number;
  y: number;
  z: number;
  grounded = false;
  readonly collider: RAPIER.Collider;
  private readonly physics: PhysicsWorld;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private fallSpeed = 0;

  constructor(physics: PhysicsWorld, x: number, y: number, z: number) {
    this.physics = physics;
    this.x = x;
    this.y = y;
    this.z = z;
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + CENTRE_HEIGHT, z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(BODY_HALF_HEIGHT, BODY_RADIUS), this.body);
    this.controller = world.createCharacterController(0.03);
    this.controller.enableAutostep(STEP_HEIGHT, STEP_MIN_WIDTH, false);
    this.controller.enableSnapToGround(SNAP_DISTANCE);
    this.controller.setMaxSlopeClimbAngle(MAX_CLIMB);
    this.controller.setMinSlopeSlideAngle(MIN_SLIDE);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  /** One physics step: try to move by (dx, dz) metres on the ground; gravity is added here. */
  move(dx: number, dz: number, dt: number): void {
    this.fallSpeed = this.grounded ? 0 : Math.min(MAX_FALL_SPEED, this.fallSpeed + GRAVITY * dt);
    // Always push down a little so the controller can tell that we are standing on something.
    const dy = -Math.max(this.fallSpeed * dt, 0.02);
    this.controller.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz });
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    this.x += moved.x;
    this.y += moved.y;
    this.z += moved.z;
    this.body.setNextKinematicTranslation({ x: this.x, y: this.y + CENTRE_HEIGHT, z: this.z });
  }

  /** Puts the body somewhere at once (spawning, or rescuing a player who fell out of the world). */
  teleport(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.fallSpeed = 0;
    this.grounded = false;
    this.body.setTranslation({ x, y: y + CENTRE_HEIGHT, z }, true);
  }

  dispose(): void {
    const world = this.physics.world;
    world.removeCharacterController(this.controller);
    world.removeRigidBody(this.body);
  }
}
