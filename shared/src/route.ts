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
// The measured map (tools/extract_map.py reads slope-map.png). Imported here because
// the GRADE has to agree with where the lake actually is — see LAKE_ROUTE_CENTER below.
// Still a leaf: the generated module is plain data and imports nothing.
import { MAP_LAYOUT } from "./mapLayout.generated";

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
 *
 * `iceGlide` marks a segment you SLIDE across rather than fall down — the frozen
 * lake. On one, speed stops reading the local grade (which is flat there, so the
 * coupling would drop you to a crawl) and instead carries the pace you arrived
 * with, bleeding off gently. See `gradeSpeedFactor`.
 */
export interface Segment {
  readonly id: string;
  readonly length: number;
  readonly next: string | null;
  readonly chasms: readonly Chasm[];
  readonly checkpoints: readonly number[];
  readonly trigger?: SegmentTrigger;
  readonly iceGlide?: boolean;
}

// Where a fresh branching run starts — the shared summit descent.
export const BRANCH_START = "summit";

// The single played trail (slope-mech, 2026-07-24 redirect — see IDEAS.md START
// HERE). The §4 branching graph below is PARKED for the played path: it stays
// here, still proven by the same-clock tests, but the active run no longer forks
// through it. Instead it rides ONE non-branching trail down the whole mountain —
// the spine: summit → forest → frozen lake → yeti's peak → cave → cliff — reaching
// the valley floor at the flag and then coasting off into the flat runout (there is
// no finish line yet — director). Kept as its own ordered list so BRANCH_SEGMENTS'
// tested topology is untouched: the sim walks THIS (via singleTrailNext) instead of
// `next` when a run is flagged single-trail, and the forks never arm.
//
// EXTENDED PAST THE FOREST (slope-mech, 2026-07-25): the trail used to dead-end at
// the back of the lake into an endless flat runout — a terrain-less void where the
// controls also went dead (the grade-0 speed bug, fixed in skiing.ts). It now rides
// the rest of the DESIGNED spine (yeti/cave/cliff already have world placement +
// grade + terrain-builder support — they were only ever parked as *fork* content,
// so pulling them onto the road just skis them straight, no splits). Two jumps come
// along for free: the lake's `lake-gap` (the first jump — design §4, "all three
// routes learn the jump here") and the cliff's `cliff-gap` (the signature crevasse).
// The segments' own triggers (lake→water, yeti→ledge) stay parked with the forks
// (guarded off for single-trail runs). Grow the trail by extending this list; the
// terrain in skiRender.ts follows it automatically.
// FORK 3 IS LIVE (slope-mech, 2026-07-26 — director: "the second mountain is the
// mountain that introduces the cave entrance and the ride around"). The played
// trail is no longer a pure list: `mountain` is a real fork, so the trail is a
// LIST PLUS ONE LIVE BRANCH. The list below is the DEFAULT line (steer nothing and
// this is your run); PLAYED_FORKS says which forks arm on it.
export const SINGLE_TRAIL: readonly string[] = [
  "summit",
  "forest-road",
  "lake",
  "mountain",
  "outside",
  "cliff",
];

/**
 * The forks that are LIVE on the played trail: segment id → the branch steering
 * into its trigger volume takes you down. Everything not listed here stays parked
 * (its trigger never arms on a played run) — so the forest tree, the lake hole and
 * the ice tail are untouched by this, exactly as before.
 *
 * Why an allowlist rather than "all triggers arm": the other three forks have no
 * corridor, no terrain and no content yet, so arming them would strand you in a
 * void. Fork 3 has all three as of this session. Grow this map as each fork lands.
 */
export const PLAYED_FORKS: Readonly<Record<string, string>> = {
  mountain: "cave",
};

/** The branch ids reachable from the played trail via a live fork — the corridors
 * the renderer has to build beyond the default line. */
export const PLAYED_FORK_BRANCHES: readonly string[] = Object.values(PLAYED_FORKS);

/** The next segment along the single played trail, or null at the cliff — the
 * trail's terminal, where the run reaches the valley floor and opens into the
 * runout.
 *
 * Two cases now that Fork 3 is live: on the default line, the list's successor;
 * on a live fork's BRANCH (e.g. inside the cave), the segment's own `next`, which
 * is what rejoins the default line at the cliff. Anything else returns null, so a
 * played run still never wanders onto the parked graph. */
