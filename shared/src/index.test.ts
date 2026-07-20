import { describe, expect, it } from "vitest";
import { createInitialState, setCatVelocity, step } from "./index";

describe("step", () => {
  it("advances position by velocity * dt", () => {
    const initial = createInitialState();
    const moving = setCatVelocity(initial, "cat-1", { x: 1, y: 0, z: 0 });

    const next = step(moving, 0.5);

    expect(next.cats[0]?.position).toEqual({ x: 0.5, y: 0, z: 0 });
  });

  it("increments the tick counter", () => {
    const initial = createInitialState();

    const next = step(initial, 1);

    expect(next.tick).toBe(initial.tick + 1);
  });

  it("never mutates the input state", () => {
    const initial = createInitialState();
    const snapshot = JSON.parse(JSON.stringify(initial));

    step(initial, 1);

    expect(initial).toEqual(snapshot);
  });
});

describe("setCatVelocity", () => {
  it("only updates the targeted cat", () => {
    const initial = createInitialState();

    const next = setCatVelocity(initial, "cat-1", { x: 2, y: 0, z: 0 });

    expect(next.cats[0]?.velocity).toEqual({ x: 2, y: 0, z: 0 });
    expect(initial.cats[0]?.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });
});
