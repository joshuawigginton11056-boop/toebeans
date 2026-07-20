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

  it("never mutates the input state", () => {
    const initial = createInitialBedroomState();
    const snapshot = JSON.parse(JSON.stringify(initial));

    stepBedroom(initial, { ...noInput, up: true, left: true }, 1);

    expect(initial).toEqual(snapshot);
  });
});
