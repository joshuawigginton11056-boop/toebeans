import { describe, expect, it } from "vitest";
import {
  CHARACTERS,
  FALL_HEADING,
  SKIN_TONES,
  createDefaultAppearance,
  createInitialBedroomState,
  createInitialSkiState,
  stepBedroom,
  stepSkiing,
} from "./index";
import {
  SAVE_VERSION,
  createSave,
  decodeSave,
  encodeSave,
  restoreSave,
} from "./save";

const idleBedroomInput = { left: false, right: false, up: false, down: false };
const idleSkiInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  boost: false,
};

// A mid-game snapshot with real history: some bedroom walking, a ski run
// past the first checkpoint with one life already lost.
function midGameSave() {
  let bedroom = createInitialBedroomState();
  for (let i = 0; i < 60; i++) {
    bedroom = stepBedroom(bedroom, { ...idleBedroomInput, right: true }, 1 / 60);
  }
  let ski = createInitialSkiState();
  for (let i = 0; i < 60 * 6; i++) {
    ski = stepSkiing(ski, idleSkiInput, 1 / 60);
  }
  const appearance = { ...createDefaultAppearance(), character: 3, skin: 5, hair: 4 };
  return { bedroom, ski, appearance, save: createSave("slope", bedroom, ski, true, appearance) };
}

