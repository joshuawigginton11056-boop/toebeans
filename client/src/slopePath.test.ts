import { describe, expect, it } from "vitest";
import {
  BRANCH_SEGMENTS,
  LATERAL_LIMIT,
  SINGLE_TRAIL,
  routeDistanceOf,
  routeHeightAt,
} from "@toebeans/shared";
import {
  buildCenterline,
  caveMouthFraction,
  cavePortals,
  caveRejoinError,
  centerlineAt,
  centerlineToWorld,
  FORK_MOUNTAIN,
  forkMountainCenter,
  forkMountainReach,
  forkMountainRiseAt,
  forkMountainRiseWorld,
  forkMountainShellHeight,
  frozenLakeBasinHeight,
  FROZEN_LAKE,
  insideCaveDoorway,
  lakeCenterWorld,
  lakeIceExtent,
  lakeIceHeight,
  playedCorridorSamples,
  segmentCenterline,
  segmentToWorld,
  slopeCenterline,
  slopeToWorld,
  trailRows,
  WALL_STEP,
  type Bend,
} from "./slopePath";

describe("slopePath — the shipped (straight) road", () => {
  it("maps distance/lateral to the exact pre-centerline world (identity)", () => {
    // The whole point of shipping straight: slopeToWorld must equal the old
    // inline mapping { x: lateral, z: -distance } so nothing visually moves.
    for (const distance of [0, 1, 120, 380, 560, 800, 899]) {
      for (const lateral of [-12, -3, 0, 5, 12]) {
        const w = slopeToWorld(distance, lateral);
        expect(w.x).toBeCloseTo(lateral, 9);
        expect(w.z).toBeCloseTo(-distance, 9);
      }
    }
  });

  it("has zero heading everywhere while straight", () => {
    for (const distance of [0, 50, 300, 800]) {
      expect(slopeCenterline(distance).heading).toBeCloseTo(0, 9);
    }
  });

  it("extends straight both past the finish and uphill of the gate", () => {
    // Past the end (table stops at 900) and behind the start (negative
    // distance, where uphill decor peeks) both keep the straight axis.
    expect(slopeToWorld(1200, 4)).toMatchObject({ x: 4 });
    expect(slopeToWorld(1200, 4).z).toBeCloseTo(-1200, 6);
    expect(slopeToWorld(-30, 4).z).toBeCloseTo(30, 6);
  });
});

