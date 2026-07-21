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
      player: { x: -1, z: -2.2 },
    };
    const state = walk(start, { ...noInput, left: true }, 500);

    // Bed center x is -3.4, half width 1.2, plus the player's radius.
    expect(state.player.x).toBeCloseTo(-3.4 + 1.2 + PLAYER_RADIUS, 5);
  });

  it("slides along furniture instead of sticking to it", () => {
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: -1, z: -2.2 },
    };
    // 20 short steps: long enough to see z progress, short enough that the
    // player is still alongside the bed (not yet slid past its edge).
    const state = walk(start, { ...noInput, left: true, down: true }, 20);

    // Blocked on x by the bed, but still moving on z the whole time.
    expect(state.player.x).toBeCloseTo(-3.4 + 1.2 + PLAYER_RADIUS, 5);
    expect(state.player.z).toBeGreaterThan(-1.5);
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
      player: { x: -1.6, z: 0.6 },
    };
    const state = walk(start, noInput, 50);

    expect(state.cat).toEqual(start.cat);
  });

  it("cat faces the direction it walks", () => {
    // Player due +x of the cat, so the cat should face +x: atan2(dx, dz)
    // with dz = 0 is π/2.
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: 3, z: -0.9 },
      obstacles: [],
    };
    const state = stepBedroom(start, noInput, 0.02);

    expect(state.cat.mood).toBe("following");
    expect(state.cat.facing).toBeCloseTo(Math.PI / 2, 5);
  });

  it("cat walks around furniture instead of getting stuck on it", () => {
    // Cat north of the desk, player south of it — the straight line goes
    // through the desk, so the cat has to round its open (west) corners.
    const start: BedroomState = {
      ...createInitialBedroomState(),
      player: { x: 3.5, z: 3.4 },
      cat: { x: 3.5, z: -0.8, facing: 0, mood: "sitting" },
    };

    // Step manually so every intermediate position can be checked: the
    // cat must never overlap the desk on the way around it.
    // Desk collision bounds inflated by the cat's radius: x ≥ 3.1,
    // 0.1 ≤ z ≤ 3.1.
    let state = start;
    for (let i = 0; i < 500; i++) {
      state = stepBedroom(state, noInput, 0.02);
      // Epsilon allows grazing contact with the boundary (float noise);
      // anything past it means real penetration.
      const e = 1e-6;
      const insideDesk =
        state.cat.x > 3.1 + e && state.cat.z > 0.1 + e && state.cat.z < 3.1 - e;
      expect(insideDesk).toBe(false);
    }

    const distance = Math.hypot(
      state.player.x - state.cat.x,
      state.player.z - state.cat.z,
    );
    expect(distance).toBeLessThanOrEqual(1.2);
    expect(state.cat.mood).toBe("sitting");
  });

  it("never mutates the input state", () => {
    const initial = createInitialBedroomState();
    const snapshot = JSON.parse(JSON.stringify(initial));

    stepBedroom(initial, { ...noInput, up: true, left: true }, 1);

    expect(initial).toEqual(snapshot);
  });
});
