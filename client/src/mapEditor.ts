// (map-editor) The director's map editor — a tilted bird's-eye view of the REAL
// 3-D slope (director call, 2026-07-25: "an actual top-down view of the map I was
// creating," not a schematic). It reuses the actual ski scene: the real sculpted
// snow terrain and the real tree/rock GLBs — exactly what you'll ski — seen from an
// angled overhead camera you can rotate, zoom, and pan down the hill. You drop and
// drag the real assets straight onto the ground, place chasms + checkpoints, and
// shape the terrain steepness (the graph panel), then Play it.
//
// It drives the shared SkiSceneHandle directly while active (camera + which meshes
// exist); the sim never runs here. main.ts calls frame(dt) each editor frame and
// render()s afterwards. The map format/save + "play it" plumbing live elsewhere
// (slopeMap.ts / mapStore.ts / main.ts); this is the view + editing.

import * as THREE from "three";
import {
  defaultMap,
  mapGradeAt,
  mapHeightAt,
  MAX_GRADE,
  MAX_LATERAL,
  MAX_MAP_LENGTH,
  MIN_GRADE,
  MIN_MAP_LENGTH,
  type PropType,
  type SlopeMap,
} from "@toebeans/shared";
import { loadMap, saveMap } from "./mapStore";
import {
  getMapSurface,
  getMapTerrainGroup,
  setMapTerrain,
  type SkiSceneHandle,
} from "./skiRender";
import { createChasmMesh, createCheckpointMarker } from "./skiScene";
import { segmentCenterline, segmentPitch, setActiveMap } from "./slopePath";

const SUNLIT_SNOW = "#F8F5EF";
const SNOW_SHADOW = "#D3DFF0";
const BIRCH_AMBER = "#E9A960";
const SLATE_DEEP = "#2E3548";

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
  onPlay(map: SlopeMap): void;
  onExit(): void;
}

export interface MapEditorHandle {
  /** Show/hide the editor (build the real scene + take over the camera, or
   * restore the skier and tear the editor scene extras down). */
  setVisible(visible: boolean): void;
  /** Per-frame while active: drive the overhead camera + rebuild if edited. */
  frame(dt: number): void;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const EDITOR_CSS = `
.maped { position: fixed; inset: 0; z-index: 20; pointer-events: none;
  font-family: "Segoe UI", system-ui, sans-serif; color: ${SLATE_DEEP}; user-select: none; }
.maped-hidden { display: none; }
/* transparent layer that captures camera + placement input over the 3D canvas */
.maped-input { position: absolute; inset: 0; pointer-events: auto; cursor: grab; }
.maped-input.placing { cursor: crosshair; }
.maped-input.erasing { cursor: not-allowed; }

.maped-top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center;
  gap: 12px; padding: 10px 16px; pointer-events: none; }
.maped-title { font-size: 20px; font-weight: 600; letter-spacing: 0.04em;
  text-shadow: 0 1px 0 ${SUNLIT_SNOW}, 0 2px 8px ${SNOW_SHADOW}; }
.maped-hint { font-size: 13px; font-weight: 500; opacity: 0.85;
  background: ${SUNLIT_SNOW}D9; padding: 4px 10px; border-radius: 8px; }

.maped-tools { position: absolute; top: 52px; left: 12px; width: 168px; display: flex;
  flex-direction: column; gap: 7px; pointer-events: auto; max-height: calc(100vh - 70px); overflow-y: auto; }
.maped-tool-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; opacity: 0.55;
  margin-top: 6px; text-transform: uppercase; }
.maped-btn { padding: 9px 12px; border-radius: 10px; border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW}E6; color: ${SLATE_DEEP}; font: 600 13px "Segoe UI", system-ui, sans-serif;
  text-align: left; cursor: pointer; transition: transform 0.1s ease, background 0.1s ease; }
.maped-btn:hover { transform: translateY(-1px); }
.maped-btn.sel { background: ${BIRCH_AMBER}F2; border-color: ${SUNLIT_SNOW}; }
.maped-play { padding: 12px; font-size: 16px; text-align: center; background: ${BIRCH_AMBER}F2;
  border-color: ${SUNLIT_SNOW}; }
.maped-play:hover { background: ${BIRCH_AMBER}; }
.maped-slider { display: flex; flex-direction: column; gap: 2px; font-size: 12px; font-weight: 600;
  background: ${SUNLIT_SNOW}E6; padding: 7px 10px; border-radius: 10px; border: 1px solid ${SNOW_SHADOW}; }
.maped-slider input { width: 100%; }

.maped-graph-wrap { position: absolute; bottom: 12px; left: 12px; width: 340px; height: 116px;
  border-radius: 12px; border: 1px solid ${SNOW_SHADOW}; background: ${SUNLIT_SNOW}E6; pointer-events: auto; }
.maped-graph { width: 100%; height: 100%; display: block; cursor: ns-resize; }
.maped-graph-cap { position: absolute; top: 5px; left: 10px; font-size: 10px; font-weight: 700;
  letter-spacing: 0.05em; opacity: 0.6; text-transform: uppercase; }
`;

export function createMapEditor(
  scene: SkiSceneHandle,
  callbacks: MapEditorCallbacks,
): MapEditorHandle {
  const style = document.createElement("style");
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);

