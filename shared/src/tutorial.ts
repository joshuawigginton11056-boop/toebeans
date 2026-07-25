// The tutorial map — a new player's first ride (onboarding, 2026-07-25).
//
// A short, gentle run whose whole job is to teach the basics: you start
// moving on your own, the controls flash up on screen (the ghost keyboard,
// see hud.ts), the sun rises as you go, and about half a minute in a CREEK
// runs across the forest floor — the run's one lesson. Jump it and you carry
// on; ski into it and you lose a life, just like a chasm on the real slope.
//
// Everything here is PURE, serializable state and math — no Three.js, no
// rendering (the forest look lives in client/src/tutorialBiome.ts). The run
// reuses the ordinary ski sim (stepSkiing in skiing.ts) unchanged: a creek is
// just a Chasm, so "jump it or die" already works. Keeping the tutorial in its
// own file (director's ask) means the layout, the timing, and the sunrise can
// be retuned here without touching the slope's own files.

import { createInitialSkiState, type SkiState } from "./skiing";

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

// Where the creek crosses, in run-distance units. Tuned so a new player who
// just lets the run carry them (no keys — the sim eases up to the gentle
// cruise speed on its own) reaches the creek's near edge at roughly 30
// seconds, per the design ask. See tutorial.test.ts, which walks the real sim
// and pins that ~30s window; retune this number there if the feel changes.
export const TUTORIAL_CREEK_START = 232;

// The creek's width — how big a gap you clear. Deliberately narrow: the same
// width as the slope's warm-up chasm ("chasm-1", the one sized to *learn* the
// jump on), so a single tap of the jump key clears it. The lesson is timing,
// not a hard clutch jump.
export const TUTORIAL_CREEK_WIDTH = 3;

// A checkpoint sits just before the creek, so dying in it respawns you right
// on the run-in — you retry the creek, not the whole map. (Checkpoint 0 is the
// start; the sim never draws a marker there.)
export const TUTORIAL_CREEK_CHECKPOINT = TUTORIAL_CREEK_START - 25;

// The run ends a little past the creek: enough coast-out to feel like you
// *made it*, then it hands back to the lobby (the sim's normal finish flow).
export const TUTORIAL_FINISH = 360;

// How dim the sky starts, on the scene's day↔night dial (skiScene.ts's
// timeOfDay: 0 = the bright warm dawn, 1 = full night). The sunrise runs this
// value *down* to 0 as you descend, so the run opens in a soft early-morning
// half-light and brightens to full daybreak by the creek and finish — the "sun
// rising as the player advances" beat. A look-pass knob: nudge it up for a
// darker, more dramatic dawn, down for a brighter start.
export const TUTORIAL_SUNRISE_START = 0.45;

// A fresh tutorial run. Reuses every physics/feel default from a normal run
// (createInitialSkiState — same body, same controls) and only swaps in the
// tutorial's shape: its own flat "tutorial" segment (unknown to the branching
// map, so the sim lays it out flat and finishes it cleanly at the line, exactly
// like the old Overlook), the single creek hazard, a checkpoint on its run-in,
// and the short finish. Not saved — like the branching map, a reload drops you
// back to the lobby's normal run; the tutorial is always entered fresh.
export function createTutorialSkiState(): SkiState {
  return {
    ...createInitialSkiState(),
    // A flat, self-contained segment. It has no entry in the route registry,
    // so the renderer lays it straight and level and the sim treats reaching
    // the line as a win — the same path the Overlook takes.
    segmentId: "tutorial",
    singleTrail: false,
    chasms: [
      {
        id: "creek",
        start: TUTORIAL_CREEK_START,
        width: TUTORIAL_CREEK_WIDTH,
      },
    ],
    checkpoints: [0, TUTORIAL_CREEK_CHECKPOINT],
    lastCheckpoint: 0,
    finishDistance: TUTORIAL_FINISH,
  };
}

// The sunrise, as a pure function of how far you've come. Returns the scene's
// timeOfDay phase to show at this distance: it starts at TUTORIAL_SUNRISE_START
// (a dim early morning) and eases to 0 (full bright dawn) by the finish, so the
// light lifts steadily as you advance. Presentation only — the client feeds
// this to setTimeOfDay each frame; nothing here touches the sim or the save.
export function tutorialSunPhase(
  distance: number,
  finishDistance: number = TUTORIAL_FINISH,
): number {
  const progress = clamp(distance / finishDistance, 0, 1);
  return clamp(TUTORIAL_SUNRISE_START * (1 - progress), 0, 1);
}
