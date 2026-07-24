// Where lobby characters stand (lobby session territory). Pure geometry plus a
// little presentation math, no three.js, so the positioning and contrast rules
// can be unit-tested without a renderer — the numbers here are the whole spec,
// checked in lobbyLayout.test.ts.
//
// Up to four players line up on the snow facing the camera. "You" — the local
// player — always stand a step *in front of* everyone else, and where you
// stand along the line depends on how many players there are:
//
//   • 2 or 4 players: you're on the left.
//   • 3 players:      you're in the middle.
//   • alone:          a touch camera-left, matching the multi-player depth.
//
// The rest fill the remaining spots, evenly spaced and centered in frame.
// (+x is screen-right, -x screen-left; +z is toward the camera.)
//
// The whole line sits well back from the camera (2026-07-24): backing the
// characters up frees the foreground for future menu UI *and* opens room for
// each player's pet to sit beside them without crowding a neighbour.

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

const SPACING = 1.35; // gap between neighbours, world units (room for pets)
const LOCAL_FORWARD = 0.6; // how far in front of the line "you" stand
const BACK_Z = -1.6; // the line everyone else stands on — backed well up
const LOCAL_FACING = 0.15; // your near-camera three-quarter turn
const OTHER_TURN = 0.22; // how far the others angle in toward center
const SOLO_X = -0.35; // the single-player spot (a touch camera-left)
const SOLO_Z = BACK_Z + LOCAL_FORWARD; // backed up to the multi-player depth

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
    // Solo: the single spot, backed up to the same depth "you" stand at in a
    // full lobby (there's no "rest" to stand a step ahead of).
    return [{ x: SOLO_X, z: SOLO_Z, facing: LOCAL_FACING, isLocal: true }];
  }
  const localIndex = localSlotIndex(n);
  const slots: LobbySlot[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * SPACING; // even spread, centered on 0
    const isLocal = i === localIndex;
    slots.push({
      x,
      // The line sits at BACK_Z; "you" step forward from it by LOCAL_FORWARD.
      z: isLocal ? BACK_Z + LOCAL_FORWARD : BACK_Z,
      facing: isLocal ? LOCAL_FACING : Math.sign(-x) * OTHER_TURN,
      isLocal,
    });
  }
  return slots;
}

/**
 * How strongly the player orbs should contrast the backdrop, from its color
 * alone (0 = no darkening, 1 = fullest). It's the backdrop's perceived
 * brightness (Rec. 709 luminance of an r,g,b in 0..1): a bright snowy sky
 * wants dark, saturated orbs to read against it; a dark backdrop wants the
 * orbs left luminous. Pure and renderer-free so the rule is one testable
 * number — the lobby renderer feeds it the live backdrop color, so if a
 * future slope re-tints the sky the orbs keep their contrast automatically.
 */
export function backdropContrast(r: number, g: number, b: number): number {
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.max(0, Math.min(1, luminance));
}