  // ── Working state ───────────────────────────────────────────────────────────
  const map: WorkingMap = fromSlopeMap(loadMap());
  let tool: Tool = "select";
  let active = false;
  let dirty = false; // an edit happened → rebuild the terrain/markers next frame

  // Overhead camera rig — a tilted bird's-eye looking DOWN the fall line, so the
  // long narrow run recedes into the distance and you see a good stretch of it at
  // once (pan the rest with the "Down the hill" slider). A steep straight-down
  // angle only shows a tiny patch of a 480-long slope, so this stays ~50°.
  let azimuth = 0.28; // gentle 3/4 rotation off straight-down-the-hill
  let pitch = 0.9; // ~52° above horizontal (Sims-style tilt, shows height + length)
  let dist = 62; // zoom
  let alongTarget = 0; // where down the hill the camera looks (set on enter)

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
  function markDirty(): void {
    dirty = true;
    persist();
  }

  // ── DOM overlay ─────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "maped maped-hidden";

  const input = document.createElement("div");
  input.className = "maped-input";

  const top = document.createElement("div");
  top.className = "maped-top";
  const title = document.createElement("div");
  title.className = "maped-title";
  title.textContent = "Map Editor";
  const hint = document.createElement("div");
  hint.className = "maped-hint";
  top.append(title, hint);

  const tools = document.createElement("div");
  tools.className = "maped-tools";

  const play = mkBtn("▶  Play this slope", () => callbacks.onPlay(snapshot()));
  play.className = "maped-btn maped-play";

  const toolButtons = new Map<Tool, HTMLButtonElement>();
  const toolBtn = (t: Tool, label: string): HTMLButtonElement => {
    const b = mkBtn(label, () => setTool(t));
    toolButtons.set(t, b);
    return b;
  };

  const placeLabel = sectionLabel("Place — click the ground");
  const bSelect = toolBtn("select", "↖  Select / Move");
  const bPine = toolBtn("pine", "🌲  Tree");
  const bRock = toolBtn("rock", "🪨  Rock");
  const bChasm = toolBtn("chasm", "⛰  Chasm (jump)");
  const bCheck = toolBtn("checkpoint", "🚩  Checkpoint");
  const bErase = toolBtn("erase", "✕  Erase");

  const viewLabel = sectionLabel("View");
  const alongSlider = slider("Down the hill", 0, 100, 30, (v) => {
    alongTarget = (v / 100) * map.length;
  });
  const camHint = document.createElement("div");
  camHint.className = "maped-tool-label";
  camHint.style.textTransform = "none";
  camHint.style.opacity = "0.5";
  camHint.textContent = "Drag empty ground to rotate · wheel to zoom";

