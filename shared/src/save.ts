import { normalizeAppearance, type Appearance } from "./appearance";
import {
  BOOST_SPEED,
  LATERAL_LIMIT,
  RESPAWN_DELAY,
  STARTING_LIVES,
  createInitialSkiState,
  downhillHeading,
  type RunStatus,
  type SkiState,
} from "./skiing";

// Save/load (M2). A save is a JSON snapshot of the *dynamic* parts of the
// game — the run in progress, whether sound is muted, who your character is.
// The static layout (chasms, checkpoints) is deliberately NOT saved: on load
// it always comes fresh from the createInitial* functions, so tuning the
// slope later never leaves old layouts trapped inside saves.
//
// Bump SAVE_VERSION whenever the save shape changes incompatibly — old saves
// are then discarded (decodeSave returns null) and the game starts fresh,
// which is always safe this early in the project.

// Bumped to 2 (skier session): saves gained the character's appearance.
// Bumped to 3 (character-select session): appearance changed shape — the
// player now picks a character whose outfit is baked in, so coat/trousers/
// boots/eyes are gone and a character index took their place. Saves written
// before this are discarded, which costs a player their position and the
// current run — acceptable this early, and the alternative is carrying every
// old save shape forever.
// Bumped to 4 (heading session): the ski run gained a heading — which way
// the skis point. Old saves have no heading, and the discard costs the same
// acceptable thing it did last time: a position and a run in progress.
// Turning round 3 (no bump): the save *shape* is unchanged — speed is now
// signed (negative = riding switch) and a heading past sideways is legal,
// both of which old v4 saves trivially satisfy. flightHeading is transient
// air state and deliberately not saved (a restore re-derives it below).
// Bumped to 5 (lobby session): the walkable bedroom was scrapped for a
// menu-style lobby (director call, 2026-07-22), so the save's bedroom block
// (player/cat positions) is gone and "bedroom" mode became "lobby". Old
// saves are discarded — the usual acceptable cost, a run in progress.
// Hold-to-charge jump (no bump): jumpCharge is transient input state and
// deliberately not saved — a restore starts uncharged, same as flightHeading.
export const SAVE_VERSION = 5;

export type SceneMode = "lobby" | "slope";

export interface SaveData {
  readonly version: number;
  readonly mode: SceneMode;
  readonly muted: boolean;
  readonly appearance: Appearance;
  readonly ski: {
    readonly distance: number;
    readonly lateral: number;
    readonly heading: number;
    readonly height: number;
    readonly verticalVelocity: number;
    readonly speed: number;
    readonly status: RunStatus;
    readonly lives: number;
    readonly respawnTimer: number;
    readonly lastCheckpoint: number;
  };
}

export function createSave(
  mode: SceneMode,
  ski: SkiState,
  muted: boolean,
  appearance: Appearance,
): SaveData {
  return {
    version: SAVE_VERSION,
    mode,
    muted,
    appearance,
    ski: {
      distance: ski.distance,
      lateral: ski.lateral,
      heading: ski.heading,
      height: ski.height,
      verticalVelocity: ski.verticalVelocity,
      speed: ski.speed,
      status: ski.status,
      lives: ski.lives,
      respawnTimer: ski.respawnTimer,
      lastCheckpoint: ski.lastCheckpoint,
    },
  };
}

