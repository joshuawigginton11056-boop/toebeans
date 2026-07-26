// The slope's centerline — the shape of the "road" the world is drawn along.
//
// PRESENTATION-ONLY, and deliberately so. The sim (shared/skiing.ts) models a
// run as `distance` (how far down the hill) + `lateral` (how far across the
// lane); it never knows the hill's shape. This module maps that (distance,
// lateral) pair to a world position + a facing, so Slope 1 can curve — bend
// around the vista, dogleg past the rock gate (DESIGN.md's scenic-showcase
// identity) — without touching a line of physics. Same trick as the faked
// flat-underneath grade: the downhill read comes from motion + framing, not
// from the sim.
//
// STRAIGHT FOR NOW. `BENDS` is empty, so every function here reduces to the
// exact pre-centerline mapping — `slopeToWorld(d, lat)` is `{ x: lat, z: -d }`,
// heading 0 everywhere — and the world is bit-for-bit what it was before this
// file existed. That is on purpose (director call, 2026-07-24, "road system
// first, curve on together"): the curve is a two-session change. THIS session
// (slope-mechanics) lays the road and routes the skier, camera, and hazards
// through it straight; the VISUALS session adopts the same centerline for the
// snow surface, treeline, and ski trails; and only once both sides follow it
// do we give `BENDS` real amplitudes and the curve turns on coherently — no
// interim where the skier drifts off a straight treeline. See the (slope-vis)
// hand-off in IDEAS.md and the seam note in PARALLEL.md.
//
// The mechanism is real and exercised — identity is just the zero-bend case of
// the same integrator — so turning the curve on is a data change here, not a
// rewrite. slopePath.test.ts pins both the straight identity and a sample
// curved centerline (arc-length ≈ distance, heading matches the bends).

import {
  BRANCH_SEGMENTS,
  REFERENCE_GRADE,
  routeDistanceOf,
  routeGradeAt,
  routeHeightAt,
  SINGLE_TRAIL,
  type Segment,
} from "@toebeans/shared";

/** A point on the centerline, in the same world axes the renderer uses. */
export interface SlopePoint {
  /** World X of the centerline at this distance. */
  readonly x: number;
  /** World Z — downhill is −z, matching the old `-distance` mapping. */
  readonly z: number;
  /**
   * World Y of the ground at this point (slope-mech, 2026-07-24 — real grade).
   * The Overlook stays a faked-flat plane at y = 0 (the whole road is 0), so
   * nothing there moves. The BRANCHING map's segments descend for real: the run
   * drops in 3D from an elevated summit to y ≈ 0 at the flag (see
   * segmentCenterline / SEGMENT_GRADE below). The renderer places the skier,
   * camera, hazards, and grayblock at this y, and passes it across the
   * visuals seam as `anchor.y` so the snow surface can follow the grade.
   */
  readonly y: number;
  /**
   * Tangent yaw in radians: 0 = straight downhill (−z); positive bends the
   * road toward world +x. Straight today (always 0). The renderer turns the
   * skier body / hazards to `-heading` and orbits the camera in this frame.
   */
  readonly heading: number;
}

/**
 * A single smooth bend in the road: a raised-cosine bump of curvature (turn
 * per unit distance) centered at `center`, spanning ±`halfWidth` units, and
 * accumulating exactly `turn` radians of heading across it (signed — positive
 * bends toward +x). Summing bends defines the whole centerline. Empty today;
 * the eventual gentle S (bend around the vista ~300–420, opposite dogleg past
 * the rock gate ~560) lands here when the curve turns on.
 */
export interface Bend {
  readonly center: number;
  readonly halfWidth: number;
  readonly turn: number;
}

// The shipped road. Empty === straight === identical to the pre-centerline
// world. Give these real amplitudes (with the visuals session adopting the
// same table) to turn the curve on.
const BENDS: readonly Bend[] = [];

// Sampling resolution and how far the table reaches. STEP 1 unit keeps the
// lerp error negligible for the gentle curves this is for; DMAX covers the
// finish (800) plus the post-line coast and the decor window that peeks past
// it. Past the end the sampler extends straight along the final tangent.
const STEP = 1;
const DMAX = 900;

/** A precomputed centerline: parallel samples every `step` units from d = 0. */
export interface Centerline {
  readonly step: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly headings: Float64Array;
}

// Curvature (turn per unit distance) at a distance: the sum of each bend's
// raised-cosine window. ∫ of one window over its span is `halfWidth`, so
// scaling by turn/halfWidth makes the heading gained across the bend exactly
// `turn`. Zero everywhere when BENDS is empty.
function curvatureAt(d: number, bends: readonly Bend[]): number {
  let k = 0;
  for (const b of bends) {
    const u = (d - b.center) / b.halfWidth;
    if (u > -1 && u < 1) {
      k += (b.turn / b.halfWidth) * 0.5 * (1 + Math.cos(Math.PI * u));
    }
  }
  return k;
}

/**
 * Build a centerline table from a set of bends. Integrates curvature → heading,
 * then the unit tangent → position, both by the trapezoid rule, so the result
 * is arc-length parameterized: a hazard at distance D lands (near enough) D
 * units of travel down the road, which is what keeps the sim's spacing honest.
 * Exported for the tests (and for the eventual curved build).
 */
export function buildCenterline(
  bends: readonly Bend[] = BENDS,
  step: number = STEP,
  dMax: number = DMAX,
): Centerline {
  const n = Math.ceil(dMax / step) + 1;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const headings = new Float64Array(n);
  let x = 0;
  let z = 0;
  let h = 0;
  let k = curvatureAt(0, bends);
  for (let i = 1; i < n; i++) {
    const dCur = i * step;
    const kNext = curvatureAt(dCur, bends);
    const hNext = h + 0.5 * (k + kNext) * step;
    // Tangent (downhill) = (sin H, −cos H); trapezoid it into position.
    x += 0.5 * (Math.sin(h) + Math.sin(hNext)) * step;
    z += 0.5 * (-Math.cos(h) - Math.cos(hNext)) * step;
    h = hNext;
    k = kNext;
    xs[i] = x;
    zs[i] = z;
    headings[i] = h;
  }
  return { step, xs, zs, headings };
}

