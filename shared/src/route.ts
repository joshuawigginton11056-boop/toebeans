// The branching map's route graph — the sim-side skeleton of "the actual map"
// (SLOPE_BRANCHING.md). A run is no longer one straight distance axis: it's a
// small graph of SEGMENTS chained summit → flag, where a fork can route you
// down a detour instead of the road.
//
// THE ONE LAW (SLOPE_BRANCHING.md §3, "same clock, same flag"): every full
// route from summit to flag is the SAME total length, so no line is a
// shortcut. This module makes that a *construction constraint*, not a scripting
// problem: a Type A detour segment is built the SAME length as the road stretch
// it bypasses, so — skied at the identical physics — it takes the same time and
// rejoins the spine at the same point automatically. Prove the length equality
// and the law holds for free. That is exactly the handoff §8 calls the riskiest
// system, de-risked here first, grayblock only, on the existing skiing sim.
//
// PURE DATA + PURE HELPERS. Where each segment sits in the *world* (its origin
// and facing) is presentation and lives in client/src/slopePath.ts, keyed by
// the same segment ids; this file only knows lengths, hazards, and how the
// graph connects — everything the sim needs to route a run and to measure "same
// clock, same flag." Type-only imports from ./skiing (Chasm) keep this a leaf:
// skiing.ts imports the registry from here at runtime, never the reverse.

import type { Chasm } from "./skiing";

/**
 * A Type A trigger volume on a segment: "the world reaches out and grabs you"
 * (SLOPE_BRANCHING.md §1). While the run is within [`at` ± `halfWidth`] down
 * this segment AND its lateral is inside [`lateralMin`, `lateralMax`], the run
 * is diverted into segment `into` at the next segment boundary (you ski into
 * the great tree and it swallows you). Discoverable by line, per the design.
 */
export interface SegmentTrigger {
  readonly at: number;
  readonly halfWidth: number;
  readonly lateralMin: number;
  readonly lateralMax: number;
  readonly into: string;
}

/**
 * One segment of the route. `length` is its arc length (the same units the sim
 * measures `distance` in); `next` is the default successor you flow into at the
 * end of the segment (staying on the road), or null when this segment ends at
 * the flag. `chasms`/`checkpoints` are that segment's own hazards/respawns, in
 * segment-local distance (0 = the segment's entrance). `trigger`, if present,
 * is the Type A fork that can override `next`.
 */
export interface Segment {
  readonly id: string;
  readonly length: number;
  readonly next: string | null;
  readonly chasms: readonly Chasm[];
  readonly checkpoints: readonly number[];
  readonly trigger?: SegmentTrigger;
}

// Where a fresh branching run starts.
export const BRANCH_START = "spine-1";

// The grayblock topology — one Type A "tree" fork, the §8 de-risk shape:
//
//   spine-1 (120) ──road──▶ spine-2 (100) ─┐
//        │                                   ├─▶ spine-3 (120) ─▶ FLAG
//        └──[great tree]──▶ tree (100) ─────┘
//
// Two full routes, BOTH 340 long: stay-on-road (120+100+120) and detour
// (120+100+120). Equal by construction ⇒ same clock, same flag. The two middle
// segments (spine-2 the road, tree the detour world) are kept flat and equal
// for this de-risk, so the *handoff* is what's on trial, not hazard balancing —
// they read as the same length, different place. The one gap lives in spine-3,
// AFTER the rejoin, so both routes prove a chasm still fires across a segment
// handoff. (Per-segment hazards differing route-to-route — the road tenser, the
// detour a lower-stakes reward run — is just a data change on these lists; §5's
// design, deferred past the de-risk.)
export const BRANCH_SEGMENTS: Readonly<Record<string, Segment>> = {
  "spine-1": {
    id: "spine-1",
    length: 120,
    next: "spine-2",
    chasms: [],
    checkpoints: [],
    // The great tree sits on the right through the back half of the segment:
    // drift or steer right (lateral 4..12) and it takes you.
    trigger: { at: 90, halfWidth: 30, lateralMin: 4, lateralMax: 12, into: "tree" },
  },
  "spine-2": {
    id: "spine-2",
    length: 100,
    next: "spine-3",
    chasms: [],
    checkpoints: [],
  },
  tree: {
    id: "tree",
    length: 100,
    next: "spine-3",
    chasms: [],
    checkpoints: [],
  },
  "spine-3": {
    id: "spine-3",
    length: 120,
    next: null,
    chasms: [{ id: "spine-3-gap", start: 60, width: 3 }],
    checkpoints: [55],
  },
};

// Cumulative arc length from the summit to the *start* of each segment — the
// key to reading "same clock, same flag" live. Because the tree detour and the
// spine-2 road it parallels are the same length, they share an offset (120), so
// `routeDistanceOf` returns the SAME progress whichever way you went: proof, on
// screen, that no route is a shortcut. Grayblock-explicit (a general graph would
// derive these); honest about being hand-authored for this one fork.
const SEGMENT_OFFSETS: Readonly<Record<string, number>> = {
  "spine-1": 0,
  "spine-2": 120,
  tree: 120,
  "spine-3": 220,
};

// The full summit → flag length every route shares.
export const TOTAL_ROUTE_LENGTH = 340;

/** How far down the whole route you are, independent of which fork you took. */
export function routeDistanceOf(segmentId: string, distance: number): number {
  return (SEGMENT_OFFSETS[segmentId] ?? 0) + distance;
}
