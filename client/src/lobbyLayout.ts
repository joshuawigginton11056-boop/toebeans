// Where lobby characters stand (lobby session territory). Pure geometry, no
// three.js, so the positioning rules can be unit-tested without a renderer —
// the numbers here are the whole spec, checked in lobbyLayout.test.ts.
//
// Up to four players line up on the snow facing the camera. "You" — the local
// player — always stand a step *in front of* everyone else, and where you
// stand along the line depends on how many players there are:
//
//   • 2 or 4 players: you're on the left.
//   • 3 players:      you're in the middle.
//   • alone:          the historical single-player spot (a touch camera-left),
//                     left exactly as it was so the solo lobby doesn't move.
//
// The rest fill the remaining spots, evenly spaced and centered in frame.
// (+x is screen-right, -x screen-left; +z is toward the camera.)

export interface LobbySlot {
  /** Across the frame: negative is screen-left, positive screen-right. */
  readonly x: number;
  /** Depth: positive is toward the camera. "You" stand a step forward. */
  readonly z: number;
  /** Body turn in radians — 0 faces the camera; others angle toward center. */
  readonly facing: number;
  /** True for the local player's ("your") slot. */
  readonly isLocal: boolean;
}

const SPACING = 1.05; // gap between neighbours, world units
const LOCAL_FORWARD = 0.6; // how far in front of the line "you" stand
const BACK_Z = 0; // the line everyone else stands on
const LOCAL_FACING = 0.15; // your near-camera three-quarter turn
const OTHER_TURN = 0.22; // how far the others angle in toward center
const SOLO_X = -0.35; // the untouched single-player spot (camera-left)

/** Clamp a requested player count to the 1..4 the lobby supports. */
export function clampPlayerCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(4, Math.trunc(count)));
}

/**
 * Which slot (0-based, left → right) belongs to the local player: the middle
 * of three, otherwise the leftmost. This is the "left / middle" rule in one
 * line, shared by the layout below and the tests.
 */
export function localSlotIndex(count: number): number {
  return clampPlayerCount(count) === 3 ? 1 : 0;
}

/** The standing positions for a lobby of `count` players (1..4). */
export function lobbyLayout(count: number): LobbySlot[] {
  const n = clampPlayerCount(count);
  if (n === 1) {
    // Solo: exactly the old single spot — there's no "rest" to stand ahead of.
    return [{ x: SOLO_X, z: BACK_Z, facing: LOCAL_FACING, isLocal: true }];
  }
  const localIndex = localSlotIndex(n);
  const slots: LobbySlot[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * SPACING; // even spread, centered on 0
    const isLocal = i === localIndex;
    slots.push({
      x,
      z: isLocal ? LOCAL_FORWARD : BACK_Z,
      facing: isLocal ? LOCAL_FACING : Math.sign(-x) * OTHER_TURN,
      isLocal,
    });
  }
  return slots;
}
