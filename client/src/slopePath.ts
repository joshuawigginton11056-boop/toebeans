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
  LAKE_RADIUS,
  LATERAL_LIMIT,
  MAP_LAYOUT,
  PLAYED_FORK_BRANCHES,
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

// The single played trail's centerline — THE LINE THE DIRECTOR DREW.
//
// This used to be a chain of hand-tuned "lobes": a net turn and a sine weave per
// area, eight of them, each a number somebody picked and then re-picked after a
// playtest. That is the thing that failed. The map was only ever describable in
// words — "the forest meanders", "it wraps the second mountain" — and words do not
// converge on a shape. Twelve hours of tuning went into those radians and the world
// still did not look like the drawing it was tuned against.
//
// So the numbers come out of the drawing now. `slope-map.png` is a top-down plan in
// flat colour; `tools/extract_map.py` segments it, thins the painted trail stroke to
// a one-pixel centreline, smooths the pixel staircase out of it, rotates it so the
// run leaves the start marker down the fall line, and scales it so the drawn line is
// exactly TRAIL_ROUTE_LEN units long. What lands in mapLayout.generated.ts is that
// line, sampled every `step` units — so index i IS route distance i·step, and this
// module just reads it.
//
// The consequences are the point:
//   * the trail's shape is no longer anybody's opinion. Change the drawing, re-run
//     the tool, and the world moves. Nothing here needs editing.
//   * the map's features (the lake, the fork mountain, the landmarks) are measured
//     against this same line as (route, lateral) — see MAP_LAYOUT — so they stay
//     pinned to it through any redraw, exactly as trailPointAtRoute already required.
//   * the old ⚠ caveat about curvature being capped by the ribbon half-width STILL
//     HOLDS. The drawing can ask for a turn tighter than a ±46 ribbon can survive
//     (addBranchTerrain pinches its inside bank for exactly this reason). Redraw a
//     hairpin and the banks will crumple before the lane does — the playable ±12 is
//     never narrowed, but the dressing around it can fold.
//
// Elevation is NOT in a plan view and never was: y still comes from the shared grade
// profile (segmentGroundY / routeHeightAt), keyed to the same route distance.
const TRAIL_ROUTE_LEN = MAP_LAYOUT.routeLength;
// Eases a turn in and out with zero slope at both ends, so a curve can sit next to a
// straight without a curvature step at the seam. The trail no longer needs it (it is
// measured, not shaped), but the cave branch below still solves its own weave.
const smoothstep = (u: number): number => u * u * (3 - 2 * u);
const TRAIL_LINE: Centerline = (() => {
  const { step, xs: drawnXs, zs: drawnZs } = MAP_LAYOUT.trail;
  const n = drawnXs.length;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const headings = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = drawnXs[i]!;
    zs[i] = drawnZs[i]!;
  }
  // Heading by central difference — the tangent convention is (sin H, −cos H), the
  // same one buildCenterline integrates, so everything downstream (the skier's
  // facing, the camera, the terrain sweep) reads this line the way it read the old one.
  //
  // UNWRAPPED, and that is not a detail. `atan2` returns (−π, π], but the trail wraps
  // ~172° around the second mountain, so the true heading crosses the branch cut. Left
  // wrapped, one sample would read +π and the next −π; `centerlineAt` lerps between
  // samples, so it would sweep the long way through zero — a skier and camera spinning
  // a half-turn mid-wrap. The old lobe chain never hit this because it INTEGRATED
  // heading and was free to run past π. Accumulating the deltas restores that.
  let unwrapped = Math.atan2(xs[1]! - xs[0]!, -(zs[1]! - zs[0]!));
  headings[0] = unwrapped;
  for (let i = 1; i < n; i++) {
    const a = i - 1;
    const b = i < n - 1 ? i + 1 : n - 1;
    const raw = Math.atan2(xs[b]! - xs[a]!, -(zs[b]! - zs[a]!));
    let delta = raw - unwrapped;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    unwrapped += delta;
    headings[i] = unwrapped;
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
// Where Fork 3 splits and rejoins — MEASURED, as the two ends of the grey line the
// director drew through the second mountain, projected onto the drawn trail. These
// were 530 and 830, the segment boundaries; the drawing puts the split later and the
// rejoin nearly at the flag.
const CAVE_FROM = MAP_LAYOUT.caveLine.fromRoute ?? 530;
const CAVE_TO = MAP_LAYOUT.caveLine.toRoute ?? 830;

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

/**
 * THE RULE FOR READING THE DRAWN MAP (director, 2026-07-26): *"the picture isn't
 * drawn to scale."*
 *
 * So the drawing is authoritative about TOPOLOGY and POSITION — what is where, in what
 * order down the run, and which side of the trail it sits on — and NOT about size. Sizes
 * are the director's, given by verdict after riding.
 *
 * That split leaves one thing to reconcile. A feature's lateral offset and its radius are
 * not independent: they are what decide whether the trail clips a lake's corner or crosses
 * its middle. Keep the drawn offset while tripling the radius and the body swallows the
 * lane; keep the drawn ratio and the drawn RELATIONSHIP survives the resize. So the offset
 * scales with the size:
 *
 *     lateral = drawnLateral × (actualRadius / drawnRadius)
 *
 * Same geometry, bigger world. This is the only place the two authorities have to meet,
 * and it is worth it being one line rather than a number somebody re-picks.
 */
function drawnLateralAt(
  drawn: { readonly lateral: number; readonly radius: number },
  actualRadius: number,
): number {
  if (drawn.radius <= 0) return drawn.lateral;
  return Math.round(drawn.lateral * (actualRadius / drawn.radius) * 10) / 10;
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
  /** Route distance the disc is centred on — MEASURED off the drawn map (the cyan
   * body's centroid, projected onto the drawn trail). It was 363, a number picked to
   * sit in the middle of GRADE_PROFILE's flat; the drawing puts the lake later than
   * that flat, which is a real disagreement between the two and is written up in
   * IDEAS.md rather than split the difference here. */
  routeCenter: MAP_LAYOUT.lake.route,
  /**
   * How far right of the lane the centre sits. Not free: it has to be near enough
   * that the lane runs on ice for the WHOLE flat span (route 312–415, ±51 either side
   * of the centre), which needs √(r² − 51²) ≥ lateralCenter + LATERAL_LIMIT. At r 90
   * that caps it around 60. Mid-crossing the ice therefore reaches ~32 units to the
   * LEFT of the lane too — which is right: mid-crossing you are properly out on the
   * lake, and it is only at the two ends that the lane sits on the shore. That is what
   * clipping a corner means.
   */
  lateralCenter: drawnLateralAt(MAP_LAYOUT.lake, LAKE_RADIUS),
  /**
   * Disc radius — the DIRECTOR'S number, not the drawing's. See LAKE_RADIUS: "i want
   * a big ass beautiful lake", and "the picture isn't drawn to scale" (2026-07-26).
   */
  radius: LAKE_RADIUS,
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
  // ⚠ THE TRAIL COMES BACK PAST THE LAKE (slope-mech, 2026-07-26 — a real bug this
  // caught). Fork 3's outside branch wraps ~172°, so the INFINITE lateral line through
  // the trail re-crosses the lake disc from hundreds of units away, mid-wrap and again
  // on the cliff. Without this guard the function reported a lake band at route 640–740,
  // the terrain builder duly "opened" the bank onto it, and the flank got blended up to
  // the lake's height — which is ~120 units above the ground there. It rendered as a
  // white wall stabbing out of the mountainside. So: the body only counts as being
  // BESIDE this stretch of trail if its centre is within a ribbon-width of it.
  const NEAR = FROZEN_LAKE.radius + 50;
  if (Math.hypot(c.x - on.x, c.z - on.z) > NEAR) return null;
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
  /** Placed relative to the trail at the middle of the wrap, on the inside —
   * MEASURED as the drawn mass's centroid projected onto the drawn trail. */
  routeAnchor: MAP_LAYOUT.mountains[1]?.route ?? 680,
  /**
   * How far off the trail the centre sits. Together with the wrap's shape this is
   * what makes the outside branch hug the mountain: measured, the line holds ~20
   * units off the foot for the whole 172°.
   */
  lateralAnchor: MAP_LAYOUT.mountains[1]
    ? drawnLateralAt(MAP_LAYOUT.mountains[1], 190)
    : 102,
  /**
   * The footprint is NOT a circle (slope-mech, 2026-07-26, after looking at it).
   *
   * A single radius has to satisfy the tightest constraint everywhere, which is the
   * wrap: the outside branch comes within ~101 units of the centre, so a circle caps
   * at ~85. Paired with a peak tall enough to be seen from the lake, that is an
   * 85 × 175 spire — and it rendered as exactly that, a needle, not "a mass".
   *
   * But the cap only BINDS where a lane passes. The wrap encloses ~172° of the
   * perimeter and leaves a wide sector open, so the honest footprint is per-azimuth:
   * as big as there is room for, in every direction independently. That gives a
   * teardrop — a steep near flank the trail wraps, and the bulk piled away behind it,
   * which is both how the map draws it and what a mountain looks like.
   *
   * `baseRadius` survives as the CAP on that profile (and as the scale the tests read).
   */
  baseRadius: 190,
  /** Clearance the footprint keeps from any playable lane, beyond the lane's own
   * half-width — so the mountain can crowd the piste but never bury it. */
  laneClearance: 6,
  /**
   * Height at the summit, above the ground it stands on.
   *
   * Two pulls. It has to be SEEN — the height profile only ever falls, so the mass
   * stands on ground ~110 units below the lake you first see it from, and anything
   * under ~100 sits at eye level and reads as a bump. But height over half-width is
   * what decides whether it reads as a mountain or a spike, and the wrap side is only
   * ~85 wide. 130 against that ~85 is a steep but believable flank (~57°), and the
   * open side's much wider apron carries the bulk.
   */
  peakHeight: 130,
  /**
   * How much mountainside a cave mouth needs above it. The dome reaches zero height
   * (and zero slope) at its foot, so there is no flank to put a hole in out there —
   * the mouth has to sit far enough in that the mass genuinely rises over it. This is
   * the rise the portals are placed at, and it is what leaves the short open cutting
   * at each end of the branch.
   *
   * It also has to be taller than the doorway cut into the flank (below), or the arch
   * pokes out through the mountainside — which is exactly what it did at 26.
   */
  mouthRise: 36,
  /** The cave mouth's opening: half-width across the corridor, and height above its
   * floor. The doorway cut out of the mass uses these, and the arch is sized from them,
   * so the hole and the thing standing in it can't disagree. */
  mouthHalfWidth: 19,
  mouthHeight: 26,
} as const;

/** The mass's centre in world x/z, and the ground height it stands on. */
export function forkMountainCenter(): {
  readonly x: number;
  readonly z: number;
  readonly y: number;
} {
  return trailPointAtRoute(FORK_MOUNTAIN.routeAnchor, FORK_MOUNTAIN.lateralAnchor);
}

// The per-azimuth footprint, solved once at load.
//
// For each of AZIMUTH_STEPS directions out from the centre, how far the mountain can
// reach before it would crowd something: any PLAYABLE lane (the approach, the outside
// branch, the cliff run-in and its runout — but NOT the cave, which is meant to run
// under the mass), and the frozen lake, which the mountain stands at the shore of
// rather than in. Then smoothed around the circle so the silhouette has no creases,
// and re-clamped to the raw limits afterwards so smoothing can never push the
// mountain back over a lane.
const AZIMUTH_STEPS = 96;
const FORK_MOUNTAIN_PROFILE: Float64Array = (() => {
  const c = forkMountainCenter();
  const lake = lakeCenterWorld();
  const clear = LATERAL_LIMIT + FORK_MOUNTAIN.laneClearance;
  // Sample every open lane once.
  const lanes: { x: number; z: number }[] = [];
  for (const id of SINGLE_TRAIL) {
    const seg = BRANCH_SEGMENTS[id];
    if (!seg) continue;
    const span = seg.length + (seg.next === null ? 200 : 0);
    for (let d = 0; d <= span; d += 2) {
      const p = segmentCenterline(id, d);
      lanes.push({ x: p.x, z: p.z });
    }
  }
  const raw = new Float64Array(AZIMUTH_STEPS);
  for (let i = 0; i < AZIMUTH_STEPS; i++) {
    const a = (i / AZIMUTH_STEPS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let limit: number = FORK_MOUNTAIN.baseRadius;
    for (const p of lanes) {
      const vx = p.x - c.x;
      const vz = p.z - c.z;
      const along = vx * dx + vz * dz;
      if (along <= 0) continue; // behind this ray
      const perp = Math.abs(vx * -dz + vz * dx);
      if (perp >= clear) continue; // this ray misses the lane
      limit = Math.min(limit, along - Math.sqrt(clear * clear - perp * perp));
    }
    // …and stop at the lake's edge: the mountain rises FROM the shore, so the ice
    // never climbs its flank and the flank never floats over the ice.
    const lx = lake.x - c.x;
    const lz = lake.z - c.z;
    const along = lx * dx + lz * dz;
    if (along > 0) {
      const perp = Math.abs(lx * -dz + lz * dx);
      if (perp < FROZEN_LAKE.radius) {
        limit = Math.min(
          limit,
          along - Math.sqrt(FROZEN_LAKE.radius * FROZEN_LAKE.radius - perp * perp),
        );
      }
    }
    raw[i] = Math.max(20, limit);
  }
  // Circular box-smooth, then re-clamp to the raw limits.
  const out = new Float64Array(AZIMUTH_STEPS);
  const W = 5;
  for (let i = 0; i < AZIMUTH_STEPS; i++) {
    let sum = 0;
    for (let k = -W; k <= W; k++) {
      sum += raw[(i + k + AZIMUTH_STEPS) % AZIMUTH_STEPS]!;
    }
    out[i] = Math.min(sum / (2 * W + 1), raw[i]!);
  }
  return out;
})();

/** How far the mountain's foot reaches in a given world direction (radians, measured
 * as atan2(dz, dx) from its centre). Lerped between the solved spokes. */
export function forkMountainReach(azimuth: number): number {
  const n = AZIMUTH_STEPS;
  const t = ((azimuth / (Math.PI * 2)) % 1 + 1) % 1;
  const f = t * n;
  const i = Math.floor(f) % n;
  const frac = f - Math.floor(f);
  const a = FORK_MOUNTAIN_PROFILE[i]!;
  const b = FORK_MOUNTAIN_PROFILE[(i + 1) % n]!;
  return a + (b - a) * frac;
}

/**
 * The dome's height above its base, as a fraction of the way out to its foot in this
 * direction. A raised cosine: zero height AND zero slope at the foot, so it blends
 * into the surrounding banks with no crease, and a rounded summit.
 *
 * Taking `u` (normalised) rather than a raw radius is what lets the footprint be a
 * teardrop — every direction reaches its own distance, and the profile fills whatever
 * room it has there.
 */
export function forkMountainRiseAt(u: number): number {
  if (u >= 1) return 0;
  return FORK_MOUNTAIN.peakHeight * 0.5 * (1 + Math.cos(Math.PI * Math.max(0, u)));
}

/** The mountain's height above its base at a world point (0 outside the footprint). */
export function forkMountainRiseWorld(x: number, z: number): number {
  const c = forkMountainCenter();
  const dx = x - c.x;
  const dz = z - c.z;
  const r = Math.hypot(dx, dz);
  const reach = forkMountainReach(Math.atan2(dz, dx));
  return forkMountainRiseAt(reach > 0 ? r / reach : 1);
}

/** How far IN (as a fraction of the reach in that direction) the dome has risen
 * `mouthRise` above its base — how far into the footprint a cave mouth has to sit to
 * have real mountainside over it. */
export function caveMouthFraction(): number {
  const { peakHeight, mouthRise } = FORK_MOUNTAIN;
  // Invert the raised cosine: rise = peak·½(1+cos(πu)) ⇒ u = acos(2·rise/peak − 1)/π.
  const ratio = Math.max(-1, Math.min(1, (2 * mouthRise) / peakHeight - 1));
  return Math.acos(ratio) / Math.PI;
}

/**
 * Where the cave's two portals sit: the first and last points of the cave branch with
 * `mouthRise` of mountain over them. Measured rather than declared, so the mouths land
 * ON a real flank even if the wrap or the mass is retuned.
 *
 * The open stretches this leaves at each end are a feature, not slop: a cutting leads
 * into the mountainside and out again, which is what makes the mouth a thing you can
 * see and aim at from the approach rather than a hole that appears the instant the fork
 * fires.
 */
export function cavePortals(): {
  readonly entryDistance: number;
  readonly exitDistance: number;
} {
  const c = forkMountainCenter();
  const mouthU = caveMouthFraction();
  const inside = (d: number): boolean => {
    const p = segmentCenterline(CAVE_ID, d);
    const r = Math.hypot(p.x - c.x, p.z - c.z);
    const reach = forkMountainReach(Math.atan2(p.z - c.z, p.x - c.x));
    return reach > 0 && r / reach <= mouthU;
  };
  const span = CAVE_TO - CAVE_FROM;
  // Quarter-unit scan: the portals are meshes standing in the world, so landing them
  // within a metre of the flank they're cut into is the difference between a mouth and
  // a floating arch.
  const STEP_SCAN = 0.25;
  let entryDistance = 0;
  for (let d = 0; d <= span; d += STEP_SCAN) {
    if (inside(d)) {
      entryDistance = d;
      break;
    }
  }
  let exitDistance = span;
  for (let d = span; d >= 0; d -= STEP_SCAN) {
    if (inside(d)) {
      exitDistance = d;
      break;
    }
  }
  return { entryDistance, exitDistance };
}

/**
 * The ground height under an OFF-TRAIL world point, and how far that point is from the
 * nearest playable corridor.
 *
 * Needed because the height profile is keyed to ROUTE distance, so "how high is the
 * ground at world (x, z)" has no closed form once the trail curves — and the lake basin
 * and the mountain mass are the first things on this map that live off the ribbon and
 * have to sit on the hill correctly. Sampled once per build, not per frame.
 *
 * ⚠ IT IS A WEIGHTED MEAN, NOT THE NEAREST SAMPLE (slope-mech, 2026-07-26, after
 * looking at it). Taking the nearest corridor's height is discontinuous: the wrap
 * brings the outside branch within ~100 units of the cliff run-in, which is ~100 units
 * LOWER, so on the surface between them the answer jumps by ~100 the moment the nearest
 * corridor switches. Adjacent vertices of the mass then landed 100 apart and rendered
 * as tall thin white slivers stabbing out of the mountainside — very visible from the
 * lake. Inverse-distance weighting (1/d⁴, so it still tracks the nearest closely)
 * is continuous everywhere, and the slivers are gone.
 */
export function nearestCorridorGround(
  x: number,
  z: number,
  samples: readonly { readonly x: number; readonly z: number; readonly y: number }[],
): { readonly y: number; readonly distance: number } {
  let wSum = 0;
  let ySum = 0;
  let bestD2 = Infinity;
  for (const s of samples) {
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD2) bestD2 = d2;
    // +1 keeps the weight finite right on top of a sample.
    const w = 1 / ((d2 + 1) * (d2 + 1));
    wSum += w;
    ySum += s.y * w;
  }
  return {
    y: wSum > 0 ? ySum / wSum : 0,
    distance: Math.sqrt(bestD2),
  };
}

/** Every played corridor sampled at `step` units — the default line (with its runout)
 * plus each live fork branch. The input to `nearestCorridorGround`. */
export function playedCorridorSamples(
  step: number,
  runout: number,
): { readonly x: number; readonly z: number; readonly y: number }[] {
  const out: { x: number; z: number; y: number }[] = [];
  const walk = (segmentId: string, span: number): void => {
    for (let d = 0; d <= span; d += step) {
      const p = segmentCenterline(segmentId, d);
      out.push({ x: p.x, z: p.z, y: p.y });
    }
  };
  SINGLE_TRAIL.forEach((id, i) => {
    const seg = BRANCH_SEGMENTS[id];
    if (!seg) return;
    walk(id, seg.length + (i === SINGLE_TRAIL.length - 1 ? runout : 0));
  });
  for (const id of PLAYED_FORK_BRANCHES) {
    const seg = BRANCH_SEGMENTS[id];
    if (seg) walk(id, seg.length);
  }
  return out;
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

// ---------------------------------------------------------------------------
// OFF-RIBBON SURFACES, AND THE ONE RULE THEY ALL OBEY (slope-mech, 2026-07-26).
//
// Nothing collides with terrain on this map: the sim rides `routeHeightAt`, a 1-D
// height profile, and every terrain mesh is decoration hung near it. So a mesh that
// stands above the ridden surface is not a hill you climb — it is a WALL YOU SKI
// STRAIGHT THROUGH, which is exactly what the lake's shore lip turned out to be.
//
// THE RULE: **no off-ribbon surface may have an EDGE inside the lane.** Buried under
// the corridor is fine. A continuous roof over it is fine too — the map has one, the
// cave's ceiling. What is never fine is a surface that stands proud on part of the
// lane's cross-section while sitting at or below it on another part: that surface has a
// rim cutting up through the ground you ride, and you pass straight through the rim.
//
// Height is deliberately NOT the discriminator, though it was the obvious first guess.
// The lake's lip stood 12.6 units up and the cave's ceiling comes down to 19.7 at the
// tunnel's low shoulder, so any clearance threshold that catches the wall also condemns
// the ceiling. What separates them is not how high but whether they CROSS: the lip
// climbs out of the snow you're skiing on, the ceiling never touches it.
//
// Why it's stated here and not in the mesh builders: `slopePath.test.ts` asserts it
// over every playable lane, and the builders in `skiRender.ts` call these same
// functions — so a mesh cannot quietly drift away from the assertion. The mountain's
// footprint was already solved against the lanes (`laneClearance`) and the basin was
// solved against nothing; this is that same discipline, written down once for both.

/** Half-width of the dressed ribbon — the corridor mesh's outer edge (skiRender's
 * FLANK_HALF). The lane the sim clamps to is only ±LATERAL_LIMIT, but a wall standing
 * in the snow at lateral 32 is exactly as wrong as one at lateral 0, so the rule and
 * the gap both use the dressed width. */
export const RIBBON_HALF_WIDTH = 46;
/** How far a surface has to stand proud of the ridden lane before it counts as a step
 * rather than a graze. The mountain's foot meets the ground tangentially at the lane
 * edge (rise and slope both reach zero there), so it brushes 0 without ever being a
 * wall; a metre of daylight is the smallest step you would actually ski into. */
export const WALL_STEP = 1;
/** How far past the ribbon a ducked surface takes to climb back to its own level. This
 * is what makes the duck read as a GAP in the lake's rim — an outlet the run leaves
 * through — rather than a slot cut with a knife. */
export const LANE_GAP_FEATHER = 40;

/** How much a surface must duck to clear the ribbon: 1 on it, easing to 0 a feather
 * beyond. Continuous, so a ducked surface has no crease. */
function laneDuck(distanceToCorridor: number): number {
  const t = Math.max(
    0,
    Math.min(1, (distanceToCorridor - RIBBON_HALF_WIDTH) / LANE_GAP_FEATHER),
  );
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The trail the basin has to duck to — measured in THREE dimensions, not in plan.
 *
 * ⚠ THE WRAP PASSES UNDER THE LAKE (slope-mech, 2026-07-26 — the second bug the
 * headroom test caught, before it was ever seen). Fork 3's outside branch and the cave
 * come back within a lake-radius of the body in PLAN while running ~120 units below it,
 * so a plan-distance duck would have hauled the disc's far edge down toward a corridor
 * that isn't beneath the lake at all — the same class of mistake `lakeIceExtent`'s NEAR
 * guard already documents. A sample only counts as trail-under-the-lake if it is within
 * a radius of the point in space.
 *
 * Returns the nearest such sample's plan distance and an inverse-distance-weighted
 * height over the relevant set (weighted, not nearest, for the reason
 * `nearestCorridorGround` gives), or `null` where no trail is near.
 */
function lakeDuckReference(
  x: number,
  z: number,
  samples: readonly { readonly x: number; readonly z: number; readonly y: number }[],
): { readonly distance: number; readonly y: number } | null {
  const reach2 = FROZEN_LAKE.radius * FROZEN_LAKE.radius;
  const lakeY = lakeIceHeight();
  let nearest = Infinity;
  let wSum = 0;
  let ySum = 0;
  for (const s of samples) {
    const dx = s.x - x;
    const dz = s.z - z;
    const dy = s.y - lakeY;
    if (dx * dx + dz * dz + dy * dy > reach2) continue; // not under this lake
    const d2 = dx * dx + dz * dz;
    if (d2 < nearest) nearest = d2;
    const w = 1 / ((d2 + 1) * (d2 + 1));
    wSum += w;
    ySum += s.y * w;
  }
  if (wSum === 0) return null;
  return { distance: Math.sqrt(nearest), y: ySum / wSum };
}

/** How far the basin sits below the ice it carries, so the two can't z-fight. */
export const BASIN_DROP = 0.25;

/**
 * THE FROZEN LAKE'S BASIN SURFACE at a world point — `null` off the body.
 *
 * Level across the body (ice is level), with a `shoreRise` lip ringing it so it reads
 * as water held in a bowl, and an uphill shore that blends up to meet the hill instead
 * of terracing against it.
 *
 * ⚠ AND A GAP AT THE CROSSINGS — the bug Josh rode into. The disc knew nothing about
 * the trail that crosses it, so it stood above the ridden surface in two places: the
 * uphill lip crossed the lane 12.6 units proud (a white wall across the piste just
 * before the ice), and on the way out the level body itself stood 27.8 units above a
 * lane that had already fallen below lake level. Both are one fault — a surface above
 * the ground you ride — so both take one fix: where the body would stand above the
 * ribbon it ducks to it and feathers back out. That is what a lake outlet is, and it is
 * why the rim now has a notch at each crossing.
 *
 * Takes the corridor samples rather than reaching for them: sampling is the expensive
 * part, and the mesh builder does it once for every off-ribbon feature.
 */
export function frozenLakeBasinHeight(
  x: number,
  z: number,
  samples: readonly { readonly x: number; readonly z: number; readonly y: number }[],
): number | null {
  const c = lakeCenterWorld();
  const { radius, shoreBand, shoreRise } = FROZEN_LAKE;
  // Epsilon-tolerant, then clamped: the mesh builder's outermost ring sits at exactly
  // `radius`, and cos/sin round-off there would otherwise report the rim as off-body.
  const raw = Math.hypot(x - c.x, z - c.z);
  if (raw > radius + 1e-6) return null;
  const r = Math.min(raw, radius);
  // Dropped a hair below the ice so it can't z-fight the corridor where the two
  // coincide across the flat crossing — the corridor is at exactly this height there,
  // which is the whole point: you ski straight out onto it.
  const lakeY = lakeIceHeight();
  const shoreT = Math.max(0, (r - (radius - shoreBand)) / shoreBand);
  const lift = shoreRise * (shoreT * shoreT * (3 - 2 * shoreT));
  let y = lakeY - BASIN_DROP + lift;
  const ground = nearestCorridorGround(x, z, samples);
  if (shoreT > 0 && ground.y > y) {
    // Only the UPHILL shore gets pulled up to the hill: downhill of the lake the ground
    // has fallen away, and following it there would drain the basin over a cliff.
    y = y + (ground.y - y) * (shoreT * shoreT);
  }
  const under = lakeDuckReference(x, z, samples);
  if (under) {
    const duck = laneDuck(under.distance);
    const floor = under.y - BASIN_DROP;
    if (duck > 0 && y > floor) y = y + (floor - y) * duck;
  }
  return y;
}

// The cave's line in plan, sampled once — the doorway is cut relative to the corridor
// it lets you into, so it has to know where that corridor runs.
const CAVE_PLAN: readonly { readonly x: number; readonly z: number }[] = (() => {
  const out: { x: number; z: number }[] = [];
  const span = BRANCH_SEGMENTS[CAVE_ID]?.length ?? 0;
  for (let d = 0; d <= span; d += 1) {
    const p = segmentCenterline(CAVE_ID, d);
    out.push({ x: p.x, z: p.z });
  }
  return out;
})();

/**
 * Is this bit of mountainside cut away for the cave?
 *
 * The mass is a closed shell, so an arch standing inside it would be invisible from
 * outside — the mountain draws over it. The mouth is therefore a genuine hole: shell
 * that would sit UNDER THE LINTEL over the cave's own corridor is simply not emitted.
 * You see into the dark, which is what makes it read as an entrance, and the short open
 * cuttings at each end are the ravine that leads you in.
 *
 * ⚠ CUT AGAINST THE CORRIDOR, NOT A SLOT AT THE PORTAL (slope-mech, 2026-07-26 — the
 * third thing the lane sweep caught, unseen). The doorway used to be a fixed 30-unit
 * slot either side of each portal. Past the end of that slot the flank kept whatever
 * low rise it had, so a lip of mountainside up to 3.75 units stood straight through the
 * lane at the exit cutting — a small version of exactly the bug this file is about.
 * Cutting wherever the shell is below the lintel AND within a mouth-width of the
 * corridor is the same intent without the arbitrary length: the tunnel is bored open
 * until there is a full lintel of rock above it. It self-limits, because deep inside
 * the mass the low-rise shell is nowhere near the corridor.
 *
 * Shared by the mesh builder and the lane sweep so "is there mountain here" has one
 * answer — otherwise the sweep reads the analytic dome and reports a wall standing
 * exactly where the doorway already removed it.
 */
export function insideCaveDoorway(x: number, z: number, rise: number): boolean {
  if (rise > FORK_MOUNTAIN.mouthHeight) return false; // above the lintel
  const limit2 = FORK_MOUNTAIN.mouthHalfWidth * FORK_MOUNTAIN.mouthHalfWidth;
  for (const p of CAVE_PLAN) {
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz <= limit2) return true;
  }
  return false;
}

/**
 * THE FORK MOUNTAIN'S SHELL SURFACE at a world point — the hill it stands on plus its
 * rise. Zero rise outside the footprint, so out there this is just the ground.
 *
 * The mesh builder and the lane-headroom test read the same function, so "how high is
 * the mountain over the cave" has exactly one answer.
 */
export function forkMountainShellHeight(
  x: number,
  z: number,
  samples: readonly { readonly x: number; readonly z: number; readonly y: number }[],
): number {
  return nearestCorridorGround(x, z, samples).y + forkMountainRiseWorld(x, z);
}
