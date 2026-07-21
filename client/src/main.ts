import {
  createInitialBedroomState,
  createInitialSkiState,
  stepBedroom,
  stepSkiing,
  type BedroomInput,
  type SkiInput,
} from "@toebeans/shared";
import {
  createBedroomScene,
  renderBedroom,
  syncBedroomSceneToState,
} from "./bedroomRender";
import { createAudio } from "./audio";
import { createHud } from "./hud";
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

// HUD: DOM overlay on top of the canvas (see hud.ts). Reads state only,
// never writes it. Synced once up front so the right panels show even
// before the first animation frame (browsers pause frames in hidden tabs).
const hud = createHud();
hud.sync(mode, skiState);

// Sound effects (see audio.ts). Reads state only, like the HUD.
const audio = createAudio();

const heldKeys = new Set<string>();
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyM") {
    audio.toggleMuted();
    return;
  }
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
  hud.sync(mode, skiState);
  audio.sync(mode, skiState);

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
