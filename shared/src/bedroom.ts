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
  // Proportions are tuned for being *inside* the room (follow camera,
  // director call 2026-07-22), not the old doll-house view from above:
  // rooms feel much smaller at eye level, so the floor plan grew from
  // 10×8, and the furniture moved flush against the walls — mid-floor
  // furniture read fine from a bird's eye but reads as clutter from
  // inside. Static layout isn't saved, so old saves survive a resize
  // (positions clamp back in on load).
  return {
    player: { x: 0, z: 2.2 },
    // Starts sitting beside the bed, far enough from the player's spawn
    // that it immediately trots over to greet you.
    cat: { x: -3.0, z: -1.0, facing: 0, mood: "sitting" },
    roomWidth: 12,
    roomDepth: 10,
    // Footprints match the real furniture models (assets/bedroom/, real
    // furniture session) — collision follows the visuals, not the other
    // way round. Bed/dresser/desk are the original three pieces; the
    // nightstand (by the bed's head) and the chair (tucked at the desk)
    // arrived with the real assets.
    obstacles: [
      { id: "bed", x: -4.78, z: -3.42, width: 2.45, depth: 3.16 },
      { id: "nightstand", x: -3.16, z: -4.66, width: 0.67, depth: 0.67 },
      { id: "dresser", x: 2.5, z: -4.63, width: 1.81, depth: 0.73 },
      { id: "desk", x: 5.57, z: 1.0, width: 0.85, depth: 1.82 },
      { id: "chair", x: 4.9, z: 1.0, width: 0.63, depth: 0.51 },
    ],
  };
}

// A push out of one piece can land inside a flush neighbor (the chair
// tucked at the desk), so the resolver re-runs until nothing overlaps.
// Five obstacles settle in 2–3 passes; the cap is a safety net, not a
// budget that gets spent.
const MAX_PUSH_PASSES = 8;

// Resolve a movement to its target position: clamp to the room walls,
// then push out of any overlapped furniture by the *smallest*
// displacement that stays inside the room. Replaces the old per-axis
// came-from face snap, which had two playtest-reproduced failure modes
// (2026-07-22): wall-flush furniture could eject the player through a
// wall into a permanent trap (the push-out never re-checked the walls),
// and corner approaches could snap a large distance to a face the player
// only grazed (a visible warp instead of a slide).
//
// Minimal penetration fixes both by construction: the push is never
// bigger than how far the player clipped in this frame (steps are far
// smaller than any furniture piece, so overlaps are always shallow), and
// out-of-room faces are simply never candidates. Sliding falls out too —
// pushing out along one axis leaves the frame's movement along the other
// axis intact. Overlap tests are strict, so exact face contact counts as
// clear: two flush pieces share a boundary line the player can stand on
// but never slip between.
function resolvePosition(
  targetX: number,
  targetZ: number,
  from: Point,
  state: BedroomState,
  radius: number,
): Point {
  const halfW = state.roomWidth / 2 - radius;
  const halfD = state.roomDepth / 2 - radius;
  let x = Math.max(-halfW, Math.min(halfW, targetX));
  let z = Math.max(-halfD, Math.min(halfD, targetZ));

  const boxes = state.obstacles.map((o) => inflatedBox(o, radius));
  for (let pass = 0; pass < MAX_PUSH_PASSES; pass++) {
    let pushed = false;
    for (const box of boxes) {
      if (x <= box.minX || x >= box.maxX || z <= box.minZ || z >= box.maxZ) {
        continue;
      }
      // The four face pushes, minus any that would leave the room — the
      // far face of wall-flush furniture lies outside the walls (the
      // nightstand trap), so it can never win.
      const candidates = [
        { x: box.minX, z, d: x - box.minX },
        { x: box.maxX, z, d: box.maxX - x },
        { x, z: box.minZ, d: z - box.minZ },
        { x, z: box.maxZ, d: box.maxZ - z },
      ].filter((c) => Math.abs(c.x) <= halfW && Math.abs(c.z) <= halfD);
      if (candidates.length === 0) continue; // box swallows the room: unreachable
      let best = candidates[0]!;
      for (const c of candidates) {
        if (c.d < best.d) best = c;
      }
      x = best.x;
      z = best.z;
      pushed = true;
    }
    if (!pushed) return { x, z };
  }
  // Couldn't settle (pathological pocket): stay where we were — the
  // previous position was valid, so refusing the move is always safe.
  return { x: from.x, z: from.z };
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
// around the furniture in the way (cat → open corners → player, tiny
// Dijkstra). Recomputed every frame from state alone, so the cat rounds
// a corner and re-aims with no stored path. The graph covers *every*
// obstacle's corners, not just the first blocker's, because furniture
// can sit in tucked clusters (the chair at the desk, since the real
// furniture session) — there, the way around one piece runs through its
// neighbor, and a one-box route would pin the cat against the second
// piece (the original stuck-cat bug in a new coat).
function pickWalkTarget(
  state: BedroomState,
  cat: BedroomCat,
  player: Point,
): Point {
  const visBoxes = state.obstacles.map((o) => inflatedBox(o, VISIBILITY_PAD));
  const clears = (a: Point, b: Point): boolean =>
    visBoxes.every((box) => !segmentHitsBox(a.x, a.z, b.x, b.z, box));
  if (clears(cat, player)) return player;

  // Corners buried inside a neighboring piece aren't standable — the
  // tucked chair's desk-side corners live inside the desk's footprint.
  const solidBoxes = state.obstacles.map((o) => inflatedBox(o, CAT_RADIUS));
  const buried = (p: Point): boolean =>
    solidBoxes.some(
      (box) =>
        p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ,
    );

  const corners: Point[] = [];
  for (const obstacle of state.obstacles) {
    const box = inflatedBox(obstacle, CAT_RADIUS + CAT_CORNER_CLEARANCE);
    for (const corner of [
      { x: box.minX, z: box.minZ },
      { x: box.minX, z: box.maxZ },
      { x: box.maxX, z: box.minZ },
      { x: box.maxX, z: box.maxZ },
    ]) {
      if (
        // Corners squeezed against a wall (furniture sits flush with them)
        // aren't walkable — drop them so the cat routes the open way round.
        Math.abs(corner.x) <= state.roomWidth / 2 - CAT_RADIUS &&
        Math.abs(corner.z) <= state.roomDepth / 2 - CAT_RADIUS &&
        !buried(corner) &&
        // A corner the cat is standing on adds nothing to the route graph,
        // and keeping it would let "walk to where you already are" win.
        Math.hypot(corner.x - cat.x, corner.z - cat.z) > 0.01
      ) {
        corners.push(corner);
      }
    }
  }

  // Shortest path over: node 0 = cat, then corners, last node = player.
  // Two nodes are connected iff the straight line between them clears
  // every box; diagonal corner-to-corner hops get pruned automatically.
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
      if (!clears(from, to)) continue;
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
  const { x, z } = resolvePosition(
    cat.x + (dx / distance) * step,
    cat.z + (dz / distance) * step,
    cat,
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
    const { x, z } = resolvePosition(
      player.x + dx * step,
      player.z + dz * step,
      player,
      state,
      PLAYER_RADIUS,
    );
    player = { x, z };
  }

  const cat = stepCat(state, player, dt);
  if (player === state.player && cat === state.cat) {
    return state;
  }

  return { ...state, player, cat };
}
