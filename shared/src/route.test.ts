import { describe, expect, it } from "vitest";
import {
  gradeSpeedFactor,
  REFERENCE_GRADE,
  routeGradeAt,
  routeHeightAt,
  TOTAL_ROUTE_LENGTH,
} from "./route";

describe("route — the descent's grade profile (steepness → speed)", () => {
  it("varies the grade: steep summit + lower pitch, faster-than-before forest/lake", () => {
    const summit = routeGradeAt(0);
    const forest = routeGradeAt(230); // the forest/lake glide (a fast stretch since 2026-07-25)
    const lower = routeGradeAt(560); // the steep lower pitch
    // The steeps stay clearly steeper than the forest so "steeper = faster" still reads;
    // the margin relaxed 0.1 → 0.05 when the forest was raised to carry speed through the
    // trees (director look-pass: "extremely slow through the forest") — see route.ts.
    expect(summit).toBeGreaterThan(forest + 0.05);
    expect(lower).toBeGreaterThan(forest + 0.05);
    // Every zone stays under the camera's ~27° framing (tan ≈ 0.51) and above a
    // gentle floor — the grade is always a real, look-down descent.
    for (const d of [0, 120, 230, 340, 460, 560, 640]) {
      expect(routeGradeAt(d)).toBeLessThan(0.51);
      expect(routeGradeAt(d)).toBeGreaterThan(0.15);
    }
  });

  it("eases out into the forest — no grade 'wall' at the forest mouth (slope-mech, 2026-07-24)", () => {
    // The bug fix (director look-pass): the summit→forest speed shed must not slam
    // in at the forest entrance (route 120). The grade sheds its extreme high on the
    // summit and levels onto a gentle leg through the mouth, so around the forest the
    // grade barely moves — no sharp corner, no sustained hard decel there.
    // 1) Across the forest mouth (route 100–200), any 20-unit window is nearly flat.
    for (let d = 100; d <= 180; d += 10) {
      expect(Math.abs(routeGradeAt(d) - routeGradeAt(d + 20))).toBeLessThan(0.03);
    }
    // 2) The mouth-region grade change is far gentler than the upper-summit shed —
    //    the steepest grade CHANGE lives high on the mountain, not at the forest.
    const upperShed = routeGradeAt(0) - routeGradeAt(40); // the steep early leg
    const mouthShed = routeGradeAt(110) - routeGradeAt(150); // across the mouth
    expect(mouthShed).toBeLessThan(upperShed / 2);
  });

  it("clamps below the route to the summit; flattens past the flag to a runout", () => {
    expect(routeGradeAt(-50)).toBe(routeGradeAt(0));
    // Past the flag the mountain runs out FLAT — no finish line yet (director
    // 2026-07-24): a terminal segment opens into an open runout you coast off.
    expect(routeGradeAt(TOTAL_ROUTE_LENGTH + 100)).toBe(0);
    expect(routeGradeAt(9999)).toBe(0);
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

  it("has a taller total drop since the forest was steepened for speed (the run's scale)", () => {
    // The forest-speed round-2 raise (0.33 → 0.42 plateau, 2026-07-25) makes the mountain
    // ~19% taller than the old ~238 — a genuinely steeper forest. Still a bounded scale.
    expect(routeHeightAt(0)).toBeGreaterThan(250);
    expect(routeHeightAt(0)).toBeLessThan(310);
  });

  describe("gradeSpeedFactor", () => {
    it("is exactly 1.0 (a no-op) off the branching map — the flat Overlook", () => {
      expect(gradeSpeedFactor("main", 0)).toBe(1);
      expect(gradeSpeedFactor("main", 400)).toBe(1);
    });

    it("is the local grade over the reference — steeps fastest, forest/lake a fast glide", () => {
      // Summit is steepest → fastest. The forest/lake used to be < 1 (a mellow-slow zone);
      // since the 2026-07-25 forest-speed raise it carries speed (> 1, ~1.2×), but stays
      // clearly below the summit so "steeper = faster" still reads. See route.ts.
      expect(gradeSpeedFactor("summit", 0)).toBeGreaterThan(1);
      expect(gradeSpeedFactor("lake", 30)).toBeGreaterThan(1); // route ~270, a fast glide now
      expect(gradeSpeedFactor("lake", 30)).toBeLessThan(gradeSpeedFactor("summit", 0));
      expect(gradeSpeedFactor("summit", 0)).toBeCloseTo(
        routeGradeAt(0) / REFERENCE_GRADE,
        9,
      );
    });
  });
});
