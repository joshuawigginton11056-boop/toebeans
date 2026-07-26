// (map-editor) The director's map editor — a top-down, 2-D plan-view screen for
// building a slope: drop trees/rocks, place chasms + checkpoints, and shape the
// terrain steepness, then Play it as the real 3-D ski run. Pure view + local
// state: every "run this" / "leave" goes out through a callback (main.ts owns
// what they mean), and the map itself is persisted here via mapStore.
//
// A 2-D plan view (Sims-style bird's-eye, which the vision already calls for)
// keeps slice 1 fast to build and easy to read; the run it produces is the real
// 3-D mountain. Coordinates: the plan is vertical — summit at the top (along 0),
// flag at the bottom (along = length), downhill = down the screen; the horizontal
// axis is lateral (centerline in the middle, skier's right = screen right). The
// bottom strip is the steepness graph (summit → flag, drag the dots).

import {
  defaultMap,
  mapGradeAt,
  MAX_GRADE,
  MAX_LATERAL,
  MAX_MAP_LENGTH,
  MIN_GRADE,
  MIN_MAP_LENGTH,
  type PropType,
  type SlopeMap,
} from "@toebeans/shared";
import { loadMap, saveMap } from "./mapStore";

const SUNLIT_SNOW = "#F8F5EF";
const SNOW_SHADOW = "#D3DFF0";
const BIRCH_AMBER = "#E9A960";
const SLATE_DEEP = "#2E3548";
const PINE_GREEN = "#3E6B54";
const ROCK_GRAY = "#8A93A6";
const SIGNAL_RED = "#C7513B";
const CHECKPOINT_BLUE = "#5B7FB0";

// How far across (lateral) the plan shows each side of the centerline.
const LAT_VIEW = 50;
const LANE_HALF = 12; // matches LATERAL_LIMIT — the skiable lane
const HIT_PX = 16; // pointer pick radius

type Tool = "select" | "pine" | "rock" | "chasm" | "checkpoint" | "erase";

interface WorkingProp {
  type: PropType;
  along: number;
  lateral: number;
}
interface WorkingChasm {
  id: string;
  start: number;
  width: number;
}
interface WorkingMap {
  name: string;
  length: number;
  grade: [number, number][];
  props: WorkingProp[];
  chasms: WorkingChasm[];
  checkpoints: number[];
}

export interface MapEditorCallbacks {
  /** Play the current map as the real 3-D run. */
  onPlay(map: SlopeMap): void;
  /** Leave the editor back to the lobby. */
  onExit(): void;
}

export interface MapEditorHandle {
  setVisible(visible: boolean): void;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const EDITOR_CSS = `
.maped {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(120% 90% at 50% -10%, ${SNOW_SHADOW} 0%, #EAF0FA 55%, #DCE6F5 100%);
  color: ${SLATE_DEEP};
  font-family: "Segoe UI", system-ui, sans-serif;
  user-select: none;
  z-index: 20;
}
.maped-hidden { display: none; }

.maped-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid ${SNOW_SHADOW};
  flex-wrap: wrap;
}
.maped-title { font-size: 20px; font-weight: 600; letter-spacing: 0.04em; }
.maped-spacer { flex: 1; }
.maped-hint { font-size: 13px; font-weight: 500; opacity: 0.75; }

.maped-body { flex: 1; display: flex; min-height: 0; }
.maped-tools {
  width: 150px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-right: 1px solid ${SNOW_SHADOW};
  overflow-y: auto;
}
.maped-tool-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; opacity: 0.5; margin-top: 6px; text-transform: uppercase; }

.maped-btn {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW}CC;
  color: ${SLATE_DEEP};
  font: 600 13px "Segoe UI", system-ui, sans-serif;
  text-align: left;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.1s ease;
}
.maped-btn:hover { transform: translateY(-1px); }
.maped-btn.sel { background: ${BIRCH_AMBER}F2; border-color: ${SUNLIT_SNOW}; }

.maped-play {
  padding: 12px;
  font-size: 16px;
  text-align: center;
  background: ${BIRCH_AMBER}F2;
  border-color: ${SUNLIT_SNOW};
}
.maped-play:hover { background: ${BIRCH_AMBER}; }

.maped-stage { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 10px; gap: 8px; }
.maped-plan-wrap { flex: 1; min-height: 0; position: relative; border-radius: 12px; overflow: hidden; border: 1px solid ${SNOW_SHADOW}; }
.maped-plan { width: 100%; height: 100%; display: block; cursor: crosshair; }

.maped-graph-wrap { height: 130px; border-radius: 12px; border: 1px solid ${SNOW_SHADOW}; background: ${SUNLIT_SNOW}99; position: relative; }
.maped-graph { width: 100%; height: 100%; display: block; cursor: ns-resize; }
.maped-graph-cap { position: absolute; top: 6px; left: 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; opacity: 0.55; text-transform: uppercase; }

.maped-slider-row { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; }
.maped-slider-row input { flex: 1; }
`;

export function createMapEditor(callbacks: MapEditorCallbacks): MapEditorHandle {
  const style = document.createElement("style");
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);

