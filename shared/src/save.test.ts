import { describe, expect, it } from "vitest";
import {
  BOOST_SPEED,
  CHARACTERS,
  LATERAL_LIMIT,
  SKIN_TONES,
  createDefaultAppearance,
  createInitialSkiState,
  stepSkiing,
} from "./index";
import {
  SAVE_VERSION,
  createSave,
  decodeSave,
  encodeSave,
  restoreSave,
} from "./save";

const idleSkiInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  boost: false,
  flip: 0,
} as const;

// A mid-game snapshot with real history: a ski run past the first
// checkpoint with one life already lost.
function midGameSave() {
  let ski = createInitialSkiState();
  for (let i = 0; i < 60 * 6; i++) {
    ski = stepSkiing(ski, idleSkiInput, 1 / 60);
  }
  const appearance = { ...createDefaultAppearance(), character: 3, skin: 5, hair: 4 };
  return { ski, appearance, save: createSave("slope", ski, true, appearance) };
}

describe("save/load", () => {
  it("round-trips a mid-game snapshot through encode → decode → restore", () => {
    const { ski, save } = midGameSave();
    const decoded = decodeSave(encodeSave(save));
    expect(decoded).not.toBeNull();
    const restored = restoreSave(decoded!);

    expect(restored.mode).toBe("slope");
    expect(restored.muted).toBe(true);
    expect(restored.ski.distance).toBe(ski.distance);
    expect(restored.ski.lives).toBe(ski.lives);
    expect(restored.ski.status).toBe(ski.status);
    expect(restored.ski.lastCheckpoint).toBe(ski.lastCheckpoint);
  });

  it("accepts both scene modes — the lobby replaced the bedroom", () => {
    const { save } = midGameSave();
    const inLobby = { ...save, mode: "lobby" };
    expect(decodeSave(JSON.stringify(inLobby))?.mode).toBe("lobby");
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

    // The save carries no layout at all — chasms and checkpoints must match
    // today's createInitialSkiState exactly.
    expect(encodeSave(save)).not.toContain("chasm");
    expect(restored.ski.chasms).toEqual(fresh.chasms);
    expect(restored.ski.checkpoints).toEqual(fresh.checkpoints);
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
    for (const key of ["mode", "muted", "ski", "appearance"] as const) {
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
      // The scrapped scene: a v4 save's mode is one more thing that would
      // reject a hand-migrated save (version alone already rejects real ones).
      { ...save, mode: "bedroom" },
      { ...save, ski: { ...save.ski, status: "flying" } },
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

  it("clamps out-of-range ski values back into today's legal ranges", () => {
    const { save } = midGameSave();
    const wild = {
      ...save,
      ski: { ...save.ski, lateral: 50, distance: -10, height: -5 },
    };
    const restored = restoreSave(decodeSave(JSON.stringify(wild))!);
    // Both sides of the 2026-07-22 merge: no bedroom block anymore (lobby
    // session), and the widened slope clamps to LATERAL_LIMIT, not a magic 4
    // (skiable-area session).
    expect(restored.ski.lateral).toBe(LATERAL_LIMIT);
    expect(restored.ski.distance).toBe(0);
    expect(restored.ski.height).toBe(0);
  });

  it("keeps a past-sideways heading — with no fall, every angle is legal", () => {
    const { save } = midGameSave();
    // heading 9 carries a whole turn; collapsed it's ~2.72 — past sideways,
    // which is riding-switch territory now (turning round 3), not a crash
    // waiting to happen on frame 1. No clamp, just the collapse.
    const turned = { ...save, ski: { ...save.ski, heading: 9 } };
    const restored = restoreSave(decodeSave(JSON.stringify(turned))!);
    expect(restored.ski.heading).toBeCloseTo(9 - 2 * Math.PI, 10);
  });

  it("restores a switch save: the speed's sign survives, its magnitude clamps", () => {
    const { save } = midGameSave();
    // Negative speed = riding switch — a legal stance, so a wild magnitude
    // clamps to the boost cap without losing the sign, and the unsaved
    // flight direction re-derives as tails-leading (heading + π).
    const riding = {
      ...save,
      ski: { ...save.ski, heading: Math.PI - 0.1, speed: -99 },
    };
    const restored = restoreSave(decodeSave(JSON.stringify(riding))!);
    expect(restored.ski.speed).toBe(-BOOST_SPEED);
    expect(restored.ski.flightHeading).toBeCloseTo(-0.1, 10);
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
    const save = createSave("slope", ski, false, createDefaultAppearance());
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