export function singleTrailNext(segmentId: string): string | null {
  const i = SINGLE_TRAIL.indexOf(segmentId);
  if (i >= 0) return i + 1 < SINGLE_TRAIL.length ? SINGLE_TRAIL[i + 1]! : null;
  if (PLAYED_FORK_BRANCHES.includes(segmentId)) {
    return BRANCH_SEGMENTS[segmentId]?.next ?? null;
  }
  return null;
}

/** Whether steering into this segment's trigger volume should divert a PLAYED run
 * (as opposed to the full parked graph, where every trigger is live). */
export function playedForkArms(segmentId: string): boolean {
  return PLAYED_FORKS[segmentId] !== undefined;
}

// The §4 map, as grayblock topology. Read as a resort trail map (sunset at the
// summit, flag in the valley):
//
//   summit (100) ──▶ FOREST fork (Type A) ──▶ lake (140) ──▶ LAKE fork ──┐
//        │           forest-road (190) ─┐                    │           │
//        └─[tree]──▶ forest-tree (190) ─┴─▶ (lake)      around│    into  │[hole]
//                                                             ▼           ▼
//                                        THE SECOND MOUNTAIN          water (400)
//                                        mountain (100) — the approach     │
//                                            │                             │
//                                     FORK 3 ├─[aim at the mouth]──▶ cave (300)
//                                            └─(steer nothing)────▶ outside (300)
//                                                     │       │             │
//                                                     ▼       ▼             ▼
//                                                  cliff (90) ◀──────── (cliff, shared)
//                                                     │
//                                                   FLAG
//
//   parked until Fork 4 (the cliff shove) is built — reachable only by injecting
//   a divert on `mountain`, which is what the same-clock test does:
//        ledge (105) ─▶ valley (150) ─▶ ice-castle (135) ─▶ FLAG
//
// PROPORTIONS FROM THE DRAWN MAP (slope-mech, 2026-07-25 director correction:
// "the proportions — forest is the long stretch, mountains are masses"). The
// segments used to be six near-equal 80–120 blocks, which is why the run read as
// one undifferentiated ramp. Re-cut to the shares Josh's top-down map actually
// shows — the forest is the long meander, the mountains are big masses you spiral
// off and wrap around, and the frozen lake is a crossing of the corner of a big
// body, not a corridor of its own.
//
// THE BIG LAKE AND THE FORK MOUNTAIN (slope-mech, 2026-07-26 — v3 §12.3, two
// director calls). Two things changed here:
//
//   1. The lake's CROSSING grew 80 → 140 (director's pick of the three sizings:
//      "body + longer corner"). The 15× is mostly the ice BODY, which is lateral
//      and lives in the renderer — but a body that big skirted in 3.8 s read as
//      nicking its edge, so the crossing grew with it (~7 s, 22% of the run).
//   2. `yeti`(70) → `cave`(110) were SEQUENTIAL spine segments — which is exactly
//      why the second mountain skied as two more slopes in a row with the fork
//      parked and never arming. They become the real Fork 3: an APPROACH you see
//      the mass and the cave mouth from, then TWO EQUAL BRANCHES, through the
//      mountain or around its outside, rejoining at the cliff. This is v3 §8's
//      parked "re-grayblock route.ts for v3's fork structure", done.
//
// ON THE CLOCK (director, 2026-07-26): §9's 3:30 is where the FINISHED map lands
// once every area has its content, NOT a length to hit now — "so far we only have
// the starting mountain, no forest, and a small lake." So each area is sized to
// what its own content needs and the total falls out. It is now 920 (a clean run
// ~45 s, up from ~31 s). Do not pad an area to chase the budget table in §9.
//
// The four full routes to time-balance (§4), each 920 long by construction:
//   Cave    — summit·forest·lake·mountain·cave·cliff    = 100+190+140+100+300+90
//   Outside — summit·forest·lake·mountain·outside·cliff = 100+190+140+100+300+90
//   Water   — summit·forest·lake·water·cliff            = 100+190+140+400+90
//   Ice     — summit·forest·lake·mountain·ledge·valley·ice-castle
//                                                       = 100+190+140+100+105+150+135
// The forest Type A (road vs. tree) is a same-length no-op on any of the four.
// Three reconvergences: Fork 3's own pair (cave and outside are the same 300, so
// they rejoin the cliff at one clock — the pair this session had to make legible),
// Cave/Outside & Water sharing `cliff` (all reach it at offset 830), and Ice
// running its own tail to a second flag at the same total distance. Hazards are
// deliberately sparse grayblock (one gap on the shared prefix, one on the shared
// cliff, one on the Ice tail): enough to prove chasms fire on every route and
// across the handoffs. NOTE Fork 3's branches carry NO chasm each — deliberate, so
// the pair is same-clock to the STEP and the §10 assertion needs no tolerance.
// Per-route hazard balancing (the road tenser, the detours lower-stakes) is §5.
export const BRANCH_SEGMENTS: Readonly<Record<string, Segment>> = {
  // 0 · Summit Descent (shared). Everyone drops in here. The great tree waits in
  // the back half on the right (lateral 4..12): steer into it and the forest
  // swallows you into the tree world instead of the road.
  summit: {
    id: "summit",
    length: 100,
    next: "forest-road",
    chasms: [],
    checkpoints: [],
    trigger: { at: 75, halfWidth: 25, lateralMin: 4, lateralMax: 12, into: "forest-tree" },
  },
  // 1 · Enchanted Forest — Type A. The road and the tree world are the same
  // length and both flow into the lake, so the detour is a same-clock no-op.
  "forest-road": {
    id: "forest-road",
    length: 190,
    next: "lake",
    chasms: [],
    checkpoints: [],
  },
  "forest-tree": {
    id: "forest-tree",
    length: 190,
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
    // THE LONGER CORNER (slope-mech, 2026-07-26 — director's sizing call). 80 → 140.
    // The 15× is mostly the ice BODY (lateral, in the renderer); this is the part of
    // it that is route length, so the crossing reads as crossing a big lake (~7 s,
    // 22% of the run) rather than nicking its edge in under four seconds.
    length: 140,
    next: "mountain",
    // The gap sits mid-crossing, with its checkpoint just above it — both moved out
    // with the shore (they were 40/35 on the old 80).
    chasms: [{ id: "lake-gap", start: 74, width: 3 }],
    checkpoints: [66],
    trigger: { at: 100, halfWidth: 30, lateralMin: 4, lateralMax: 12, into: "water" },
    // The one FLAT area on the mountain (director, 2026-07-25: "you currently have
    // the frozen lake on the downhill slope"). Flat would normally mean slow — the
    // speed coupling reads grade — so the lake glides instead; see gradeSpeedFactor.
    iceGlide: true,
  },
  // 2b · Into the hole → drivable penguin → underwater penguin castle → surface
  // back on the normal trail (the Water Line). Built the same 200 as
  // yeti(80)+cave(120) so it rejoins the cliff at the same clock.
  water: {
    id: "water",
    // Re-lengthened with Fork 3 (180 → 400) so it still replaces everything the
    // around-the-hole routes ski: mountain(100) + a branch(300). Same clock.
    length: 400,
    next: "cliff",
    chasms: [],
    checkpoints: [],
  },
  // 3 · THE SECOND MOUNTAIN — the approach, and Fork 3's trigger (§5 fork 3;
  // director, 2026-07-26: "the second mountain is the mountain that introduces the
  // cave entrance and the ride around"). This segment is not a slope that happens
  // to curve — it is the stretch where the MASS is in front of you and the cave
  // mouth is a thing you can see and aim at. Steer into the mouth's lateral band
  // (right, +4..+12) over its back half and the mountain takes you inside; steer
  // nothing and you carry on around the outside (`next`), which is the white line
  // on the drawn map. Replaces the old `yeti`, whose trigger pointed at the ice
  // tail — that tail belongs to Fork 4's shove (§5 fork 4), which is a SPEED
  // condition the sim doesn't model yet, so it is parked (see `ledge`).
  mountain: {
    id: "mountain",
    length: 100,
    next: "outside",
    chasms: [],
    checkpoints: [],
    // The mouth sits on the mass's flank at the fork point; the volume covers the
    // back half of the approach, so you have the whole run-in to line up on it.
    trigger: { at: 72, halfWidth: 28, lateralMin: 4, lateralMax: 12, into: "cave" },
  },
  // 3a · THROUGH — the cave, the interior line: enclosed, the mountain overhead.
  // 3b · AROUND — the outside, the exposed line over the shoulder: the mass above
  // you on one side, open air on the other.
  //
  // Same length, therefore same clock; and because height is keyed to route DEPTH
  // (see GRADE_PROFILE) they also share a pitch. Their character is deliberately
  // ENCLOSURE vs EXPOSURE, not steepness — v3 §12.3's "let the cave carry the
  // descent" is structurally unavailable (equal depth ⇒ equal grade), and making
  // either line mellow to satisfy "not another drop-off" would repeat the forest
  // mistake (speed IS grade here; a level area is a slow area). Both keep the
  // mountain's honest pitch and the difference is what's around you.
  cave: {
    id: "cave",
    length: 300,
    next: "cliff",
    chasms: [],
    checkpoints: [],
  },
  outside: {
    id: "outside",
    length: 300,
    next: "cliff",
    chasms: [],
    checkpoints: [],
  },
  // 3c · PARKED: the Ice tail — ledge → the steep valley → the Ice Castle → its own
  // flag. Nothing triggers into it any more: it used to hang off `yeti`, whose one
  // trigger slot is now Fork 3's cave, and its real home is Fork 4's involuntary
  // shove ("too slow → the yeti's son shoves you off"), which is a speed condition
  // the sim doesn't model yet. It stays reachable by injecting a divert on
  // `mountain` — which is exactly what the same-clock test does — so the tail keeps
  // its structural identity: ledge+valley+ice-castle = 390 = cave(300)+cliff(90),
  // and the Ice line still reaches its flag at the same total distance.
  ledge: {
    id: "ledge",
    length: 105,
    next: "valley",
    chasms: [],
    checkpoints: [],
  },
  valley: {
    id: "valley",
    length: 150,
    next: "ice-castle",
    chasms: [{ id: "valley-gap", start: 76, width: 3 }],
    checkpoints: [68],
  },
  "ice-castle": {
    id: "ice-castle",
    length: 135,
    next: null,
    chasms: [],
    checkpoints: [],
  },
  // 4 · The Cliff jump — the shared finale for the Cave, Outside and Water lines.
  // Reached from either Fork 3 branch (mountain·cave / mountain·outside, offset
  // 830) and from water (offset 830) at the same clock. The signature gap lives
  // here (grayblock width 3 for now — the wide "charged-jump-or-boost" cliff is §5
  // balancing).
  cliff: {
    id: "cliff",
    length: 90,
    next: null,
    chasms: [{ id: "cliff-gap", start: 45, width: 3 }],
    checkpoints: [40],
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
  "forest-road": 100,
  "forest-tree": 100,
  lake: 290,
  // After the lake: around (→ the mountain approach) and into the hole (→ water)
  // both start at 430.
  mountain: 430,
  water: 430,
  // FORK 3 splits at the end of the approach: `cave` (through) and `outside`
  // (around) both start at 530 — the pair whose same clock this session is for.
  // The parked ice tail is injected at the same point, so it starts there too.
  cave: 530,
  outside: 530,
  ledge: 530,
  // The Ice tail continues from ledge.
  valley: 635,
  "ice-castle": 785,
  // The shared cliff: both Fork 3 branches end at 830 and water ends at 830, so
  // cliff is 830 whichever way you came — the load-bearing same-clock coincidence.
  cliff: 830,
};

// The full summit → flag length every route shares. 640 → 920 (slope-mech,
// 2026-07-26): the lake's longer corner (+60) and the second mountain becoming an
// approach plus two 300-unit fork branches (+220). Not a step toward §9's 3:30 —
// per the director that number is where the FINISHED map lands; areas are sized to
// their own content and the total is whatever that sums to.
export const TOTAL_ROUTE_LENGTH = 920;

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
// the steepest grade CHANGE now lives high on the mountain, not at the forest.
//
// KEEP THE FOREST'S SPEED (slope-mech, 2026-07-25 director look-pass: "in the forest
// speed drops off"). The old floor 0.28 was mellow enough that a hold-W run shed ~4 u/s
// (18.5 → 14.4) crossing into the forest — a felt "brakes on." First raised to 0.33.
//
// FOREST SPEED, ROUND 2 (slope-mech, 2026-07-25 same-day follow-up: "my speed still feels
// extremely slow through the forest"). 0.33 (factor 0.33/0.35 ≈ 0.94) still left the forest
// BELOW the reference — a genuine slow zone: cruise ~11.3 u/s against the summit's ~17, so
// after the plunge the trees felt like a crawl. The prior nudges (0.26→0.28→0.33) only
// inched it because speed IS grade here — a mellow-graded forest is a slow forest, full stop.
// So this pass stops treating the forest as the slow zone: the plateau jumps to 0.42, ABOVE
// the reference (factor 1.2 → cruise ~14.4 u/s, ~84% of the summit instead of 66%). The
// forest now CARRIES momentum through the trees rather than shedding it. "Steeper = faster"
// still reads where it matters — the 0.5 summit/lower pitch stay clearly steeper than the
// 0.42 forest — but the forest is no longer a mellow-slow stretch; it's a fast glide that's
// just a touch less steep than the plunges. Consequence, flagged for slope-vis: the mountain
// is ~19% taller now (total drop ~282 vs ~238) — a genuinely steeper forest, which the world
// geometry (routeHeightAt) renders. Tuning knob: nudge the 0.42 plateau if the trees still
// read slow (up) or start to feel out of control (down).
//
// FOREST SPEED, ROUND 3 (slope-mech, 2026-07-25 follow-up: "it stays at base speed
// not recognizing my w or shift key"). Round 2's 0.42 STILL read as a slow zone
// because the forest was graded MELLOWER than the 0.5 summit plunge: coming off the
// plunge you decelerate into the trees no matter what you hold (a hold-W run shed
// ~25.7 → 21.6 u/s crossing in; a boosted run is pinned at the GRADE_TOP_SPEED cap
// through both, so the number never budges) — which reads as "the forest ignores my
// keys and sits at one speed." The keys ARE live (the sim folds up/boost into the
// target); the felt deadness was the mellow grade + the cap, not a dropped input.
// Fix: stop making the forest mellower than the summit at all. The post-plunge grade
// now eases from 0.5 only to 0.48 and HOLDS 0.48 flat across the forest + lake, so the
// plunge's momentum carries straight through the trees instead of bleeding off — the
// forest skis as fast as the summit (cruise ~16.5 u/s, hold-W ~24.7). "Steeper =
// faster" now lives entirely in the *lower* pitch (0.5 at 560) and the flag ease; the
// upper mountain is one sustained fast pitch by design (Josh's repeated call:
// forest-not-slow beats a visible summit↔forest grade step). Consequence, flagged for
// slope-vis: the upper mountain is a touch taller/steeper again (routeHeightAt renders
// it). KNOBS: nudge the 0.48 plateau if the trees still read slow (up) / out of control
// (down); if BOOST specifically should out-run cruise on the fast stretches rather than
// sitting at the shared 28 ceiling, raise GRADE_TOP_SPEED in skiing.ts (its own call).
// SHAPE THE MOUNTAIN (slope-mech, 2026-07-25 — director: "you currently have the
// frozen lake on the downhill slope"; every area skied the same ~26°, so the map
// had no terrain story). Each area has its own character, read off the drawn map.
// Re-spanned 2026-07-26 for the big lake + the fork mountain (route 640 → 920):
//
//   start mountain 0–100    the plunge, steepest and steady
//   forest        100–290   ROLLING — the profile undulates instead of stepping down
//   frozen lake   290–430   FLAT (the ease-down + the ice + the ramp back out)
//   second mtn    430–830   the approach + both fork branches, HONEST pitch
//   cliff run-in  830–920   steep again, then easing to the flag
//
// THE SECOND MOUNTAIN IS NOT MELLOW (slope-mech, 2026-07-26). The director's call
// is that it must not read as "another drop-off" — but speed IS grade here, so
// flattening it would make it a slow area, which is the forest mistake made a
// fourth time. It therefore keeps a pitch at or above the forest's mean (~0.44–0.46,
// where the old profile dipped to 0.38 mid-wrap), and "not another drop-off" is
// answered by GEOMETRY instead: the mountain's bulk stands beside and above the
// line (the renderer's mass), the outside branch wraps around its foot, and the
// cave branch runs inside it. Both branches sit at the same route depth, so they
// necessarily share this pitch — the difference between them is enclosure vs
// exposure, never steepness.
//
// THE FOREST IS ROLLING, NOT MELLOW. Speed IS grade here, and a gentler forest has
// been rejected three times ("my speed still feels extremely slow through the
// trees"). So the forest keeps a MEAN pitch right at the summit's — it just stops
// being a straight ramp: the grade rolls between ~0.41 and ~0.52 over ~30-unit
// waves, which reads as rolling ground under you and costs nothing in average
// speed. Character without a slow zone. (Rounds 1–3 of the old forest-speed fight
// are the reason this is a roll and not a step; see the git history of this file.)
//
// THE LAKE IS GENUINELY FLAT. The grade eases from the forest's 0.44 to 0 over the
// lake's first ~22 units, sits at 0 across the ice, and ramps back to the second
// mountain's pitch after. Flat would normally mean a hard speed shed, so the lake
// is `iceGlide` and its speed comes from what you arrived with — see
// gradeSpeedFactor. The ease-down is INSIDE the lake segment on purpose, so the
// glide covers it and the shore doesn't read as brakes; the ramp back out straddles
// the far shore for the same reason.
/**
 * The lake's size, and where it sits.
 *
 * Split on purpose, because the two come from different authorities (2026-07-26):
 * the DRAWING says where the lake is — `MAP_LAYOUT.lake.route` is the drawn cyan
 * body's centroid projected onto the drawn trail — and the DIRECTOR says how big it
 * is: *"the picture isn't drawn to scale. i want a big ass beautiful lake."* The drawn
 * body is only ~3 lane-widths across; 90 is the ~15× the ride verdict asked for.
 *
 * It lives here rather than beside FROZEN_LAKE in slopePath.ts because the GRADE has
 * to agree with it: the flat below is flat *because* there is a lake there, and the two
 * silently disagreeing is precisely the failure the measured map exists to end. (The
 * old flat sat at 312–415 while the drawn lake centres at 432.)
 */
export const LAKE_RADIUS = 90;
export const LAKE_ROUTE_CENTER = MAP_LAYOUT.lake.route;
/** How far the lateral offset puts the lane off the lake's centre, at LAKE_RADIUS —
 * mirrors slopePath's `drawnLateralAt`, which scales the drawn offset with the size. */
const LAKE_LATERAL =
  MAP_LAYOUT.lake.radius > 0
    ? (MAP_LAYOUT.lake.lateral * LAKE_RADIUS) / MAP_LAYOUT.lake.radius
    : MAP_LAYOUT.lake.lateral;
/**
 * How much of the crossing is dead flat.
 *
 * NOT the full chord through the disc, deliberately. A radius-90 lake crossed near
 * its middle is ~170 units of ice, and 170 units at zero grade is a long time with no
 * gravity — the flat is the one stretch where speed comes only from what you carried
 * in (see iceGlideFactor). The tuned figure was 103 units, inside a wider sheet of
 * ice, and that pacing is kept: the flat MOVES with the lake but does not GROW with it.
 * Widen this only against a ride, not against the geometry.
 */
const LAKE_FLAT_SPAN = 103;
const LAKE_FLAT_HALF = Math.min(
  LAKE_FLAT_SPAN / 2,
  Math.sqrt(Math.max(0, LAKE_RADIUS * LAKE_RADIUS - LAKE_LATERAL * LAKE_LATERAL)),
);
export const LAKE_FLAT_FROM = Math.round(LAKE_ROUTE_CENTER - LAKE_FLAT_HALF);
export const LAKE_FLAT_TO = Math.round(LAKE_ROUTE_CENTER + LAKE_FLAT_HALF);

const GRADE_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0.5], // start mountain: the plunge (~26.6°, just under the camera's ~27°)
  [80, 0.5], // …held steady the whole way down the peak, not shed early
  [100, 0.48], // the forest mouth — barely a step, so no "brakes" at the treeline
  [130, 0.52], // ── the forest rolls: crest…
  [160, 0.41], // …and hollow…
  [195, 0.51], // …and crest…
  [225, 0.41], // …and hollow…
  [260, 0.5], // …and a last crest…
  [290, 0.44], // …bottoming out onto the lake shore. ⚠ iceGlideFactor samples the
  // grade at EXACTLY 290 to know what pace you arrived with — keep a control point
  // here holding the forest's exit pitch, or the glide starts already half-scrubbed.
  // The flat is DERIVED from the lake now, not typed. It used to be a fixed 312–415,
  // which stopped being under the lake the moment the map came off the drawing — the
  // ice would have been a level sheet floating over ground that was still falling.
  [LAKE_FLAT_FROM, 0.0], // the ice begins — flat, and the glide carries you across
  [LAKE_FLAT_TO, 0.0], // …flat right across the crossing: the lake does not tilt
  [LAKE_FLAT_TO + 33, 0.47], // the second mountain picks the descent back up
  [LAKE_FLAT_TO + 60, 0.48], // …toward the fork, at the mountain's honest pitch
  [620, 0.46], // ── the wrap rolls a little rather than holding one dead pitch…
  [720, 0.49],
  [830, 0.47], // …but its MEAN (~0.475) stays above the forest's (~0.468). NOT mellow —
  // route.test.ts pins that, because flattening this area is the standing trap.
  [870, 0.5], // the steep lower pitch (the cliff run-in)
  [900, 0.5],
  [920, 0.42], // ease a touch for the flag
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
  const seg = BRANCH_SEGMENTS[segmentId];
  if (!seg) return 1;
  if (seg.iceGlide) return iceGlideFactor(seg, distance);
  return routeGradeAt(routeDistanceOf(segmentId, distance)) / REFERENCE_GRADE;
}

