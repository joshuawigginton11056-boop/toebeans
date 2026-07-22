export interface SkiInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly jump: boolean;
  readonly boost: boolean;
}

export interface Chasm {
  readonly id: string;
  readonly start: number;
  readonly width: number;
}

// "skiing" — normal play. "crashed" — brief pause after losing a life,
// before respawning at the last checkpoint. "forfeited" — all nine lives
// gone; the run is over (half XP once XP exists — see DESIGN.md).
export type RunStatus = "skiing" | "crashed" | "forfeited";

export interface SkiState {
  readonly distance: number;
  readonly lateral: number;
  // Which way the skis point, in radians. 0 = straight downhill, positive =
  // turned right, negative = turned left. Steering turns this and it STAYS
  // turned when the key is released (like real skiing — you steer back
  // yourself); movement follows it. Turn past FALL_HEADING on the snow and
  // you fall over. Mid-air it can accumulate whole spins; landing collapses
  // it to the nearest downhill-equivalent (see downhillHeading).
  readonly heading: number;
  // Which steer keys have been held continuously since the skis left the
  // snow. A key already down at takeoff was carving a line, not calling a
  // trick — mid-air it keeps steering at the carving rate; only a key
  // pressed FRESH in the air spins at AIR_TURN_RATE (air-spin round 2,
  // director call 2026-07-22 — fixes jump-while-turning whipping into an
  // accidental 360). While grounded these simply track the keys, so the
  // takeoff frame captures exactly what was held as the snow fell away;
  // airborne they can only decay — releasing a key makes its next press
  // fresh.
  readonly leftHeldSinceTakeoff: boolean;
  readonly rightHeldSinceTakeoff: boolean;
  readonly height: number;
  readonly verticalVelocity: number;
  readonly speed: number;
  readonly status: RunStatus;
  readonly lives: number;
  readonly respawnTimer: number;
  readonly lastCheckpoint: number;
  readonly checkpoints: readonly number[];
  readonly chasms: readonly Chasm[];
}

// Exported for the client: audio scales wind/carve loudness off these
// (speed / BOOST_SPEED, and "is this a boost" = speed > MAX_SPEED), the
// ski pose maps speed across [MIN_SPEED, BOOST_SPEED] onto the crouch depth,
// and the pole push-off cycle fades out as speed approaches BASE_SPEED —
// speed encodes where the run is at, so the body can read it back from
// state alone.
export const BASE_SPEED = 8;
export const MIN_SPEED = 4;
export const MAX_SPEED = 12;
const LEAN_SHIFT = 6;
export const BOOST_SPEED = 16;
// Momentum (M2): speed is inertial. The lean/boost inputs set a *target*
// and the actual speed eases toward it — runs start from a standstill with
// a pole push-off instead of teleporting to cruise speed. Getting up to
// speed is slower than losing it (braking bites, gravity builds), and a
// released boost coasts down through drag rather than snapping back.
const SKI_ACCEL = 4;
const BOOST_ACCEL = 8;
const COAST_DRAG = 4;
const BRAKE_DECEL = 10;
// Steering is a real turn (M2 heading session): holding left/right keeps
// rotating the skis, up to fully sideways and beyond — there's no built-in
// stop. TURN_RATE is how fast the skis rotate at full authority; past
// FALL_HEADING (a bit beyond perpendicular-to-the-hill) the skier has turned
// too far to hold the edge and falls over — a normal crash: one life, the
// tip-over pause, respawn at the checkpoint. FALL_HEADING is exported for
// save.ts (restored headings clamp into the standing-up range).
// Turning round 2: TURN_RATE 1.2 → 1.8 (director call — too slow) with
// FALL_HEADING retuned alongside it (2.0 → 2.2) so the margin-of-error
// window past sideways stays ~0.35s, same as before the speedup.
const TURN_RATE = 1.8;
export const FALL_HEADING = 2.2;
// In the air there's no ski bite to resist a rotation, so spinning is much
// faster than carving — fast enough to fit a full 360 inside a jump's
// airtime (~0.78s at JUMP_VELOCITY/GRAVITY below), which makes jumps a
// place for style, not just a way over chasms. Only a key pressed fresh
// mid-air gets this rate — a key held since takeoff stays at TURN_RATE
// (see leftHeldSinceTakeoff on SkiState).
const AIR_TURN_RATE = 9;
// Exported for save.ts: restoring a save clamps lateral position into range.
export const LATERAL_LIMIT = 4;
const JUMP_VELOCITY = 7;
const GRAVITY = -18;
const CHASM_CLEAR_HEIGHT = 0.4;
export const STARTING_LIVES = 9;
export const RESPAWN_DELAY = 1.5;