  // ── Working state ─────────────────────────────────────────────────────────
  const map: WorkingMap = fromSlopeMap(loadMap());
  let tool: Tool = "select";
  // A selection / drag target: which collection + index, or a grade point.
  let dragging:
    | { kind: "prop" | "chasm" | "checkpoint"; index: number }
    | { kind: "grade"; index: number }
    | null = null;
  let selected: { kind: "prop" | "chasm" | "checkpoint"; index: number } | null =
    null;

  function fromSlopeMap(s: SlopeMap): WorkingMap {
    return {
      name: s.name,
      length: s.length,
      grade: s.grade.map((g) => [g[0], g[1]] as [number, number]),
      props: s.props.map((p) => ({ type: p.type, along: p.along, lateral: p.lateral })),
      chasms: s.chasms.map((c) => ({ id: c.id, start: c.start, width: c.width })),
      checkpoints: [...s.checkpoints],
    };
  }
  function snapshot(): SlopeMap {
    // Sort/clean for a stable, valid map (grade in order, a checkpoint at 0).
    const grade = [...map.grade].sort((a, b) => a[0] - b[0]);
    const checkpoints = [...new Set(map.checkpoints)].sort((a, b) => a - b);
    if (!checkpoints.includes(0)) checkpoints.unshift(0);
    return {
      version: 1,
      name: map.name,
      length: map.length,
      grade,
      props: map.props.map((p) => ({ ...p })),
      chasms: map.chasms.map((c) => ({ ...c })),
      checkpoints,
    };
  }
  function persist(): void {
    saveMap(snapshot());
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "maped maped-hidden";

  const top = document.createElement("div");
  top.className = "maped-top";
  const title = document.createElement("div");
  title.className = "maped-title";
  title.textContent = "Map Editor";
  const spacer = document.createElement("div");
  spacer.className = "maped-spacer";
  const hint = document.createElement("div");
  hint.className = "maped-hint";
  top.append(title, spacer, hint);

  const body = document.createElement("div");
  body.className = "maped-body";

  // Toolbar
  const tools = document.createElement("div");
  tools.className = "maped-tools";

  const play = mkBtn("▶  Play this slope", () => callbacks.onPlay(snapshot()));
  play.className = "maped-btn maped-play";

  const toolButtons = new Map<Tool, HTMLButtonElement>();
  function toolBtn(t: Tool, label: string): HTMLButtonElement {
    const b = mkBtn(label, () => setTool(t));
    toolButtons.set(t, b);
    return b;
  }
  const placeLabel = sectionLabel("Place — click the map");
  const bSelect = toolBtn("select", "↖  Select / Move");
  const bPine = toolBtn("pine", "🌲  Tree");
  const bRock = toolBtn("rock", "🪨  Rock");
  const bChasm = toolBtn("chasm", "⛰  Chasm (jump)");
  const bCheck = toolBtn("checkpoint", "🚩  Checkpoint");
  const bErase = toolBtn("erase", "✕  Erase");

  const editLabel = sectionLabel("Slope");
  // Length slider.
  const lenRow = document.createElement("div");
  lenRow.className = "maped-slider-row";
  const lenText = document.createElement("span");
  const lenInput = document.createElement("input");
  lenInput.type = "range";
  lenInput.min = String(MIN_MAP_LENGTH);
  lenInput.max = String(MAX_MAP_LENGTH);
  lenInput.step = "20";
  lenInput.value = String(map.length);
  const setLenText = (): void => {
    lenText.textContent = `Length ${Math.round(map.length)}`;
  };
  setLenText();
  lenInput.addEventListener("input", () => {
    map.length = Number(lenInput.value);
    // Keep everything inside the new length.
    for (const p of map.props) p.along = clamp(p.along, 0, map.length);
    for (const c of map.chasms) c.start = clamp(c.start, 0, map.length);
    map.checkpoints = map.checkpoints.map((cp) => clamp(cp, 0, map.length));
    for (const g of map.grade) g[0] = clamp(g[0], 0, map.length);
    setLenText();
    persist();
    renderAll();
  });
  lenRow.append(lenText, lenInput);

  const bReset = mkBtn("↺  Reset to starter", () => {
    if (!confirm("Replace this slope with the starter map?")) return;
    Object.assign(map, fromSlopeMap(defaultMap()));
    lenInput.value = String(map.length);
    setLenText();
    selected = null;
    persist();
    renderAll();
  });
  const bExit = mkBtn("←  Back to lobby", () => callbacks.onExit());

  tools.append(
    play,
    placeLabel,
    bSelect,
    bPine,
    bRock,
    bChasm,
    bCheck,
    bErase,
    editLabel,
    lenRow,
    bReset,
    bExit,
  );

  // Stage: plan canvas + steepness graph.
  const stage = document.createElement("div");
  stage.className = "maped-stage";
  const planWrap = document.createElement("div");
  planWrap.className = "maped-plan-wrap";
  const plan = document.createElement("canvas");
  plan.className = "maped-plan";
  planWrap.append(plan);
  const graphWrap = document.createElement("div");
  graphWrap.className = "maped-graph-wrap";
  const graphCap = document.createElement("div");
  graphCap.className = "maped-graph-cap";
  graphCap.textContent = "Steepness  ·  summit → flag  ·  drag dots · dbl-click add · right-click remove";
  const graph = document.createElement("canvas");
  graph.className = "maped-graph";
  graphWrap.append(graph, graphCap);
  stage.append(planWrap, graphWrap);

  body.append(tools, stage);
  root.append(top, body);
  document.body.appendChild(root);

  function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "maped-btn";
    b.textContent = label;
    b.addEventListener("click", () => {
      onClick();
      b.blur();
    });
    return b;
  }
  function sectionLabel(text: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "maped-tool-label";
    d.textContent = text;
    return d;
  }