/** The centerline point at a distance, lerped between samples (extends straight
 * past either end so uphill decor peeks and the post-finish coast stay sane). */
export function centerlineAt(line: Centerline, distance: number): SlopePoint {
  const { step, xs, zs, headings } = line;
  const n = xs.length;
  if (distance <= 0) {
    // Uphill of the gate: extend straight from the start tangent (heading 0).
    const h0 = headings[0]!;
    return {
      x: xs[0]! + Math.sin(h0) * distance,
      z: zs[0]! - Math.cos(h0) * distance,
      // The road (the Overlook) is faked-flat — grade lives only on the
      // branching segments (segmentCenterline), never here.
      y: 0,
      heading: h0,
    };
  }
  const fi = distance / step;
  const i = Math.floor(fi);
  if (i >= n - 1) {
    // Past the table: extend straight along the final tangent.
    const last = n - 1;
    const hl = headings[last]!;
    const extra = distance - last * step;
    return {
      x: xs[last]! + Math.sin(hl) * extra,
      z: zs[last]! - Math.cos(hl) * extra,
      y: 0,
      heading: hl,
    };
  }
  const t = fi - i;
  return {
    x: xs[i]! + (xs[i + 1]! - xs[i]!) * t,
    z: zs[i]! + (zs[i + 1]! - zs[i]!) * t,
    y: 0,
    heading: headings[i]! + (headings[i + 1]! - headings[i]!) * t,
  };
}

/**
 * Map a world position off the centerline: `lateral` runs along the road's
 * left/right normal (world +x when straight). This is the one place the sim's
 * cross-lane offset becomes a world position, so the skier and everything
 * pinned to the lane curve together.
 */
export function centerlineToWorld(
  line: Centerline,
  distance: number,
  lateral: number,
): { readonly x: number; readonly z: number } {
  const p = centerlineAt(line, distance);
  return {
    x: p.x + Math.cos(p.heading) * lateral,
    z: p.z + Math.sin(p.heading) * lateral,
  };
}

// The shipped centerline, built once. The renderer imports the two convenience
// wrappers below; the visuals session imports these same ones so both sides
// draw against one road.
const SLOPE = buildCenterline();

/** The centerline point (world x/z + tangent heading) at a distance downhill. */
export function slopeCenterline(distance: number): SlopePoint {
  return centerlineAt(SLOPE, distance);
}

/** World x/z for a sim (distance, lateral) pair — the lane mapped onto the road. */
export function slopeToWorld(
  distance: number,
  lateral: number,
): { readonly x: number; readonly z: number } {
  return centerlineToWorld(SLOPE, distance, lateral);
}

// ---------------------------------------------------------------------------
// The branching map's segment placement (slope-mech, 2026-07-24 — the §4 map of
// SLOPE_BRANCHING.md, grayblock). Presentation-only, the same as the road above:
// the sim (route.ts) knows a run as (segmentId, segment-local distance); this
// maps that to a world point + facing.
//
// SHAPED CORRIDORS (slope-mech, 2026-07-24 — "make the map bend through the
// world"). Each segment is a constant-curvature ARC now, not a straight box: it
// begins at a world origin + entry heading and turns a fixed amount (SEGMENT_SHAPES
// below) across its length, so the run carves down a mountain instead of a chute.
// Because the arc is arc-length parameterized, a hazard at segment-distance D still
// sits D units of travel down the corridor — the sim's spacing is untouched, and
// the grade (world-Y, keyed to ROUTE distance) rides the same as before.
//
// Continuity is by construction: segments you reach by staying on the road
// (walked via route.ts `next`) INHERIT their origin + heading from the previous
// segment's exit, so the spine and each detour tail flow smoothly with no kink at
// the seams. Only a fork HANDOFF jumps corridors — the tree yanks you off the
// road, the penguin surfaces you back on the trail — and that jump is a deliberate,
// diegetic cut, so a detour's entry is placed freely near where the fork fires and
// need not meet the world point it left (the "same clock, same flag" that must hold
// is route distance + height, both unaffected by where the corridor sits in x/z).
//
// The layout, read as a trail map: the spine (summit → forest-road → lake → yeti →
// cave → cliff) eases through a gentle S down the middle; forest-tree curls off to
// the right and cuts back to the lake; water swings far left and cuts back to the
// shared cliff; the Ice tail (ledge → valley → ice-castle) peels right off the peak
// to its own flag. Two flags (cliff, ice-castle) at the same clock/height, wherever
// they land in x/z.
//
// "main" (the Overlook's single segment) has NO placement here, so the segment
// functions fall straight through to the road above — the un-branched run is
// bit-for-bit unchanged.

/** A segment's world placement: where its entrance sits, which way it faces, and
 * its constant curvature (turn per unit length, + toward world +x). Derived by
 * walking the route graph from the chain-starts in SEGMENT_SHAPES — see below. */
export interface SegmentPlacement {
  readonly originX: number;
  readonly originZ: number;
  /** Entry tangent yaw; 0 = straight downhill (−z). The heading grows by
   * `curvature × distance` along the arc. */
  readonly entryHeading: number;
  /** Turn per unit length. 0 = a straight corridor (a plain line). */
  readonly curvature: number;
}

// The branching map's grade (slope-mech, 2026-07-24 — "ride down a REAL mountain
// into the forest", director call). The §4 map descends for real in world-Y: the
// summit sits up high and the hill falls away beneath you all the way to the flag.
// Grade only for the BRANCHING map — the Overlook stays faked-flat (its "main"
// segment has no placement, so segmentCenterline falls through to the flat road
// above and nothing there moves).
//
// VARYING grade now (slope-mech, 2026-07-24 — "steepness increases speed"): the
// height + local pitch are no longer one constant but the shared route profile in
// route.ts (routeHeightAt / routeGradeAt), keyed to ROUTE distance — a steep summit
// plunge, a mellow forest/lake, a steep lower pitch into the flag. Because it's a
// function of route distance, every fork reconvergence still sits at one height and
// every route drops the SAME total ("same clock, same flag" in elevation, for free).
// This module just embeds that profile into the world: y = routeHeightAt(routeDist),
// pitch = atan(routeGradeAt(routeDist)). The sim reads the SAME profile for the
// speed coupling (route.ts's gradeSpeedFactor) — one source of truth.
//
// SEAM NOTE (slope-mech → slope-vis): the grayblock corridors this drives live in
// skiRender.ts (mine) and ride the grade today. The DRESSED snow surface lives in
// skiScene.ts (slope-vis) and is still a flat plane at y = 0 — it only follows the
// anchor's z, ignoring anchor.y. The renderer passes the real ground y as
// `anchor.y`; slope-vis makes the snow surface sit + tilt to it (and the treeline/
// trails/decor along with it). NOTE the pitch VARIES now, so the tilt must follow
// segmentPitch(id, distance) per-point, not one constant. Parked in IDEAS.md.

