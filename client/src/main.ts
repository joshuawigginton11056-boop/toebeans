import {
  createInitialBedroomState,
  createInitialSkiState,
  stepBedroom,
  stepSkiing,
  type BedroomInput,
  type SkiInput,
  type SkiState,
} from "@toebeans/shared";
import {
  createBedroomScene,
  renderBedroom,
  syncBedroomSceneToState,
} from "./bedroomRender";
import { createSkiScene, render, syncSkiSceneToState } from "./skiRender";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

// Two gray-box scenes, one visible at a time. The game starts at home in
// the bedroom (that's where the core loop begins); Enter switches to the
// slope and back. Each scene keeps its own canvas — the inactive one is
// just hidden.
type Mode = "bedroom" | "slope";
let mode: Mode = "bedroom";

let bedroomState = createInitialBedroomState();
let skiState = createInitialSkiState();

const bedroomScene = createBedroomScene(container, bedroomState);
const skiScene = createSkiScene(container);

function showActiveCanvas(): void {
  bedroomScene.renderer.domElement.style.display =
    mode === "bedroom" ? "" : "none";
  skiScene.renderer.domElement.style.display = mode === "slope" ? "" : "none";
}
showActiveCanvas();

// HUD: DOM overlay on top of the canvas. Reads state only, never writes it.
const hud = document.createElement("div");
hud.style.cssText =
  "position:fixed;top:16px;left:16px;font:20px system-ui,sans-serif;" +
  "color:#1a1a2e;user-select:none;pointer-events:none;";
const livesEl = document.createElement("div");
const messageEl = document.createElement("div");
messageEl.style.cssText = "margin-top:8px;font-size:28px;font-weight:bold;";
const hintEl = document.createElement("div");
hintEl.style.cssText = "margin-top:8px;font-size:16px;color:#55556a;";
hud.append(livesEl, messageEl, hintEl);
document.body.appendChild(hud);

function syncHud(state: SkiState): void {
  if (mode === "bedroom") {
    livesEl.textContent = "";
    messageEl.textContent = "";
    hintEl.textContent = "Arrows/WASD to walk — Enter to go skiing";
    return;
  }
  livesEl.textContent = `\u{1F431} × ${state.lives}`;
  if (state.status === "crashed") {
    messageEl.textContent =
      state.lives > 0 ? "Crashed! Back to the checkpoint…" : "Crashed!";
  } else if (state.status === "forfeited") {
    messageEl.textContent = "Out of lives — run forfeited";
  } else {
    messageEl.textContent = "";
  }
  hintEl.textContent = "Enter to go home";
}

const heldKeys = new Set<string>();
window.addEventListener("keydown", (event) => {
  if (event.code === "Enter") {
    if (mode === "bedroom") {
      mode = "slope";
      // Every trip to the slope is a fresh run — full lives, back to the
      // top. This is also how you retry after a forfeit.
      skiState = createInitialSkiState();
    } else {
      mode = "bedroom";
    }
    showActiveCanvas();
    return;
  }
  heldKeys.add(event.code);
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));

function readSkiInput(): SkiInput {
  return {
    left: heldKeys.has("ArrowLeft") || heldKeys.has("KeyA"),
    right: heldKeys.has("ArrowRight") || heldKeys.has("KeyD"),
    up: heldKeys.has("ArrowUp") || heldKeys.has("KeyW"),
    down: heldKeys.has("ArrowDown") || heldKeys.has("KeyS"),
    jump: heldKeys.has("Space"),
    boost: heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight"),
  };
}

function readBedroomInput(): BedroomInput {
  return {
    left: heldKeys.has("ArrowLeft") || heldKeys.has("KeyA"),
    right: heldKeys.has("ArrowRight") || heldKeys.has("KeyD"),
    up: heldKeys.has("ArrowUp") || heldKeys.has("KeyW"),
    down: heldKeys.has("ArrowDown") || heldKeys.has("KeyS"),
  };
}

let lastTime = performance.now();

function loop(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (mode === "bedroom") {
    bedroomState = stepBedroom(bedroomState, readBedroomInput(), dt);
    syncBedroomSceneToState(bedroomScene, bedroomState);
    renderBedroom(bedroomScene);
  } else {
    skiState = stepSkiing(skiState, readSkiInput(), dt);
    syncSkiSceneToState(skiScene, skiState);
    render(skiScene);
  }
  syncHud(skiState);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

window.addEventListener("resize", () => {
  for (const handle of [bedroomScene, skiScene]) {
    handle.camera.aspect = window.innerWidth / window.innerHeight;
    handle.camera.updateProjectionMatrix();
    handle.renderer.setSize(window.innerWidth, window.innerHeight);
  }
});
