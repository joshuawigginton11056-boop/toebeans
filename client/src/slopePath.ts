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
  yeti: { turn: -0.28 },
  cave: { turn: -0.18 },
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
// continuous-curvature line summit → the back of the forest: a gentle S whose
// heading is a full sine period over the trail's route length, so the curvature is
// smooth EVERYWHERE (no seam kink) and BOTH the heading and the lateral return to
// ~0 at the forest (∫ heading over a full period is 0) — the run tracks the fall
// line with no net drift, killing the old forest drift-right. Keyed to ROUTE
// distance (summit 0..120, forest-road 120..240) so the two trail segments sample
// one shared line; y still comes from the shared grade profile (segmentGroundY).
const TRAIL_ROUTE_LEN = 240; // summit (120) + forest-road (120) → back of the forest
// Peak heading off the fall line, radians (~8°). Negative leans the S LEFT first
// then eases back (matching the old spine's left lobe through the summit). A gentle
// LOOK-PASS KNOB — raise for a bolder curve, drop toward 0 for near-straight.
const TRAIL_AMPLITUDE = -0.14;
const TRAIL_LINE: Centerline = (() => {
  const step = STEP;
  const n = Math.ceil(TRAIL_ROUTE_LEN / step) + 1;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const headings = new Float64Array(n);
  const headingAt = (s: number): number =>
    TRAIL_AMPLITUDE *
    Math.sin((2 * Math.PI * Math.min(s, TRAIL_ROUTE_LEN)) / TRAIL_ROUTE_LEN);
  let x = 0;
  let z = 0;
  headings[0] = headingAt(0);
  for (let i = 1; i < n; i++) {
    const h0 = headingAt((i - 1) * step);
    const h1 = headingAt(i * step);
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

/** The centerline point (world x/z + tangent) at a distance down a segment.
 * Unknown segment ("main") → the Overlook's global road, so it's unchanged. The
 * single played trail (summit, forest-road) rides the one smooth TRAIL_LINE above
 * instead of its per-segment arc — killing the seam kink and the drift; the parked
 * branching segments keep their constant-curvature arc placement. */
export function segmentCenterline(segmentId: string, distance: number): SlopePoint {
  const p = SEGMENT_PLACEMENTS[segmentId];
  if (!p) return slopeCenterline(distance);
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
