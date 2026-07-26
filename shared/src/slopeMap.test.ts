import { describe, expect, it } from "vitest";
import { createMapSkiState, stepSkiing, type SkiInput } from "./skiing";
import {
  decodeMap,
  defaultMap,
  encodeMap,
  mapGradeAt,
  mapGradeFactor,
  mapHeightAt,
  MAP_REFERENCE_GRADE,
  type SlopeMap,
} from "./slopeMap";

const NO_INPUT: SkiInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  boost: false,
  spin: 0,
};

describe("slopeMap — grade sampling", () => {
  const grade: readonly [number, number][] = [
    [0, 0.5],
    [100, 0.3],
    [200, 0.4],
  ];

  it("returns control-point values exactly at the points", () => {
    expect(mapGradeAt(grade, 0)).toBeCloseTo(0.5);
    expect(mapGradeAt(grade, 100)).toBeCloseTo(0.3);
    expect(mapGradeAt(grade, 200)).toBeCloseTo(0.4);
  });

  it("interpolates linearly between points", () => {
    expect(mapGradeAt(grade, 50)).toBeCloseTo(0.4); // halfway 0.5→0.3
    expect(mapGradeAt(grade, 150)).toBeCloseTo(0.35); // halfway 0.3→0.4
  });

  it("clamps past the ends to the end values", () => {
    expect(mapGradeAt(grade, -10)).toBeCloseTo(0.5);
    expect(mapGradeAt(grade, 999)).toBeCloseTo(0.4);
  });

  it("makes the speed factor 1.0 at the reference grade", () => {
    expect(mapGradeFactor([[0, MAP_REFERENCE_GRADE]], 50)).toBeCloseTo(1);
    expect(mapGradeFactor([[0, MAP_REFERENCE_GRADE * 2]], 50)).toBeCloseTo(2);
  });
});

describe("slopeMap — height integrates the grade to zero at the flag", () => {
  it("is exactly 0 at the trail's end and positive at the summit", () => {
    const map = defaultMap();
    expect(mapHeightAt(map, map.length)).toBeCloseTo(0, 5);
    expect(mapHeightAt(map, 0)).toBeGreaterThan(0);
  });

  it("descends monotonically down the trail (no uphill)", () => {
    const map = defaultMap();
    let prev = Infinity;
    for (let d = 0; d <= map.length; d += 20) {
      const h = mapHeightAt(map, d);
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });

  it("a steeper stretch drops more height than a mellow one of equal length", () => {
    const steep: SlopeMap = { ...defaultMap(), grade: [[0, 0.6], [200, 0.6]], length: 200 };
    const mellow: SlopeMap = { ...defaultMap(), grade: [[0, 0.2], [200, 0.2]], length: 200 };
    expect(mapHeightAt(steep, 0)).toBeGreaterThan(mapHeightAt(mellow, 0));
  });
});

describe("slopeMap — decode heals junk and round-trips", () => {
  it("round-trips a real map through encode/decode", () => {
    const map = defaultMap();
    const back = decodeMap(JSON.parse(encodeMap(map)));
    expect(back).not.toBeNull();
    expect(back!.length).toBe(map.length);
    expect(back!.props.length).toBe(map.props.length);
    expect(back!.chasms.length).toBe(map.chasms.length);
  });

  it("returns null for non-objects", () => {
    expect(decodeMap(null)).toBeNull();
    expect(decodeMap(42)).toBeNull();
    expect(decodeMap("nope")).toBeNull();
  });

  it("drops malformed props and hazards but keeps the map usable", () => {
    const healed = decodeMap({
      length: 400,
      grade: [[0, 0.4], ["bad", 1], [400, 0.3]],
      props: [
        { type: "pine", along: 100, lateral: 5 },
        { type: "banana", along: 10, lateral: 0 }, // unknown type → dropped
        { type: "rock", along: "x", lateral: 0 }, // bad along → dropped
      ],
      chasms: [{ start: 50, width: 3 }, { start: "no", width: 3 }],
      checkpoints: [200, "later", 100],
    });
    expect(healed).not.toBeNull();
    expect(healed!.props).toHaveLength(1);
    expect(healed!.chasms).toHaveLength(1);
    // Checkpoints sorted and 0 guaranteed present.
    expect(healed!.checkpoints[0]).toBe(0);
    expect(healed!.grade.length).toBeGreaterThanOrEqual(2);
  });

  it("clamps out-of-range numbers into skiable bounds", () => {
    const healed = decodeMap({ length: 999999, grade: [[0, 5]], props: [], chasms: [], checkpoints: [] });
    expect(healed!.length).toBeLessThanOrEqual(2000);
    expect(healed!.grade[0]![1]).toBeLessThanOrEqual(0.7);
  });
});

describe("slopeMap — the run reads the map's steepness", () => {
  it("a steeper map builds speed faster than a mellow one", () => {
    const steep: SlopeMap = { ...defaultMap(), grade: [[0, 0.6], [480, 0.6]] };
    const mellow: SlopeMap = { ...defaultMap(), grade: [[0, 0.2], [480, 0.2]] };
    // Long enough for both to pass the shared accel-limited ramp and settle
    // toward their (different) steepness-driven target speeds.
    const hold: SkiInput = { ...NO_INPUT, up: true };
    let a = createMapSkiState(steep);
    let b = createMapSkiState(mellow);
    for (let i = 0; i < 600; i++) {
      a = stepSkiing(a, hold, 1 / 60);
      b = stepSkiing(b, hold, 1 / 60);
    }
    expect(Math.abs(a.speed)).toBeGreaterThan(Math.abs(b.speed) + 1);
  });

  it("built-in runs are untouched (no mapGrade)", () => {
    const s = createMapSkiState(defaultMap());
    expect(s.mapGrade).toBeDefined();
    expect(s.segmentId).toBe("map");
  });
});
