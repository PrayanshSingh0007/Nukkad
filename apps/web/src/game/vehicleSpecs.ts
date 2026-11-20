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
  /** Top speed forwards (where the limiter holds it) and backwards, m/s. */
  maxSpeed: number;
  reverse: number;
  /** Most the tyres can pull, m/s² (launch); see `driveAccel`. */
  accel: number;
  /** Engine power per kilogram, W/kg, and air drag, 1/m — set by `tune` from real figures. */
  power?: number;
  drag?: number;
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
  /** Handlebar grips for a visible driver: [half width, height, z] in metres, front is −z. */
  hands?: readonly [number, number, number];
  /** Footrests, the same way. */
  feet?: readonly [number, number, number];
  /** Sitting spot shift for a visible driver: [up, z] metres. */
  seat?: readonly [number, number];
}

const spec = (s: VehicleSpec): VehicleSpec => s;

/**
 * Real performance: the top speed (km/h) and how long it takes to reach a speed from standing
 * (e.g. 0–100 km/h in 13 s), plus how hard the tyres can pull. From these we work out an engine
 * power and an air drag so that the vehicle pulls hard at first (grip-limited), then less and
 * less as speed rises (power-limited, drag grows with speed²), and a limiter holds the top speed.
 */
function tune(s: VehicleSpec, topKmh: number, toKmh: number, seconds: number, traction: number): VehicleSpec {
  const top = topKmh / 3.6;
  const target = toKmh / 3.6;
  const dragFor = (power: number): number => power / Math.pow(top * 1.06, 3); // ≈ 0 pull just past the limiter
  const timeTo = (power: number): number => {
    const drag = dragFor(power);
    let v = 0;
    let t = 0;
    while (v < target) {
      const a = Math.min(traction, power / Math.max(v, 1)) - drag * v * v;
      if (a <= 1e-3 || t > 200) return Infinity;
      v += a * 0.02;
      t += 0.02;
    }
    return t;
  };
  // Search realistic powers only: above traction × top speed the engine could spin the wheels
  // even at top speed, and the model (pull capped by grip, drag growing with power) breaks down.
  let low = 1;
  let high = traction * top * 1.06;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (timeTo(mid) > seconds) low = mid;
    else high = mid;
  }
  return { ...s, maxSpeed: top, accel: traction, power: high, drag: dragFor(high) };
}

/** Pull from the engine at speed `v` (m/s) with full throttle, m/s². */
export function driveAccel(s: VehicleSpec, v: number): number {
  const speed = Math.max(0, v);
  if (s.power === undefined || s.drag === undefined) return s.accel * Math.max(0, 1 - Math.pow(speed / s.maxSpeed, 2.2));
  return Math.max(0, Math.min(s.accel, s.power / Math.max(speed, 1)) - s.drag * speed * speed);
}

/** Gears: the electric scooter has none; bikes 5, small cars 5, quick cars 6. 1-based. */
export function gearCount(s: VehicleSpec): number {
  if (s.code === 1) return 1;
  return s.leans ? 5 : s.maxSpeed > 45 ? 6 : 5;
}

/** Which gear you are in at this speed (upshifts spaced like a real gearbox: short first). */
export function gearAt(s: VehicleSpec, speed: number): number {
  const gears = gearCount(s);
  let gear = 1;
  while (gear < gears && speed > gearTop(s, gear) * 0.97) gear++;
  return gear;
}

/** The speed at the top of a gear, m/s. */
export function gearTop(s: VehicleSpec, gear: number): number {
  return s.maxSpeed * Math.pow(gear / gearCount(s), 0.75);
}

export const SCOOTER_BASE = spec({ code: 1, model: '', label: 'scooter', maxSpeed: 25.0, reverse: 2, accel: 6.5, brake: 9, wheelbase: 1.2, maxSteer: 0.55, grip: 9, driftGrip: 4, radius: 0.32, leans: true, driverVisible: true, cameraDistance: 5.2 });

