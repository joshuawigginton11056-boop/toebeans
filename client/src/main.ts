import {
  createDefaultAppearance,
  createInitialBedroomState,
  createInitialSkiState,
  createSave,
  cycleBase,
  cycleRegion,
  restoreSave,
  stepBedroom,
  stepSkiing,
  type Appearance,
  type BedroomInput,
  type SceneMode,
  type SkiInput,
} from "@toebeans/shared";
import {
  createBedroomScene,
  renderBedroom,
  syncBedroomSceneToState,
} from "./bedroomRender";
import { createAudio } from "./audio";
import { createHud } from "./hud";
import { readSave, writeSave } from "./save";
import { createSkiScene, render, syncSkiSceneToState } from "./skiRender";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

// Two gray-box scenes, one visible at a time. The game starts at home in
// the bedroom (that's where the core loop begins); Enter switches to the
// slope and back. Each scene keeps its own canvas — the inactive one is
// just hidden.
//
// Save/load (M2): if browser storage holds a valid save, the game resumes
// exactly where it left off — same scene, same spot, mid-run and all.
// Anything invalid (corrupt, old version) is ignored and you start fresh.
const restored = (() => {
  const save = readSave();
  return save === null ? null : restoreSave(save);
})();

let mode: SceneMode = restored?.mode ?? "bedroom";
let bedroomState = restored?.bedroom ?? createInitialBedroomState();
let skiState = restored?.ski ?? createInitialSkiState();
let muted = restored?.muted ?? false;
let appearance: Appearance = restored?.appearance ?? createDefaultAppearance();

const bedroomScene = createBedroomScene(container, bedroomState);
const skiScene = createSkiScene(container);

// Both scenes show the same character, so they always get the same
// appearance. Pushing it in (rather than the rigs reading state) keeps the
// renderers free of game-state knowledge.
function applyAppearance(): void {
  bedroomScene.player.setAppearance(appearance);
  skiScene.skier.setAppearance(appearance);
}
applyAppearance();

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
const audio = createAudio(muted);

// Persist the whole game as one snapshot. Called on scene switches and mute
// (the moments that feel like "progress"), every few seconds as a safety
// net, and when the tab is hidden or closed.
function persist(): void {
  writeSave(createSave(mode, bedroomState, skiState, muted, appearance));
}

const AUTOSAVE_SECONDS = 5;
let autosaveTimer = 0;

const heldKeys = new Set<string>();
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyM") {
    muted = audio.toggleMuted();
    persist();
    return;
  }
  // Appearance keys. B is temporary — it swaps between the two candidate
  // skier models so the director can pick one by eye, and goes away with
  // the losing model. K and H stand in for the real customization UI (an M3
  // item) and are the only way to see the color seam working until then.
  if (event.code === "KeyB" || event.code === "KeyK" || event.code === "KeyH") {
    appearance =
      event.code === "KeyB"
        ? cycleBase(appearance)
        : cycleRegion(appearance, event.code === "KeyK" ? "skin" : "hair");
    applyAppearance();
    persist();
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
    persist();
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
    syncBedroomSceneToState(bedroomScene, bedroomState, dt);
    renderBedroom(bedroomScene);
  } else {
    skiState = stepSkiing(skiState, readSkiInput(), dt);
    syncSkiSceneToState(skiScene, skiState, dt);
    render(skiScene);
  }
  hud.sync(mode, skiState);
  audio.sync(mode, skiState);

  autosaveTimer += dt;
  if (autosaveTimer >= AUTOSAVE_SECONDS) {
    autosaveTimer = 0;
    persist();
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Save at the moments the page might go away: tab hidden (browsers pause
// hidden tabs, and mobile may never fire pagehide) and actual unload.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});
window.addEventListener("pagehide", () => persist());

window.addEventListener("resize", () => {
  for (const handle of [bedroomScene, skiScene]) {
    handle.camera.aspect = window.innerWidth / window.innerHeight;
    handle.camera.updateProjectionMatrix();
    handle.renderer.setSize(window.innerWidth, window.innerHeight);
  }
});
