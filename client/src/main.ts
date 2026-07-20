import { createInitialSkiState, stepSkiing, type SkiInput } from "@toebeans/shared";
import { createSkiScene, render, syncSkiSceneToState } from "./skiRender";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

const sceneHandle = createSkiScene(container);

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
let announcedCrash = false;

function loop(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  state = stepSkiing(state, readInput(), dt);
  syncSkiSceneToState(sceneHandle, state);
  render(sceneHandle);

  if (state.crashed && !announcedCrash) {
    announcedCrash = true;
    console.log(`Crashed at distance ${state.distance.toFixed(1)}`);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

window.addEventListener("resize", () => {
  sceneHandle.camera.aspect = window.innerWidth / window.innerHeight;
  sceneHandle.camera.updateProjectionMatrix();
  sceneHandle.renderer.setSize(window.innerWidth, window.innerHeight);
});