/** Your own electric scooter: 90 km/h, 0–60 in 5.5 s. */
export const SCOOTER = tune(SCOOTER_BASE, 90, 60, 5.5, 3.5);

const BASE: Record<string, VehicleSpec> = {
  hatchback: spec({ code: 2, model: 'hatchback', label: 'car', maxSpeed: 50.0, reverse: 4, accel: 8, brake: 12, wheelbase: 2.45, maxSteer: 0.6, grip: 7, driftGrip: 1.6, radius: 0.85, leans: false, driverVisible: false, cameraDistance: 6.5 }),
  sedan: spec({ code: 3, model: 'sedan', label: 'car', maxSpeed: 69.4, reverse: 4, accel: 10, brake: 15, wheelbase: 2.7, maxSteer: 0.58, grip: 7, driftGrip: 1.5, radius: 0.88, leans: false, driverVisible: false, cameraDistance: 6.8 }),
  suv: spec({ code: 4, model: 'suv', label: 'SUV', maxSpeed: 55.6, reverse: 4, accel: 8.5, brake: 13, wheelbase: 2.8, maxSteer: 0.56, grip: 6.5, driftGrip: 1.6, radius: 0.93, leans: false, driverVisible: false, cameraDistance: 7.2 }),
  auto: spec({ code: 5, model: 'auto', label: 'auto', maxSpeed: 12, reverse: 3, accel: 3.6, brake: 8, wheelbase: 1.9, maxSteer: 0.7, grip: 6, driftGrip: 2.2, radius: 0.68, leans: false, driverVisible: true, cameraDistance: 5.8, hands: [0.28, 1.05, -0.72], feet: [0.14, 0.36, -0.64], seat: [0.03, -0.34] }),
  two_wheeler: spec({ code: 6, model: 'two_wheeler', label: 'two-wheeler', maxSpeed: 25.0, reverse: 2, accel: 6.5, brake: 10, wheelbase: 1.25, maxSteer: 0.55, grip: 9, driftGrip: 3.5, radius: 0.34, leans: true, driverVisible: true, cameraDistance: 5.4, hands: [0.33, 0.98, -0.32], feet: [0.15, 0.26, -0.2], seat: [0, -0.1] }),
  taxi: spec({ code: 8, model: 'taxi', label: 'taxi', maxSpeed: 50.0, reverse: 4, accel: 8, brake: 12, wheelbase: 2.6, maxSteer: 0.58, grip: 7, driftGrip: 1.6, radius: 0.88, leans: false, driverVisible: false, cameraDistance: 6.8 }),
  van: spec({ code: 9, model: 'van', label: 'van', maxSpeed: 15, reverse: 4, accel: 4.2, brake: 9, wheelbase: 2.6, maxSteer: 0.58, grip: 6.5, driftGrip: 1.8, radius: 0.9, leans: false, driverVisible: false, cameraDistance: 7 }),
  ambulance: spec({ code: 10, model: 'ambulance', label: 'ambulance', maxSpeed: 19, reverse: 4, accel: 4.6, brake: 9, wheelbase: 3.1, maxSteer: 0.55, grip: 6.5, driftGrip: 1.8, radius: 1.0, leans: false, driverVisible: false, cameraDistance: 8 }),
  truck: spec({ code: 11, model: 'truck', label: 'truck', maxSpeed: 13, reverse: 3, accel: 3, brake: 7, wheelbase: 3.0, maxSteer: 0.55, grip: 6, driftGrip: 2.2, radius: 1.05, leans: false, driverVisible: false, cameraDistance: 8.5 }),
  delivery: spec({ code: 12, model: 'delivery', label: 'tempo', maxSpeed: 13, reverse: 3, accel: 3.2, brake: 7.5, wheelbase: 3.0, maxSteer: 0.57, grip: 6, driftGrip: 2.2, radius: 1.05, leans: false, driverVisible: false, cameraDistance: 8.5 }),
  motorbike: spec({ code: 13, model: 'motorbike', label: 'bike', maxSpeed: 41.7, reverse: 2, accel: 9, brake: 13, wheelbase: 1.39, maxSteer: 0.5, grip: 9, driftGrip: 3, radius: 0.4, leans: true, driverVisible: true, cameraDistance: 5.6, hands: [0.36, 1.02, -0.46], feet: [0.2, 0.3, -0.12], seat: [-0.04, 0.12] }), // Bajaj Pulsar 150: seat behind the middle, bars ahead
  bus: spec({ code: 7, model: 'bus', label: 'bus', maxSpeed: 12, reverse: 3, accel: 2.4, brake: 6, wheelbase: 6.4, maxSteer: 0.6, grip: 6, driftGrip: 3, radius: 1.25, leans: false, driverVisible: false, cameraDistance: 13 }),
};

