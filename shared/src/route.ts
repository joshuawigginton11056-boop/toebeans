// The branching map's route graph — the sim-side skeleton of "the actual map"
// (SLOPE_BRANCHING.md §4). A run is no longer one straight distance axis: it's a
// small graph of SEGMENTS chained summit → flag, where forks route you down
// detour worlds or split the whole line to the flag.
//
// THE ONE LAW (SLOPE_BRANCHING.md §3, "same clock, same flag"): every full route
// from summit to flag is the SAME total length, so no line is a shortcut. This
// module makes that a *construction constraint*, not a scripting problem: the
// segment lengths are chosen so the three routes (Ice / Cave / Water) each sum
// to TOTAL_ROUTE_LENGTH, and every shared reconvergence point sits at the same
// cumulative offset whichever way you reached it (see SEGMENT_OFFSETS). Prove
// the length equality and the law holds for free — the riskiest system in the
// concept (§8), de-risked as grayblock on the existing skiing sim.
//
// PURE DATA + PURE HELPERS. Where each segment sits in the *world* (its origin
// and facing) is presentation and lives in client/src/slopePath.ts, keyed by
// the same segment ids; this file only knows lengths, hazards, and how the
// graph connects — everything the sim needs to route a run and to measure "same
// clock, same flag." Type-only imports from ./skiing (Chasm) keep this a leaf:
// skiing.ts imports the registry from here at runtime, never the reverse.

import type { Chasm } from "./skiing";

/**
 * A trigger volume on a segment: "the world reaches out and grabs you"
 * (SLOPE_BRANCHING.md §1). While the run is within [`at` ± `halfWidth`] down
 * this segment AND its lateral is inside [`lateralMin`, `lateralMax`], the run
 * is diverted into segment `into` at the next segment boundary (you ski into
 * the great tree / over the yeti's hole / onto the ledge and it takes you).
 * Discoverable by line, per the design. Used for both Type A detours (the tree,
 * the lake) and the Type B split (yeti's peak) — the sim primitive is identical;
 * the only difference is topological (a Type A detour's `next` rejoins the spine
 * quickly, a Type B branch stays separate to the flag).
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
 * is the fork that can override `next`.
 */
export interface Segment {
  readonly id: string;
  readonly length: number;
  readonly next: string | null;
  readonly chasms: readonly Chasm[];
  readonly checkpoints: readonly number[];
  readonly trigger?: SegmentTrigger;
}

// Where a fresh branching run starts — the shared summit descent.
export const BRANCH_START = "summit";