/** How much of the ice you have scrubbed off by the far shore — the lake is not
 * frictionless, it just doesn't brake you. 0.18 = you leave the lake at ~82% of
 * the pace you hit it with. Raise for a draggier lake, lower for slicker ice. */
const ICE_DRAG = 0.18;

/**
 * Speed on an `iceGlide` segment (slope-mech, 2026-07-25 — director's call on the
 * flat lake: "flat look, ice keeps speed").
 *
 * The frozen lake is the one FLAT area on the mountain, and speed here is grade:
 * reading the local grade on flat ground would floor the coupling and drop cruise
 * from ~16 u/s to the 8 u/s base the moment you touched the shore — the exact
 * "slamming the brakes" the forest was retuned three times to avoid. So on the ice
 * the factor is the one you ARRIVED with (the grade just above the lake, i.e. the
 * forest's exit pitch), bled off linearly by ICE_DRAG across the crossing. You
 * carry the mountain's momentum onto the lake, glide, and slowly lose it — which
 * is what skating across a frozen lake actually does.
 *
 * Deliberately a pure function of (segment, distance) like every other factor
 * here: no new sim state, nothing to serialize, no SAVE_VERSION bump, and a
 * headless timing run over the route reproduces it exactly.
 */
function iceGlideFactor(seg: Segment, distance: number): number {
  const entry = SEGMENT_OFFSETS[seg.id] ?? 0;
  // The pitch you arrive at the shore with. GRADE_PROFILE carries a control point at
  // the lake's entry holding the run-in's pitch, and only flattens to 0 over the
  // following stretch — so sampling exactly at `entry` reads the mountain above the
  // ice, not the ice. (Keep that control point if you retune the profile: without it
  // this would read the flattening and the glide would start already half-scrubbed.)
  const carried = routeGradeAt(entry) / REFERENCE_GRADE;
  const u = seg.length > 0 ? Math.min(1, Math.max(0, distance / seg.length)) : 0;
  return carried * (1 - ICE_DRAG * u);
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