// The heading a spin lands on: the nearest downhill-equivalent angle, in
// (-π, π]. A completed 360 collapses back to ~0 and lands clean; a half
// spin collapses to ~±π — well past FALL_HEADING — and lands crashed.
// Exported for save.ts (healing a mid-spin heading) and the renderer
// (telling a fall-over from a chasm crash during the tip-over).
export function downhillHeading(heading: number): number {
  return heading - 2 * Math.PI * Math.round(heading / (2 * Math.PI));
}

export function createInitialSkiState(): SkiState {
  return {
    distance: 0,
    lateral: 0,
    heading: 0,
    leftHeldSinceTakeoff: false,
    rightHeldSinceTakeoff: false,
    height: 0,
    verticalVelocity: 0,
    // Runs start from a standstill — the push-off to cruise speed is part
    // of the run, not something that happens before it.
    speed: 0,
    status: "skiing",
    lives: STARTING_LIVES,
    respawnTimer: 0,
    lastCheckpoint: 0,
    // One checkpoint after each chasm you survive, so a crash only ever
    // replays the hazard that killed you, not the whole slope.
    checkpoints: [0, 26, 52],
    chasms: [
      { id: "chasm-1", start: 20, width: 3 },
      { id: "chasm-2", start: 45, width: 3.5 },
      { id: "chasm-3", start: 70, width: 4 },
    ],
  };
}

function fellIntoAChasm(
  chasms: readonly Chasm[],
  distance: number,
  height: number,
): boolean {
  if (height >= CHASM_CLEAR_HEIGHT) {
    return false;
  }
  return chasms.some(
    (chasm) => distance >= chasm.start && distance <= chasm.start + chasm.width,
  );
}

function respawnAtCheckpoint(state: SkiState): SkiState {
  return {
    ...state,
    distance: state.lastCheckpoint,
    lateral: 0,
    // Respawn pointing straight downhill — whatever turn you fell over in
    // (or crashed carrying) doesn't follow you back to the checkpoint.
    heading: 0,
    leftHeldSinceTakeoff: false,
    rightHeldSinceTakeoff: false,
    height: 0,
    verticalVelocity: 0,
    // A crash scrubs all your speed — you push off again from the
    // checkpoint, so momentum lost is part of the crash's cost.
    speed: 0,
    status: "skiing",
    respawnTimer: 0,
  };
}

