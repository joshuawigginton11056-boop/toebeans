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

// The single played trail (slope-mech, 2026-07-24 redirect — see IDEAS.md START
// HERE). The §4 branching graph below is PARKED for the played path: it stays
// here, still proven by the same-clock tests, but the active run no longer forks
// through it. Instead it rides ONE non-branching trail — summit → the back of the
// enchanted forest — and ends there, coasting off into the flat runout (there is
// no finish line yet). Kept as its own tiny ordered list so BRANCH_SEGMENTS'
// tested topology is untouched: the sim walks THIS (via singleTrailNext) instead
// of `next` when a run is flagged single-trail, and the forks never arm. Extend
// the list (and its terrain in skiRender) when Josh opens the map back up.
export const SINGLE_TRAIL: readonly string[] = ["summit", "forest-road"];

/** The next segment along the single played trail, or null at the back of the
 * forest — the trail's terminal, where the run opens into the runout. Off the
 * trail (an unlisted id) returns null too, so a single-trail run never wanders
 * onto the parked graph. */
export function singleTrailNext(segmentId: string): string | null {
  const i = SINGLE_TRAIL.indexOf(segmentId);
  return i >= 0 && i + 1 < SINGLE_TRAIL.length ? SINGLE_TRAIL[i + 1]! : null;
}

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

// ── The descent's grade profile ─────────────────────────────────────────────
// (slope-mech, 2026-07-24 — "steepness increases speed. the steeper the area, the
// faster the skiing," director.) The branching map no longer drops at ONE pitch:
// the grade VARIES down the route — a steep summit plunge, a mellow forest/lake, a
// steep lower pitch into the flag — and the sim reads the local grade to drive
// speed (steeper ⇒ faster cruise; see skiing.ts's targetMagnitude).
//
// Kept a function of ROUTE distance (routeDistanceOf), so — exactly like the old
// constant grade — every route sits at the same height at the same clock and drops
// the same total to the flag ("same clock, same flag" in elevation, for free). A
// per-route "steep valley" flavor is therefore a per-DEPTH profile shared by all
// routes at that depth, NOT a per-segment override (which would break the
// equal-drop invariant). Presentation (slopePath.ts) reads routeHeightAt for the
// world-Y; the sim reads gradeSpeedFactor for the coupling. It lives HERE (shared,
// pure) so both sides read one source of truth and skiing.ts stays pure.
//
// REFERENCE_GRADE is the director-locked "invigorating" ~19° (tan 0.35): the speed
// coupling is a NO-OP at this grade, so average-pitch terrain feels exactly as it
// did and only the steep/mellow zones push speed up/down. The steep zones are held
// just under the camera's framing elevation (~27°, tan ≈ 0.51) so the view still
// looks down onto the slope — steeper than that would want a camera change too.
export const REFERENCE_GRADE = 0.35;

// Control points [routeDistance, grade], linearly interpolated → a continuous grade
// (no pitch crease) that integrates to a smooth height. Averages ~0.35 over the 640
// route (≈ the old ~224-unit total drop). Tunable knobs — widen the spread for more
// punch, flatten for less.
//
// THE SUMMIT→FOREST EASE-OUT (slope-mech, 2026-07-24, director look-pass: "speed
// instantly drops at the forest — it reads as slamming the brakes"). The old profile
// dropped the grade at ONE constant slope [0,0.5]→[120,0.26] that bottomed exactly at
// the forest mouth (120): the whole speed shed landed there, and a boosted run pins
// the momentum easing at its COAST_DRAG floor (~4 u/s²) for a sustained beat right as
// the forest arrives — the "brakes." Fix: shed the plunge's extreme EARLY and EASE OUT
// into the forest. The grade now falls STEEPLY over the upper summit [0,60] (where
// bleeding the ~27° plunge's speed is natural and expected) then LEVELS onto a gentle
// leg [60,180] that carries THROUGH the forest entrance (120) — so at the forest you're
// already gliding, decel a fraction of the cap (~0.3 u/s² cruise), not slamming. The
// mellow finishes at 180 (just inside the early forest) instead of at its mouth, and
// the floor sits a touch higher (0.28) to narrow the summit→forest speed ratio without
// touching the locked 0.5 plunge or the SLOPE_SPEED_GAIN steeps. The steepest grade
// CHANGE now lives high on the mountain, not at the forest. (Secondary knob if it wants
// even gentler: lower SLOPE_SPEED_GAIN in skiing.ts — it scales the absolute decel.)
const GRADE_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0.5], // steep summit plunge (~26.6°, just under the camera's ~27°)
  [60, 0.36], // shed most of the plunge up high — steep grade drop, expected here
  [180, 0.28], // ease out onto the mellow forest, gently, PAST the 120 forest mouth
  [340, 0.28], // …stays gentle across the forest + frozen lake
  [460, 0.34], // building back up through the mid detours
  [560, 0.5], // the steep lower pitch (ice valley / cliff run-in)
  [640, 0.38], // ease a touch for the flag
];

