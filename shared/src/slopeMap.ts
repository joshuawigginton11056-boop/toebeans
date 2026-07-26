// (map-editor) The director-authored map format — "the actual map" as editable,
// serializable DATA instead of hardcoded code constants (route.ts + slopePath.ts).
//
// The ski slope has always been data-SHAPED (the sim runs off SkiState.chasms /
// .checkpoints / .finishDistance and reads steepness via a grade profile) — it just
// wasn't data-DRIVEN: those authoring inputs lived as consts in route.ts. A SlopeMap
// is exactly those inputs pulled out into an object the map editor writes and the run
// reads, so a director can shape a slope and ski it. Pure data + pure helpers,
// mirroring route.ts's role for the branching map (grade → height by integration).
//
// Type-only import from ./skiing (Chasm) keeps this a leaf, exactly like route.ts:
// skiing.ts imports mapGradeFactor from here at runtime, never the reverse.

import type { Chasm } from "./skiing";

/** The kinds of asset the editor can drop (slice 1). Grows in later slices. */
export type PropType = "pine" | "rock";

/** A placed asset: its kind and where it sits — `along` is distance down the
 * trail (0 = summit), `lateral` is across it (+ = skier's right, 0 = centerline). */
export interface MapProp {
  readonly type: PropType;
  readonly along: number;
  readonly lateral: number;
  /** Optional per-placement size multiplier (defaults to 1). */
  readonly scale?: number;
}

/**
 * One director-authored slope. Everything the sim and renderer need to run and
 * draw a bespoke run, as plain JSON-serializable data:
 * - `length` — total trail length, in the same units as the sim's `distance`.
 * - `grade` — steepness control points `[alongDistance, tanGrade]`, linearly
 *   interpolated into a continuous grade (exactly the shape of route.ts's
 *   GRADE_PROFILE). This is the editable terrain steepness: the run's world-Y is
 *   this integrated (mapHeightAt), and the sim scales speed by it (steeper ⇒
 *   faster), so sculpting a stretch steeper both looks and skis steeper.
 * - `props` — placed assets (trees/rocks).
 * - `chasms` / `checkpoints` — the run's hazards + respawns, reusing the sim's
 *   own types, in trail distance.
 */
export interface SlopeMap {
  readonly version: number;
  readonly name: string;
  readonly length: number;
  readonly grade: readonly (readonly [number, number])[];
  readonly props: readonly MapProp[];
  readonly chasms: readonly Chasm[];
  readonly checkpoints: readonly number[];
}

export const MAP_VERSION = 1;

// Mirrors route.ts's REFERENCE_GRADE (the director-locked "invigorating" ~19°,
// tan 0.35): the speed coupling is a no-op at this grade, so an average-pitch map
// skis at the tuned baseline and only the steep/mellow stretches push speed
// up/down — same feel contract as the branching map. Kept as a local copy (a
// shared design constant) so this module stays a clean leaf.
export const MAP_REFERENCE_GRADE = 0.35;

// Bounds the editor and the healer keep maps sane — a slope you can actually ski.
export const MIN_MAP_LENGTH = 120;
export const MAX_MAP_LENGTH = 2000;
export const MIN_GRADE = 0.05;
export const MAX_GRADE = 0.7;
export const MAX_LATERAL = 44; // props may sit out on the snowbanks, not just the lane

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** A gentle starter slope so the editor opens on something skiable, not a blank
 * void — a mellow-to-mid descent with a couple of trees, a rock, and one
 * jump+checkpoint that already exercises the whole edit→play pipeline. */
export function defaultMap(): SlopeMap {
  return {
    version: MAP_VERSION,
    name: "My Slope",
    length: 480,
    grade: [
      [0, 0.42],
      [180, 0.4],
      [340, 0.38],
      [480, 0.34],
    ],
    props: [
      { type: "pine", along: 90, lateral: -16 },
      { type: "pine", along: 140, lateral: 18 },
      { type: "pine", along: 300, lateral: -20 },
      { type: "rock", along: 220, lateral: 9 },
    ],
    chasms: [{ id: "gap-1", start: 260, width: 3.5 }],
    checkpoints: [0, 250],
  };
}

/** The local grade (tan of the downhill pitch) a given distance down the trail —
 * the grade control points, linearly interpolated and clamped to the trail. */
export function mapGradeAt(
  grade: readonly (readonly [number, number])[],
  along: number,
): number {
  if (grade.length === 0) return MAP_REFERENCE_GRADE;
  const first = grade[0]!;
  if (along <= first[0]) return first[1];
  for (let i = 1; i < grade.length; i++) {
    const [d0, g0] = grade[i - 1]!;
    const [d1, g1] = grade[i]!;
    if (along <= d1) {
      const t = d1 === d0 ? 0 : (along - d0) / (d1 - d0);
      return g0 + (g1 - g0) * t;
    }
  }
  return grade[grade.length - 1]![1];
}

