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
const STEER_SPEED = 5;
// Exported for save.ts: restoring a save clamps lateral position into range.
export const LATERAL_LIMIT = 4;
const JUMP_VELOCITY = 7;
const GRAVITY = -18;
const CHASM_CLEAR_HEIGHT = 0.4;
export const STARTING_LIVES = 9;
export const RESPAWN_DELAY = 1.5;

export function createInitialSkiState(): SkiState {
  return {
    distance: 0,
    lateral: 0,
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
  const distance = state.distance + speed * dt;

  // Steering authority builds with speed — carving comes from the skis
  // biting the snow, so a standstill can't slide sideways (which would
  // also swing the renderer's carve angle, atan2(sideways, downhill), to
  // a right angle during the push-off). Full authority from MIN_SPEED up.
  const steerSpeed = STEER_SPEED * Math.min(1, speed / MIN_SPEED);
  let lateral = state.lateral;
  if (input.left) lateral -= steerSpeed * dt;
  if (input.right) lateral += steerSpeed * dt;
  lateral = Math.max(-LATERAL_LIMIT, Math.min(LATERAL_LIMIT, lateral));

  const verticalVelocity =
    grounded && input.jump ? JUMP_VELOCITY : state.verticalVelocity + GRAVITY * dt;
  const height = Math.max(0, state.height + verticalVelocity * dt);

  let lastCheckpoint = state.lastCheckpoint;
  for (const checkpoint of state.checkpoints) {
    if (distance >= checkpoint && checkpoint > lastCheckpoint) {
      lastCheckpoint = checkpoint;
    }
  }

  const crashed = fellIntoAChasm(state.chasms, distance, height);

  return {
    distance,
    lateral,
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