describe("slopePath — the curve mechanism (proven before it ships)", () => {
  // A gentle right bend: accumulate ~0.2 rad of heading centered at 400.
  const bend: Bend = { center: 400, halfWidth: 100, turn: 0.2 };
  const line = buildCenterline([bend]);

  it("accumulates exactly the bend's turn in heading across it", () => {
    // Before the bend: still straight. After: the full turn, held.
    expect(centerlineAt(line, bend.center - bend.halfWidth).heading).toBeCloseTo(
      0,
      6,
    );
    expect(centerlineAt(line, bend.center).heading).toBeCloseTo(bend.turn / 2, 3);
    expect(centerlineAt(line, bend.center + bend.halfWidth).heading).toBeCloseTo(
      bend.turn,
      3,
    );
    expect(centerlineAt(line, 800).heading).toBeCloseTo(bend.turn, 3);
  });

  it("stays arc-length parameterized (travel ≈ distance)", () => {
    // Walk the sampled points and sum segment lengths; a hazard at distance D
    // must sit ~D units of travel down the road, or the sim's spacing lies.
    let travel = 0;
    let prev = centerlineAt(line, 0);
    for (let d = 1; d <= 800; d++) {
      const p = centerlineAt(line, d);
      travel += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    expect(travel).toBeCloseTo(800, 0);
  });

  it("bends toward +x and lateral rides the road's normal", () => {
    // Positive turn curves the centerline toward +x downhill of the bend.
    expect(centerlineAt(line, 800).x).toBeGreaterThan(1);
    // Off-center points sit `lateral` from the centerline, perpendicular to it.
    const center = centerlineAt(line, 800);
    const off = centerlineToWorld(line, 800, 3);
    expect(Math.hypot(off.x - center.x, off.z - center.z)).toBeCloseTo(3, 6);
  });
});

describe("slopePath — the branching map's real grade (world-Y descent)", () => {
  // The world-Y now delegates to route.ts's shared height profile (routeHeightAt),
  // which VARIES the grade down the route. The invariants that must survive that:
  // the Overlook stays flat, the embed matches the shared profile exactly, the flag
  // sits at 0, every fork reconvergence is at one height, and the descent is
  // monotone. (The grade profile's own shape is pinned in shared/route.test.ts.)
  const summitY = segmentCenterline("summit", 0).y;

  it("leaves the Overlook (and the flat road) dead flat at y = 0", () => {
    // "main" has no placement → falls through to the flat road, so the shipped
    // Overlook never moves in y.
    for (const distance of [0, 120, 380, 800]) {
      expect(segmentCenterline("main", distance).y).toBe(0);
      expect(slopeCenterline(distance).y).toBe(0);
    }
  });

  it("descends from an elevated summit to y ≈ 0 at the flag", () => {
    expect(summitY).toBeGreaterThan(0);
    // Both terminal segments (cliff, ice-castle) end at the flag — route
    // distance TOTAL — so both land at y = 0: same clock, same flag, same floor.
    // Lengths read off the registry, not baked in: the areas get re-proportioned
    // whenever the map is reshaped (2026-07-25 and -26 were two such passes).
    const endOf = (id: string) => segmentCenterline(id, BRANCH_SEGMENTS[id]!.length).y;
    expect(endOf("cliff")).toBeCloseTo(0, 6);
    expect(endOf("ice-castle")).toBeCloseTo(0, 6);
    // The total drop is the summit's height — every route falls the same amount.
    expect(summitY - endOf("cliff")).toBeCloseTo(summitY, 6);
  });

  it("embeds the shared route height profile as the ground Y", () => {
    // segmentCenterline's y is exactly routeHeightAt(routeDistanceOf(...)) — so a
    // point's height depends only on its ROUTE distance, which is what keeps every
    // route the same height at the same clock (the "matches on every segment" check
    // below is the same identity read across forks).
    for (const [id, distance] of [
      ["summit", 60],
      ["forest-road", 0],
      ["forest-tree", 60], // the Type A detour: same height as the road it parallels
      ["lake", 50],
      ["water", 100],
      ["mountain", 40],
      // FORK 3's two branches: the cave rides its own corridor and the outside rides
      // the default line, but BOTH read their height off the shared depth profile —
      // which is exactly why the fork is same-clock in elevation as well as distance.
      ["outside", 150],
      ["cave", 150],
      ["ledge", 30],
      ["valley", 40],
    ] as const) {
      expect(segmentCenterline(id, distance).y).toBeCloseTo(
        routeHeightAt(routeDistanceOf(id, distance)),
        6,
      );
    }
  });

  it("keeps every fork reconvergence at one height whichever way it's reached", () => {
    // Read the lengths off the registry rather than hard-coding them: the areas get
    // RE-PROPORTIONED whenever the map's shape is retuned (2026-07-25 was one such
    // pass), and a test that bakes in "cave is 120 long" stops testing the
    // reconvergence and starts testing last month's numbers.
    const endOf = (id: string) => segmentCenterline(id, BRANCH_SEGMENTS[id]!.length).y;
    // Cave and Water both deliver you to the shared cliff: the ends of cave and
    // water, and the cliff's entrance, are all one height.
    const cliffEntranceY = segmentCenterline("cliff", 0).y;
    expect(endOf("cave")).toBeCloseTo(cliffEntranceY, 6);
    expect(endOf("water")).toBeCloseTo(cliffEntranceY, 6);
    // The Type A forest fork: road and tree both feed the lake at the same height.
    expect(endOf("forest-road")).toBeCloseTo(endOf("forest-tree"), 6);
    expect(segmentCenterline("lake", 0).y).toBeCloseTo(endOf("forest-road"), 6);
  });

  it("descends monotonically down every segment", () => {
    for (const id of ["summit", "lake", "water", "valley", "cliff"]) {
      const top = segmentCenterline(id, 0).y;
      const bottom = segmentCenterline(id, 40).y;
      expect(bottom).toBeLessThan(top);
    }
  });
});

describe("slopePath — the branching map's shaped (curved) corridors", () => {
  const lengthOf = (id: string): number => BRANCH_SEGMENTS[id]!.length;

  it("stays arc-length parameterized down each segment (travel ≈ distance)", () => {
    // The corridors curve now, but each is a circular arc parameterized by arc
    // length — so a hazard at segment-distance D still sits D units of travel
    // down it, keeping the sim's spacing honest (same guarantee as the road).
    for (const id of ["summit", "lake", "water", "valley", "forest-tree"]) {
      const len = lengthOf(id);
      let travel = 0;
      let prev = segmentCenterline(id, 0);
      for (let d = 1; d <= len; d++) {
        const p = segmentCenterline(id, d);
        travel += Math.hypot(p.x - prev.x, p.z - prev.z);
        prev = p;
      }
      expect(travel).toBeCloseTo(len, 0);
    }
  });

  it("actually turns — the heading changes across a curved segment", () => {
    // A still-parked branching arc (water) — `lake` now rides the single trail's
    // smooth line, which returns to the fall line at its end (no net turn), so it's
    // no longer the right example of a big per-segment arc.
    const h0 = segmentCenterline("water", 0).heading;
    const h1 = segmentCenterline("water", lengthOf("water")).heading;
    expect(Math.abs(h1 - h0)).toBeGreaterThan(0.1);
  });

  it("the single played trail is ONE smooth continuous line — no seam kink, no drift (2026-07-24 redirect)", () => {
    // The redirect (IDEAS.md START HERE): the played run rides one continuous-
    // curvature line summit → forest → the frozen lake, not the old per-segment
    // constant-curvature arcs whose curvature SIGN FLIPPED at the seam (the "jerky"
    // path). Sample the trail continuously across BOTH internal seams
    // (summit→forest-road AND forest-road→lake) and pin THREE things the old arcs
    // couldn't all give at once.
    // Sampled across the WHOLE played spine, not just the first three areas: since
    // the map was laid out as drawn (2026-07-25) the back half turns for real — a
    // ~160° wrap around the second mountain — and that is exactly where a curvature
    // step would be felt hardest, so it has to be inside the sampled range.
    const trail = [...SINGLE_TRAIL];
    const trailLen = trail.reduce((s, id) => s + lengthOf(id), 0); // the full 640

    // A helper: the world point at a ROUTE distance down the trail (which segment,
    // which local distance), so we can sample right across the internal seams.
    const at = (routeD: number) => {
      let id = "summit";
      let acc = 0;
      for (const seg of trail) {
        if (routeD < acc + lengthOf(seg) || seg === trail[trail.length - 1]) {
          id = seg;
          break;
        }
        acc += lengthOf(seg);
      }
      return segmentCenterline(id, routeD - acc);
    };

    // 1) Position + heading continuous at each seam: the segment END and the next
    // segment START are the same route distance, so both sample the one line at the
    // same point — identical world position and heading, no gap, no dogleg.
    for (const [a, b] of [
      ["summit", "forest-road"],
      ["forest-road", "lake"],
      ["lake", "mountain"],
      ["mountain", "outside"],
      ["outside", "cliff"],
    ] as const) {
      const aEnd = segmentCenterline(a, lengthOf(a));
      const bStart = segmentCenterline(b, 0);
      expect(bStart.x).toBeCloseTo(aEnd.x, 6);
      expect(bStart.z).toBeCloseTo(aEnd.z, 6);
      expect(bStart.heading).toBeCloseTo(aEnd.heading, 6);
    }

    // 2) CURVATURE continuous everywhere — the real no-kink fix, and the one that
    // survives the map being laid out as drawn. The old arcs jumped curvature from
    // summit's −0.002 to forest-road's +0.002 at the seam (the "jerky" path); the
    // lobe chain never jumps, at ANY seam, even where a straight area meets the
    // second mountain's wrap. Two construction rules earn that and this test is what
    // holds them: every lobe's weave amplitude is TRAIL_WEAVE × its own span (so a
    // lobe's end curvature is the same TRAIL_WEAVE·2π whatever its length), and a
    // net turn is applied through a smoothstep (so it contributes NO curvature at
    // the seams). Break either and this fails.
    // Measured as "are the seams special?" rather than against a fixed number. The
    // trail curves for real now, so curvature CHANGES as you ski — smoothly, all the
    // way round the wrap. An absolute threshold can't tell that apart from a kink; it
    // just gets loosened every time the map gets bolder. What a kink actually is: a
    // curvature step that happens AT a seam and nowhere else. So compare the two.
    const seams: number[] = [];
    let acc = 0;
    for (const id of trail.slice(0, -1)) {
      acc += lengthOf(id);
      seams.push(acc);
    }
    const nearSeam = (d: number) => seams.some((s) => Math.abs(d - s) <= 3);
    let seamJump = 0;
    let interiorJump = 0;
    let prevK = 0;
    for (let d = 1; d <= trailLen; d++) {
      const k = at(d).heading - at(d - 1).heading; // curvature over this unit step
      if (d > 1) {
        const jump = Math.abs(k - prevK);
        if (nearSeam(d)) seamJump = Math.max(seamJump, jump);
        else interiorJump = Math.max(interiorJump, jump);
      }
      prevK = k;
    }
    // Crossing a seam is no more of an event than any other metre of the trail.
    expect(seamJump).toBeLessThanOrEqual(interiorJump * 1.5);
    // …and the curve as a whole stays smooth in absolute terms too, so this can't
    // pass by making the whole trail equally jerky.
    expect(Math.max(seamJump, interiorJump)).toBeLessThan(0.01);

    // 3) No UNINTENDED drift. A weave must always return what it borrowed — ∫ over a
    // full sine period is 0 — so an area that declares no net turn finishes pointing
    // exactly where it started, and the old forest drift-right cannot come back.
    // The areas that DO turn are the ones that say so in TRAIL_LOBES.
    const forestEnd = trail.slice(0, 2).reduce((s, id) => s + lengthOf(id), 0);
    expect(at(forestEnd).heading).toBeCloseTo(0, 3); // summit + forest: pure weave
    expect(at(forestEnd + lengthOf("lake")).heading).toBeCloseTo(0, 3); // lake too
    // …and the trail as a whole HAS turned by the end, because the drawn map wraps
    // the second mountain. This is the assertion that distinguishes "laid out as
    // drawn" from "a fall line with a wiggle."
    expect(Math.abs(at(trailLen).heading)).toBeGreaterThan(1.2);

    // The weave stays a weave: on the areas that don't turn, the excursion off the
    // fall line is a real visible curve but never runs away.
    let peakLateral = 0;
    for (let d = 0; d <= forestEnd; d++) peakLateral = Math.max(peakLateral, Math.abs(at(d).x));
    expect(peakLateral).toBeGreaterThan(LATERAL_LIMIT); // the forest genuinely meanders
    expect(peakLateral).toBeLessThan(40); // …without leaving the dressed ribbon
  });

  it("maps lateral onto the corridor normal, perpendicular to the tangent", () => {
    const mid = 40;
    const c = segmentCenterline("lake", mid);
    const off = segmentToWorld("lake", mid, 5);
    // The offset point sits exactly |lateral| from the centerline...
    expect(Math.hypot(off.x - c.x, off.z - c.z)).toBeCloseTo(5, 6);
    // ...and perpendicular to the tangent (dot of the offset with the tangent ≈ 0).
    const tangent = { x: Math.sin(c.heading), z: -Math.cos(c.heading) };
    const dot = (off.x - c.x) * tangent.x + (off.z - c.z) * tangent.z;
    expect(dot).toBeCloseTo(0, 6);
  });

  it("leaves 'main' straight (identity road) — the unbranched run is unchanged", () => {
    for (const d of [0, 50, 300]) {
      expect(segmentCenterline("main", d).heading).toBeCloseTo(0, 9);
      expect(segmentToWorld("main", d, 4)).toMatchObject({ x: 4 });
    }
  });
});

// FORK 3 — the fork mountain (slope-mech, 2026-07-26). The fork's legibility rests on
// geometry, so the geometry gets pinned: the cave has to start where the fork fires and
// END where the outside branch ends (or the terrain tears at the rejoin), it has to
// actually pass through the mass, and the mass has to be big without swallowing any
// lane. All four are load-bearing, and all four would break silently the next time
// somebody makes the wrap bolder — which is exactly what these are for.
describe("slopePath — Fork 3: two lines around and through the mass", () => {
  const CAVE_LEN = BRANCH_SEGMENTS.cave!.length;
  const OUTSIDE_LEN = BRANCH_SEGMENTS.outside!.length;

  it("splits both branches from one point and rejoins them at one point", () => {
    // The fork mouth: the approach's exit is where BOTH branches begin.
    const forkPoint = segmentCenterline("mountain", BRANCH_SEGMENTS.mountain!.length);
    for (const branch of ["outside", "cave"] as const) {
      const start = segmentCenterline(branch, 0);
      expect(Math.hypot(start.x - forkPoint.x, start.z - forkPoint.z)).toBeCloseTo(0, 3);
      expect(start.heading).toBeCloseTo(forkPoint.heading, 3);
    }
    // The rejoin: the cave's exit lands on the cliff's entrance, which is where the
    // outside branch ends. This is the residual of the solve in slopePath.ts — if the
    // wrap is retuned and the solver can no longer close it, this fails rather than
    // leaving a visible tear in the ground.
    expect(caveRejoinError()).toBeLessThan(1);
    const cliffStart = segmentCenterline("cliff", 0);
    const caveEnd = segmentCenterline("cave", CAVE_LEN);
    expect(Math.hypot(caveEnd.x - cliffStart.x, caveEnd.z - cliffStart.z)).toBeLessThan(1);
    // …and both branches are the same length, so it is a choice and not a shortcut.
    expect(CAVE_LEN).toBe(OUTSIDE_LEN);
  });

  it("stays arc-length parameterized down the cave (travel ≈ distance)", () => {
    // The cave is its own centerline, so it needs the same guarantee as the rest: a
    // hazard at distance D sits D units of travel in, or the sim's spacing lies.
    let travel = 0;
    let prev = segmentCenterline("cave", 0);
    for (let d = 1; d <= CAVE_LEN; d++) {
      const p = segmentCenterline("cave", d);
      travel += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    expect(travel).toBeCloseTo(CAVE_LEN, 0);
  });

  // Where the cave gets deepest into the mass, as a world point.
  function caveDeepest(): [number, number] {
    const c = forkMountainCenter();
    let best: [number, number] = [0, 0];
    let bestU = Infinity;
    for (let d = 0; d <= BRANCH_SEGMENTS.cave!.length; d++) {
      const p = segmentCenterline("cave", d);
      const u =
        Math.hypot(p.x - c.x, p.z - c.z) /
        forkMountainReach(Math.atan2(p.z - c.z, p.x - c.x));
      if (u < bestU) {
        bestU = u;
        best = [p.x, p.z];
      }
    }
    return best;
  }

  it("runs the cave THROUGH the mass and the outside branch AROUND its foot", () => {
    const c = forkMountainCenter();
    // "How far inside the mountain" is a FRACTION of the reach in that direction now,
    // because the footprint is a teardrop rather than a circle (see FORK_MOUNTAIN).
    const depthOf = (p: { x: number; z: number }): number =>
      Math.hypot(p.x - c.x, p.z - c.z) /
      forkMountainReach(Math.atan2(p.z - c.z, p.x - c.x));
    // The cave crosses the interior — deep inside the footprint, not skimming it.
    let deepest = Infinity;
    for (let d = 0; d <= CAVE_LEN; d++) {
      deepest = Math.min(deepest, depthOf(segmentCenterline("cave", d)));
    }
    expect(deepest).toBeLessThan(0.6); // past halfway to the summit
    // …with real mountain overhead where it's deepest.
    const [dx, dz] = caveDeepest();
    expect(forkMountainRiseWorld(dx, dz)).toBeGreaterThan(
      FORK_MOUNTAIN.peakHeight * 0.35,
    );
    // The outside branch never enters the footprint, and hugs it the whole way round:
    // "the ride around" has to stay beside the mountain, not wander off across the map.
    let nearest = Infinity;
    let farthest = 0;
    for (let d = 0; d <= OUTSIDE_LEN; d++) {
      const p = segmentCenterline("outside", d);
      const gap =
        Math.hypot(p.x - c.x, p.z - c.z) -
        forkMountainReach(Math.atan2(p.z - c.z, p.x - c.x));
      nearest = Math.min(nearest, gap);
      farthest = Math.max(farthest, gap);
    }
    expect(nearest).toBeGreaterThan(0); // never inside the footprint
    expect(farthest).toBeLessThan(50); // …and never far from its foot
    // …and it really does sweep around, rather than passing by: well over a third of
    // a full turn of heading across the branch.
    const swept = Math.abs(
      segmentCenterline("outside", OUTSIDE_LEN).heading -
        segmentCenterline("outside", 0).heading,
    );
    expect(swept).toBeGreaterThan(2.5); // > 143°
  });

  it("keeps the mass clear of every playable lane (it must not bury the piste)", () => {
    // The footprint is SOLVED against the lanes, per azimuth — this is the assertion
    // that solve has to satisfy. The lane is ±LATERAL_LIMIT and IS the sim's ground, so
    // the mountain's foot stays outside it with room to spare. Reshape the wrap or grow
    // the mountain and this fails, rather than the piste quietly disappearing under a
    // hill.
    const c = forkMountainCenter();
    for (const [id, len] of [
      ["mountain", BRANCH_SEGMENTS.mountain!.length],
      ["outside", OUTSIDE_LEN],
      ["cliff", BRANCH_SEGMENTS.cliff!.length + 200], // include the flat runout
    ] as const) {
      for (let d = 0; d <= len; d += 2) {
        const p = segmentCenterline(id, d);
        const reach = forkMountainReach(Math.atan2(p.z - c.z, p.x - c.x));
        expect(Math.hypot(p.x - c.x, p.z - c.z) - reach).toBeGreaterThanOrEqual(
          LATERAL_LIMIT,
        );
        // …so nothing on a playable lane is ever underneath the mountain.
        expect(forkMountainRiseWorld(p.x, p.z)).toBe(0);
      }
    }
  });

  it("is a MASS, not a spire — wide enough for its height, and lopsided", () => {
    // The first build used ONE radius for every direction. A single radius has to obey
    // the tightest constraint (the wrap, ~85 units), and paired with a peak tall enough
    // to see from across the lake that rendered as a literal needle. The fix was the
    // per-azimuth footprint; this is what stops it regressing to a spike.
    const N = 96;
    const reach: number[] = [];
    for (let i = 0; i < N; i++) reach.push(forkMountainReach((i / N) * Math.PI * 2));
    const min = Math.min(...reach);
    const max = Math.max(...reach);
    const mean = reach.reduce((a, b) => a + b, 0) / N;
    // Height against the MEAN half-width is the honest "is it a mountain or a spike"
    // ratio. The circle version was 175 over 85 (2.06 — a needle); this is well under.
    expect(FORK_MOUNTAIN.peakHeight / mean).toBeLessThan(1.6);
    // Widest span straight through the centre: the mountain is bigger across than the
    // whole dressed ribbon is wide, which is what makes it a mass you go around.
    let widest = 0;
    for (let i = 0; i < N; i++) widest = Math.max(widest, reach[i]! + reach[(i + N / 2) % N]!);
    expect(widest).toBeGreaterThan(240);
    // And it is genuinely lopsided: the bulk piles up away from the wrap.
    expect(max).toBeGreaterThan(min * 2);
    expect(mean).toBeGreaterThan(85);
    // Still tall enough to be a mountain you can see from across the lake — the height
    // profile only falls, so it stands on ground well below the shore you see it from.
    expect(FORK_MOUNTAIN.peakHeight).toBeGreaterThan(100);
  });

  it("stands at the lake's shore, not in it", () => {
    // The map draws the mountain immediately beyond the water. If its foot reached into
    // the body, the flat ice would cut through the flank (and the flank would float over
    // the ice), so the solve treats the lake as an obstacle too.
    const c = forkMountainCenter();
    const lc = lakeCenterWorld();
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r = forkMountainReach(a);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      expect(Math.hypot(x - lc.x, z - lc.z)).toBeGreaterThanOrEqual(
        FROZEN_LAKE.radius - 1,
      );
    }
  });

  it("puts both cave portals ON the mountainside, with a short cutting either end", () => {
    const { entryDistance, exitDistance } = cavePortals();
    // Not at the very fork point: a cutting leads in, which is what makes the mouth a
    // thing you spot and aim at from the approach.
    expect(entryDistance).toBeGreaterThan(10);
    expect(entryDistance).toBeLessThan(120);
    // And out the far side with a run-out to the rejoin, not straight into the cliff.
    expect(CAVE_LEN - exitDistance).toBeGreaterThan(10);
    expect(exitDistance).toBeGreaterThan(entryDistance + 80); // a real tunnel between
    // The mouths sit where the mass has real flank above them — not out at the foot,
    // where the dome has flattened to nothing and there'd be nothing to put a hole in.
    expect(forkMountainRiseAt(caveMouthFraction())).toBeCloseTo(
      FORK_MOUNTAIN.mouthRise,
      4,
    );
    for (const d of [entryDistance, exitDistance]) {
      const p = segmentCenterline("cave", d);
      expect(forkMountainRiseWorld(p.x, p.z)).toBeCloseTo(FORK_MOUNTAIN.mouthRise, 0);
    }
  });
});

// THE BIG LAKE (slope-mech, 2026-07-26). The body is a world disc rather than a band
// down the route, because ice has to be LEVEL and the trail is only level across the
// flat. These pin the two things that make it read as a lake at all: it is ~15× the
// old ribbon, and the crossing is actually ON it.
describe("slopePath — the frozen lake as a BODY", () => {
  it("is about 15× the ice it replaced (the director's sizing)", () => {
    const area = Math.PI * FROZEN_LAKE.radius ** 2;
    // The old sheet was the lane ribbon: ~64 long × 26 wide ≈ 1.7k square units.
    const oldArea = 64 * 26;
    expect(area / oldArea).toBeGreaterThan(13);
    expect(area / oldArea).toBeLessThan(18);
    // …and it is a BODY, not a corridor: wider than the dressed ribbon is wide.
    expect(FROZEN_LAKE.radius * 2).toBeGreaterThan(150);
  });

  it("carries the lane out onto the ice, with a shoreline at each end of the flat", () => {
    // The crossing has to BE on the lake, not beside it. The flat spans route 312–415
    // (GRADE_PROFILE); across its middle the lane is fully out on the ice — ice on both
    // sides of you — and at the two ends the lane runs along the shore with ice only on
    // the lake side. That asymmetry IS the corner clip the map draws, so it's asserted
    // rather than tuned away: making the disc big enough to swallow the lane end to end
    // would push it past the director's 15×.
    for (let d = 325; d <= 405; d += 5) {
      const band = lakeIceExtent(d);
      expect(band).not.toBeNull();
      expect(band!.latMin).toBeLessThan(-LATERAL_LIMIT); // out on the lake
      expect(band!.latMax).toBeGreaterThan(LATERAL_LIMIT);
    }
    for (const d of [314, 413]) {
      const band = lakeIceExtent(d);
      expect(band).not.toBeNull(); // still on the body…
      expect(band!.latMax).toBeGreaterThan(LATERAL_LIMIT); // …ice out to the right…
      expect(band!.latMin).toBeGreaterThan(-LATERAL_LIMIT); // …shore on the left.
    }
    // The body reaches far out to ONE side (the drawn map's side) rather than being a
    // symmetric widening of the corridor — that's what "spread out in front of you" is.
    // …reaching far past the dressed ribbon's ±46 edge, which is what makes it read
    // as an expanse rather than a wide bit of trail.
    const mid = lakeIceExtent(FROZEN_LAKE.routeCenter)!;
    expect(mid.latMax).toBeGreaterThan(135);
    expect(mid.latMax - mid.latMin).toBeGreaterThan(150);
    // Lopsided toward the drawn map's side: much more lake on the right than the left.
    expect(mid.latMax).toBeGreaterThan(Math.abs(mid.latMin) * 3);
  });

  it("is level, and ends where the ground starts falling away again", () => {
    // One height for the whole sheet — the flat's height. If the flat ever stops being
    // flat, the ice would tilt, which is the bug that started the shaping pass.
    for (const d of [315, 350, 380, 412]) {
      expect(routeHeightAt(d)).toBeCloseTo(lakeIceHeight(), 6);
    }
    // Off the body entirely, well up in the forest and well down the approach.
    expect(lakeIceExtent(200)).toBeNull();
    expect(lakeIceExtent(520)).toBeNull();
  });

  it("does not report a lake band where the wrap brings the trail back past it", () => {
    // The bug this guards (slope-mech, 2026-07-26): Fork 3's outside branch turns ~172°,
    // so the INFINITE lateral line through the trail re-crosses the lake disc from the
    // far side of the map. The extent came back non-null right across the wrap and the
    // cliff, the terrain builder opened the bank onto that phantom lake, and the flank
    // got blended up to the lake's height — ~120 units above the ground there. It
    // rendered as a white wall out of the mountainside. Nothing past the lake's own
    // shore may report a band.
    //
    // The first stretch of the approach (to ~480) legitimately still runs beside the
    // body's lower shore — the disc's edge really is a few tens of units to the right
    // there — so the sweep starts past it. Everything from the fork onward must be null.
    for (let d = 500; d <= 920; d += 5) {
      expect(lakeIceExtent(d)).toBeNull();
    }
  });
});

describe("slopePath — the trail is ONE surface (no seam at the segment joins)", () => {
  const STEP = 5;
  const RUNOUT = 180;
  const LATS = [-46, -12, 0, 12, 46];

  it("hands the two sides of every join the exact same cross-section", () => {
    // This is what makes the weld legal: where one segment ends and the next
    // begins, the sampled ring of vertices is identical, so emitting it ONCE
    // moves nothing. If a future placement change breaks this, the merged
    // surface would tear — fail here rather than on screen.
    for (let i = 0; i + 1 < SINGLE_TRAIL.length; i++) {
      const above = SINGLE_TRAIL[i]!;
      const below = SINGLE_TRAIL[i + 1]!;
      const end = BRANCH_SEGMENTS[above]!.length;
      expect(segmentCenterline(above, end).y).toBeCloseTo(
        segmentCenterline(below, 0).y,
        6,
      );
      for (const lat of LATS) {
        const a = segmentToWorld(above, end, lat);
        const b = segmentToWorld(below, 0, lat);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0, 6);
      }
    }
  });

  it("emits each join row once — one continuous ladder summit to runout", () => {
    const rows = trailRows(STEP, RUNOUT);
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    expect(first.segmentId).toBe(SINGLE_TRAIL[0]);
    expect(first.distance).toBe(0);
    // The terminal carries the runout past the flag (no finish line yet).
    expect(last.segmentId).toBe(SINGLE_TRAIL[SINGLE_TRAIL.length - 1]);
    expect(last.distance).toBeCloseTo(
      BRANCH_SEGMENTS[SINGLE_TRAIL[SINGLE_TRAIL.length - 1]!]!.length + RUNOUT,
      6,
    );

    // No segment starts with a duplicate of the row above it: a segment change
    // between consecutive rows must step DOWN the trail, never repeat in place.
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const row = rows[i]!;
      if (row.segmentId === prev.segmentId) {
        expect(row.distance).toBeGreaterThan(prev.distance);
      } else {
        expect(row.distance).toBeGreaterThan(0);
      }
    }
  });

  it("keeps rows evenly spaced through the joins (no stretched cell)", () => {
    const rows = trailRows(STEP, RUNOUT);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!;
      const b = rows[i]!;
      const pa = segmentCenterline(a.segmentId, a.distance);
      const pb = segmentCenterline(b.segmentId, b.distance);
      const gap = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(STEP * 1.2);
    }
  });

  it("covers the whole played trail, and grows with it", () => {
    const rows = trailRows(STEP, RUNOUT);
    const covered = new Set(rows.map((r) => r.segmentId));
    for (const id of SINGLE_TRAIL) expect(covered.has(id)).toBe(true);
    const trailLength = SINGLE_TRAIL.reduce(
      (sum, id) => sum + BRANCH_SEGMENTS[id]!.length,
      0,
    );
    // One row per STEP down the trail + the runout, minus the shared join rows.
    expect(rows.length).toBeCloseTo((trailLength + RUNOUT) / STEP + 1, 0);
  });
});