  function setTool(t: Tool): void {
    tool = t;
    for (const [k, b] of toolButtons) b.classList.toggle("sel", k === t);
    plan.style.cursor = t === "select" ? "grab" : t === "erase" ? "not-allowed" : "crosshair";
    hint.textContent = TOOL_HINTS[t];
  }

  const TOOL_HINTS: Record<Tool, string> = {
    select: "Click an item to select, drag to move it.",
    pine: "Click to plant a tree.",
    rock: "Click to drop a rock.",
    chasm: "Click on the lane to cut a jumpable chasm.",
    checkpoint: "Click to set a respawn checkpoint.",
    erase: "Click an item to delete it.",
  };

  // ── Plan-view coordinate mapping ────────────────────────────────────────────
  // Map plan pixels ↔ (along, lateral). These read the canvas's LIVE client size
  // (not a render-populated cache) so a click always maps correctly, even before
  // the first paint or if a frame is throttled.
  let planW = 0;
  let planH = 0;
  const alongToY = (along: number): number => (along / map.length) * (plan.clientHeight || 1);
  const yToAlong = (y: number): number =>
    clamp((y / (plan.clientHeight || 1)) * map.length, 0, map.length);
  const latToX = (lat: number): number => ((plan.clientWidth || 1) / 2) * (1 + lat / LAT_VIEW);
  const xToLat = (x: number): number =>
    clamp((x / ((plan.clientWidth || 1) / 2) - 1) * LAT_VIEW, -MAX_LATERAL, MAX_LATERAL);