function gradeProfileAt(routeDistance: number): number {
  const d = Math.max(0, Math.min(TOTAL_ROUTE_LENGTH, routeDistance));
  const pts = GRADE_PROFILE;
  for (let i = 1; i < pts.length; i++) {
    const [d0, g0] = pts[i - 1]!;
    const [d1, g1] = pts[i]!;
    if (d <= d1) {
      const t = d1 === d0 ? 0 : (d - d0) / (d1 - d0);
      return g0 + (g1 - g0) * t;
    }
  }
  return pts[pts.length - 1]![1];
}

// Precomputed cumulative HEIGHT above the flag: H(D) = ∫_D^TOTAL grade ds, so the
// flag (D = TOTAL) is exactly 0 and the summit (D = 0) is the full drop. Sampled
// every unit and trapezoid-summed once at load; routeHeightAt lerps it. Keyed to
// route distance like everything else, so H is the same height whichever route
// reached depth D.
const HEIGHT_STEP = 1;
const HEIGHT_TABLE: Float64Array = (() => {
  const n = Math.floor(TOTAL_ROUTE_LENGTH / HEIGHT_STEP) + 1;
  const h = new Float64Array(n);
  // Accumulate from the flag upward so the flag stays exactly 0.
  for (let i = n - 2; i >= 0; i--) {
    const d0 = i * HEIGHT_STEP;
    const d1 = (i + 1) * HEIGHT_STEP;
    const avg = (gradeProfileAt(d0) + gradeProfileAt(d1)) / 2;
    h[i] = h[i + 1]! + avg * (d1 - d0);
  }
  return h;
})();

/** The local grade (tan of the downhill pitch) at a route distance — steep near
 * the summit and the lower pitch, mellow through the forest/lake.
 *
 * Past the flag the mountain RUNS OUT FLAT (slope-mech, 2026-07-24 — "no finish
 * line yet", director): a terminal segment opens into an open runout you coast
 * off rather than a win, so grade drops to 0 there. That keeps the runout terrain
 * flat and consistent with the clamped height (routeHeightAt is already 0 past the
 * flag) and eases the speed coupling into a gentle coast on the valley floor. */
export function routeGradeAt(routeDistance: number): number {
  if (routeDistance > TOTAL_ROUTE_LENGTH) return 0;
  return gradeProfileAt(routeDistance);
}

/** Height above the flag at a route distance (the world-Y the slope sits at). The
 * same value whichever route reached this depth — "same clock, same flag." */
export function routeHeightAt(routeDistance: number): number {
  const d = Math.max(0, Math.min(TOTAL_ROUTE_LENGTH, routeDistance));
  const fi = d / HEIGHT_STEP;
  const i = Math.floor(fi);
  const last = HEIGHT_TABLE.length - 1;
  if (i >= last) return HEIGHT_TABLE[last]!;
  const t = fi - i;
  return HEIGHT_TABLE[i]! + (HEIGHT_TABLE[i + 1]! - HEIGHT_TABLE[i]!) * t;
}

/** The speed multiplier from local steepness (slope-mech, 2026-07-24): the local
 * grade relative to the reference, so it's 1.0 (a no-op) on the locked ~19° pitch,
 * >1 on the steeps (faster) and <1 on the flats (slower). Exactly 1.0 off the
 * branching map — the flat Overlook's "main" segment has no grade, so it plays as
 * it always did. */
export function gradeSpeedFactor(segmentId: string, distance: number): number {
  if (!BRANCH_SEGMENTS[segmentId]) return 1;
  return routeGradeAt(routeDistanceOf(segmentId, distance)) / REFERENCE_GRADE;
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
