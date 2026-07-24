import { describe, expect, it } from "vitest";
import { routeDistanceOf, TOTAL_ROUTE_LENGTH } from "@toebeans/shared";
import {
  buildCenterline,
  centerlineAt,
  centerlineToWorld,
  segmentCenterline,
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
  // Height is derived from the constant grade × the route's remaining distance
  // (see SEGMENT_GRADE / segmentGroundY). We don't hardcode the grade constant:
  // the summit-entrance height IS grade × TOTAL, so every other height is that
  // scaled by (TOTAL − routeDistance)/TOTAL — which pins the whole formula from
  // one measured value and stays honest if the grade is retuned.
  const summitY = segmentCenterline("summit", 0).y;
  const expectedY = (segmentId: string, distance: number): number =>
    (summitY * (TOTAL_ROUTE_LENGTH - routeDistanceOf(segmentId, distance))) /
    TOTAL_ROUTE_LENGTH;

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

  it("matches the height formula on every segment (same clock → same height)", () => {
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
      expect(segmentCenterline(id, distance).y).toBeCloseTo(expectedY(id, distance), 6);
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