export function stepSkiing(state: SkiState, input: SkiInput, dt: number): SkiState {
  if (state.status === "forfeited") {
    return state;
  }

  if (state.status === "crashed") {
    const respawnTimer = state.respawnTimer - dt;
    if (respawnTimer > 0) {
      return { ...state, respawnTimer };
    }
    return state.lives > 0
      ? respawnAtCheckpoint(state)
      : { ...state, status: "forfeited", respawnTimer: 0 };
  }

  const grounded = state.height <= 0;

  // The inputs pick a target; momentum decides how fast you get there.
  const targetSpeed = input.boost
    ? BOOST_SPEED
    : Math.max(
        MIN_SPEED,
        Math.min(
          MAX_SPEED,
          BASE_SPEED + (input.up ? LEAN_SHIFT : 0) - (input.down ? LEAN_SHIFT : 0),
        ),
      );
  // Speed only changes on the snow — airborne there's nothing to push
  // against or brake with, so you land carrying your takeoff speed.
  let speed = state.speed;
  if (grounded) {
    speed =
      speed < targetSpeed
        ? Math.min(
            targetSpeed,
            speed + (input.boost ? BOOST_ACCEL : SKI_ACCEL) * dt,
          )
        : Math.max(
            targetSpeed,
            speed - (input.down ? BRAKE_DECEL : COAST_DRAG) * dt,
          );
  }
  // Steering rotates the skis and the heading stays where you put it —
  // steering back is on you. On the snow, authority builds with speed
  // (carving comes from the skis biting, so a standstill can't spin on the
  // spot; full authority from MIN_SPEED up). In the air the skis have
  // nothing to bite — so spinning is *faster*, at full authority whatever
  // your speed (turning round 2, director call: jumps allow spinning and
  // re-aiming; the old airborne freeze read as a limitation, not physics).
  const steerAuthority = Math.min(1, speed / MIN_SPEED);
  let heading = state.heading;
  if (grounded) {
    // A landed spin collapses to the direction the skis actually point —
    // heading only accumulates whole turns while airborne.
    heading = downhillHeading(heading);
    if (input.left) heading -= TURN_RATE * steerAuthority * dt;
    if (input.right) heading += TURN_RATE * steerAuthority * dt;
  } else {
    // A key held since takeoff keeps carving-rate line adjustment (speed is
    // frozen airborne, so its authority is whatever takeoff had); a fresh
    // press is the trick spin, full authority even from a standstill hop.
    if (input.left) {
      heading -= state.leftHeldSinceTakeoff
        ? TURN_RATE * steerAuthority * dt
        : AIR_TURN_RATE * dt;
    }
    if (input.right) {
      heading += state.rightHeldSinceTakeoff
        ? TURN_RATE * steerAuthority * dt
        : AIR_TURN_RATE * dt;
    }
  }
  // Grounded: track the keys, so the takeoff frame captures what was held.
  // Airborne: only decay — a key released mid-air presses fresh next time.
  const leftHeldSinceTakeoff = grounded
    ? input.left
    : state.leftHeldSinceTakeoff && input.left;
  const rightHeldSinceTakeoff = grounded
    ? input.right
    : state.rightHeldSinceTakeoff && input.right;

  // Movement follows the heading: turned sideways, all your speed is going
  // across the hill and none of it down. The lane edges still clamp.
  const distance = state.distance + speed * Math.cos(heading) * dt;
  let lateral = state.lateral + speed * Math.sin(heading) * dt;
  lateral = Math.max(-LATERAL_LIMIT, Math.min(LATERAL_LIMIT, lateral));

  // Turned too far past sideways to hold the edge — the skier falls over.
  // Same crash flow as a chasm: costs a life, tips over, back to the
  // checkpoint. Only checked on the snow: mid-air any rotation is legal,
  // and an over-rotated landing crashes on the first grounded frame —
  // a botched landing IS a fall (director default, ratify at playtest).
  const fellOver = grounded && Math.abs(heading) > FALL_HEADING;

  const verticalVelocity =
    grounded && input.jump ? JUMP_VELOCITY : state.verticalVelocity + GRAVITY * dt;
  const height = Math.max(0, state.height + verticalVelocity * dt);

  let lastCheckpoint = state.lastCheckpoint;
  for (const checkpoint of state.checkpoints) {
    if (distance >= checkpoint && checkpoint > lastCheckpoint) {
      lastCheckpoint = checkpoint;
    }
  }

  const crashed = fellOver || fellIntoAChasm(state.chasms, distance, height);

  return {
    distance,
    lateral,
    heading,
    leftHeldSinceTakeoff,
    rightHeldSinceTakeoff,
    height,
    verticalVelocity: height <= 0 ? 0 : verticalVelocity,
    speed,
    status: crashed ? "crashed" : "skiing",
    lives: crashed ? state.lives - 1 : state.lives,
    respawnTimer: crashed ? RESPAWN_DELAY : 0,
    lastCheckpoint,
    checkpoints: state.checkpoints,
    chasms: state.chasms,
  };
}