describe("save/load", () => {
  it("round-trips a mid-game snapshot through encode → decode → restore", () => {
    const { bedroom, ski, save } = midGameSave();
    const decoded = decodeSave(encodeSave(save));
    expect(decoded).not.toBeNull();
    const restored = restoreSave(decoded!);

    expect(restored.mode).toBe("slope");
    expect(restored.muted).toBe(true);
    expect(restored.bedroom.player).toEqual(bedroom.player);
    expect(restored.bedroom.cat).toEqual(bedroom.cat);
    expect(restored.ski.distance).toBe(ski.distance);
    expect(restored.ski.lives).toBe(ski.lives);
    expect(restored.ski.status).toBe(ski.status);
    expect(restored.ski.lastCheckpoint).toBe(ski.lastCheckpoint);
  });

  it("round-trips the character's appearance", () => {
    const { appearance, save } = midGameSave();
    const restored = restoreSave(decodeSave(encodeSave(save))!);
    expect(restored.appearance).toEqual(appearance);
  });

  it("rejects appearances of the wrong kind", () => {
    const { save } = midGameSave();
    const cases: ReadonlyArray<Record<string, unknown>> = [
      { ...save, appearance: "brown hair" },
      { ...save, appearance: { ...save.appearance, character: "casual" } },
      { ...save, appearance: { ...save.appearance, skin: "honey" } },
      { ...save, appearance: { ...save.appearance, hair: null } },
      { ...save, appearance: { ...save.appearance, character: Number.NaN } },
    ];
    for (const broken of cases) {
      expect(decodeSave(JSON.stringify(broken))).toBeNull();
    }
  });

  it("heals appearance indices that fell off the end of a ramp", () => {
    const { save } = midGameSave();
    // A save written when the ramps were longer (or hand-edited): the index
    // is a real number, just out of range, so it clamps rather than wiping
    // the whole save.
    const stale = {
      ...save,
      appearance: { ...save.appearance, character: 999, skin: 99, hair: -3 },
    };
    const restored = restoreSave(decodeSave(JSON.stringify(stale))!);
    expect(restored.appearance.character).toBe(CHARACTERS.length - 1);
    expect(restored.appearance.skin).toBe(SKIN_TONES.length - 1);
    expect(restored.appearance.hair).toBe(0);
  });

  it("restores static layout from code, not from the save", () => {
    const { save } = midGameSave();
    const restored = restoreSave(decodeSave(encodeSave(save))!);
    const fresh = createInitialSkiState();
    const freshRoom = createInitialBedroomState();

    // The save carries no layout at all — chasms, checkpoints, room size,
    // and furniture must match today's createInitial* exactly.
    expect(encodeSave(save)).not.toContain("chasm");
    expect(restored.ski.chasms).toEqual(fresh.chasms);
    expect(restored.ski.checkpoints).toEqual(fresh.checkpoints);
    expect(restored.bedroom.obstacles).toEqual(freshRoom.obstacles);
    expect(restored.bedroom.roomWidth).toBe(freshRoom.roomWidth);
  });

  it("a restored run keeps stepping exactly like the original", () => {
    const { ski, save } = midGameSave();
    const restored = restoreSave(decodeSave(encodeSave(save))!);
    let a = ski;
    let b = restored.ski;
    for (let i = 0; i < 120; i++) {
      a = stepSkiing(a, idleSkiInput, 1 / 60);
      b = stepSkiing(b, idleSkiInput, 1 / 60);
    }
    expect(b).toEqual(a);
  });

  it("rejects garbage and structurally wrong saves", () => {
    expect(decodeSave("not json at all {{{")).toBeNull();
    expect(decodeSave("null")).toBeNull();
    expect(decodeSave("42")).toBeNull();
    expect(decodeSave("{}")).toBeNull();

    const { save } = midGameSave();
    // Drop each top-level piece in turn.
    for (const key of ["mode", "muted", "bedroom", "ski", "appearance"] as const) {
      const broken: Record<string, unknown> = { ...save };
      delete broken[key];
      expect(decodeSave(JSON.stringify(broken))).toBeNull();
    }
  });

  it("rejects saves from a different version", () => {
    const { save } = midGameSave();
    const old = { ...save, version: SAVE_VERSION - 1 };
    expect(decodeSave(JSON.stringify(old))).toBeNull();
  });

  it("rejects invalid enum values and non-finite numbers", () => {
    const { save } = midGameSave();
    const cases: ReadonlyArray<Record<string, unknown>> = [
      { ...save, mode: "space-shuttle" },
      { ...save, ski: { ...save.ski, status: "flying" } },
      { ...save, bedroom: { ...save.bedroom, cat: { ...save.bedroom.cat, mood: "zoomies" } } },
      { ...save, ski: { ...save.ski, distance: "12" } },
      { ...save, ski: { ...save.ski, height: null } },
      { ...save, ski: { ...save.ski, lives: 4.5 } },
      { ...save, ski: { ...save.ski, lives: 12 } },
      { ...save, ski: { ...save.ski, lives: -1 } },
    ];
    for (const broken of cases) {
      expect(decodeSave(JSON.stringify(broken))).toBeNull();
    }
  });

  it("rejects lives/status combinations that can't happen in play", () => {
    const { save } = midGameSave();
    const skiingWithNoLives = { ...save, ski: { ...save.ski, status: "skiing", lives: 0 } };
    expect(decodeSave(JSON.stringify(skiingWithNoLives))).toBeNull();
    const forfeitedWithLives = {
      ...save,
      ski: { ...save.ski, status: "forfeited", lives: 3 },
    };
    expect(decodeSave(JSON.stringify(forfeitedWithLives))).toBeNull();
  });

  it("snaps a stale checkpoint down to one that exists today", () => {
    const { save } = midGameSave();
    // 30 isn't a checkpoint in the current layout (they're 0, 26, 52) — a
    // save from an old slope tune should land on 26, the nearest one passed.
    const stale = { ...save, ski: { ...save.ski, lastCheckpoint: 30 } };
    const restored = restoreSave(decodeSave(JSON.stringify(stale))!);
    expect(restored.ski.lastCheckpoint).toBe(26);
  });

  it("clamps out-of-range positions back into the room and slope", () => {
    const { save } = midGameSave();
    const wild = {
      ...save,
      bedroom: {
        player: { x: 999, z: -999 },
        cat: { ...save.bedroom.cat, x: -999, z: 999 },
      },
      ski: { ...save.ski, lateral: 50, distance: -10, height: -5 },
    };
    const restored = restoreSave(decodeSave(JSON.stringify(wild))!);
    const room = createInitialBedroomState();
    expect(Math.abs(restored.bedroom.player.x)).toBeLessThan(room.roomWidth / 2);
    expect(Math.abs(restored.bedroom.player.z)).toBeLessThan(room.roomDepth / 2);
    expect(Math.abs(restored.bedroom.cat.x)).toBeLessThan(room.roomWidth / 2);
    expect(Math.abs(restored.bedroom.cat.z)).toBeLessThan(room.roomDepth / 2);
    expect(restored.ski.lateral).toBe(4);
    expect(restored.ski.distance).toBe(0);
    expect(restored.ski.height).toBe(0);
  });

  it("clamps a fallen-over heading back into the standing range", () => {
    const { save } = midGameSave();
    // A heading past FALL_HEADING would fall over on the first frame after
    // loading — heal it to the edge of standing instead, like positions.
    const tipped = { ...save, ski: { ...save.ski, heading: 9 } };
    const restored = restoreSave(decodeSave(JSON.stringify(tipped))!);
    expect(restored.ski.heading).toBe(FALL_HEADING);
  });

  it("collapses a mid-spin heading to its downhill-equivalent", () => {
    const { save } = midGameSave();
    // A save taken mid-air mid-spin can carry whole turns (spins are legal
    // in the air) — heal to where the skis actually point, not the clamp.
    const spinning = { ...save, ski: { ...save.ski, heading: 2 * Math.PI + 0.5 } };
    const restored = restoreSave(decodeSave(JSON.stringify(spinning))!);
    expect(restored.ski.heading).toBeCloseTo(0.5, 10);
  });

  it("restores a crashed run mid-pause so the respawn still happens", () => {
    let ski = createInitialSkiState();
    // Ski straight into the first chasm at distance 20.
    while (ski.status === "skiing") {
      ski = stepSkiing(ski, idleSkiInput, 1 / 60);
    }
    expect(ski.status).toBe("crashed");
    const save = createSave(
      "slope",
      createInitialBedroomState(),
      ski,
      false,
      createDefaultAppearance(),
    );
    let restored = restoreSave(decodeSave(encodeSave(save))!).ski;
    // Let the pause run out: the restored run must respawn at the
    // checkpoint, exactly like an uninterrupted one.
    for (let i = 0; i < 60 * 2; i++) {
      restored = stepSkiing(restored, idleSkiInput, 1 / 60);
    }
    expect(restored.status).toBe("skiing");
    expect(restored.lives).toBe(8);
    expect(restored.distance).toBeGreaterThanOrEqual(0);
  });
});