/** A representative downhill pitch (atan of the REFERENCE grade) — the locked ~19°.
 * The real pitch varies down the route (see segmentPitch); this is the baseline any
 * consumer that wants one number can use. */
export const slopeGradePitch = Math.atan(REFERENCE_GRADE);

/** The local downhill pitch (radians) on a placed (branching) segment at a
 * segment-local distance — atan of the varying route grade; 0 on the flat road /
 * Overlook, so pitching the rig/scenery never tilts the un-graded Overlook. */
export function segmentPitch(segmentId: string, distance: number): number {
  if (!SEGMENT_PLACEMENTS[segmentId]) return 0;
  return Math.atan(routeGradeAt(routeDistanceOf(segmentId, distance)));
}

/** The ground height of a placed (branching) segment at a segment-local distance;
 * 0 for the flat road / Overlook ("main" has no placement). */
function segmentGroundY(segmentId: string, distance: number): number {
  if (!SEGMENT_PLACEMENTS[segmentId]) return 0;
  return routeHeightAt(routeDistanceOf(segmentId, distance));
}

/** A segment's intrinsic shape. `turn` is the total heading change across its
 * whole length (radians, + toward world +x). `entry` is present only on the
 * segments that BEGIN a continuous run of corridor — the summit (spine root) and
 * each detour a fork cuts you into — and fixes where that run starts and faces;
 * every other segment inherits its start from the previous segment's exit. */
interface SegmentShape {
  readonly turn: number;
  readonly entry?: {
    readonly originX: number;
    readonly originZ: number;
    readonly heading: number;
  };
}

const SEGMENT_SHAPES: Readonly<Record<string, SegmentShape>> = {
  // The spine — a gentle S down the MIDDLE. Only the summit is anchored (it drops
  // in straight downhill from the top); forest-road…cliff chain off its exit. The
  // turns are balanced so the heading returns to ~0 at the flag and the line stays
  // near x≈0 the whole way — a readable left-then-right weave that never wanders
  // out into the detour corridors on either side (water far left, the ice tail
  // right). A left lobe (summit→forest) and a right lobe (lake→yeti) roughly
  // cancel the lateral drift; cave/cliff settle it straight for the finish.
  summit: { turn: -0.24, entry: { originX: 0, originZ: 0, heading: 0 } },
  "forest-road": { turn: 0.24 },
  lake: { turn: 0.34 },
  // The second mountain (slope-mech, 2026-07-26): `yeti` became the approach and its
  // fork branches. The played run rides TRAIL_LINE / CAVE_LINE, so these arc shapes
  // only matter to the still-parked graph — but `cave` needs an `entry` here so it
  // registers as a placed segment at all (segmentCenterline's guard), and being a
  // chain-start also stops the spine walk from chaining through it.
  mountain: { turn: -0.14 },
  outside: { turn: -0.34 },
  cave: { turn: -0.2, entry: { originX: 46, originZ: -498, heading: 0.1 } },
  cliff: { turn: 0.12 },
  // The forest tree world: the great tree yanks you off to the right, the corridor
  // bulges out and curls back. Cut in/out (next = lake), so its entry just reads as
  // its own loop near the fork — no world-space rejoin needed.
  "forest-tree": { turn: -0.55, entry: { originX: 52, originZ: -118, heading: 0.5 } },
  // The penguin/underwater line: the hole drops you far left, then a long swing
  // back toward the shared cliff. Cut in/out (next = cliff).
  water: { turn: 0.5, entry: { originX: -74, originZ: -344, heading: -0.35 } },
  // The Ice line's tail: the yeti's son shoves you right off the peak; ledge starts
  // the chain (cut in from yeti) peeling right, then valley → ice-castle curl back
  // so the tail settles facing downhill again at its own flag (not spiralling out).
  ledge: { turn: 0.2, entry: { originX: 58, originZ: -424, heading: 0.4 } },
  valley: { turn: -0.3 },
  "ice-castle": { turn: -0.3 },
};

/** Advance a constant-curvature arc: the world point + heading `length` units
 * along from (`x`, `z`) facing `heading`, turning at `curvature` rad/unit. The
 * closed form is exact and arc-length parameterized (unit tangent). Straight
 * (curvature ≈ 0) falls back to a plain line so there's no 0/0. */
function advanceArc(
  x: number,
  z: number,
  heading: number,
  curvature: number,
  length: number,
): { x: number; z: number; heading: number } {
  if (Math.abs(curvature) < 1e-9) {
    return {
      x: x + Math.sin(heading) * length,
      z: z - Math.cos(heading) * length,
      heading,
    };
  }
  const h1 = heading + curvature * length;
  // ∫ (sin h, −cos h) with h = heading + curvature·s over [0, length].
  return {
    x: x + (Math.cos(heading) - Math.cos(h1)) / curvature,
    z: z + (Math.sin(heading) - Math.sin(h1)) / curvature,
    heading: h1,
  };
}

