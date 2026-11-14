/**
 * How each vehicle drives. Arcade handling, tuned to feel good on a phone:
 * a "bicycle model" (turning depends on speed and wheelbase), grip that pulls the slide
 * back in line (lower grip = more drift), and a handbrake that lets the back step out.
 * `code` is sent to friends in the flags byte (bits 4–7) so they see the right vehicle.
 */
export interface VehicleSpec {
  code: number;
  /** Street-life model name (empty for your own scooter, which is part of the avatar). */
  model: string;
  label: string;
  /** Top speed forwards and backwards, m/s. */
  maxSpeed: number;
  reverse: number;
  accel: number;
  brake: number;
  /** Distance between front and rear wheels, m (longer = wider turns). */
  wheelbase: number;
  /** Largest steering angle at low speed, radians. */
  maxSteer: number;
  /** How fast sideways sliding is removed, per second; and with the handbrake on. */
  grip: number;
  driftGrip: number;
  /** Radius of the round collision body while driving, m. */
  radius: number;
  /** Two-wheelers lean into turns. */
  leans: boolean;
  /** Is the driver visible (scooters, autos) or inside (cars, buses)? */
  driverVisible: boolean;
  cameraDistance: number;
}

const spec = (s: VehicleSpec): VehicleSpec => s;

export const SCOOTER = spec({ code: 1, model: '', label: 'scooter', maxSpeed: 9, reverse: 2, accel: 4.5, brake: 9, wheelbase: 1.2, maxSteer: 0.55, grip: 9, driftGrip: 4, radius: 0.32, leans: true, driverVisible: true, cameraDistance: 5.2 });

export const VEHICLES: Record<string, VehicleSpec> = {
  hatchback: spec({ code: 2, model: 'hatchback', label: 'car', maxSpeed: 17, reverse: 4, accel: 5, brake: 10, wheelbase: 2.45, maxSteer: 0.6, grip: 7, driftGrip: 1.6, radius: 0.85, leans: false, driverVisible: false, cameraDistance: 6.5 }),
  sedan: spec({ code: 3, model: 'sedan', label: 'car', maxSpeed: 19, reverse: 4, accel: 5.2, brake: 10, wheelbase: 2.7, maxSteer: 0.58, grip: 7, driftGrip: 1.5, radius: 0.88, leans: false, driverVisible: false, cameraDistance: 6.8 }),
  suv: spec({ code: 4, model: 'suv', label: 'SUV', maxSpeed: 18, reverse: 4, accel: 4.6, brake: 9.5, wheelbase: 2.8, maxSteer: 0.56, grip: 6.5, driftGrip: 1.6, radius: 0.93, leans: false, driverVisible: false, cameraDistance: 7.2 }),
  auto: spec({ code: 5, model: 'auto', label: 'auto', maxSpeed: 12, reverse: 3, accel: 3.6, brake: 8, wheelbase: 1.9, maxSteer: 0.7, grip: 6, driftGrip: 2.2, radius: 0.68, leans: false, driverVisible: true, cameraDistance: 5.8 }),
  two_wheeler: spec({ code: 6, model: 'two_wheeler', label: 'two-wheeler', maxSpeed: 14, reverse: 2, accel: 5, brake: 10, wheelbase: 1.25, maxSteer: 0.55, grip: 9, driftGrip: 3.5, radius: 0.34, leans: true, driverVisible: true, cameraDistance: 5.4 }),
  taxi: spec({ code: 8, model: 'taxi', label: 'taxi', maxSpeed: 18, reverse: 4, accel: 5, brake: 10, wheelbase: 2.6, maxSteer: 0.58, grip: 7, driftGrip: 1.6, radius: 0.88, leans: false, driverVisible: false, cameraDistance: 6.8 }),
  van: spec({ code: 9, model: 'van', label: 'van', maxSpeed: 15, reverse: 4, accel: 4.2, brake: 9, wheelbase: 2.6, maxSteer: 0.58, grip: 6.5, driftGrip: 1.8, radius: 0.9, leans: false, driverVisible: false, cameraDistance: 7 }),
  ambulance: spec({ code: 10, model: 'ambulance', label: 'ambulance', maxSpeed: 19, reverse: 4, accel: 4.6, brake: 9, wheelbase: 3.1, maxSteer: 0.55, grip: 6.5, driftGrip: 1.8, radius: 1.0, leans: false, driverVisible: false, cameraDistance: 8 }),
  truck: spec({ code: 11, model: 'truck', label: 'truck', maxSpeed: 13, reverse: 3, accel: 3, brake: 7, wheelbase: 3.0, maxSteer: 0.55, grip: 6, driftGrip: 2.2, radius: 1.05, leans: false, driverVisible: false, cameraDistance: 8.5 }),
  delivery: spec({ code: 12, model: 'delivery', label: 'tempo', maxSpeed: 13, reverse: 3, accel: 3.2, brake: 7.5, wheelbase: 3.0, maxSteer: 0.57, grip: 6, driftGrip: 2.2, radius: 1.05, leans: false, driverVisible: false, cameraDistance: 8.5 }),
  motorbike: spec({ code: 13, model: 'motorbike', label: 'bike', maxSpeed: 22, reverse: 2, accel: 6, brake: 11, wheelbase: 1.39, maxSteer: 0.5, grip: 9, driftGrip: 3, radius: 0.4, leans: true, driverVisible: true, cameraDistance: 5.6 }),
  bus: spec({ code: 7, model: 'bus', label: 'bus', maxSpeed: 12, reverse: 3, accel: 2.4, brake: 6, wheelbase: 6.4, maxSteer: 0.6, grip: 6, driftGrip: 3, radius: 1.25, leans: false, driverVisible: false, cameraDistance: 13 }),
};

const BY_CODE = new Map<number, VehicleSpec>([[SCOOTER.code, SCOOTER], ...Object.values(VEHICLES).map((v): [number, VehicleSpec] => [v.code, v])]);

export function specByCode(code: number): VehicleSpec | null {
  return BY_CODE.get(code) ?? null;
}