  const slopeLabel = sectionLabel("Slope");
  const lenSlider = slider(
    `Length ${Math.round(map.length)}`,
    MIN_MAP_LENGTH,
    MAX_MAP_LENGTH,
    map.length,
    (v, el) => {
      map.length = v;
      for (const p of map.props) p.along = clamp(p.along, 0, map.length);
      for (const c of map.chasms) c.start = clamp(c.start, 0, map.length);
      map.checkpoints = map.checkpoints.map((cp) => clamp(cp, 0, map.length));
      for (const g of map.grade) g[0] = clamp(g[0], 0, map.length);
      el.textContent = `Length ${Math.round(map.length)}`;
      markDirty();
    },
  );
  const bReset = mkBtn("↺  Reset to starter", () => {
    if (!confirm("Replace this slope with the starter map?")) return;
    Object.assign(map, fromSlopeMap(defaultMap()));
    (lenSlider.querySelector("input") as HTMLInputElement).value = String(map.length);
    (lenSlider.querySelector("span") as HTMLSpanElement).textContent = `Length ${Math.round(map.length)}`;
    selected = null;
    markDirty();
  });
  const bExit = mkBtn("←  Back to lobby", () => callbacks.onExit());

  tools.append(
    play, placeLabel, bSelect, bPine, bRock, bChasm, bCheck, bErase,
    viewLabel, alongSlider, camHint, slopeLabel, lenSlider, bReset, bExit,
  );

  // Steepness graph panel (a control, not the map): drag the dots to shape the
  // hill; the real 3-D terrain reshapes live.
  const graphWrap = document.createElement("div");
  graphWrap.className = "maped-graph-wrap";
  const graphCap = document.createElement("div");
  graphCap.className = "maped-graph-cap";
  graphCap.textContent = "Steepness · summit → flag · drag · dbl-click add · right-click remove";
  const graph = document.createElement("canvas");
  graph.className = "maped-graph";
  graphWrap.append(graph, graphCap);

  root.append(input, top, tools, graphWrap);
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
  function slider(
    label: string,
    min: number,
    max: number,
    value: number,
    onInput: (v: number, labelEl: HTMLSpanElement) => void,
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "maped-slider";
    const lab = document.createElement("span");
    lab.textContent = label;
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = "5";
    inp.value = String(value);
    inp.addEventListener("input", () => onInput(Number(inp.value), lab));
    wrap.append(lab, inp);
    return wrap;
  }

  function setTool(t: Tool): void {
    tool = t;
    for (const [k, b] of toolButtons) b.classList.toggle("sel", k === t);
    input.classList.toggle("placing", t === "pine" || t === "rock" || t === "chasm" || t === "checkpoint");
    input.classList.toggle("erasing", t === "erase");
    hint.textContent = TOOL_HINTS[t];
  }
  const TOOL_HINTS: Record<Tool, string> = {
    select: "Drag empty ground to rotate the view; drag a tree/rock to move it.",
    pine: "Click the ground to plant a tree.",
    rock: "Click the ground to drop a rock.",
    chasm: "Click the lane to cut a jumpable chasm.",
    checkpoint: "Click to set a respawn checkpoint.",
    erase: "Click a tree/rock/chasm/checkpoint to delete it.",
  };

  // ── Overhead camera + rebuild ────────────────────────────────────────────────
  const target = new THREE.Vector3();
  function updateCamera(): void {
    const ty = mapHeightAt(snapshotLite(), alongTarget);
    target.set(0, ty, -alongTarget);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    scene.camera.position.set(
      target.x + dist * cp * Math.sin(azimuth),
      target.y + dist * sp,
      target.z + dist * cp * Math.cos(azimuth),
    );
    scene.camera.lookAt(target);
  }
  // A cheap SlopeMap view for height sampling (no prop/checkpoint copying).
  function snapshotLite(): SlopeMap {
    return {
      version: 1, name: map.name, length: map.length,
      grade: [...map.grade].sort((a, b) => a[0] - b[0]),
      props: [], chasms: [], checkpoints: [],
    };
  }

