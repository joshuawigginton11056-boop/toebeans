import {
  createDefaultAppearance,
  createInitialBedroomState,
  createInitialSkiState,
  createSave,
  cycleCharacter,
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

// Wheel notches for the bedroom's camera zoom, accumulated between frames
// (trackpads fire many tiny events per frame) and consumed once per loop.
let wheelSteps = 0;
window.addEventListener(
  "wheel",
  (event) => {
    wheelSteps += event.deltaY / 100;
  },
  { passive: true },
);

// Dragging on the bedroom canvas orbits the camera — horizontal for spin,
// vertical for tilt. Pixel deltas accumulate between frames (like the
// wheel) and are consumed once per loop. Pointer events rather than mouse
// events, so touch-dragging works the same way on the web portals' touch
// devices (an M5 concern, nearly free here). Any mouse button drags:
// left-drag is the convention players try first, and if M3's
// click-to-interact furniture ever wants left-click to itself, a
// click-vs-drag movement threshold keeps both.
let dragPixelsX = 0;
let dragPixelsY = 0;
let dragPointerId: number | null = null;
let dragLastX = 0;
let dragLastY = 0;

const bedroomCanvas = bedroomScene.renderer.domElement;
// Without this, touch-dragging scrolls/zooms the page instead of sending
// pointermove events.
bedroomCanvas.style.touchAction = "none";
// Right-drag orbits too, so the browser's right-click menu can't pop
// mid-gesture. Canvas only — the rest of the page keeps its menu.
bedroomCanvas.addEventListener("contextmenu", (event) =>
  event.preventDefault(),
);
bedroomCanvas.addEventListener("pointerdown", (event) => {
  if (dragPointerId !== null) return; // one drag at a time
  dragPointerId = event.pointerId;
  dragLastX = event.clientX;
  dragLastY = event.clientY;
  // Capture so the drag keeps working when the pointer leaves the canvas
  // mid-gesture (or the window, for mice). Capture is a nicety, not a
  // requirement — it can throw for a pointer that's already gone (or a
  // synthetic event), and the drag still works without it.
  try {
    bedroomCanvas.setPointerCapture(event.pointerId);
  } catch {
    // no capture: the drag just ends at the canvas edge
  }
});
bedroomCanvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== dragPointerId) return;
  dragPixelsX += event.clientX - dragLastX;
  dragPixelsY += event.clientY - dragLastY;
  dragLastX = event.clientX;
  dragLastY = event.clientY;
});
const endDrag = (event: PointerEvent): void => {
  if (event.pointerId === dragPointerId) dragPointerId = null;
};
bedroomCanvas.addEventListener("pointerup", endDrag);
bedroomCanvas.addEventListener("pointercancel", endDrag);

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyM") {
    muted = audio.toggleMuted();
    persist();
    return;
  }
  // Appearance keys, all temporary stand-ins for the character picker and
  // customization UI (an M3 item) — the only way to see the roster and the
  // color seam working until then. C cycles through the character roster;
  // K and H cycle skin and hair color. Bedroom only, matching what the HUD
  // hints already claimed — swapping your whole body mid-run on the slope
  // was a playtest surprise (director, 2026-07-21).
  if (event.code === "KeyC" || event.code === "KeyK" || event.code === "KeyH") {
    if (mode !== "bedroom") return;
    appearance =
      event.code === "KeyC"
        ? cycleCharacter(appearance)
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

// Walking is camera-relative: "up" always means "away from the camera",
// however far the room has been spun. The keys are turned into a screen-
// space direction, rotated by the camera's current angle into world space,
// and quantized back to the 8-way booleans /shared expects — so the shared
// simulation stays camera-ignorant.
const EIGHT_WAY_THRESHOLD = Math.sin(Math.PI / 8);

function readBedroomInput(cameraAzimuth: number): BedroomInput {
  const screenX =
    (heldKeys.has("ArrowRight") || heldKeys.has("KeyD") ? 1 : 0) -
    (heldKeys.has("ArrowLeft") || heldKeys.has("KeyA") ? 1 : 0);
  const screenZ =
    (heldKeys.has("ArrowDown") || heldKeys.has("KeyS") ? 1 : 0) -
    (heldKeys.has("ArrowUp") || heldKeys.has("KeyW") ? 1 : 0);
  if (screenX === 0 && screenZ === 0) {
    return { left: false, right: false, up: false, down: false };
  }
  // At azimuth 0 (the classic view) screen space and world space agree;
  // rotating the camera rotates what "screen right/down" mean in the world.
  const sin = Math.sin(cameraAzimuth);
  const cos = Math.cos(cameraAzimuth);
  const worldX = screenX * cos + screenZ * sin;
  const worldZ = -screenX * sin + screenZ * cos;
  const length = Math.hypot(worldX, worldZ);
  const x = worldX / length;
  const z = worldZ / length;
  return {
    left: x < -EIGHT_WAY_THRESHOLD,
    right: x > EIGHT_WAY_THRESHOLD,
    up: z < -EIGHT_WAY_THRESHOLD,
    down: z > EIGHT_WAY_THRESHOLD,
  };
}

let lastTime = performance.now();

function loop(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (mode === "bedroom") {
    // Q/E spin the room, R/F tilt it, the wheel zooms, dragging the canvas
    // orbits. Wheel notches and drag pixels are consumed once per frame.
    const cameraInput = {
      rotate:
        (heldKeys.has("KeyE") ? 1 : 0) - (heldKeys.has("KeyQ") ? 1 : 0),
      tilt: (heldKeys.has("KeyR") ? 1 : 0) - (heldKeys.has("KeyF") ? 1 : 0),
      zoomSteps: wheelSteps,
      dragX: dragPixelsX,
      dragY: dragPixelsY,
    };
    wheelSteps = 0;
    dragPixelsX = 0;
    dragPixelsY = 0;
    bedroomState = stepBedroom(
      bedroomState,
      readBedroomInput(bedroomScene.orbit.azimuth),
      dt,
    );
    syncBedroomSceneToState(bedroomScene, bedroomState, dt, cameraInput);
    renderBedroom(bedroomScene);
  } else {
    // Scrolling and dragging do nothing on the slope — drop them so they
    // can't pile up and lurch the camera when you get home.
    wheelSteps = 0;
    dragPixelsX = 0;
    dragPixelsY = 0;
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
