import { describe, expect, it } from "vitest";
import {
  createInitialBedroomState,
  PLAYER_RADIUS,
  stepBedroom,
  type BedroomInput,
  type BedroomState,
} from "./bedroom";

const noInput: BedroomInput = {
  left: false,
  right: false,
  up: false,
  down: false,
};

// An empty room isolates wall/movement behavior from furniture collision.
const emptyRoom: BedroomState = {
  ...createInitialBedroomState(),
  player: { x: 0, z: 0 },
  obstacles: [],
};

function walk(start: BedroomState, input: BedroomInput, steps: number): BedroomState {
  let state = start;
  for (let i = 0; i < steps; i++) {
    state = stepBedroom(state, input, 0.02);
  }
  return state;
}

describe("stepBedroom", () => {
  it("walks in the direction held", () => {
    const state = stepBedroom(emptyRoom, { ...noInput, right: true }, 0.1);

    expect(state.player.x).toBeGreaterThan(0);
    expect(state.player.z).toBe(0);
  });

  it("stands still with no input", () => {
    const state = stepBedroom(emptyRoom, noInput, 0.1);

    expect(state.player).toEqual(emptyRoom.player);
  });

  it("walks diagonals at the same speed as straight lines", () => {
    const straight = stepBedroom(emptyRoom, { ...noInput, right: true }, 0.1);
    const diagonal = stepBedroom(emptyRoom, { ...noInput, right: true, down: true }, 0.1);

    const straightDistance = Math.hypot(straight.player.x, straight.player.z);
    const diagonalDistance = Math.hypot(diagonal.player.x, diagonal.player.z);

    expect(diagonalDistance).toBeCloseTo(straightDistance, 5);
  });

  it("stops at the walls", () => {
    const state = walk(emptyRoom, { ...noInput, left: true }, 500);

    expect(state.player.x).toBe(-(emptyRoom.roomWidth / 2 - PLAYER_RADIUS));
  });

  it("is blocked by furniture", () => {
    // Start to the right of the bed, level with its center, and walk left.
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: -1, z: -3.3 },
    };
    const state = walk(start, { ...noInput, left: true }, 500);

    // Bed center x is -4.78, half width 1.225, plus the player's radius.
    expect(state.player.x).toBeCloseTo(-4.78 + 1.225 + PLAYER_RADIUS, 5);
  });

  it("slides along furniture instead of sticking to it", () => {
    // Start 0.9 from the bed's blocked edge (at -3.3), so the walk below
    // hits it inside its 20 steps (each covers ~0.05 per axis).
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: -2.4, z: -3.3 },
    };
    // 20 short steps: long enough to see z progress, short enough that the
    // player is still alongside the bed (not yet slid past its edge).
    const state = walk(start, { ...noInput, left: true, down: true }, 20);

    // Blocked on x by the bed, but still moving on z the whole time.
    expect(state.player.x).toBeCloseTo(-4.78 + 1.225 + PLAYER_RADIUS, 5);
    expect(state.player.z).toBeGreaterThan(-2.6);
  });

  it("cat trots over to greet the player at game start", () => {
    // The initial state deliberately spawns the cat far enough from the
    // player that it starts following right away.
    let state = createInitialBedroomState();
    const startDistance = Math.hypot(
      state.player.x - state.cat.x,
      state.player.z - state.cat.z,
    );

    state = stepBedroom(state, noInput, 0.02);
    expect(state.cat.mood).toBe("following");

    // Two simulated seconds is plenty to cross the room.
    state = walk(state, noInput, 100);
    const endDistance = Math.hypot(
      state.player.x - state.cat.x,
      state.player.z - state.cat.z,
    );

    expect(endDistance).toBeLessThan(startDistance);
    expect(endDistance).toBeLessThanOrEqual(1.2);
    expect(state.cat.mood).toBe("sitting");
  });

  it("cat stays sitting while the player is close enough", () => {
    // Player at ~1.5 away: between the stop distance (where a following
    // cat sits down) and the start distance (where a sitting cat gets up).
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: -3.0, z: 0.5 },
    };
    const state = walk(start, noInput, 50);

    expect(state.cat).toEqual(start.cat);
  });

  it("cat faces the direction it walks", () => {
    // Player due +x of the cat, so the cat should face +x: atan2(dx, dz)
    // with dz = 0 is π/2.
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: 3, z: -1.0 },
      obstacles: [],
    };
    const state = stepBedroom(start, noInput, 0.02);

    expect(state.cat.mood).toBe("following");
    expect(state.cat.facing).toBeCloseTo(Math.PI / 2, 5);
  });

  it("cat walks around furniture instead of getting stuck on it", () => {
    // Cat north of the desk, player south of it — the straight line goes
    // through both the desk *and* the chair tucked at it, so the cat has
    // to round the whole cluster on its open (west) side. This is the
    // tucked-cluster case the multi-box route graph exists for: a route
    // around just the desk would walk straight through the chair and pin
    // the cat against it.
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: 5.2, z: 3.8 },
      cat: { x: 5.2, z: -1.5, facing: 0, mood: "sitting" },
    };

    // Step manually so every intermediate position can be checked: the
    // cat must never overlap the desk or the chair on the way around.
    // Collision bounds inflated by the cat's radius: desk x ≥ 4.945,
    // -0.11 ≤ z ≤ 2.11; chair 4.385 ≤ x ≤ 5.415, 0.545 ≤ z ≤ 1.455.
    let state = start;
    for (let i = 0; i < 500; i++) {
      state = stepBedroom(state, noInput, 0.02);
      // Epsilon allows grazing contact with the boundary (float noise);
      // anything past it means real penetration.
      const e = 1e-6;
      const insideDesk =
        state.cat.x > 4.945 + e &&
        state.cat.z > -0.11 + e &&
        state.cat.z < 2.11 - e;
      const insideChair =
        state.cat.x > 4.385 + e &&
        state.cat.x < 5.415 - e &&
        state.cat.z > 0.545 + e &&
        state.cat.z < 1.455 - e;
      expect(insideDesk).toBe(false);
      expect(insideChair).toBe(false);
    }

    const distance = Math.hypot(
      state.player.x - state.cat.x,
      state.player.z - state.cat.z,
    );
    expect(distance).toBeLessThanOrEqual(1.2);
    expect(state.cat.mood).toBe("sitting");
  });

  // ---- Collision resolver regressions (playtest bugs, 2026-07-22) ----

  // The two invariants the old resolver broke: everyone stays inside the
  // walls, and nobody ends a frame inside furniture. Exact face contact
  // is legal (sliding rests on the boundary); anything deeper than the
  // epsilon is real penetration.
  function expectValidPositions(state: BedroomState): void {
    const e = 1e-9;
    for (const [p, radius] of [
      [state.player, PLAYER_RADIUS],
      [state.cat, 0.2],
    ] as const) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(state.roomWidth / 2 - radius + e);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(state.roomDepth / 2 - radius + e);
      for (const o of state.obstacles) {
        const inside =
          p.x > o.x - o.width / 2 - radius + e &&
          p.x < o.x + o.width / 2 + radius - e &&
          p.z > o.z - o.depth / 2 - radius + e &&
          p.z < o.z + o.depth / 2 + radius - e;
        expect(inside).toBe(false);
      }
    }
  }

  it("wall-flush furniture never ejects the player through the wall", () => {
    // The playtest trap: sliding along the north wall into the nightstand
    // ejected the player to z = -5.295 — 0.6 inside the wall, permanently
    // (the wall clamp and the far-side push fought forever). Approach from
    // the east and hold up+left into it.
    let state: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: -1.0, z: -4.5 },
    };
    for (let i = 0; i < 200; i++) {
      state = stepBedroom(state, { ...noInput, up: true, left: true }, 0.02);
      expectValidPositions(state);
    }

    // Pinned against the nightstand's east face, still on the wall —
    // blocked, not trapped. Nightstand x = -3.16, half width 0.335.
    expect(state.player.x).toBeCloseTo(-3.16 + 0.335 + PLAYER_RADIUS, 5);
    // And walking away still works — the old trap was permanent.
    const freed = walk(state, { ...noInput, down: true }, 60);
    expect(freed.player.z).toBeGreaterThan(state.player.z + 2);
  });

  it("corner approaches slide instead of warping", () => {
    // The playtest glitch: a NW diagonal into the desk/chair cluster
    // face-snapped the player 0.46 units backward through the desk. A
    // frame's displacement is now bounded by what it actually moved (one
    // step, plus at most one flush-neighbor push of the same size).
    const maxFrameTravel = 2 * 3.5 * 0.02 + 1e-6;
    let state: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: 4.2, z: -0.6 },
    };
    for (let i = 0; i < 300; i++) {
      const before = state.player;
      state = stepBedroom(state, { ...noInput, right: true, down: true }, 0.02);
      expect(
        Math.hypot(state.player.x - before.x, state.player.z - before.z),
      ).toBeLessThanOrEqual(maxFrameTravel);
      expectValidPositions(state);
    }
    // Settled in the desk/chair inner pocket: against the desk's west
    // face (x = 5.57 - 0.425 - radius), not slipped between the pieces.
    expect(state.player.x).toBeCloseTo(5.57 - 0.425 - PLAYER_RADIUS, 5);
  });

  it("heals a position inside furniture instead of trapping there", () => {
    // A stale save can land inside furniture (layout isn't saved). One
    // step must eject cleanly through the nearest in-room face — not
    // oscillate, not tunnel out through the east wall the desk is flush
    // against.
    let state: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: 5.0, z: 0.0 },
    };
    state = stepBedroom(state, { ...noInput, left: true }, 0.02);

    expectValidPositions(state);
    expect(state.player.x).toBeCloseTo(5.57 - 0.425 - PLAYER_RADIUS, 5);
    expect(state.player.z).toBeCloseTo(0.0, 5);
  });

  it("stays valid pressing along every wall and furniture cluster", () => {
    // A perimeter-and-pockets sweep: hold a diagonal into each wall run
    // and flush furniture piece, and require the invariants every frame.
    // Each start is a legal standing spot; 300 steps ≈ 6 s of pressing.
    const scenarios: ReadonlyArray<{
      start: { x: number; z: number };
      input: Partial<BedroomInput>;
    }> = [
      { start: { x: -1.0, z: -4.5 }, input: { up: true, right: true } }, // north wall → dresser
      { start: { x: 4.5, z: -4.5 }, input: { up: true, right: true } }, // NE corner
      { start: { x: 5.5, z: -3.0 }, input: { down: true, right: true } }, // east wall → desk north
      { start: { x: 5.5, z: 4.5 }, input: { up: true, right: true } }, // east wall → desk south
      { start: { x: -5.5, z: 3.0 }, input: { up: true, left: true } }, // west wall → bed foot
      { start: { x: 0.0, z: 4.5 }, input: { down: true, left: true } }, // south wall
      { start: { x: 3.0, z: 0.0 }, input: { up: true, right: true } }, // open floor → dresser/desk gap
    ];

    for (const { start, input } of scenarios) {
      let state: BedroomState = {
        ...createInitialBedroomState(),
        player: start,
      };
      for (let i = 0; i < 300; i++) {
        state = stepBedroom(state, { ...noInput, ...input }, 0.02);
        expectValidPositions(state);
      }
    }
  });

  it("never mutates the input state", () => {
    const initial = createInitialBedroomState();
    const snapshot = JSON.parse(JSON.stringify(initial));

    stepBedroom(initial, { ...noInput, up: true, left: true }, 1);

    expect(initial).toEqual(snapshot);
  });
});