  function sizeCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return null;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // A palette-blue tint for steep snow, warm-white for mellow — reads as terrain.
  function gradeColor(g: number): string {
    const t = clamp((g - MIN_GRADE) / (MAX_GRADE - MIN_GRADE), 0, 1);
    // mellow #F1F4FA → steep #7C93BE
    const lerp = (a: number, b: number): number => Math.round(a + (b - a) * t);
    return `rgb(${lerp(241, 124)},${lerp(244, 147)},${lerp(250, 190)})`;
  }

  function renderPlan(): void {
    const ctx = sizeCanvas(plan);
    if (!ctx) return;
    planW = plan.clientWidth;
    planH = plan.clientHeight;

    // Off-lane snow.
    ctx.fillStyle = "#E4ECF7";
    ctx.fillRect(0, 0, planW, planH);

    // The lane, tinted by steepness in stripes down the hill.
    const laneLeft = latToX(-LANE_HALF);
    const laneRight = latToX(LANE_HALF);
    const stripes = 48;
    for (let i = 0; i < stripes; i++) {
      const a0 = (i / stripes) * map.length;
      const y0 = alongToY(a0);
      const y1 = alongToY(((i + 1) / stripes) * map.length);
      ctx.fillStyle = gradeColor(mapGradeAt(map.grade, a0));
      ctx.fillRect(laneLeft, y0, laneRight - laneLeft, y1 - y0 + 1);
    }
    // Lane edges.
    ctx.strokeStyle = SNOW_SHADOW;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(laneLeft, 0);
    ctx.lineTo(laneLeft, planH);
    ctx.moveTo(laneRight, 0);
    ctx.lineTo(laneRight, planH);
    ctx.stroke();

    // Summit / flag labels.
    ctx.fillStyle = SLATE_DEEP;
    ctx.font = "600 12px 'Segoe UI', system-ui, sans-serif";
    ctx.globalAlpha = 0.6;
    ctx.fillText("▲ Summit (start)", 8, 16);
    ctx.fillText("⚑ Flag (finish)", 8, planH - 8);
    ctx.globalAlpha = 1;

    // Checkpoints (lines across).
    map.checkpoints.forEach((cp, i) => {
      const y = alongToY(cp);
      const sel = selected?.kind === "checkpoint" && selected.index === i;
      ctx.strokeStyle = CHECKPOINT_BLUE;
      ctx.lineWidth = sel ? 4 : 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(laneLeft - 8, y);
      ctx.lineTo(laneRight + 8, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = CHECKPOINT_BLUE;
      ctx.fillText("🚩", laneRight + 10, y + 5);
    });

    // Chasms (red bands across the lane).
    map.chasms.forEach((c, i) => {
      const y0 = alongToY(c.start);
      const y1 = alongToY(c.start + c.width);
      const sel = selected?.kind === "chasm" && selected.index === i;
      ctx.fillStyle = SIGNAL_RED + (sel ? "" : "CC");
      ctx.fillRect(laneLeft, y0, laneRight - laneLeft, Math.max(3, y1 - y0));
      if (sel) {
        ctx.strokeStyle = SLATE_DEEP;
        ctx.lineWidth = 2;
        ctx.strokeRect(laneLeft, y0, laneRight - laneLeft, Math.max(3, y1 - y0));
      }
    });

    // Props.
    map.props.forEach((p, i) => {
      const x = latToX(p.lateral);
      const y = alongToY(p.along);
      const sel = selected?.kind === "prop" && selected.index === i;
      if (sel) {
        ctx.strokeStyle = BIRCH_AMBER;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p.type === "pine") {
        ctx.fillStyle = PINE_GREEN;
        ctx.beginPath();
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x + 7, y + 6);
        ctx.lineTo(x - 7, y + 6);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = ROCK_GRAY;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ── Steepness graph ─────────────────────────────────────────────────────────
  let gW = 0;
  let gH = 0;
  const GPAD = 14;
  const gwPx = (): number => graph.clientWidth || 1;
  const ghPx = (): number => graph.clientHeight || 1;
  const gx = (along: number): number => GPAD + (along / map.length) * (gwPx() - 2 * GPAD);
  const gy = (grade: number): number =>
    GPAD + (1 - (grade - MIN_GRADE) / (MAX_GRADE - MIN_GRADE)) * (ghPx() - 2 * GPAD);
  const gxToAlong = (x: number): number =>
    clamp(((x - GPAD) / (gwPx() - 2 * GPAD)) * map.length, 0, map.length);
  const gyToGrade = (y: number): number =>
    clamp(
      MIN_GRADE + (1 - (y - GPAD) / (ghPx() - 2 * GPAD)) * (MAX_GRADE - MIN_GRADE),
      MIN_GRADE,
      MAX_GRADE,
    );

  function renderGraph(): void {
    const ctx = sizeCanvas(graph);
    if (!ctx) return;
    gW = graph.clientWidth;
    gH = graph.clientHeight;
    ctx.clearRect(0, 0, gW, gH);
    const pts = [...map.grade].sort((a, b) => a[0] - b[0]);
    // Filled area under the curve.
    ctx.beginPath();
    ctx.moveTo(gx(pts[0]![0]), gH - GPAD);
    for (const p of pts) ctx.lineTo(gx(p[0]), gy(p[1]));
    ctx.lineTo(gx(pts[pts.length - 1]![0]), gH - GPAD);
    ctx.closePath();
    ctx.fillStyle = "#7C93BE33";
    ctx.fill();
    // The curve.
    ctx.beginPath();
    pts.forEach((p, i) => {
      const X = gx(p[0]);
      const Y = gy(p[1]);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.strokeStyle = "#4E608A";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Control dots.
    for (const p of pts) {
      ctx.fillStyle = BIRCH_AMBER;
      ctx.strokeStyle = SLATE_DEEP;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gx(p[0]), gy(p[1]), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Steep/mellow axis hint.
    ctx.fillStyle = SLATE_DEEP;
    ctx.globalAlpha = 0.4;
    ctx.font = "600 10px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("steep", 2, GPAD + 2);
    ctx.fillText("mellow", 2, gH - GPAD + 2);
    ctx.globalAlpha = 1;
  }

  function renderAll(): void {
    renderPlan();
    renderGraph();
  }

  // ── Hit-testing ─────────────────────────────────────────────────────────────
  function pickPlan(px: number, py: number):
    | { kind: "prop" | "chasm" | "checkpoint"; index: number }
    | null {
    // Props first (smallest, on top).
    for (let i = map.props.length - 1; i >= 0; i--) {
      const p = map.props[i]!;
      if (Math.hypot(latToX(p.lateral) - px, alongToY(p.along) - py) <= HIT_PX) {
        return { kind: "prop", index: i };
      }
    }
    for (let i = map.chasms.length - 1; i >= 0; i--) {
      const c = map.chasms[i]!;
      const y0 = alongToY(c.start);
      const y1 = alongToY(c.start + c.width);
      if (py >= y0 - 4 && py <= y1 + 4 && px >= latToX(-LANE_HALF) && px <= latToX(LANE_HALF)) {
        return { kind: "chasm", index: i };
      }
    }
    for (let i = 0; i < map.checkpoints.length; i++) {
      if (Math.abs(alongToY(map.checkpoints[i]!) - py) <= 8) {
        return { kind: "checkpoint", index: i };
      }
    }
    return null;
  }

  function localXY(canvas: HTMLCanvasElement, ev: PointerEvent | MouseEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  // ── Plan interactions ───────────────────────────────────────────────────────
  plan.addEventListener("pointerdown", (ev) => {
    const [px, py] = localXY(plan, ev);
    const along = yToAlong(py);
    const lateral = xToLat(px);
    if (tool === "pine" || tool === "rock") {
      map.props.push({ type: tool, along, lateral });
      selected = { kind: "prop", index: map.props.length - 1 };
    } else if (tool === "chasm") {
      map.chasms.push({ id: `gap-${Date.now().toString(36)}`, start: along, width: 3.5 });
      selected = { kind: "chasm", index: map.chasms.length - 1 };
    } else if (tool === "checkpoint") {
      map.checkpoints.push(along);
      selected = { kind: "checkpoint", index: map.checkpoints.length - 1 };
    } else if (tool === "erase") {
      const hit = pickPlan(px, py);
      if (hit) removeHit(hit);
      selected = null;
    } else {
      // select / move
      const hit = pickPlan(px, py);
      selected = hit;
      if (hit) {
        dragging = hit;
        plan.setPointerCapture(ev.pointerId);
      }
    }
    persist();
    renderAll();
  });

  plan.addEventListener("pointermove", (ev) => {
    if (!dragging || dragging.kind === "grade") return;
    const [px, py] = localXY(plan, ev);
    const along = yToAlong(py);
    if (dragging.kind === "prop") {
      const p = map.props[dragging.index];
      if (p) {
        p.along = along;
        p.lateral = xToLat(px);
      }
    } else if (dragging.kind === "chasm") {
      const c = map.chasms[dragging.index];
      if (c) c.start = clamp(along, 0, map.length - c.width);
    } else if (dragging.kind === "checkpoint") {
      map.checkpoints[dragging.index] = along;
    }
    renderPlan();
  });

  const endDrag = (ev: PointerEvent): void => {
    if (dragging) {
      dragging = null;
      persist();
      renderAll();
    }
    if (plan.hasPointerCapture(ev.pointerId)) plan.releasePointerCapture(ev.pointerId);
  };
  plan.addEventListener("pointerup", endDrag);
  plan.addEventListener("pointercancel", endDrag);

  function removeHit(hit: { kind: "prop" | "chasm" | "checkpoint"; index: number }): void {
    if (hit.kind === "prop") map.props.splice(hit.index, 1);
    else if (hit.kind === "chasm") map.chasms.splice(hit.index, 1);
    else if (hit.kind === "checkpoint" && map.checkpoints[hit.index] !== 0) {
      // The start checkpoint (0) is the run's respawn floor — keep it.
      map.checkpoints.splice(hit.index, 1);
    }
  }

  // ── Graph interactions ──────────────────────────────────────────────────────
  function pickGrade(px: number, py: number): number {
    const pts = map.grade;
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(gx(pts[i]![0]) - px, gy(pts[i]![1]) - py) <= 10) return i;
    }
    return -1;
  }
  graph.addEventListener("pointerdown", (ev) => {
    const [px, py] = localXY(graph, ev);
    const i = pickGrade(px, py);
    if (i >= 0) {
      dragging = { kind: "grade", index: i };
      graph.setPointerCapture(ev.pointerId);
    }
  });
  graph.addEventListener("pointermove", (ev) => {
    if (!dragging || dragging.kind !== "grade") return;
    const [px, py] = localXY(graph, ev);
    const pt = map.grade[dragging.index]!;
    pt[1] = gyToGrade(py);
    // Interior points can also slide along; endpoints stay pinned to 0 / length.
    const isFirst = dragging.index === 0;
    const isLast = dragging.index === map.grade.length - 1;
    if (!isFirst && !isLast) pt[0] = gxToAlong(px);
    renderGraph();
    renderPlan(); // lane tint follows the grade live
  });
  graph.addEventListener("pointerup", (ev) => {
    if (dragging?.kind === "grade") {
      dragging = null;
      persist();
      renderAll();
    }
    if (graph.hasPointerCapture(ev.pointerId)) graph.releasePointerCapture(ev.pointerId);
  });
  graph.addEventListener("dblclick", (ev) => {
    const [px] = localXY(graph, ev);
    const along = gxToAlong(px);
    map.grade.push([along, mapGradeAt(map.grade, along)]);
    map.grade.sort((a, b) => a[0] - b[0]);
    persist();
    renderAll();
  });
  graph.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const [px, py] = localXY(graph, ev);
    const i = pickGrade(px, py);
    if (i >= 0 && map.grade.length > 2) {
      map.grade.splice(i, 1);
      persist();
      renderAll();
    }
  });

  window.addEventListener("resize", () => {
    if (!root.classList.contains("maped-hidden")) renderAll();
  });

  setTool("select");

  return {
    setVisible(visible: boolean): void {
      root.classList.toggle("maped-hidden", !visible);
      if (visible) {
        // Canvas has no size while display:none — render once it's laid out. Both
        // a rAF and a timeout so it paints even if frames are throttled.
        requestAnimationFrame(renderAll);
        setTimeout(renderAll, 0);
      }
    },
  };
}
