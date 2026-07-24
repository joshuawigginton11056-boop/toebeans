import { describe, expect, it } from "vitest";
import {
  gradeSpeedFactor,
  REFERENCE_GRADE,
  routeGradeAt,
  routeHeightAt,
  TOTAL_ROUTE_LENGTH,
} from "./route";

describe("route — the descent's grade profile (steepness → speed)", () => {
  it("varies the grade: steep summit + lower pitch, mellow forest/lake", () => {
    const summit = routeGradeAt(0);
    const forest = routeGradeAt(230); // the mellow forest/lake zone
    const lower = routeGradeAt(560); // the steep lower pitch
    expect(summit).toBeGreaterThan(forest + 0.1);
    expect(lower).toBeGreaterThan(forest + 0.1);
    // Every zone stays under the camera's ~27° framing (tan ≈ 0.51) and above a
    // gentle floor — the grade is always a real, look-down descent.
    for (const d of [0, 120, 230, 340, 460, 560, 640]) {
      expect(routeGradeAt(d)).toBeLessThan(0.51);
      expect(routeGradeAt(d)).toBeGreaterThan(0.15);
    }
  });

  it("clamps out-of-range route distances to the ends", () => {
    expect(routeGradeAt(-50)).toBe(routeGradeAt(0));
    expect(routeGradeAt(9999)).toBe(routeGradeAt(TOTAL_ROUTE_LENGTH));
  });

  it("drops the height monotonically to exactly 0 at the flag", () => {
    expect(routeHeightAt(TOTAL_ROUTE_LENGTH)).toBeCloseTo(0, 9);
    expect(routeHeightAt(0)).toBeGreaterThan(0);
    let prev = routeHeightAt(0);
    for (let d = 10; d <= TOTAL_ROUTE_LENGTH; d += 10) {
      const h = routeHeightAt(d);
      expect(h).toBeLessThan(prev);
      prev = h;
    }
  });

  it("integrates the grade into the height (dH/dD ≈ −grade)", () => {
    // A central difference of the height table recovers the local grade — proof
    // the height IS the integral of the grade profile.
    for (const d of [60, 200, 400, 500, 600]) {
      const slope = (routeHeightAt(d - 1) - routeHeightAt(d + 1)) / 2;
      expect(slope).toBeCloseTo(routeGradeAt(d), 2);
    }
  });

  it("keeps the total drop near the old constant-grade ~224 (the run's scale)", () => {
    expect(routeHeightAt(0)).toBeGreaterThan(190);
    expect(routeHeightAt(0)).toBeLessThan(240);
  });

  describe("gradeSpeedFactor", () => {
    it("is exactly 1.0 (a no-op) off the branching map — the flat Overlook", () => {
      expect(gradeSpeedFactor("main", 0)).toBe(1);
      expect(gradeSpeedFactor("main", 400)).toBe(1);
    });

    it("is the local grade over the reference — >1 steep, <1 mellow", () => {
      // Summit is steep → faster than reference; the forest/lake is mellow → slower.
      expect(gradeSpeedFactor("summit", 0)).toBeGreaterThan(1);
      expect(gradeSpeedFactor("lake", 30)).toBeLessThan(1); // route ~270, mellow
      expect(gradeSpeedFactor("summit", 0)).toBeCloseTo(
        routeGradeAt(0) / REFERENCE_GRADE,
        9,
      );
    });
  });
});
