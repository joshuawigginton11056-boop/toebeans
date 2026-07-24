import { describe, expect, it } from "vitest";
import {
  buildCenterline,
  centerlineAt,
  centerlineToWorld,
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