  let hazardGroup: THREE.Group | null = null;
  function rebuildHazardMarkers(): void {
    if (hazardGroup) {
      scene.scene.remove(hazardGroup);
      hazardGroup = null;
    }
    const g = new THREE.Group();
    map.chasms.forEach((c, i) => {
      const mesh = createChasmMesh(c.width);
      const mid = c.start + c.width / 2;
      const pt = segmentCenterline("map", mid);
      mesh.position.set(pt.x, pt.y + 0.06, pt.z);
      mesh.rotation.set(-segmentPitch("map", mid), -pt.heading, 0, "YXZ");
      mesh.userData.mapChasmIndex = i;
      g.add(mesh);
    });
    map.checkpoints.forEach((cp, i) => {
      if (cp === 0) return; // the start line isn't an editable marker
      const mk = createCheckpointMarker();
      const pt = segmentCenterline("map", cp);
      mk.position.set(pt.x, pt.y + 0.06, pt.z);
      mk.rotation.set(-segmentPitch("map", cp), -pt.heading, 0, "YXZ");
      mk.userData.mapCheckpointIndex = i;
      g.add(mk);
    });
    scene.scene.add(g);
    hazardGroup = g;
  }
  function rebuild(): void {
    const snap = snapshot();
    setActiveMap(snap); // so segmentCenterline("map") reflects the current grade/length
    setMapTerrain(scene, snap);
    rebuildHazardMarkers();
  }