export function encodeSave(save: SaveData): string {
  return JSON.stringify(save);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Parse and validate a save string. Browser storage can be corrupted,
// half-written, or edited by hand — anything that doesn't check out cleanly
// returns null, and the caller starts a fresh game. Strict on purpose:
// rejecting a bad save costs a fresh start; accepting one costs a broken
// game state that persists itself right back to storage.
export function decodeSave(json: string): SaveData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.version !== SAVE_VERSION) return null;
  if (parsed.mode !== "lobby" && parsed.mode !== "slope") return null;
  if (typeof parsed.muted !== "boolean") return null;

  // Appearance: reject the wrong *kind* of value, but leave out-of-range
  // indices to normalizeAppearance below — same split as everywhere else
  // here, where a wrong type is corruption and a stale number is healable.
  const appearance = parsed.appearance;
  if (!isRecord(appearance)) return null;
  const indices = ["character", "skin", "hair"] as const;
  const picked = {} as Record<(typeof indices)[number], number>;
  for (const field of indices) {
    const value = appearance[field];
    if (!isFinite(value)) return null;
    picked[field] = value;
  }

  const ski = parsed.ski;
  if (!isRecord(ski)) return null;
  const { distance, lateral, heading, height, verticalVelocity, speed, respawnTimer, lastCheckpoint } =
    ski;
  if (
    !isFinite(distance) ||
    !isFinite(lateral) ||
    !isFinite(heading) ||
    !isFinite(height) ||
    !isFinite(verticalVelocity) ||
    !isFinite(speed) ||
    !isFinite(respawnTimer) ||
    !isFinite(lastCheckpoint)
  ) {
    return null;
  }
  const status = ski.status;
  if (status !== "skiing" && status !== "crashed" && status !== "forfeited") {
    return null;
  }
  const lives = ski.lives;
  if (!isFinite(lives) || !Number.isInteger(lives)) return null;
  if (lives < 0 || lives > STARTING_LIVES) return null;
  // Consistency with how runs actually play out: you can't still be skiing
  // with no lives, and a forfeit only ever happens once they're all gone.
  if (status === "skiing" && lives < 1) return null;
  if (status === "forfeited" && lives !== 0) return null;

  return {
    version: SAVE_VERSION,
    mode: parsed.mode,
    muted: parsed.muted,
    appearance: normalizeAppearance(picked),
    ski: {
      distance,
      lateral,
      heading,
      height,
      verticalVelocity,
      speed,
      status,
      lives,
      respawnTimer,
      lastCheckpoint,
    },
  };
}

export interface RestoredGame {
  readonly mode: SceneMode;
  readonly muted: boolean;
  readonly appearance: Appearance;
  readonly ski: SkiState;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Turn a decoded save back into live game states. Dynamic fields come from
// the save; everything static comes from the createInitial* functions. Saved
// numbers are clamped into today's legal ranges, so a save made before a
// layout tweak lands somewhere sensible instead of somewhere impossible.
export function restoreSave(save: SaveData): RestoredGame {
  const skiBase = createInitialSkiState();

  // The saved checkpoint might not exist in the current layout (slope got
  // retuned). Snap down to the nearest checkpoint you'd genuinely passed.
  const lastCheckpoint = skiBase.checkpoints.reduce(
    (best, checkpoint) =>
      checkpoint <= save.ski.lastCheckpoint && checkpoint > best ? checkpoint : best,
    0,
  );

  // Healed together because flightHeading below is derived from both.
  const heading = downhillHeading(save.ski.heading);
  const speed = clamp(save.ski.speed, -BOOST_SPEED, BOOST_SPEED);

  return {
    mode: save.mode,
    muted: save.muted,
    appearance: normalizeAppearance(save.appearance),
    ski: {
      ...skiBase,
      distance: Math.max(0, save.ski.distance),
      lateral: clamp(save.ski.lateral, -LATERAL_LIMIT, LATERAL_LIMIT),
      // A stale heading is healed like a stale position: collapsed to its
      // downhill-equivalent (a save taken mid-air mid-spin can carry whole
      // turns). No range clamp anymore — with the fall removed (turning
      // round 3), every angle in (-π, π] is a legal place to stand.
      heading,
      // Not saved (transient air state): re-derive the travel direction the
      // way the next grounded frame would. A save taken mid-air loses the
      // spin offset and resumes flying the way it faces — an acceptable
      // heal, same spirit as clamping a stale position.
      flightHeading: downhillHeading(heading + (speed < 0 ? Math.PI : 0)),
      height: Math.max(0, save.ski.height),
      verticalVelocity: save.ski.verticalVelocity,
      // Signed: negative magnitude is riding switch, and clamps the same.
      speed,
      status: save.ski.status,
      lives: save.ski.lives,
      respawnTimer: clamp(save.ski.respawnTimer, 0, RESPAWN_DELAY),
      lastCheckpoint,
    },
  };
}