// Derive every segment's world placement by walking the route graph from the
// chain-starts. A chain-start (has `entry`) is placed at its anchor; then we
// follow route.ts `next` — each successor inheriting the previous segment's exit
// point + heading — until the run ends (`next` null), rejoins an already-placed
// segment (back onto the spine), or hands off into another chain-start (a fork
// cut, which we DON'T chain across). Summit is walked first so the spine is down
// before the detours that rejoin it check "already placed."
export const SEGMENT_PLACEMENTS: Readonly<Record<string, SegmentPlacement>> = (() => {
  const out: Record<string, SegmentPlacement> = {};
  const chainStarts = Object.keys(SEGMENT_SHAPES).filter(
    (id) => SEGMENT_SHAPES[id]!.entry,
  );
  const order = ["summit", ...chainStarts.filter((id) => id !== "summit")];
  for (const startId of order) {
    const entry = SEGMENT_SHAPES[startId]!.entry!;
    let x = entry.originX;
    let z = entry.originZ;
    let heading = entry.heading;
    let id: string | null = startId;
    while (id && !out[id]) {
      const shape = SEGMENT_SHAPES[id];
      const seg: Segment | undefined = BRANCH_SEGMENTS[id];
      if (!shape || !seg) break;
      const curvature = shape.turn / seg.length;
      out[id] = { originX: x, originZ: z, entryHeading: heading, curvature };
      const exit = advanceArc(x, z, heading, curvature, seg.length);
      const nextId: string | null = seg.next;
      // A handoff into a chain-start is a cut; stop and let that chain place it.
      if (!nextId || SEGMENT_SHAPES[nextId]?.entry) break;
      x = exit.x;
      z = exit.z;
      heading = exit.heading;
      id = nextId;
    }
  }
  return out;
})();

// The single played trail's smooth centerline (slope-mech, 2026-07-24 redirect —
// IDEAS.md START HERE). The branching corridors above are per-segment CONSTANT-
// curvature arcs whose curvature sign FLIPS at each seam (summit −0.24 then
// forest-road +0.24 …) — the "jerky" path. The active run instead rides ONE
// continuous-curvature line summit → forest → the frozen lake: a gentle weave
// whose curvature is smooth EVERYWHERE (no seam kink).
//
// Built as a chain of LOBES, one per area on the trail. Each lobe carries two
// things: a NET TURN (where the trail as a whole is heading by the area's end) and
// a WEAVE (a sine that returns to zero, so the weave alone never drifts). Lobes
// chain at whatever heading the previous one ended on, so position AND tangent stay
// continuous across every seam. Extend the trail = append a lobe here AND its id to
// route.ts's SINGLE_TRAIL. Keyed to ROUTE distance so every trail segment samples
// one shared line; y still comes from the shared grade profile (segmentGroundY).
//
// NET TURNS ADDED (slope-mech, 2026-07-25 — director: "build my map as i drew it").
// Every lobe used to be a pure weave with zero net turn, so the whole run was a
// straight fall line with a wiggle: fine for a single trail down one mountain, but
// the drawn map is not that. It coils off the start mountain, meanders through the
// forest, crosses the corner of the lake and then WRAPS AROUND the second mountain
// before turning back to the flag. A pure weave cannot express a wrap — that needs
// a sustained turn in one direction — hence `netTurn`.
//
// ⚠ WHAT LIMITS THE SHAPE (worth knowing before you make a curve bolder): the
// dressed ribbon is ±46 units wide (addBranchTerrain's FLANK_HALF) and the whole
// run is only 640 long, so the trail is FAT relative to its length — about seven
// ribbon-widths end to end, where the drawn map's trail is nearer a hundred. A turn
// whose radius approaches the ribbon half-width folds its inner bank, so curvature
// is capped by geometry, not taste. Two consequences:
//   * the forest gets ONE big meander here, not the drawn map's three;
//   * the second mountain wraps ~160°, not the drawn ~180°.
// Both open up as soon as the route is stretched to §9's 3:30 (the parked job).
// The banks are pinched on the inside of a turn (see addBranchTerrain) so the
// curves we DO use don't crumple; the playable ±12 lane is never narrowed.
interface TrailLobe {
  /** Route distance the lobe starts / ends at. */
  readonly from: number;
  readonly to: number;
  /** Total heading gained across the lobe, radians (+ turns RIGHT, toward world
   * +x). 0 = the area finishes pointing the way it started. This is what makes an
   * area WRAP rather than wiggle. Applied through a smoothstep, so the turn eases
   * in and releases instead of snapping on at the seam. */
  readonly netTurn?: number;
}