// The §4 map, as grayblock topology. Read as a resort trail map (sunset at the
// summit, flag in the valley):
//
//   summit (120) ──▶ FOREST fork (Type A) ──▶ lake (100) ──▶ LAKE fork ──┐
//        │           forest-road (120) ─┐                    │           │
//        └─[tree]──▶ forest-tree (120) ─┴─▶ (lake)      around│    into  │[hole]
//                                                             ▼           ▼
//                                            YETI fork (Type B)      water (200)
//                                            yeti (80)                    │
//                                        cave│    around│[ledge]          │
//                                            ▼           ▼                │
//                                        cave (120)   ledge (60)          │
//                                            │           │                │
//                                            │        valley (80)         │
//                                            ▼           │                ▼
//                                         cliff (100) ◀──┼──────── (cliff, shared)
//                                            │        ice-castle (80)
//                                          FLAG          │
//                                                      FLAG
//
// The three full routes to time-balance (§4), each 640 long by construction:
//   Cave  — summit·forest·lake·yeti·cave·cliff            = 120+120+100+80+120+100
//   Ice   — summit·forest·lake·yeti·ledge·valley·icecastle= 120+120+100+80+60+80+80
//   Water — summit·forest·lake·water·cliff                = 120+120+100+200+100
// The forest Type A (road vs. tree) is a same-length no-op on any of the three.
// Two reconvergences: Cave & Water share `cliff` (both reach it at offset 540 —
// the same clock), and Ice runs its own tail (valley → ice-castle) to a second
// flag at the same total distance. Hazards are deliberately sparse grayblock
// (one gap on the shared prefix, one on the shared cliff, one on the Ice tail):
// enough to prove chasms fire on every route and across the handoffs; per-route
// hazard balancing (the road tenser, the detours lower-stakes) is §5, deferred.
export const BRANCH_SEGMENTS: Readonly<Record<string, Segment>> = {
  // 0 · Summit Descent (shared). Everyone drops in here. The great tree waits in
  // the back half on the right (lateral 4..12): steer into it and the forest
  // swallows you into the tree world instead of the road.
  summit: {
    id: "summit",
    length: 120,
    next: "forest-road",
    chasms: [],
    checkpoints: [],
    trigger: { at: 90, halfWidth: 30, lateralMin: 4, lateralMax: 12, into: "forest-tree" },
  },
  // 1 · Enchanted Forest — Type A. The road and the tree world are the same
  // length and both flow into the lake, so the detour is a same-clock no-op.
  "forest-road": {
    id: "forest-road",
    length: 120,
    next: "lake",
    chasms: [],
    checkpoints: [],
  },
  "forest-tree": {
    id: "forest-tree",
    length: 120,
    next: "lake",
    chasms: [],
    checkpoints: [],
  },
  // 2 · Frozen Lake — Type A trigger, but its "into" branch feeds the cliff line
  // rather than rejoining where "around" continues: the yeti smashes a hole
  // (back half, right), and dropping in routes you through the penguin world to
  // the shared cliff, skipping Yeti's Peak. Skiing "around" (the default) presses
  // on to the peak. Both faces of the fork are same-clock to the flag. The shared
  // lake gap sits before the hole, so all three routes learn the jump here.
  lake: {
    id: "lake",
    length: 100,
    next: "yeti",
    chasms: [{ id: "lake-gap", start: 50, width: 3 }],
    checkpoints: [45],
    trigger: { at: 70, halfWidth: 25, lateralMin: 4, lateralMax: 12, into: "water" },
  },
  // 2b · Into the hole → drivable penguin → underwater penguin castle → surface
  // back on the normal trail (the Water Line). Built the same 200 as
  // yeti(80)+cave(120) so it rejoins the cliff at the same clock.
  water: {
    id: "water",
    length: 200,
    next: "cliff",
    chasms: [],
    checkpoints: [],
  },
  // 3 · Yeti's Peak — Type B (splits to the flag). Only the around-lake routes
  // reach it. Ski it, then the yeti's son shoves you off the ledge (back half,
  // right) into the Ice Line, or press through to the cave (the default) and the
  // reunion cliff run.
  yeti: {
    id: "yeti",
    length: 80,
    next: "cave",
    chasms: [],
    checkpoints: [],
    trigger: { at: 50, halfWidth: 25, lateralMin: 4, lateralMax: 12, into: "ledge" },
  },
  // 3a · Through the cave → the main road (your friend surfaces from their lake
  // run) → the cliff. The Cave Line, the reunion route.
  cave: {
    id: "cave",
    length: 120,
    next: "cliff",
    chasms: [],
    checkpoints: [],
  },
  // 3b · Around — the ledge → the steep valley → the Ice Castle → its own flag.
  // The Ice Line, run blind to the finish. ledge+valley+ice-castle = 220 =
  // cave(120)+cliff(100), so the two Type B branches reach the flag same-clock.
  ledge: {
    id: "ledge",
    length: 60,
    next: "valley",
    chasms: [],
    checkpoints: [],
  },
  valley: {
    id: "valley",
    length: 80,
    next: "ice-castle",
    chasms: [{ id: "valley-gap", start: 40, width: 3 }],
    checkpoints: [35],
  },
  "ice-castle": {
    id: "ice-castle",
    length: 80,
    next: null,
    chasms: [],
    checkpoints: [],
  },
  // 4 · The Cliff jump — the shared finale for the Cave and Water lines. Reached
  // from cave (yeti·cave, offset 540) and from water (offset 540) at the same
  // clock. The signature gap lives here (grayblock width 3 for now — the wide
  // "charged-jump-or-boost" cliff is §5 balancing).
  cliff: {
    id: "cliff",
    length: 100,
    next: null,
    chasms: [{ id: "cliff-gap", start: 50, width: 3 }],
    checkpoints: [45],
  },
};

// Cumulative arc length from the summit to the *start* of each segment — the key
// to reading "same clock, same flag" live. The construction guarantees every
// shared point lands at one offset whichever fork reached it: the tree detour
// shares spine-2's/the road's forest offset (120); `water` (into the lake) and
// `yeti`→`cave` both deliver you to `cliff` at 540. So `routeDistanceOf` returns
// the SAME progress on every route: proof, on screen, that no line is a shortcut.
// Grayblock-explicit (a general graph would derive these); honest about being
// hand-authored for this map.
const SEGMENT_OFFSETS: Readonly<Record<string, number>> = {
  summit: 0,
  "forest-road": 120,
  "forest-tree": 120,
  lake: 240,
  // After the lake: around (→ yeti) and into (→ water) both start at 340.
  yeti: 340,
  water: 340,
  // Yeti's Peak splits: cave and ledge both start at 420.
  cave: 420,
  ledge: 420,
  // The Ice tail continues from ledge.
  valley: 480,
  "ice-castle": 560,
  // The shared cliff: cave ends at 540 and water ends at 540, so cliff is 540
  // whichever way you came — the load-bearing same-clock coincidence.
  cliff: 540,
};

// The full summit → flag length every route shares.
export const TOTAL_ROUTE_LENGTH = 640;

/** How far down the whole route you are, independent of which fork you took. */
export function routeDistanceOf(segmentId: string, distance: number): number {
  return (SEGMENT_OFFSETS[segmentId] ?? 0) + distance;
}

/**
 * The segment ids on the default road — the ones you reach by never taking a
 * fork, walked from BRANCH_START along each `next`. Everything else is a detour
 * world. Single source of truth for the grayblock renderer's spine-vs-detour
 * coloring and the debug readout's "(detour)" label, so adding segments to the
 * map above just works. Recomputed on call (the graph is tiny); the `has` guard
 * stops a hypothetical `next` cycle from looping forever.
 */
export function roadSegmentIds(): ReadonlySet<string> {
  const road = new Set<string>();
  let id: string | null = BRANCH_START;
  while (id && !road.has(id)) {
    road.add(id);
    id = BRANCH_SEGMENTS[id]?.next ?? null;
  }
  return road;
}
