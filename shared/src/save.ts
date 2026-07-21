import { normalizeAppearance, type Appearance } from "./appearance";
import {
  CAT_RADIUS,
  PLAYER_RADIUS,
  createInitialBedroomState,
  type BedroomState,
  type CatMood,
} from "./bedroom";
import {
  BOOST_SPEED,
  LATERAL_LIMIT,
  RESPAWN_DELAY,
  STARTING_LIVES,
  createInitialSkiState,
  type RunStatus,
  type SkiState,
} from "./skiing";

// Save/load (M2). A save is a JSON snapshot of the *dynamic* parts of the
// game — where you are, the run in progress, whether sound is muted. The
// static layout (room size, furniture, chasms, checkpoints) is deliberately
// NOT saved: on load it always comes fresh from the createInitial* functions,
// so tuning the slope later never leaves old layouts trapped inside saves.
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
export const SAVE_VERSION = 3;

export type SceneMode = "bedroom" | "slope";

export interface SaveData {
  readonly version: number;
  readonly mode: SceneMode;
  readonly muted: boolean;
  readonly appearance: Appearance;
  readonly bedroom: {
    readonly player: { readonly x: number; readonly z: number };
    readonly cat: {
      readonly x: number;
      readonly z: number;
      readonly facing: number;
      readonly mood: CatMood;
    };
  };
  readonly ski: {
    readonly distance: number;
    readonly lateral: number;
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
  bedroom: BedroomState,
  ski: SkiState,
  muted: boolean,
  appearance: Appearance,
): SaveData {
  return {
    version: SAVE_VERSION,
    mode,
    muted,
    appearance,
    bedroom: {
      player: { x: bedroom.player.x, z: bedroom.player.z },
      cat: {
        x: bedroom.cat.x,
        z: bedroom.cat.z,
        facing: bedroom.cat.facing,
        mood: bedroom.cat.mood,
      },
    },
    ski: {
      distance: ski.distance,
      lateral: ski.lateral,
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
  if (parsed.mode !== "bedroom" && parsed.mode !== "slope") return null;
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

  const bedroom = parsed.bedroom;
  if (!isRecord(bedroom)) return null;
  const player = bedroom.player;
  if (!isRecord(player) || !isFinite(player.x) || !isFinite(player.z)) {
    return null;
  }
  const cat = bedroom.cat;
  if (
    !isRecord(cat) ||
    !isFinite(cat.x) ||
    !isFinite(cat.z) ||
    !isFinite(cat.facing)
  ) {
    return null;
  }
  if (cat.mood !== "sitting" && cat.mood !== "following") return null;

  const ski = parsed.ski;
  if (!isRecord(ski)) return null;
  const { distance, lateral, height, verticalVelocity, speed, respawnTimer, lastCheckpoint } =
    ski;
  if (
    !isFinite(distance) ||
    !isFinite(lateral) ||
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
    bedroom: {
      player: { x: player.x, z: player.z },
      cat: { x: cat.x, z: cat.z, facing: cat.facing, mood: cat.mood },
    },
    ski: {
      distance,
      lateral,
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
  readonly bedroom: BedroomState;
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
  const bedroomBase = createInitialBedroomState();
  const skiBase = createInitialSkiState();

  const playerHalfW = bedroomBase.roomWidth / 2 - PLAYER_RADIUS;
  const playerHalfD = bedroomBase.roomDepth / 2 - PLAYER_RADIUS;
  const catHalfW = bedroomBase.roomWidth / 2 - CAT_RADIUS;
  const catHalfD = bedroomBase.roomDepth / 2 - CAT_RADIUS;

  // The saved checkpoint might not exist in the current layout (slope got
  // retuned). Snap down to the nearest checkpoint you'd genuinely passed.
  const lastCheckpoint = skiBase.checkpoints.reduce(
    (best, checkpoint) =>
      checkpoint <= save.ski.lastCheckpoint && checkpoint > best ? checkpoint : best,
    0,
  );

  return {
    mode: save.mode,
    muted: save.muted,
    appearance: normalizeAppearance(save.appearance),
    bedroom: {
      ...bedroomBase,
      player: {
        x: clamp(save.bedroom.player.x, -playerHalfW, playerHalfW),
        z: clamp(save.bedroom.player.z, -playerHalfD, playerHalfD),
      },
      cat: {
        x: clamp(save.bedroom.cat.x, -catHalfW, catHalfW),
        z: clamp(save.bedroom.cat.z, -catHalfD, catHalfD),
        facing: save.bedroom.cat.facing,
        mood: save.bedroom.cat.mood,
      },
    },
    ski: {
      ...skiBase,
      distance: Math.max(0, save.ski.distance),
      lateral: clamp(save.ski.lateral, -LATERAL_LIMIT, LATERAL_LIMIT),
      height: Math.max(0, save.ski.height),
      verticalVelocity: save.ski.verticalVelocity,
      speed: clamp(save.ski.speed, 0, BOOST_SPEED),
      status: save.ski.status,
      lives: save.ski.lives,
      respawnTimer: clamp(save.ski.respawnTimer, 0, RESPAWN_DELAY),
      lastCheckpoint,
    },
  };
}
