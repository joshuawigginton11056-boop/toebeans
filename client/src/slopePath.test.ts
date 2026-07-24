import { describe, expect, it } from "vitest";
import {
  BRANCH_SEGMENTS,
  LATERAL_LIMIT,
  routeDistanceOf,
  routeHeightAt,
} from "@toebeans/shared";
import {
  buildCenterline,
  centerlineAt,
  centerlineToWorld,
  segmentCenterline,
  segmentToWorld,
  slopeCenterline,
  slopeToWorld,
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
    expect(segmentCenterline("cliff", 100).y).toBeCloseTo(0, 6);
    expect(segmentCenterline("ice-castle", 80).y).toBeCloseTo(0, 6);
    // The total drop is the summit's height — every route falls the same amount.
    expect(summitY - segmentCenterline("cliff", 100).y).toBeCloseTo(summitY, 6);
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
      ["yeti", 40],
      ["cave", 0],
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
    // Cave and Water both deliver you to the shared cliff at route offset 540:
    // the ends of cave and water, and the cliff's entrance, are all one height.
    const cliffEntranceY = segmentCenterline("cliff", 0).y;
    expect(segmentCenterline("cave", 120).y).toBeCloseTo(cliffEntranceY, 6);
    expect(segmentCenterline("water", 200).y).toBeCloseTo(cliffEntranceY, 6);
    // The Type A forest fork: road and tree both feed the lake at the same height.
    expect(segmentCenterline("forest-road", 120).y).toBeCloseTo(
      segmentCenterline("forest-tree", 120).y,
      6,
    );
    expect(segmentCenterline("lake", 0).y).toBeCloseTo(
      segmentCenterline("forest-road", 120).y,
      6,
    );
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
    const h0 = segmentCenterline("lake", 0).heading;
    const h1 = segmentCenterline("lake", lengthOf("lake")).heading;
    expect(Math.abs(h1 - h0)).toBeGreaterThan(0.1);
  });

  it("the single played trail is ONE smooth continuous line — no seam kink, no drift (2026-07-24 redirect)", () => {
    // The redirect (IDEAS.md START HERE): the played run rides one continuous-
    // curvature line summit → the back of the forest, not the old per-segment
    // constant-curvature arcs whose curvature SIGN FLIPPED at the seam (the "jerky"
    // path). Sample the trail continuously across the summit→forest-road seam and
    // pin THREE things the old arcs couldn't all give at once.
    const trail = ["summit", "forest-road"];
    const trailLen = trail.reduce((s, id) => s + lengthOf(id), 0); // 240

    // A helper: the world point at a ROUTE distance down the trail (which segment,
    // which local distance), so we can sample right across the internal seam.
    const at = (routeD: number) => {
      const id = routeD < lengthOf("summit") ? "summit" : "forest-road";
      const local = id === "summit" ? routeD : routeD - lengthOf("summit");
      return segmentCenterline(id, local);
    };

    // 1) Position + heading continuous at the seam: summit's END and forest-road's
    // START are the same route distance (120), so both sample the one line at the
    // same point — identical world position and heading, no gap, no dogleg.
    const summitEnd = segmentCenterline("summit", lengthOf("summit"));
    const forestStart = segmentCenterline("forest-road", 0);
    expect(forestStart.x).toBeCloseTo(summitEnd.x, 6);
    expect(forestStart.z).toBeCloseTo(summitEnd.z, 6);
    expect(forestStart.heading).toBeCloseTo(summitEnd.heading, 6);

    // 2) CURVATURE continuous everywhere — the real no-kink fix. The old arcs jumped
    // curvature from summit's −0.002 to forest-road's +0.002 (a ~0.004 rad/unit
    // step) at the seam; the smooth line's curvature never jumps. Second difference
    // of heading between adjacent unit steps stays tiny across the whole trail.
    let maxCurvatureJump = 0;
    let prevK = 0;
    for (let d = 1; d <= trailLen; d++) {
      const k = at(d).heading - at(d - 1).heading; // curvature over this unit step
      if (d > 1) maxCurvatureJump = Math.max(maxCurvatureJump, Math.abs(k - prevK));
      prevK = k;
    }
    expect(maxCurvatureJump).toBeLessThan(1e-3);

    // 3) No net drift: heading AND lateral come back to ~0 at the back of the forest
    // (∫ heading over the full sine period is 0), so the run tracks the fall line —
    // the old forest drift-right is gone. The peak excursion mid-trail stays gentle.
    const end = at(trailLen);
    expect(end.heading).toBeCloseTo(0, 3);
    expect(Math.abs(end.x)).toBeLessThan(0.5);
    let peakLateral = 0;
    for (let d = 0; d <= trailLen; d++) peakLateral = Math.max(peakLateral, Math.abs(at(d).x));
    expect(peakLateral).toBeGreaterThan(2); // a real, visible curve (not dead straight)
    expect(peakLateral).toBeLessThan(LATERAL_LIMIT); // …but stays a gentle lean
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