  // ── Raycast picking ───────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function toNdc(ev: PointerEvent | WheelEvent): void {
    ndc.set(
      (ev.clientX / window.innerWidth) * 2 - 1,
      -((ev.clientY / window.innerHeight) * 2 - 1),
    );
  }
  function pickGround(): { along: number; lateral: number } | null {
    const surf = getMapSurface();
    if (!surf) return null;
    raycaster.setFromCamera(ndc, scene.camera);
    const hit = raycaster.intersectObject(surf, false)[0];
    if (!hit) return null;
    return {
      along: clamp(-hit.point.z, 0, map.length),
      lateral: clamp(hit.point.x, -MAX_LATERAL, MAX_LATERAL),
    };
  }
  type Pick =
    | { kind: "prop"; index: number }
    | { kind: "chasm"; index: number }
    | { kind: "checkpoint"; index: number };
  function pickObject(): Pick | null {
    raycaster.setFromCamera(ndc, scene.camera);
    const roots: THREE.Object3D[] = [];
    const grp = getMapTerrainGroup();
    if (grp) roots.push(grp);
    if (hazardGroup) roots.push(hazardGroup);
    for (const hit of raycaster.intersectObjects(roots, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (typeof o.userData.mapPropIndex === "number") return { kind: "prop", index: o.userData.mapPropIndex };
        if (typeof o.userData.mapChasmIndex === "number") return { kind: "chasm", index: o.userData.mapChasmIndex };
        if (typeof o.userData.mapCheckpointIndex === "number") return { kind: "checkpoint", index: o.userData.mapCheckpointIndex };
        o = o.parent;
      }
    }
    return null;
  }
  function findPropClone(index: number): THREE.Object3D | null {
    const grp = getMapTerrainGroup();
    if (!grp) return null;
    return grp.children.find((c) => c.userData.mapPropIndex === index) ?? null;
  }

  // ── Interaction ───────────────────────────────────────────────────────────────
  let selected: Pick | null = null;
  let drag: "orbit" | "prop" | null = null;
  let dragPropIndex = -1;
  let lastX = 0;
  let lastY = 0;

  input.addEventListener("pointerdown", (ev) => {
    toNdc(ev);
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (tool === "pine" || tool === "rock") {
      const g = pickGround();
      if (g) {
        map.props.push({ type: tool, along: g.along, lateral: g.lateral });
        selected = { kind: "prop", index: map.props.length - 1 };
        markDirty();
      }
      return;
    }
    if (tool === "chasm") {
      const g = pickGround();
      if (g) {
        map.chasms.push({ id: `gap-${Date.now().toString(36)}`, start: g.along, width: 3.5 });
        markDirty();
      }
      return;
    }
    if (tool === "checkpoint") {
      const g = pickGround();
      if (g) {
        map.checkpoints.push(g.along);
        markDirty();
      }
      return;
    }
    if (tool === "erase") {
      const p = pickObject();
      if (p) removePick(p);
      return;
    }
    // select / move: a prop starts a move-drag; empty ground orbits.
    const p = pickObject();
    selected = p;
    if (p && p.kind === "prop") {
      drag = "prop";
      dragPropIndex = p.index;
    } else {
      drag = "orbit";
    }
    input.setPointerCapture(ev.pointerId);
  });

  input.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (drag === "orbit") {
      azimuth += (ev.clientX - lastX) * 0.006;
      pitch = clamp(pitch - (ev.clientY - lastY) * 0.004, 0.5, 1.45);
      lastX = ev.clientX;
      lastY = ev.clientY;
    } else if (drag === "prop") {
      toNdc(ev);
      const g = pickGround();
      const p = map.props[dragPropIndex];
      if (g && p) {
        p.along = g.along;
        p.lateral = g.lateral;
        // Move the existing clone live for smoothness (exact y fixed on release).
        const clone = findPropClone(dragPropIndex);
        if (clone) clone.position.set(g.lateral, clone.position.y, -g.along);
      }
    }
  });

  const endDrag = (ev: PointerEvent): void => {
    if (drag === "prop") markDirty();
    drag = null;
    if (input.hasPointerCapture(ev.pointerId)) input.releasePointerCapture(ev.pointerId);
  };
  input.addEventListener("pointerup", endDrag);
  input.addEventListener("pointercancel", endDrag);
  input.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    dist = clamp(dist * (1 + ev.deltaY * 0.0012), 18, 160);
  }, { passive: false });

  function removePick(p: Pick): void {
    if (p.kind === "prop") map.props.splice(p.index, 1);
    else if (p.kind === "chasm") map.chasms.splice(p.index, 1);
    else if (p.kind === "checkpoint" && map.checkpoints[p.index] !== 0) {
      map.checkpoints.splice(p.index, 1);
    }
    selected = null;
    markDirty();
  }

  // ── Steepness graph (a 2-D control panel) ─────────────────────────────────────
  const GPAD = 16;
  const gw = (): number => graph.clientWidth || 1;
  const gh = (): number => graph.clientHeight || 1;
  const gx = (along: number): number => GPAD + (along / map.length) * (gw() - 2 * GPAD);
  const gy = (grade: number): number =>
    GPAD + (1 - (grade - MIN_GRADE) / (MAX_GRADE - MIN_GRADE)) * (gh() - 2 * GPAD);
  const gxToAlong = (x: number): number => clamp(((x - GPAD) / (gw() - 2 * GPAD)) * map.length, 0, map.length);
  const gyToGrade = (y: number): number =>
    clamp(MIN_GRADE + (1 - (y - GPAD) / (gh() - 2 * GPAD)) * (MAX_GRADE - MIN_GRADE), MIN_GRADE, MAX_GRADE);
  let gradeDrag = -1;

  function renderGraph(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = graph.clientWidth;
    const h = graph.clientHeight;
    if (w === 0 || h === 0) return;
    graph.width = Math.round(w * dpr);
    graph.height = Math.round(h * dpr);
    const ctx = graph.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pts = [...map.grade].sort((a, b) => a[0] - b[0]);
    ctx.beginPath();
    ctx.moveTo(gx(pts[0]![0]), h - GPAD);
    for (const p of pts) ctx.lineTo(gx(p[0]), gy(p[1]));
    ctx.lineTo(gx(pts[pts.length - 1]![0]), h - GPAD);
    ctx.closePath();
    ctx.fillStyle = "#7C93BE33";
    ctx.fill();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(gx(p[0]), gy(p[1])) : ctx.moveTo(gx(p[0]), gy(p[1]))));
    ctx.strokeStyle = "#4E608A";
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(gx(p[0]), gy(p[1]), 5, 0, Math.PI * 2);
      ctx.fillStyle = BIRCH_AMBER;
      ctx.strokeStyle = SLATE_DEEP;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = SLATE_DEEP;
    ctx.font = "600 9px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("steep", 2, GPAD - 2);
    ctx.fillText("mellow", 2, h - 4);
    ctx.globalAlpha = 1;
  }
  const graphXY = (ev: PointerEvent | MouseEvent): [number, number] => {
    const r = graph.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  graph.addEventListener("pointerdown", (ev) => {
    const [x, y] = graphXY(ev);
    for (let i = 0; i < map.grade.length; i++) {
      if (Math.hypot(gx(map.grade[i]![0]) - x, gy(map.grade[i]![1]) - y) <= 9) {
        gradeDrag = i;
        graph.setPointerCapture(ev.pointerId);
        return;
      }
    }
  });
  graph.addEventListener("pointermove", (ev) => {
    if (gradeDrag < 0) return;
    const [x, y] = graphXY(ev);
    const pt = map.grade[gradeDrag]!;
    pt[1] = gyToGrade(y);
    if (gradeDrag !== 0 && gradeDrag !== map.grade.length - 1) pt[0] = gxToAlong(x);
    renderGraph();
    markDirty(); // the real 3-D hill reshapes on the next frame
  });
  graph.addEventListener("pointerup", (ev) => {
    if (gradeDrag >= 0) {
      gradeDrag = -1;
      renderGraph();
    }
    if (graph.hasPointerCapture(ev.pointerId)) graph.releasePointerCapture(ev.pointerId);
  });
  graph.addEventListener("dblclick", (ev) => {
    const [x] = graphXY(ev);
    const along = gxToAlong(x);
    map.grade.push([along, mapGradeAt(map.grade, along)]);
    map.grade.sort((a, b) => a[0] - b[0]);
    renderGraph();
    markDirty();
  });
  graph.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const [x, y] = graphXY(ev);
    for (let i = 0; i < map.grade.length; i++) {
      if (Math.hypot(gx(map.grade[i]![0]) - x, gy(map.grade[i]![1]) - y) <= 9 && map.grade.length > 2) {
        map.grade.splice(i, 1);
        renderGraph();
        markDirty();
        return;
      }
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────────
  function enter(): void {
    active = true;
    root.classList.remove("maped-hidden");
    alongTarget = map.length * 0.25;
    // Hide the skier + cat so the map reads clean.
    scene.player.visible = false;
    const catGroup = (scene.cat as unknown as { group?: THREE.Object3D }).group;
    if (catGroup) catGroup.visible = false;
    rebuild();
    updateCamera();
    setTool(tool);
    requestAnimationFrame(renderGraph);
    setTimeout(renderGraph, 0);
  }
  function exit(): void {
    active = false;
    root.classList.add("maped-hidden");
    scene.player.visible = true;
    const catGroup = (scene.cat as unknown as { group?: THREE.Object3D }).group;
    if (catGroup) catGroup.visible = true;
    if (hazardGroup) {
      scene.scene.remove(hazardGroup);
      hazardGroup = null;
    }
  }

  return {
    setVisible(visible: boolean): void {
      if (visible === active) return;
      if (visible) enter();
      else exit();
    },
    frame(): void {
      if (!active) return;
      if (dirty) {
        rebuild();
        dirty = false;
      }
      updateCamera();
    },
  };
}
