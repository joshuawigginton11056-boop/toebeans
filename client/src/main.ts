import {
  createInitialSkiState,
  stepSkiing,
  type SkiInput,
  type SkiState,
} from "@toebeans/shared";
import { createSkiScene, render, syncSkiSceneToState } from "./skiRender";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

const sceneHandle = createSkiScene(container);

// HUD: DOM overlay on top of the canvas. Reads state only, never writes it.
const hud = document.createElement("div");
hud.style.cssText =
  "position:fixed;top:16px;left:16px;font:20px system-ui,sans-serif;" +
  "color:#1a1a2e;user-select:none;pointer-events:none;";
const livesEl = document.createElement("div");
const messageEl = document.createElement("div");
messageEl.style.cssText = "margin-top:8px;font-size:28px;font-weight:bold;";
hud.append(livesEl, messageEl);
document.body.appendChild(hud);

function syncHud(state: SkiState): void {
  livesEl.textContent = `\u{1F431} × ${state.lives}`;
  if (state.status === "crashed") {
    messageEl.textContent =
      state.lives > 0 ? "Crashed! Back to the checkpoint…" : "Crashed!";
  } else if (state.status === "forfeited") {
    messageEl.textContent = "Out of lives — run forfeited";
  } else {
    messageEl.textContent = "";
  }
}

const heldKeys = new Set<string>();
window.addEventListener("keydown", (event) => heldKeys.add(event.code));
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));

function readInput(): SkiInput {
  return {
    left: heldKeys.has("ArrowLeft") || heldKeys.has("KeyA"),
    right: heldKeys.has("ArrowRight") || heldKeys.has("KeyD"),
    up: heldKeys.has("ArrowUp") || heldKeys.has("KeyW"),
    down: heldKeys.has("ArrowDown") || heldKeys.has("KeyS"),
    jump: heldKeys.has("Space"),
    boost: heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight"),
  };
}

let state = createInitialSkiState();
let lastTime = performance.now();

function loop(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  state = stepSkiing(state, readInput(), dt);
  syncSkiSceneToState(sceneHandle, state);
  syncHud(state);
  render(sceneHandle);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

window.addEventListener("resize", () => {
  sceneHandle.camera.aspect = window.innerWidth / window.innerHeight;
  sceneHandle.camera.updateProjectionMatrix();
  sceneHandle.renderer.setSize(window.innerWidth, window.innerHeight);
});
