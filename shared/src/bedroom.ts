export interface BedroomInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
}

// Placeholder furniture: an axis-aligned box the player can't walk through.
// Center + full extents, so rendering and collision read the same numbers.
export interface RoomObstacle {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

export interface BedroomState {
  readonly player: { readonly x: number; readonly z: number };
  readonly roomWidth: number;
  readonly roomDepth: number;
  readonly obstacles: readonly RoomObstacle[];
}

const WALK_SPEED = 3.5;
// Half-size of the player's square footprint, used for wall and furniture
// collision. Rendering sizes the player box off this too.
export const PLAYER_RADIUS = 0.3;

export function createInitialBedroomState(): BedroomState {
  return {
    player: { x: 0, z: 2.5 },
    roomWidth: 10,
    roomDepth: 8,
    obstacles: [
      { id: "bed", x: -3.4, z: -2.2, width: 2.4, depth: 3.4 },
      { id: "dresser", x: 4.0, z: -3.2, width: 1.8, depth: 1.2 },
      { id: "desk", x: 4.1, z: 1.6, width: 1.6, depth: 2.6 },
    ],
  };
}

// Resolve movement along one axis: clamp to the room walls, then push back
// out of any obstacle overlapped at the new position. Solving x and z
// separately lets the player slide along a wall or furniture edge instead
// of sticking to it.
function resolveAxis(
  target: number,
  crossCoord: number,
  movingX: boolean,
  from: number,
  state: BedroomState,
): number {
  const halfRoom =
    (movingX ? state.roomWidth : state.roomDepth) / 2 - PLAYER_RADIUS;
  let pos = Math.max(-halfRoom, Math.min(halfRoom, target));

  for (const obstacle of state.obstacles) {
    const halfAlong =
      (movingX ? obstacle.width : obstacle.depth) / 2 + PLAYER_RADIUS;
    const halfAcross =
      (movingX ? obstacle.depth : obstacle.width) / 2 + PLAYER_RADIUS;
    const centerAlong = movingX ? obstacle.x : obstacle.z;
    const centerAcross = movingX ? obstacle.z : obstacle.x;

    if (Math.abs(crossCoord - centerAcross) >= halfAcross) continue;
    if (Math.abs(pos - centerAlong) >= halfAlong) continue;

    pos = from <= centerAlong ? centerAlong - halfAlong : centerAlong + halfAlong;
  }

  return pos;
}

export function stepBedroom(
  state: BedroomState,
  input: BedroomInput,
  dt: number,
): BedroomState {
  let dx = 0;
  let dz = 0;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;
  if (input.up) dz -= 1;
  if (input.down) dz += 1;

  if (dx === 0 && dz === 0) {
    return state;
  }

  // Normalize so diagonal walking isn't faster than walking straight.
  const step = (WALK_SPEED * dt) / Math.hypot(dx, dz);
  const x = resolveAxis(
    state.player.x + dx * step,
    state.player.z,
    true,
    state.player.x,
    state,
  );
  const z = resolveAxis(state.player.z + dz * step, x, false, state.player.z, state);

  return { ...state, player: { x, z } };
}
