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

export type CatMood = "sitting" | "following";

export interface BedroomCat {
  readonly x: number;
  readonly z: number;
  // Yaw in radians (atan2 of the walk direction) so rendering can turn the
  // cat to face where it's headed without tracking positions itself.
  readonly facing: number;
  readonly mood: CatMood;
}

export interface BedroomState {
  readonly player: { readonly x: number; readonly z: number };
  readonly cat: BedroomCat;
  readonly roomWidth: number;
  readonly roomDepth: number;
  readonly obstacles: readonly RoomObstacle[];
}

const WALK_SPEED = 3.5;
// Slightly slower than the player, so the cat trails behind while you walk
// and only catches up when you stop.
const CAT_SPEED = 3.0;
// Hysteresis so the cat doesn't flicker between moods at one threshold: it
// stays sitting until you're this far away…
const FOLLOW_START_DISTANCE = 2.2;
// …then follows until it's back within arm's reach.
const FOLLOW_STOP_DISTANCE = 1.1;
// Half-size of the player's square footprint, used for wall and furniture
// collision. Rendering sizes the player box off this too.
export const PLAYER_RADIUS = 0.3;
export const CAT_RADIUS = 0.2;

export function createInitialBedroomState(): BedroomState {
  return {
    player: { x: 0, z: 2.5 },
    // Starts sitting beside the bed, far enough from the player's spawn
    // that it immediately trots over to greet you.
    cat: { x: -1.6, z: -0.9, facing: 0, mood: "sitting" },
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
  radius: number,
): number {
  const halfRoom = (movingX ? state.roomWidth : state.roomDepth) / 2 - radius;
  let pos = Math.max(-halfRoom, Math.min(halfRoom, target));

  for (const obstacle of state.obstacles) {
    const halfAlong =
      (movingX ? obstacle.width : obstacle.depth) / 2 + radius;
    const halfAcross =
      (movingX ? obstacle.depth : obstacle.width) / 2 + radius;
    const centerAlong = movingX ? obstacle.x : obstacle.z;
    const centerAcross = movingX ? obstacle.z : obstacle.x;

    if (Math.abs(crossCoord - centerAcross) >= halfAcross) continue;
    if (Math.abs(pos - centerAlong) >= halfAlong) continue;

    pos = from <= centerAlong ? centerAlong - halfAlong : centerAlong + halfAlong;
  }

  return pos;
}

// The cat's whole brain: sit until the player wanders off, walk toward
// them (bumping around furniture like the player does), sit back down once
// close. Runs every frame regardless of player input — the cat keeps
// walking even while you stand still.
function stepCat(
  state: BedroomState,
  player: { readonly x: number; readonly z: number },
  dt: number,
): BedroomCat {
  const cat = state.cat;
  const dx = player.x - cat.x;
  const dz = player.z - cat.z;
  const distance = Math.hypot(dx, dz);

  if (cat.mood === "sitting" && distance <= FOLLOW_START_DISTANCE) {
    return cat;
  }
  if (distance <= FOLLOW_STOP_DISTANCE) {
    return cat.mood === "sitting" ? cat : { ...cat, mood: "sitting" };
  }

  const step = Math.min(CAT_SPEED * dt, distance);
  const x = resolveAxis(
    cat.x + (dx / distance) * step,
    cat.z,
    true,
    cat.x,
    state,
    CAT_RADIUS,
  );
  const z = resolveAxis(
    cat.z + (dz / distance) * step,
    x,
    false,
    cat.z,
    state,
    CAT_RADIUS,
  );

  return { x, z, facing: Math.atan2(dx, dz), mood: "following" };
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

  let player = state.player;
  if (dx !== 0 || dz !== 0) {
    // Normalize so diagonal walking isn't faster than walking straight.
    const step = (WALK_SPEED * dt) / Math.hypot(dx, dz);
    const x = resolveAxis(
      player.x + dx * step,
      player.z,
      true,
      player.x,
      state,
      PLAYER_RADIUS,
    );
    const z = resolveAxis(player.z + dz * step, x, false, player.z, state, PLAYER_RADIUS);
    player = { x, z };
  }

  const cat = stepCat(state, player, dt);
  if (player === state.player && cat === state.cat) {
    return state;
  }

  return { ...state, player, cat };
}