// How hard the trail weaves, in radians of peak heading per unit of area length —
// ONE knob for the whole run's wiggle (raise for a bolder meander, → 0 for clean
// fall lines). Each lobe's weave amplitude is this × its own span, and that is not
// a stylistic choice: a lobe's curvature at both its ends is amplitude·2π/span, so
// making amplitude proportional to span is exactly what makes the curvature MATCH
// across every seam. Continuous curvature is the whole point — the original "the
// path is jerky" bug was per-segment arcs stepping their curvature at the joins,
// and hand-tuned per-area amplitudes would quietly reintroduce it the first time
// someone nudged one. It also falls out right: a short area weaves little (the lake
// crossing is nearly straight), a long one weaves a lot (the forest meanders ~18
// units), which is precisely how the map is drawn.
const TRAIL_WEAVE = 0.0031;
// The net turn's shape across a lobe: smoothstep, whose slope is 0 at both ends.
// That keeps a lobe's END curvature independent of its net turn, so a wrapping area
// can sit next to a straight one without a curvature step at the seam.
const smoothstep = (u: number): number => u * u * (3 - 2 * u);
// ONE LOBE PER AREA, laid out as the map is drawn (slope-mech, 2026-07-25; re-spanned
// 2026-07-26 for the big lake + the fork mountain). The route spans match route.ts's
// segments — start mountain 0..100, forest 100..290, lake 290..430, the second
// mountain's approach 430..530, Fork 3's outside branch 530..830, cliff 830..920.
// Signs: − leans LEFT first, + turns RIGHT.
//
// ⚠ WHY THE WRAP IS THREE LOBES, NOT ONE (slope-mech, 2026-07-26). A lobe's weave
// amplitude is TRAIL_WEAVE × its own span — the rule that keeps curvature continuous
// at the seams. The consequence is that a LONG lobe weaves hard: one 300-unit lobe
// carries 0.93 rad of sine, whose curvature (~1/51) swamps the net turn's and swings
// the line ~44 units in and out. Around a mountain that reads as a wobble, not a
// wrap, and it repeatedly walks the ribbon toward the mass. Splitting the wrap into
// three 100-unit lobes that each turn a third of the way keeps the same total sweep
// with a third of the weave — and because the seam curvature is TRAIL_WEAVE·2π
// whatever the span, continuity is untouched. Measured: the outside line then holds
// 19–23 units off the mass's foot for the whole 172°, instead of 36–51 and wobbling.
const TRAIL_LOBES: readonly TrailLobe[] = [
  // The start mountain: the drawn trail begins near the peak and coils off its
  // flank. A short area, so a short weave (~5 units) — it reads as peeling off the
  // summit rather than dropping straight down it.
  { from: 0, to: 100 },
  // The forest: the long meander, and the biggest curve on the run (~18 units of
  // swing). The drawn map has three of these; one is what fits at this length.
  { from: 100, to: 290 },
  // The frozen lake: the trail clips the corner of a big body of ice. Nearly a
  // straight crossing, so the expanse opens out beside you rather than the trail
  // wandering across it — the body itself is FROZEN_LAKE below.
  { from: 290, to: 430 },
  // The second mountain's APPROACH: deliberately no net turn. This is the stretch
  // where the mass is in front of you and the cave mouth is a thing you can see and
  // aim at (route.ts's Fork 3 trigger lives here), so the line runs AT the mountain
  // rather than already curving away from it.
  { from: 430, to: 530 },
  // FORK 3, the outside branch: the WRAP, as three chained lobes (see the note
  // above). ~172° of sustained right-hand sweep around the mass — the exposed line
  // riding around the mountain's foot while it stands above you on your right.
  // Height still drops with route distance, so you corkscrew down its flank.
  { from: 530, to: 630, netTurn: 1.0 },
  { from: 630, to: 730, netTurn: 1.0 },
  { from: 730, to: 830, netTurn: 1.0 },
  // The cliff run-in: swing back out of the wrap and run out to the flag.
  { from: 830, to: 920, netTurn: -1.0 },
];
const TRAIL_ROUTE_LEN = TRAIL_LOBES[TRAIL_LOBES.length - 1]!.to; // the whole spine
// The heading each lobe STARTS at — the sum of every previous lobe's net turn, so
// lobes chain tangent-continuously instead of all resetting to the fall line.
const TRAIL_LOBE_STARTS: readonly number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const lobe of TRAIL_LOBES) {
    out.push(acc);
    acc += lobe.netTurn ?? 0;
  }
  return out;
})();
const TRAIL_END_HEADING =
  TRAIL_LOBE_STARTS[TRAIL_LOBES.length - 1]! +
  (TRAIL_LOBES[TRAIL_LOBES.length - 1]!.netTurn ?? 0);
// Heading at a route distance: the lobe's baseline (its start heading plus however
// much of its net turn is behind you) plus a full-period sine weave that is 0 at
// both ends. Past the last lobe the heading HOLDS at the trail's final heading, so
// the runout continues straight on out of the cliff rather than kinking back to the
// original fall line.
const trailHeadingAt = (s: number): number => {
  for (let i = 0; i < TRAIL_LOBES.length; i++) {
    const lobe = TRAIL_LOBES[i]!;
    if (s <= lobe.to) {
      const span = lobe.to - lobe.from;
      const u = (Math.max(s, lobe.from) - lobe.from) / span;
      return (
        TRAIL_LOBE_STARTS[i]! +
        (lobe.netTurn ?? 0) * smoothstep(u) +
        TRAIL_WEAVE * span * Math.sin(2 * Math.PI * u)
      );
    }
  }
  return TRAIL_END_HEADING;
};
const TRAIL_LINE: Centerline = (() => {
  const step = STEP;
  const n = Math.ceil(TRAIL_ROUTE_LEN / step) + 1;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const headings = new Float64Array(n);
  let x = 0;
  let z = 0;
  headings[0] = trailHeadingAt(0);
  for (let i = 1; i < n; i++) {
    const h0 = trailHeadingAt((i - 1) * step);
    const h1 = trailHeadingAt(i * step);
    // Tangent (downhill) = (sin H, −cos H); trapezoid it into position, same as
    // buildCenterline — arc-length parameterized, so travel ≈ route distance.
    x += 0.5 * (Math.sin(h0) + Math.sin(h1)) * step;
    z += 0.5 * (-Math.cos(h0) - Math.cos(h1)) * step;
    xs[i] = x;
    zs[i] = z;
    headings[i] = h1;
  }
  return { step, xs, zs, headings };
})();

// ---------------------------------------------------------------------------
// FORK 3: THE CAVE BRANCH (slope-mech, 2026-07-26 — the fork mountain).
//
// The outside branch rides TRAIL_LINE (it's the default line). The cave is the one
// corridor that leaves it and comes back, and it has two hard geometric jobs:
//
//   * START exactly where the fork fires — the end of the approach — so the mouth
//     you aimed at is where you actually go in; and
//   * END exactly where the outside branch ends, because both are 300 units and the
//     cliff's entrance is one world point. A rejoin that misses is a visible tear in
//     the terrain, not a diegetic cut.
//
// Both branches are the same LENGTH between the same two points with the same
// tangents, which means the cave cannot be a "shortcut through" — it has the same
// 300 units to spend, so it winds. That's what puts it inside the mass: the outside
// line spends its 300 sweeping 172° around the foot, and the cave spends its 300 on
// a deep S that crosses the interior.
//
// Shape: the same lobe algebra as the trail — the fork's net turn through a
// smoothstep, plus a full-period sine that returns the heading to zero. The sine's
// amplitude is the ONE free parameter, and it is SOLVED at load for the endpoint
// match rather than hand-tuned, so retuning the wrap above re-solves the cave
// instead of quietly tearing the rejoin. `slopePath.test.ts` pins the residual.
const CAVE_ID = "cave";
const CAVE_FROM = 530; // route distance where Fork 3 splits (the approach's end)
const CAVE_TO = 830; // route distance where both branches rejoin (the cliff)

// The heading down the cave at a fraction u of its length, for a given weave.
const caveHeadingAt = (u: number, weave: number, from: number, net: number): number =>
  from + net * smoothstep(u) + weave * Math.sin(2 * Math.PI * u);

