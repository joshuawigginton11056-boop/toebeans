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

export interface SkiState {
  readonly distance: number;
  readonly lateral: number;
  readonly height: number;
  readonly verticalVelocity: number;
  readonly speed: number;
  readonly crashed: boolean;
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

export function createInitialSkiState(): SkiState {
  return {
    distance: 0,
    lateral: 0,
    height: 0,
    verticalVelocity: 0,
    speed: BASE_SPEED,
    crashed: false,
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

export function stepSkiing(state: SkiState, input: SkiInput, dt: number): SkiState {
  if (state.crashed) {
    return state;
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

  const crashed = fellIntoAChasm(state.chasms, distance, height);

  return {
    distance,
    lateral,
    height,
    verticalVelocity: height <= 0 ? 0 : verticalVelocity,
    speed,
    crashed,
    chasms: state.chasms,
  };
}
