import {
  roadSegmentIds,
  routeDistanceOf,
  TOTAL_ROUTE_LENGTH,
  type SkiState,
} from "@toebeans/shared";

// A dev-only readout for the branching map (SLOPE_BRANCHING.md §4): the live
// numbers that PROVE "same clock, same flag." It shows which segment you're on,
// how far down the whole route you are, and — the load-bearing line — how much
// route is left to the flag: that number is identical whichever of the three
// routes (Ice / Cave / Water) you took, so you can watch two runs and see no
// line is a shortcut. Not shipped: created only when a branching run starts (a
// URL flag in main.ts), a plain fixed DOM panel over the canvas. Reads state,
// never writes it — same contract as the HUD.

export interface BranchDebug {
  /** Advance the clock and repaint the panel from the current run state. */
  update(state: SkiState, dt: number): void;
  /** Zero the elapsed clock for a fresh run. */
  reset(): void;
  /** Remove the panel from the page. */
  destroy(): void;
}

export function createBranchDebug(): BranchDebug {
  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:fixed",
    "top:12px",
    "left:12px",
    "z-index:20",
    "padding:10px 12px",
    "font:12px/1.5 ui-monospace,Menlo,Consolas,monospace",
    "color:#eaf2ff",
    "background:rgba(18,24,34,0.82)",
    "border:1px solid rgba(150,180,220,0.35)",
    "border-radius:8px",
    "white-space:pre",
    "pointer-events:none",
    "letter-spacing:0.02em",
  ].join(";");
  document.body.appendChild(panel);

  let elapsed = 0;
  // The default road (walked from the summit) — anything off it is a detour
  // world. From route.ts, so the label tracks the topology.
  const road = roadSegmentIds();

  const fmt = (n: number): string => n.toFixed(1);

  return {
    update(state, dt) {
      // The run clock runs while there's a run to time (not once it's coasted
      // out or forfeited) — that's the "same clock" being measured.
      if (state.status === "skiing" || state.status === "crashed") {
        elapsed += dt;
      }
      const onDetour = !road.has(state.segmentId);
      const routeDist = routeDistanceOf(state.segmentId, state.distance);
      const remaining = Math.max(0, TOTAL_ROUTE_LENGTH - routeDist);
      panel.textContent = [
        "BRANCHING MAP — §4",
        `segment    ${state.segmentId}${onDetour ? "  (detour)" : ""}`,
        `in segment ${fmt(state.distance)} / ${fmt(state.finishDistance)}`,
        `route      ${fmt(routeDist)} / ${TOTAL_ROUTE_LENGTH}`,
        `to flag    ${fmt(remaining)}   ← same on every route`,
        `elapsed    ${fmt(elapsed)}s`,
        `fork armed ${state.divertTo ?? "—"}`,
        `status     ${state.status}`,
      ].join("\n");
    },
    reset() {
      elapsed = 0;
    },
    destroy() {
      panel.remove();
    },
  };
}