// Integrate the cave for a weave amplitude and return its sampled line.
function buildCaveLine(weave: number): Centerline {
  const entry = centerlineAt(TRAIL_LINE, CAVE_FROM);
  const exitHeading = centerlineAt(TRAIL_LINE, CAVE_TO).heading;
  const net = exitHeading - entry.heading;
  const span = CAVE_TO - CAVE_FROM;
  const step = STEP;
  const n = Math.ceil(span / step) + 1;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const headings = new Float64Array(n);
  let x = entry.x;
  let z = entry.z;
  xs[0] = x;
  zs[0] = z;
  headings[0] = entry.heading;
  for (let i = 1; i < n; i++) {
    const h0 = caveHeadingAt(((i - 1) * step) / span, weave, entry.heading, net);
    const h1 = caveHeadingAt((i * step) / span, weave, entry.heading, net);
    x += 0.5 * (Math.sin(h0) + Math.sin(h1)) * step;
    z += 0.5 * (-Math.cos(h0) - Math.cos(h1)) * step;
    xs[i] = x;
    zs[i] = z;
    headings[i] = h1;
  }
  return { step, xs, zs, headings };
}

// Solve the weave for the rejoin: a coarse sweep (the endpoint error is not monotone
// in the weave — a big enough weave loops the line right past the target) followed by
// a golden-section refine on the bracketing interval. Deterministic, ~160 integrations
// at load. A NEGATIVE weave would bulge the cave away from the mountain, so the sweep
// is restricted to the positive side that curls it inward.
const CAVE_WEAVE: number = (() => {
  const target = centerlineAt(TRAIL_LINE, CAVE_TO);
  const errAt = (weave: number): number => {
    const line = buildCaveLine(weave);
    const last = line.xs.length - 1;
    return Math.hypot(line.xs[last]! - target.x, line.zs[last]! - target.z);
  };
  let bestWeave = 0;
  let bestErr = Infinity;
  for (let w = 0; w <= 3; w += 0.02) {
    const e = errAt(w);
    if (e < bestErr) {
      bestErr = e;
      bestWeave = w;
    }
  }
  // Refine inside ±0.02 of the coarse winner by ternary search.
  let lo = Math.max(0, bestWeave - 0.02);
  let hi = bestWeave + 0.02;
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (errAt(a) < errAt(b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
})();

const CAVE_LINE: Centerline = buildCaveLine(CAVE_WEAVE);

/** How far the cave's rejoin misses the cliff's entrance, in world units — the
 * residual of the solve above. Exported so the test can pin it (and so a future
 * reshaping of the wrap can't silently tear the terrain). */
export const caveRejoinError = (): number => {
  const target = centerlineAt(TRAIL_LINE, CAVE_TO);
  const last = CAVE_LINE.xs.length - 1;
  return Math.hypot(CAVE_LINE.xs[last]! - target.x, CAVE_LINE.zs[last]! - target.z);
};

/** The centerline point (world x/z + tangent) at a distance down a segment.
 * Unknown segment ("main") → the Overlook's global road, so it's unchanged. The
 * played trail's default line (summit … outside, cliff) rides the one smooth
 * TRAIL_LINE above instead of its per-segment arc — killing the seam kink and the
 * drift. Fork 3's `cave` branch rides its own solved CAVE_LINE, which starts and
 * ends on TRAIL_LINE so the fork and the rejoin are continuous. The still-parked
 * branching segments keep their constant-curvature arc placement. */
export function segmentCenterline(segmentId: string, distance: number): SlopePoint {
  const p = SEGMENT_PLACEMENTS[segmentId];
  if (!p) return slopeCenterline(distance);
  if (segmentId === CAVE_ID) {
    const c = centerlineAt(CAVE_LINE, distance);
    return {
      x: c.x,
      z: c.z,
      // y still comes from the shared depth-keyed profile, so the cave drops exactly
      // what the outside branch drops — same clock, same flag, for free.
      y: segmentGroundY(segmentId, distance),
      heading: c.heading,
    };
  }
  if (SINGLE_TRAIL.includes(segmentId)) {
    const c = centerlineAt(TRAIL_LINE, routeDistanceOf(segmentId, distance));
    return {
      x: c.x,
      z: c.z,
      y: segmentGroundY(segmentId, distance),
      heading: c.heading,
    };
  }
  const arc = advanceArc(p.originX, p.originZ, p.entryHeading, p.curvature, distance);
  return {
    x: arc.x,
    z: arc.z,
    y: segmentGroundY(segmentId, distance),
    heading: arc.heading,
  };
}

/** One cross-section of the trail surface: where down the trail it sits. */
export interface TrailRow {
  readonly segmentId: string;
  /** Distance into that segment (past its length on the terminal's runout). */
  readonly distance: number;
}

/**
 * The rows of the played trail's ground surface, summit to runout, as ONE list.
 *
 * The terrain used to be built a mesh per segment; each ended with its own copy of
 * the join row, so the two sides were lit independently and the shading stepped at
 * every join. This walks the whole trail instead, emitting each join row ONCE — the
 * segment above it ends there and the segment below starts there, and the sampled
 * positions are identical either way (the trail centerline is continuous through a
 * join; `slopePath.test.ts` pins that to 0 units). One list of rows → one mesh →
 * normals that roll through the joins.
 *
 * Row positions are unchanged from the per-segment build: each segment still spans
 * its own length in `ceil(span / step) + 1` even rows, so growing the trail
 * (`SINGLE_TRAIL`) grows the surface with no retuning.
 */
export function trailRows(step: number, runout: number): TrailRow[] {
  const out: TrailRow[] = [];
  SINGLE_TRAIL.forEach((segmentId, index) => {
    const seg = BRANCH_SEGMENTS[segmentId];
    if (!seg) return;
    // The trail's terminal carries the flat runout past the flag — there is no
    // finish line yet (director), so the run coasts off onto the valley floor.
    const isTerminal = index === SINGLE_TRAIL.length - 1;
    const span = seg.length + (isTerminal ? runout : 0);
    const rows = Math.max(2, Math.ceil(span / step) + 1);
    // Skip row 0 below the first segment: the segment above already emitted that
    // exact cross-section as its last row. This is the weld.
    for (let i = out.length === 0 ? 0 : 1; i < rows; i++) {
      out.push({ segmentId, distance: (i / (rows - 1)) * span });
    }
  });
  return out;
}

/**
 * The graded ground height at a world Z along the played trail. Added by the (forest)
 * session (2026-07-25) to sit the decor scatter ON the descending mountain instead of
 * the y = 0 valley floor.
 *
 * ⚠ SUPERSEDED (slope-mech, 2026-07-25) — prefer `trailPointAtRoute`. This function
 * rests on "world Z ≈ −routeDistance", which was true while the trail was nearly
 * straight (heading ≤ ~0.07 rad) and is NOT true since the map was laid out as drawn:
 * the trail now meanders ~34 units and WRAPS ~160° around the second mountain, so
 * arc length and |Z| diverge, and past the wrap a single world Z maps to two
 * different route distances. Kept because the flat Overlook still has a straight
 * road, where the identity holds exactly.
 */
export function trailGroundHeightAtZ(worldZ: number): number {
  return routeHeightAt(-worldZ);
}

/**
 * Where a point sits in the world, given how far it is DOWN THE TRAIL and how far it
 * is across from the lane centre. The trail-relative replacement for pinning scenery
 * to raw world X/Z (slope-mech, 2026-07-25, "build my map as i drew it").
 *
 * Why it exists: the decor scatter placed trees at a literal world X of ±(lane edge +
 * a bit) and a literal world Z, which only lines them up beside the run while the run
 * is a straight line down x = 0. Now that the trail curves for real, raw-XZ placement
 * leaves the lane wandering away from its own treeline — and worse, puts trees IN the
 * piste at the meander's extremes. Route distance + lateral is the coordinate system
 * that survives any future reshaping of the map, because it is the one the sim and the
 * terrain already share.
 *
 * `routeDistance` is measured from the summit along the trail (the same axis as
 * route.ts's offsets); `lateral` is signed across the lane (+ toward the trail's
 * right). Past the flag it extends down the flat runout along the final tangent.
 */
export function trailPointAtRoute(
  routeDistance: number,
  lateral: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  // Which trail segment owns this route distance (the terminal owns everything past
  // the flag, so the runout keeps following the trail's exit tangent).
  let acc = 0;
  let id = SINGLE_TRAIL[0]!;
  let local = routeDistance;
  for (let i = 0; i < SINGLE_TRAIL.length; i++) {
    const segmentId = SINGLE_TRAIL[i]!;
    const length = BRANCH_SEGMENTS[segmentId]?.length ?? 0;
    id = segmentId;
    local = routeDistance - acc;
    if (routeDistance < acc + length || i === SINGLE_TRAIL.length - 1) break;
    acc += length;
  }
  const w = segmentToWorld(id, local, lateral);
  return { x: w.x, y: segmentCenterline(id, local).y, z: w.z };
}

// ---------------------------------------------------------------------------
// THE TWO BIG FEATURES (slope-mech, 2026-07-26 — v3 §12.3's two director calls).
// Both are described HERE, trail-relative, rather than in the renderer: they have to
// stay pinned to the trail through any future reshaping of the lobes, and both the
// terrain builder (skiRender.ts) and the ice dressing (forestGraphics.ts) read one
// source of truth. Everything is derived from `trailPointAtRoute`, never raw world
// X/Z — raw XZ loses both the grade and the curve.

/**
 * THE FROZEN LAKE, as a BODY (director: ~15× too small; "you come out of the forest
 * and it's spread out in front of you").
 *
 * It used to be a 64 × 26 ribbon of ice skinned onto the lane — a strip, not a lake.
 * It is now a disc: ~180 units across, ~25k square units, which is 15× the ribbon's
 * ~1.7k. The trail clips its corner, exactly as the map is drawn.
 *
 * The disc is centred OFF TO THE RIGHT of the crossing, and its radius is chosen so
 * that the lane runs on ice for the whole flat span. That side is not arbitrary: the
 * drawn map puts the lake body, the lake opening and the penguin castle all on that
 * side of the trail, and route.ts's parked Fork 2 trigger already reads lateral
 * +4..+12 for the yeti's hole.
 *
 * WHY IT IS A WORLD DISC AND NOT A ROUTE-SPAN BAND: the ice surface has to be LEVEL,
 * and the only place the trail is level is the lake's flat (route 312–415, where
 * GRADE_PROFILE sits at 0). A band that followed the route past 415 would float above
 * a trail that has started dropping again. A disc puts the body's downhill shore
 * exactly where the ground starts falling away — which is what a lake's outlet is.
 */
export const FROZEN_LAKE = {
  /** Route distance the disc is centred on — the middle of the flat crossing. */
  routeCenter: 363,
  /**
   * How far right of the lane the centre sits. Not free: it has to be near enough
   * that the lane runs on ice for the WHOLE flat span (route 312–415, ±51 either side
   * of the centre), which needs √(r² − 51²) ≥ lateralCenter + LATERAL_LIMIT. At r 90
   * that caps it around 60. Mid-crossing the ice therefore reaches ~32 units to the
   * LEFT of the lane too — which is right: mid-crossing you are properly out on the
   * lake, and it is only at the two ends that the lane sits on the shore. That is what
   * clipping a corner means.
   */
  lateralCenter: 58,
  /** Disc radius. 90 ⇒ ~25.4k sq units ⇒ ~15× the old ribbon's ~1.7k. */
  radius: 90,
  /** How wide a shore lip rings the body, and how high it rises above the ice. */
  shoreBand: 20,
  shoreRise: 14,
} as const;

/** The lake's ice height — one level for the whole body, read off the trail at the
 * middle of the flat. (Because GRADE_PROFILE is 0 across 312–415, every point of the
 * flat is this same height; sampling the middle just makes that explicit.) */
export function lakeIceHeight(): number {
  return routeHeightAt(FROZEN_LAKE.routeCenter);
}

/** The lake's centre in world x/z. */
export function lakeCenterWorld(): { readonly x: number; readonly z: number } {
  const p = trailPointAtRoute(FROZEN_LAKE.routeCenter, FROZEN_LAKE.lateralCenter);
  return { x: p.x, z: p.z };
}

/**
 * The lateral band of ICE across the lane at a route distance: `null` off the body,
 * otherwise the signed lateral range the ice sheet covers there.
 *
 * This is the seam the ice DRESSING reads (forestGraphics.ts owns the look; the body's
 * shape is the map's, so it lives here). It also tells the decor scatter where not to
 * stand — trees on a frozen lake was the first thing that broke when the berm opened.
 *
 * Derived by intersecting the trail's lateral axis at `routeDistance` with the disc,
 * so it follows the body honestly even where the trail curves across it.
 */
export function lakeIceExtent(
  routeDistance: number,
): { readonly latMin: number; readonly latMax: number } | null {
  const c = lakeCenterWorld();
  const on = trailPointAtRoute(routeDistance, 0);
  const across = trailPointAtRoute(routeDistance, 1);
  // The unit lateral direction at this route distance, and where the centre projects
  // onto it. (`across` − `on` is already unit length: lateral is in world units.)
  const ax = across.x - on.x;
  const az = across.z - on.z;
  const toC = { x: c.x - on.x, z: c.z - on.z };
  const along = toC.x * ax + toC.z * az; // the centre's lateral coordinate
  const perp2 = toC.x * toC.x + toC.z * toC.z - along * along; // squared miss distance
  const half2 = FROZEN_LAKE.radius * FROZEN_LAKE.radius - perp2;
  if (half2 <= 0) return null; // this cross-section misses the body entirely
  const half = Math.sqrt(half2);
  return { latMin: along - half, latMax: along + half };
}

/**
 * THE FORK MOUNTAIN'S MASS (director: *"its not a view only mountain. its got real
 * purpose. the second mountain is the mountain that introduces the cave entrance and
 * the ride around"*).
 *
 * A dome standing on the inside of Fork 3's wrap: ~170 units across and rising well
 * above the line, so the outside branch rides around its foot and the cave branch runs
 * through its middle. This is what answers "not another drop-off" WITHOUT flattening
 * the area — the pitch stays honest (route.ts) and the mass supplies the shape.
 *
 * The numbers are not free. The radius is the largest that clears every open lane —
 * the approach, the outside branch and the cliff run-in — by more than the playable
 * half-width, measured against the trail as actually laid out. Grow it and the
 * mountain buries the piste; shrink it and the wrap stops hugging anything.
 * `slopePath.test.ts` asserts the clearance, so a future reshaping of the wrap fails
 * a test rather than swallowing the run.
 */
export const FORK_MOUNTAIN = {
  /** Placed relative to the trail at the middle of the wrap, on the inside. */
  routeAnchor: 680,
  lateralAnchor: 102,
  /** Base radius: where the dome meets the surrounding ground. */
  baseRadius: 85,
  /**
   * Height at the summit, above the ground it stands on.
   *
   * Sized to be SEEN, which on this mountain takes more than it sounds: the height
   * profile only ever falls, so the mass stands on ground ~110 units below the lake
   * you first see it from. At 175 its summit clears the eye line from the far shore
   * by a good margin and it reads as a mountain standing beyond the water; at ~100 it
   * would sit at eye level and read as a bump. (Real uphill would be the honest fix
   * and is a SIM change — v3 §12.3 — so this is the cheap answer the drawing allows.)
   */
  peakHeight: 175,
} as const;

/** The mass's centre in world x/z, and the ground height it stands on. */
export function forkMountainCenter(): {
  readonly x: number;
  readonly z: number;
  readonly y: number;
} {
  return trailPointAtRoute(FORK_MOUNTAIN.routeAnchor, FORK_MOUNTAIN.lateralAnchor);
}

/**
 * The dome's height above its base at a distance `r` from the centre. A raised
 * cosine: zero height AND zero slope at the foot, so it blends into the surrounding
 * banks with no crease, and a rounded summit. Steepest mid-flank (~70°), which is
 * deliberate — it is a mass you ride around, not a slope you ski down.
 */
export function forkMountainRise(r: number): number {
  if (r >= FORK_MOUNTAIN.baseRadius) return 0;
  const u = r / FORK_MOUNTAIN.baseRadius;
  return FORK_MOUNTAIN.peakHeight * 0.5 * (1 + Math.cos(Math.PI * u));
}

/**
 * Where the cave's two portals sit: the first and last points of the cave branch that
 * lie inside the mass's footprint. Measured rather than declared, so the mouths always
 * land ON the mountainside even if the wrap or the mass is retuned.
 *
 * The residual open stretches (~36 units at each end) are a feature, not slop: a short
 * cutting leads into the mountainside and out again, which is what makes the mouth a
 * thing you can see and aim at from the approach rather than a hole that appears the
 * instant the fork fires.
 */
export function cavePortals(): {
  readonly entryDistance: number;
  readonly exitDistance: number;
} {
  const c = forkMountainCenter();
  const inside = (d: number): boolean => {
    const p = segmentCenterline(CAVE_ID, d);
    return Math.hypot(p.x - c.x, p.z - c.z) <= FORK_MOUNTAIN.baseRadius;
  };
  const span = CAVE_TO - CAVE_FROM;
  let entryDistance = 0;
  for (let d = 0; d <= span; d++) {
    if (inside(d)) {
      entryDistance = d;
      break;
    }
  }
  let exitDistance = span;
  for (let d = span; d >= 0; d--) {
    if (inside(d)) {
      exitDistance = d;
      break;
    }
  }
  return { entryDistance, exitDistance };
}

/** World x/z for a (segmentId, distance, lateral) triple — the lane on a segment. */
export function segmentToWorld(
  segmentId: string,
  distance: number,
  lateral: number,
): { readonly x: number; readonly z: number } {
  const p = SEGMENT_PLACEMENTS[segmentId];
  if (!p) return slopeToWorld(distance, lateral);
  const c = segmentCenterline(segmentId, distance);
  return {
    x: c.x + Math.cos(c.heading) * lateral,
    z: c.z + Math.sin(c.heading) * lateral,
  };
}