// ---------------------------------------------------------------------------
// NO OFF-RIBBON SURFACE MAY HAVE AN EDGE INSIDE THE LANE (slope-mech, 2026-07-26).
//
// Nothing collides with terrain here — the sim rides a 1-D height profile and every
// terrain mesh is decoration hung near it — so a surface with a rim cutting up through
// the ground you ride is a WALL YOU SKI THROUGH. The lake's shore lip was exactly that
// for a day: 12.6 units proud of the lane at the ice's uphill shore, and the level body
// itself 27.8 units above the lane on the way out. Both would have failed this sweep on
// the day they landed.
//
// That is the point of writing it down: the mountain's footprint was already solved
// against every lane (FORK_MOUNTAIN.laneClearance) and the basin was solved against
// nothing. This closes the gap for every off-ribbon surface, present and future.
//
// WHY CROSSING AND NOT HEIGHT. The obvious test — "nothing within N units above the
// lane" — cannot work: the lip stood 12.6 up and the cave's ceiling comes down to 19.7
// at the tunnel's low shoulder, so every N that catches the wall also condemns the
// ceiling. Tuning N between them would be fitting the test to the failures. What
// actually separates a wall from a roof is whether the surface crosses the ground you
// ride, so that is what gets asserted.
//
// SCOPE — the RIDDEN lane (±LATERAL_LIMIT), which is what "you ski through it" means;
// the sim clamps you there. The FIX ducks across the whole dressed ribbon, so the walls
// beside the lane go too; only the assertion is narrower. Judging the dressed ribbon
// fairly needs the corridor's own banks (skiRender's `crossY`) extracted alongside
// these surfaces — parked in IDEAS.md.
describe("no off-ribbon surface has an edge inside the lane", () => {
  const samples = playedCorridorSamples(4, 200);

  /**
   * Walk every playable lane. At each step, measure the surface across the lane's full
   * width against the height ridden there, and report the worst place the surface is
   * proud on one side of the cross-section while at or below it on another — the
   * signature of a rim cutting through the lane.
   */
  function worstEdge(surface: (x: number, z: number) => number | null): {
    step: number;
    where: string;
  } {
    let step = 0;
    let where = "nowhere";
    for (const id of [...SINGLE_TRAIL, "cave"]) {
      const seg = BRANCH_SEGMENTS[id];
      if (!seg) continue;
      for (let d = 0; d <= seg.length; d += 2) {
        const y = segmentCenterline(id, d).y; // the lane is flat across its width
        let highest = -Infinity;
        let lowest = Infinity;
        for (let lat = -LATERAL_LIMIT; lat <= LATERAL_LIMIT; lat += 2) {
          const w = segmentToWorld(id, d, lat);
          // Where a cave mouth is cut out of the mass there IS no surface, so the
          // analytic dome must not be read as one — that hole is the entrance.
          if (insideCaveDoorway(w.x, w.z, forkMountainRiseWorld(w.x, w.z))) continue;
          const h = surface(w.x, w.z);
          if (h === null) continue;
          highest = Math.max(highest, h - y);
          lowest = Math.min(lowest, h - y);
        }
        // A rim in the lane: proud on one side, buried on the other. A surface entirely
        // below is buried; one entirely above is a roof.
        if (lowest <= 0 && highest > step) {
          step = highest;
          where = `${id} d=${d}`;
        }
      }
    }
    return { step, where };
  }

  it("the frozen lake's basin never walls off the trail that crosses it", () => {
    const r = worstEdge((x, z) => frozenLakeBasinHeight(x, z, samples));
    expect(r.step, `basin rim cuts the lane at ${r.where}`).toBeLessThan(WALL_STEP);
  });

  it("the fork mountain's mass never walls off a lane", () => {
    const r = worstEdge((x, z) => {
      // Outside the footprint the dome has no surface — `forkMountainShellHeight`
      // there is just the (smoothed) ground, not a mesh. Reading it as a surface makes
      // the sweep measure the smoothing itself: the estimate wanders a couple of units
      // across a lane's width, which looked like a 1.9-unit rim on the cliff run-in
      // where in fact the mass's foot is 18 units clear of it (asserted separately, via
      // FORK_MOUNTAIN.laneClearance). So: no rise, no surface.
      if (forkMountainRiseWorld(x, z) <= 0) return null;
      return forkMountainShellHeight(x, z, samples);
    });
    expect(r.step, `mass rim cuts the lane at ${r.where}`).toBeLessThan(WALL_STEP);
  });

  it("still roofs the cave — the shell is the tunnel's ceiling", () => {
    // The double-sided shell is what gives the tunnel a roof. If a reshaping ever
    // lifted the mass off the corridor, or the doorway cut ate the whole span, the
    // tunnel would silently open to the sky and only this line would notice.
    const { entryDistance, exitDistance } = cavePortals();
    let tightest = Infinity;
    for (let d = entryDistance + 10; d <= exitDistance - 10; d += 2) {
      const c = segmentCenterline("cave", d);
      for (let lat = -LATERAL_LIMIT; lat <= LATERAL_LIMIT; lat += 2) {
        const w = segmentToWorld("cave", d, lat);
        tightest = Math.min(tightest, forkMountainShellHeight(w.x, w.z, samples) - c.y);
      }
    }
    expect(tightest).toBeGreaterThan(10); // real rock overhead, everywhere inside
    expect(tightest).toBeLessThan(200); // a roof, not the sky
  });
});
