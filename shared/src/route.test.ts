import { describe, expect, it } from "vitest";
import {
  BRANCH_SEGMENTS,
  gradeSpeedFactor,
  REFERENCE_GRADE,
  routeGradeAt,
  routeHeightAt,
  TOTAL_ROUTE_LENGTH,
} from "./route";

describe("route — the descent's grade profile (steepness → speed)", () => {
  it("gives the forest character by ROLLING, not by going mellow (its mean stays summit-fast)", () => {
    const summit = routeGradeAt(40);
    const meanOver = (from: number, to: number) => {
      let sum = 0;
      for (let d = from; d <= to; d++) sum += routeGradeAt(d);
      return sum / (to - from + 1);
    };
    // Shape-the-mountain (slope-mech, 2026-07-25). The forest has to read as its own
    // place without becoming a slow zone — speed IS grade here, and a mellower forest
    // was rejected three separate times ("my speed still feels extremely slow through
    // the forest"). So its character is UNDULATION: the grade rolls crest-to-hollow
    // while its MEAN stays right at the summit's pitch.
    const forestMean = meanOver(100, 290);
    expect(forestMean).toBeGreaterThan(REFERENCE_GRADE + 0.1); // decidedly fast on average
    expect(summit - forestMean).toBeLessThan(0.06); // no slow-zone step into the trees
    // …and it genuinely rolls, rather than being a straight ramp at that mean.
    let crest = 0;
    let hollow = 1;
    for (let d = 100; d <= 290; d++) {
      crest = Math.max(crest, routeGradeAt(d));
      hollow = Math.min(hollow, routeGradeAt(d));
    }
    expect(crest - hollow).toBeGreaterThan(0.08); // real relief, not a flat plateau
    // Every PITCHED zone stays under the camera's ~27° framing (tan ≈ 0.51) and above
    // a gentle floor. The lake is deliberately excluded: it is the one flat area.
    for (const d of [0, 120, 230, 260, 400, 470, 560, 640]) {
      expect(routeGradeAt(d)).toBeLessThan(0.51);
      expect(routeGradeAt(d)).toBeGreaterThan(0.15);
    }
  });

  it("makes the frozen lake actually flat — and keeps it fast anyway (the ice glide)", () => {
    // The callout that started the shaping pass (director, 2026-07-25): "you
    // currently have the frozen lake on the downhill slope." It doesn't any more.
    for (let d = 315; d <= 355; d += 5) {
      expect(routeGradeAt(d)).toBe(0);
    }
    // Flat ground would normally mean a hard speed shed, because the coupling reads
    // grade. On the lake it doesn't: the factor is the one you arrived with, bleeding
    // off gently, so you glide across instead of slamming into a crawl.
    const arriving = gradeSpeedFactor("forest-road", BRANCH_SEGMENTS["forest-road"]!.length);
    const onIce = gradeSpeedFactor("lake", 0);
    const leavingIce = gradeSpeedFactor("lake", BRANCH_SEGMENTS["lake"]!.length);
    expect(onIce).toBeCloseTo(arriving, 6); // you enter the ice at the pace you hit it
    expect(leavingIce).toBeLessThan(onIce); // …and the ice does scrub some off…
    expect(leavingIce).toBeGreaterThan(onIce * 0.75); // …but nowhere near a stop.
    // The point of the whole mechanism: the flat lake is still faster than the
    // reference pitch, so it never becomes the run's slow zone.
    expect(leavingIce).toBeGreaterThan(1);
  });

  it("has no grade 'wall' at the forest mouth — you arrive already gliding (2026-07-24)", () => {
    // The original bug (director look-pass): the summit→forest speed shed slammed in
    // at the forest entrance and read as "slamming the brakes." The forest now ROLLS
    // rather than stepping down, so the assertion is no longer "the grade barely
    // moves here" (it moves — that's the rolling) but the thing that actually
    // mattered: crossing the treeline costs you no NET pitch.
    const mouth = 100;
    const justAbove = routeGradeAt(mouth - 20);
    const justBelow = routeGradeAt(mouth + 20);
    expect(justBelow).toBeGreaterThan(justAbove - 0.03); // no step DOWN at the mouth
    // And the mouth is not where the run's steepest change lives — a roll's slope is
    // gentler than the drop onto the lake shore, which is the one place the mountain
    // is meant to hand off hard.
    const mouthChange = Math.abs(routeGradeAt(mouth - 20) - routeGradeAt(mouth + 20));
    const shoreChange = Math.abs(routeGradeAt(295) - routeGradeAt(315));
    expect(mouthChange).toBeLessThan(shoreChange);
  });

  it("clamps below the route to the summit; flattens past the flag to a runout", () => {
    expect(routeGradeAt(-50)).toBe(routeGradeAt(0));
    // Past the flag the mountain runs out FLAT — no finish line yet (director
    // 2026-07-24): a terminal segment opens into an open runout you coast off.
    expect(routeGradeAt(TOTAL_ROUTE_LENGTH + 100)).toBe(0);
    expect(routeGradeAt(9999)).toBe(0);
  });

  it("never climbs, and reaches exactly 0 at the flag (flat on the lake, falling everywhere else)", () => {
    expect(routeHeightAt(TOTAL_ROUTE_LENGTH)).toBeCloseTo(0, 9);
    expect(routeHeightAt(0)).toBeGreaterThan(0);
    // Was strictly monotonic; since the lake was flattened (2026-07-25) the height
    // holds LEVEL across the ice, which is the whole point of it. It must still never
    // rise — there is no uphill skiing in this sim, and a climb would be a real bug.
    let prev = routeHeightAt(0);
    for (let d = 10; d <= TOTAL_ROUTE_LENGTH; d += 10) {
      const h = routeHeightAt(d);
      expect(h).toBeLessThanOrEqual(prev);
      prev = h;
    }
    // The lake is level, not merely gentle: same height at both ends of the ice.
    expect(routeHeightAt(355)).toBeCloseTo(routeHeightAt(315), 6);
    // …and everywhere off the lake it really is descending.
    for (const d of [40, 150, 250, 420, 500, 600]) {
      expect(routeHeightAt(d) - routeHeightAt(d + 20)).toBeGreaterThan(4);
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