/**
 * Real-world figures for each kind (used when the model has none of its own below):
 * [top km/h, reach km/h, in seconds, tyre pull m/s²].
 */
const KIND_FIGURES: Record<string, [number, number, number, number]> = {
  hatchback: [150, 100, 13, 4.5],
  sedan: [180, 100, 11, 5],
  suv: [175, 100, 11.5, 5],
  auto: [55, 40, 9, 1.8],
  two_wheeler: [85, 60, 8.5, 3], // a 110 cc scooter
  taxi: [170, 100, 12, 4.5],
  van: [140, 100, 15, 3.5],
  ambulance: [120, 100, 22, 3],
  truck: [80, 60, 30, 1.4],
  delivery: [80, 60, 20, 2],
  motorbike: [115, 60, 5, 5.5], // Bajaj Pulsar 150
  bus: [80, 60, 25, 1.5],
};

/** Figures for the real cars and trucks in the game, by model file. */
const MODEL_FIGURES: Record<string, [number, number, number, number]> = {
  wagonr: [150, 100, 13.5, 4.5],
  nano: [105, 60, 8.5, 3.5],
  city: [190, 100, 10.5, 5],
  bmw_m3: [250, 100, 3.9, 8.5], // M3 Competition, limited to 250
  creta: [175, 100, 11.5, 5],
  seltos: [170, 100, 11, 5],
  thar: [155, 100, 12.5, 4.5],
  bmw_x3: [240, 100, 6.3, 7], // X3 xDrive30i
  minivan: [140, 100, 15, 3.5],
  ambulance: [120, 100, 22, 3],
  signa: [80, 60, 30, 1.4],
  minitruck: [80, 60, 20, 2],
  pickup: [120, 100, 20, 3],
};

export const VEHICLES: Record<string, VehicleSpec> = Object.fromEntries(
  Object.entries(BASE).map(([kind, s]) => {
    const [top, to, seconds, traction] = KIND_FIGURES[kind] ?? [s.maxSpeed * 3.6, 60, 8, s.accel];
    return [kind, tune(s, top, to, seconds, traction)];
  }),
);

const tunedModels = new Map<string, VehicleSpec>();
/** The kind's handling with this exact model's real top speed and pull (e.g. the BMW M3 vs a Honda City). */
export function specForModel(kind: VehicleSpec, file: string | undefined): VehicleSpec {
  const figures = file ? MODEL_FIGURES[file] : undefined;
  if (!figures) return kind;
  const key = `${kind.code}:${file}`;
  let tuned = tunedModels.get(key);
  if (!tuned) tunedModels.set(key, (tuned = tune(kind, ...figures)));
  return tuned;
}

const BY_CODE = new Map<number, VehicleSpec>([[SCOOTER.code, SCOOTER], ...Object.values(VEHICLES).map((v): [number, VehicleSpec] => [v.code, v])]);

export function specByCode(code: number): VehicleSpec | null {
  return BY_CODE.get(code) ?? null;
}