/** Height above the trail's end (the flag) at a distance down the trail — the
 * grade integrated from the end upward, so the end is exactly 0 and the summit
 * is the full drop. Same trapezoid approach as route.ts's HEIGHT_TABLE, computed
 * on the fly (maps are short and this is called per terrain row, not per frame). */
export function mapHeightAt(map: SlopeMap, along: number): number {
  const d = clamp(along, 0, map.length);
  // Integrate grade from d up to length (height above the end).
  const step = 4;
  let h = 0;
  for (let s = map.length; s > d; s -= step) {
    const a = Math.max(d, s - step);
    const avg = (mapGradeAt(map.grade, a) + mapGradeAt(map.grade, s)) / 2;
    h += avg * (s - a);
  }
  return h;
}

/** The speed multiplier from local steepness — the grade relative to the
 * reference, so it's 1.0 (a no-op) at the reference pitch, >1 on the steeps
 * (faster) and <1 on the mellow stretches, exactly like route.ts's
 * gradeSpeedFactor. The sim (skiing.ts) reads this for a map run. */
export function mapGradeFactor(
  grade: readonly (readonly [number, number])[],
  along: number,
): number {
  return mapGradeAt(grade, along) / MAP_REFERENCE_GRADE;
}

// ── Serialization (self-healing, like save.ts) ──────────────────────────────

export function encodeMap(map: SlopeMap): string {
  return JSON.stringify(map);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Parse an unknown blob into a valid SlopeMap, healing what it can and dropping
 * what it can't (bad props/hazards are skipped; out-of-range numbers clamped).
 * Returns null only when the blob isn't a usable object at all — callers fall
 * back to defaultMap(). Keeps a corrupt or old-shaped save from ever crashing
 * the editor, same spirit as save.ts's strict-but-forgiving decode. */
export function decodeMap(raw: unknown): SlopeMap | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const length = isFiniteNumber(r.length)
    ? clamp(r.length, MIN_MAP_LENGTH, MAX_MAP_LENGTH)
    : defaultMap().length;

  const grade: [number, number][] = [];
  if (Array.isArray(r.grade)) {
    for (const pt of r.grade) {
      if (
        Array.isArray(pt) &&
        isFiniteNumber(pt[0]) &&
        isFiniteNumber(pt[1])
      ) {
        grade.push([clamp(pt[0], 0, length), clamp(pt[1], MIN_GRADE, MAX_GRADE)]);
      }
    }
  }
  grade.sort((a, b) => a[0] - b[0]);
  if (grade.length === 0) grade.push([0, MAP_REFERENCE_GRADE]);

  const props: MapProp[] = [];
  if (Array.isArray(r.props)) {
    for (const p of r.props) {
      if (typeof p !== "object" || p === null) continue;
      const pp = p as Record<string, unknown>;
      if (pp.type !== "pine" && pp.type !== "rock") continue;
      if (!isFiniteNumber(pp.along) || !isFiniteNumber(pp.lateral)) continue;
      props.push({
        type: pp.type,
        along: clamp(pp.along, 0, length),
        lateral: clamp(pp.lateral, -MAX_LATERAL, MAX_LATERAL),
        ...(isFiniteNumber(pp.scale) ? { scale: clamp(pp.scale, 0.3, 3) } : {}),
      });
    }
  }

  const chasms: Chasm[] = [];
  if (Array.isArray(r.chasms)) {
    for (const c of r.chasms) {
      if (typeof c !== "object" || c === null) continue;
      const cc = c as Record<string, unknown>;
      if (!isFiniteNumber(cc.start) || !isFiniteNumber(cc.width)) continue;
      chasms.push({
        id: typeof cc.id === "string" ? cc.id : `gap-${chasms.length}`,
        start: clamp(cc.start, 0, length),
        width: clamp(cc.width, 1, 12),
      });
    }
  }

  const checkpoints: number[] = [];
  if (Array.isArray(r.checkpoints)) {
    for (const cp of r.checkpoints) {
      if (isFiniteNumber(cp)) checkpoints.push(clamp(cp, 0, length));
    }
  }
  checkpoints.sort((a, b) => a - b);
  if (!checkpoints.includes(0)) checkpoints.unshift(0);

  return {
    version: isFiniteNumber(r.version) ? r.version : MAP_VERSION,
    name: typeof r.name === "string" ? r.name.slice(0, 60) : defaultMap().name,
    length,
    grade,
    props,
    chasms,
    checkpoints,
  };
}
