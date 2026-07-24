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

/** A point on the centerline, in the same world axes the renderer uses. */
export interface SlopePoint {
  /** World X of the centerline at this distance. */
  readonly x: number;
  /** World Z — downhill is −z, matching the old `-distance` mapping. */
  readonly z: number;
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
      heading: hl,
    };
  }
  const t = fi - i;
  return {
    x: xs[i]! + (xs[i + 1]! - xs[i]!) * t,
    z: zs[i]! + (zs[i + 1]! - zs[i]!) * t,
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
// The branching map's segment placement (slope-mech, 2026-07-24 — the §8
// de-risk of SLOPE_BRANCHING.md). Presentation-only, the same as the road
// above: the sim (route.ts) knows a run as (segmentId, segment-local distance);
// this maps that to a world point + facing. Each segment is a straight
// grayblock corridor with its own world origin — the spine chained down −z, the
// tree detour offset far to the side so it reads as a separate "world." A run
// that forks jumps between corridors at the handoff (the tree swallows you /
// the bird drops you back on the road): a deliberate, diegetic cut, exactly the
// enter→detour→rejoin the de-risk is proving.
//
// "main" (the Overlook's single segment) has NO placement here, so the segment
// functions fall straight through to the road above — the un-branched run is
// bit-for-bit unchanged. Grayblock straight; the real map's shaped corridors
// (and the visuals session's dressing) come later.

/** A segment's world anchor: where its entrance sits and which way it heads. */
export interface SegmentPlacement {
  readonly originX: number;
  readonly originZ: number;
  /** Tangent yaw; 0 = straight downhill (−z), like the road's heading 0. */
  readonly heading: number;
}

export const SEGMENT_PLACEMENTS: Readonly<Record<string, SegmentPlacement>> = {
  // Spine: chained straight down −z. spine-1 [0,120], spine-2 [120,220],
  // spine-3 [220,340] (matching route.ts's segment lengths).
  "spine-1": { originX: 0, originZ: 0, heading: 0 },
  "spine-2": { originX: 0, originZ: -120, heading: 0 },
  // The detour "world": a parallel corridor offset +50 in x, spanning the same
  // downhill extent as spine-2. Entering/leaving it cuts across that gap.
  tree: { originX: 50, originZ: -120, heading: 0 },
  "spine-3": { originX: 0, originZ: -220, heading: 0 },
};

/** The centerline point (world x/z + tangent) at a distance down a segment.
 * Unknown segment ("main") → the Overlook's global road, so it's unchanged. */
export function segmentCenterline(segmentId: string, distance: number): SlopePoint {
  const p = SEGMENT_PLACEMENTS[segmentId];
  if (!p) return slopeCenterline(distance);
  return {
    x: p.originX + Math.sin(p.heading) * distance,
    z: p.originZ - Math.cos(p.heading) * distance,
    heading: p.heading,
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
