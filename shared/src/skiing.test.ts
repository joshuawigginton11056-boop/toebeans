import { describe, expect, it } from "vitest";
import { createInitialSkiState, stepSkiing, type SkiInput, type SkiState } from "./skiing";

const noInput: SkiInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  boost: false,
};

// Positioned just short of a chasm so crash tests need only a couple dozen
// small steps instead of simulating all the way from the top of the slope.
const nearChasm: SkiState = {
  distance: 19,
  lateral: 0,
  height: 0,
  verticalVelocity: 0,
  speed: 8,
  crashed: false,
  chasms: [{ id: "c1", start: 20, width: 3 }],
};

describe("stepSkiing", () => {
  it("moves downhill at base speed with no input", () => {
    const state = stepSkiing(createInitialSkiState(), noInput, 1);

    expect(state.distance).toBe(8);
    expect(state.crashed).toBe(false);
  });

  it("steers laterally within the slope limits", () => {
    const state = stepSkiing(createInitialSkiState(), { ...noInput, right: true }, 1);

    expect(state.lateral).toBeGreaterThan(0);
    expect(state.lateral).toBeLessThanOrEqual(4);
  });

  it("boosts speed while held", () => {
    const state = stepSkiing(createInitialSkiState(), { ...noInput, boost: true }, 1);

    expect(state.speed).toBe(16);
  });

  it("jumps and comes back down under gravity", () => {
    const jumped = stepSkiing(createInitialSkiState(), { ...noInput, jump: true }, 0.1);

    expect(jumped.height).toBeGreaterThan(0);
  });

  it("crashes when reaching a chasm without enough height to clear it", () => {
    let state = nearChasm;
    for (let i = 0; i < 30; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }

    expect(state.distance).toBeGreaterThanOrEqual(20);
    expect(state.crashed).toBe(true);
  });

  it("clears a chasm when jumping over it", () => {
    let state = nearChasm;
    for (let i = 0; i < 30; i++) {
      state = stepSkiing(state, { ...noInput, jump: i === 0 }, 0.02);
    }

    expect(state.distance).toBeGreaterThan(23);
    expect(state.crashed).toBe(false);
  });

  it("never mutates the input state", () => {
    const initial = createInitialSkiState();
    const snapshot = JSON.parse(JSON.stringify(initial));

    stepSkiing(initial, { ...noInput, jump: true, right: true }, 1);

    expect(initial).toEqual(snapshot);
  });

  it("stays crashed and stops advancing once crashed", () => {
    let state = createInitialSkiState();
    for (let i = 0; i < 30; i++) {
      state = stepSkiing(state, noInput, 0.1);
    }
    expect(state.crashed).toBe(true);

    const next = stepSkiing(state, { ...noInput, up: true, jump: true }, 1);

    expect(next).toEqual(state);
  });
});
