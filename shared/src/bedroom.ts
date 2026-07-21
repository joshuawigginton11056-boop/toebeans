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

// How far outside a furniture piece's collision edge the cat aims when
// walking around it, so it rounds corners instead of scraping them.
const CAT_CORNER_CLEARANCE = 0.15;

interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function inflatedBox(obstacle: RoomObstacle, pad: number): Box {
  return {
    minX: obstacle.x - obstacle.width / 2 - pad,
    maxX: obstacle.x + obstacle.width / 2 + pad,
    minZ: obstacle.z - obstacle.depth / 2 - pad,
    maxZ: obstacle.z + obstacle.depth / 2 + pad,
  };
}

// Does the straight line from a to b pass through the box? Standard
// slab test: clip the segment against the box's x and z ranges and see
// whether any of it survives.
function segmentHitsBox(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  box: Box,
): boolean {
  let tMin = 0;
  let tMax = 1;
  const axes: ReadonlyArray<readonly [number, number, number, number]> = [
    [ax, bx - ax, box.minX, box.maxX],
    [az, bz - az, box.minZ, box.maxZ],
  ];
  for (const [start, delta, min, max] of axes) {
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }
  return true;
}

// Visibility checks use a box an epsilon thinner than real collision, so
// a cat pressed right up against a face (exactly on the collision
// boundary) still "sees" along it instead of every route reading as
// blocked. Any bigger gap here and routes can cut corners the collision
// then scrapes against.
const VISIBILITY_PAD = CAT_RADIUS - 1e-6;

interface Point {
  readonly x: number;
  readonly z: number;
}

// Where the cat should walk this frame: straight at the player if the
// line is clear, otherwise the first waypoint of the shortest route
// around the blocking furniture (cat → its open corners → player, tiny
// Dijkstra over at most 6 nodes). Recomputed every frame from state
// alone, so the cat rounds a corner and re-aims with no stored path.
// (With three well-separated furniture pieces, a corner route blocked by
// a *second* piece can't happen, so this only routes around one box.)
function pickWalkTarget(
  state: BedroomState,
  cat: BedroomCat,
  player: Point,
): Point {
  const blocking = state.obstacles.find((obstacle) =>
    segmentHitsBox(
      cat.x,
      cat.z,
      player.x,
      player.z,
      inflatedBox(obstacle, VISIBILITY_PAD),
    ),
  );
  if (!blocking) return player;

  const visBox = inflatedBox(blocking, VISIBILITY_PAD);
  const box = inflatedBox(blocking, CAT_RADIUS + CAT_CORNER_CLEARANCE);
  const corners = [
    { x: box.minX, z: box.minZ },
    { x: box.minX, z: box.maxZ },
    { x: box.maxX, z: box.minZ },
    { x: box.maxX, z: box.maxZ },
  ].filter(
    (corner) =>
      // Corners squeezed against a wall (furniture sits flush with them)
      // aren't walkable — drop them so the cat routes the open way round.
      Math.abs(corner.x) <= state.roomWidth / 2 - CAT_RADIUS &&
      Math.abs(corner.z) <= state.roomDepth / 2 - CAT_RADIUS &&
      // A corner the cat is standing on adds nothing to the route graph,
      // and keeping it would let "walk to where you already are" win.
      Math.hypot(corner.x - cat.x, corner.z - cat.z) > 0.01,
  );

  // Shortest path over: node 0 = cat, then corners, last node = player.
  // Two nodes are connected iff the straight line between them clears the
  // box; diagonal corner-to-corner hops get pruned by that automatically.
  const nodes: readonly Point[] = [{ x: cat.x, z: cat.z }, ...corners, player];
  const playerNode = nodes.length - 1;
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;

  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!done[i] && dist[i]! < (u === -1 ? Infinity : dist[u]!)) u = i;
    }
    if (u === -1 || u === playerNode) break;
    done[u] = true;
    const from = nodes[u]!;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || v === u) continue;
      const to = nodes[v]!;
      if (segmentHitsBox(from.x, from.z, to.x, to.z, visBox)) continue;
      const alt = dist[u]! + Math.hypot(to.x - from.x, to.z - from.z);
      if (alt < dist[v]!) {
        dist[v] = alt;
        prev[v] = u;
      }
    }
  }

  // No route (cat boxed in somehow): press straight at the player and let
  // collision sliding do what it can — the pre-detour behavior.
  if (dist[playerNode] === Infinity) return player;

  let hop = playerNode;
  while (prev[hop] !== 0) hop = prev[hop]!;
  return nodes[hop]!;
}

// The cat's whole brain: sit until the player wanders off, walk toward
// them (detouring around furniture in the way), sit back down once close.
// Runs every frame regardless of player input — the cat keeps walking
// even while you stand still.
function stepCat(
  state: BedroomState,
  player: { readonly x: number; readonly z: number },
  dt: number,
): BedroomCat {
  const cat = state.cat;
  const playerDistance = Math.hypot(player.x - cat.x, player.z - cat.z);

  if (cat.mood === "sitting" && playerDistance <= FOLLOW_START_DISTANCE) {
    return cat;
  }
  if (playerDistance <= FOLLOW_STOP_DISTANCE) {
    return cat.mood === "sitting" ? cat : { ...cat, mood: "sitting" };
  }

  const target = pickWalkTarget(state, cat, player);
  const dx = target.x - cat.x;
  const dz = target.z - cat.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) {
    return cat.mood === "following" ? cat : { ...cat, mood: "following" };
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
