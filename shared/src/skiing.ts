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

const BASE_SPEED = 8;
const MIN_SPEED = 4;
const MAX_SPEED = 12;
const LEAN_ACCEL = 6;
const BOOST_SPEED = 16;
const STEER_SPEED = 5;
const LATERAL_LIMIT = 4;
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
    speed: BASE_SPEED,
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
    speed: BASE_SPEED,
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

  const speed = input.boost
    ? BOOST_SPEED
    : Math.max(
        MIN_SPEED,
        Math.min(
          MAX_SPEED,
          BASE_SPEED + (input.up ? LEAN_ACCEL : 0) - (input.down ? LEAN_ACCEL : 0),
        ),
      );
  const distance = state.distance + speed * dt;

  let lateral = state.lateral;
  if (input.left) lateral -= STEER_SPEED * dt;
  if (input.right) lateral += STEER_SPEED * dt;
  lateral = Math.max(-LATERAL_LIMIT, Math.min(LATERAL_LIMIT, lateral));

  const grounded = state.height <= 0;
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
