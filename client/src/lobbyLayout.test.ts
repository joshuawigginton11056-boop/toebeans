import { describe, expect, it } from "vitest";
import { clampPlayerCount, lobbyLayout, localSlotIndex } from "./lobbyLayout";

describe("lobbyLayout — up-to-four player positioning", () => {
  it("clamps requested counts into the supported 1..4", () => {
    expect(clampPlayerCount(0)).toBe(1);
    expect(clampPlayerCount(-3)).toBe(1);
    expect(clampPlayerCount(2)).toBe(2);
    expect(clampPlayerCount(9)).toBe(4);
    expect(clampPlayerCount(2.8)).toBe(2); // truncates, not rounds
    expect(clampPlayerCount(Number.NaN)).toBe(1);
  });

  it("returns exactly one slot per player", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(lobbyLayout(n)).toHaveLength(n);
    }
  });

  it("marks exactly one slot as the local player", () => {
    for (const n of [1, 2, 3, 4]) {
      const local = lobbyLayout(n).filter((s) => s.isLocal);
      expect(local).toHaveLength(1);
    }
  });

  it("puts the local player a step in front of everyone else", () => {
    for (const n of [2, 3, 4]) {
      const slots = lobbyLayout(n);
      const local = slots.find((s) => s.isLocal)!;
      const others = slots.filter((s) => !s.isLocal);
      // Toward the camera is +z, so the local z must beat every other's.
      for (const other of others) {
        expect(local.z).toBeGreaterThan(other.z);
      }
    }
  });

  it("two players: the local one is on the left (smallest x)", () => {
    const slots = lobbyLayout(2);
    const local = slots.find((s) => s.isLocal)!;
    const minX = Math.min(...slots.map((s) => s.x));
    expect(local.x).toBe(minX);
    expect(localSlotIndex(2)).toBe(0);
  });

  it("four players: the local one is on the left (smallest x)", () => {
    const slots = lobbyLayout(4);
    const local = slots.find((s) => s.isLocal)!;
    const minX = Math.min(...slots.map((s) => s.x));
    expect(local.x).toBe(minX);
    expect(localSlotIndex(4)).toBe(0);
  });

  it("three players: the local one is in the middle (x === 0, flanked)", () => {
    const slots = lobbyLayout(3);
    const local = slots.find((s) => s.isLocal)!;
    expect(local.x).toBeCloseTo(0, 6);
    expect(localSlotIndex(3)).toBe(1);
    // One other on each side.
    const others = slots.filter((s) => !s.isLocal);
    expect(others.some((s) => s.x < local.x)).toBe(true);
    expect(others.some((s) => s.x > local.x)).toBe(true);
  });

  it("solo layout is the untouched historical spot", () => {
    const slots = lobbyLayout(1);
    expect(slots).toHaveLength(1);
    const only = slots[0]!;
    expect(only.isLocal).toBe(true);
    expect(only.x).toBeCloseTo(-0.35, 6);
    expect(only.z).toBe(0);
  });

  it("the others face inward, toward the center of the line", () => {
    // On the left of center a body turns right (+); on the right it turns
    // left (-). That's a turn toward the middle from either side.
    for (const n of [2, 3, 4]) {
      for (const slot of lobbyLayout(n).filter((s) => !s.isLocal)) {
        if (slot.x < 0) expect(slot.facing).toBeGreaterThan(0);
        if (slot.x > 0) expect(slot.facing).toBeLessThan(0);
      }
    }
  });
});
