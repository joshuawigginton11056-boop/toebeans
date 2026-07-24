import {
  createDefaultAppearance,
  createInitialSkiState,
  createSave,
  cycleCharacter,
  cycleRegion,
  resolveCharacter,
  restoreSave,
  stepSkiing,
  type Appearance,
  type SceneMode,
  type SkiInput,
} from "@toebeans/shared";
import { createAudio } from "./audio";
import { createHud } from "./hud";
import {
  createLobbyScene,
  renderLobby,
  setLobbyLocalName,
  setLobbyPlayerCount,
  syncLobbyScene,
} from "./lobbyRender";
import { createLobbyUi, type LobbyCycle } from "./lobbyUi";
import { readSave, writeSave } from "./save";
import { createSkiScene, render, syncSkiSceneToState } from "./skiRender";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

// Two scenes, one visible at a time. The game opens on the lobby — a
// menu-style front-of-house (director call, 2026-07-22: the walkable
// bedroom is scrapped) with your character and the cat idling behind the
// menu. Play (or Enter) heads to the slope; Enter comes back. Each scene
// keeps its own canvas — the inactive one is just hidden.
//
// Save/load (M2): if browser storage holds a valid save, the game resumes
// exactly where it left off — same scene, mid-run and all. Anything invalid
// (corrupt, old version) is ignored and you start fresh.
const restored = (() => {
  const save = readSave();
  return save === null ? null : restoreSave(save);
})();

let mode: SceneMode = restored?.mode ?? "lobby";
let skiState = restored?.ski ?? createInitialSkiState();
let muted = restored?.muted ?? false;
let appearance: Appearance = restored?.appearance ?? createDefaultAppearance();

const lobbyScene = createLobbyScene(container);
const skiScene = createSkiScene(container);

// Lobby party size. Single-player today, but the lobby can stand up to four
// characters (you plus guests, each with a glowing orb). Until real
// multiplayer wires in the live party, `?players=2..4` previews the layouts —
// you shift left (2/4) or to the middle (3), always a step in front.
const lobbyPlayers = Number(new URLSearchParams(location.search).get("players"));
if (Number.isFinite(lobbyPlayers) && lobbyPlayers > 1) {
  setLobbyPlayerCount(lobbyScene, lobbyPlayers);
}

// Both scenes show the same character, so they always get the same
// appearance. Pushing it in (rather than the rigs reading state) keeps the
// renderers free of game-state knowledge.
function applyAppearance(): void {
  lobbyScene.player.setAppearance(appearance);
  skiScene.skier.setAppearance(appearance);
  const label = resolveCharacter(appearance).label;
  lobbyUi.setCharacterLabel(label);
  // Keep the name on your lobby orb in step with the character you're wearing.
  setLobbyLocalName(lobbyScene, label);
}

function showActiveCanvas(): void {
  lobbyScene.renderer.domElement.style.display =
    mode === "lobby" ? "" : "none";
  skiScene.renderer.domElement.style.display = mode === "slope" ? "" : "none";
  lobbyUi.setVisible(mode === "lobby");
}

// Persist the whole game as one snapshot. Called on scene switches, mute,
// and appearance changes (the moments that feel like "progress"), every few
// seconds as a safety net, and when the tab is hidden or closed.
function persist(): void {
  writeSave(createSave(mode, skiState, muted, appearance));
}

function goSkiing(): void {
  if (mode === "slope") return;
  mode = "slope";
  // Every trip to the slope is a fresh run — full lives, back to the top.
  // This is also how you retry after a forfeit.
  skiState = createInitialSkiState();
  showActiveCanvas();
  persist();
}

function backToLobby(): void {
  if (mode === "lobby") return;
  mode = "lobby";
  showActiveCanvas();
  persist();
}

function cycleAppearance(kind: LobbyCycle): void {
  // Lobby only — the menu is only clickable there anyway, but the C/K/H
  // keys share this path, and swapping your whole body mid-run on the slope
  // was a playtest surprise once already (director, 2026-07-21).
  if (mode !== "lobby") return;
  appearance =
    kind === "character"
      ? cycleCharacter(appearance)
      : cycleRegion(appearance, kind);
  applyAppearance();
  persist();
}

// The lobby menu: buttons for everything the keyboard can do, because a
// menu screen that only answers to keys isn't a menu (and the web portals'
// touch devices have no keys at all).
const lobbyUi = createLobbyUi({
  onPlay: goSkiing,
  onCycle: cycleAppearance,
  onToggleMute: () => {
    muted = audio.toggleMuted();
    lobbyUi.setMuted(muted);
    persist();
  },
});

applyAppearance();
showActiveCanvas();

// HUD: DOM overlay on top of the canvas (see hud.ts). Reads state only,
// never writes it. Synced once up front so the right panels show even
// before the first animation frame (browsers pause frames in hidden tabs).
const hud = createHud();
hud.sync(mode, skiState);

// Sound effects (see audio.ts). Reads state only, like the HUD.
const audio = createAudio(muted);
lobbyUi.setMuted(muted);

const AUTOSAVE_SECONDS = 5;
let autosaveTimer = 0;

const heldKeys = new Set<string>();

// The air spin's side (turning round 9): holding Space airborne spins the
// body — toward the steer key held right now, else the last steered
// direction (director call, 2026-07-23), defaulting right before any
// steer. The sim takes the side as an input and owns everything else.
let lastSteerSide: -1 | 1 = 1;

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyM") {
    muted = audio.toggleMuted();
    lobbyUi.setMuted(muted);
    persist();
    return;
  }
  // Appearance keys — the same cycles as the lobby's buttons (C character,
  // K skin, H hair), kept for keyboard players.
  if (event.code === "KeyC" || event.code === "KeyK" || event.code === "KeyH") {
    cycleAppearance(
      event.code === "KeyC" ? "character" : event.code === "KeyK" ? "skin" : "hair",
    );
    return;
  }
  // Camera round 3 (slope-mech): the slope camera is all mouse/touch now —
  // wheel/pinch zoom and Pointer-Lock mouse look (click to engage, Esc to
  // release), wired in skiRender.ts. No keyboard camera control (V is gone).
  if (event.code === "Enter") {
    if (mode === "lobby") goSkiing();
    else backToLobby();
    return;
  }
  if (event.code === "ArrowLeft" || event.code === "KeyA") lastSteerSide = -1;
  if (event.code === "ArrowRight" || event.code === "KeyD") lastSteerSide = 1;
  heldKeys.add(event.code);
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));

function readSkiInput(): SkiInput {
  const left = heldKeys.has("ArrowLeft") || heldKeys.has("KeyA");
  const right = heldKeys.has("ArrowRight") || heldKeys.has("KeyD");
  const jump = heldKeys.has("Space");
  // The spin side: a held steer key wins (both held = the last pressed),
  // else the last steered direction. The sim only spins airborne — on the
  // snow a held Space stays the jump charge.
  const spin = jump ? (left && !right ? -1 : right && !left ? 1 : lastSteerSide) : 0;
  return {
    left,
    right,
    up: heldKeys.has("ArrowUp") || heldKeys.has("KeyW"),
    down: heldKeys.has("ArrowDown") || heldKeys.has("KeyS"),
    jump,
    boost: heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight"),
    spin,
  };
}

let lastTime = performance.now();

function loop(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (mode === "lobby") {
    // No game state in the lobby — the vignette just idles (see
    // lobbyRender.ts): rigs animate, the camera sways, the cat strolls.
    syncLobbyScene(lobbyScene, dt);
    renderLobby(lobbyScene);
  } else {
    skiState = stepSkiing(skiState, readSkiInput(), dt);
    syncSkiSceneToState(skiScene, skiState, dt);
    render(skiScene);
    // Finishing the slope coasts to a stop and then auto-returns to the lobby
    // (director call, 2026-07-23): once the post-finish linger runs out, head
    // back. goSkiing() will start a fresh run next time Play is pressed.
    if (skiState.status === "finished" && skiState.finishTimer <= 0) {
      backToLobby();
    }
  }
  hud.sync(mode, skiState);
  // audio.ts is slope-session territory and its AudioMode still says
  // "bedroom" for the quiet scene — map at the call site rather than edit
  // their file (IDEAS.md has a (slope) note to rename it at leisure).
  audio.sync(mode === "slope" ? "slope" : "bedroom", skiState);

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
  for (const handle of [lobbyScene, skiScene]) {
    handle.camera.aspect = window.innerWidth / window.innerHeight;
    handle.camera.updateProjectionMatrix();
    handle.renderer.setSize(window.innerWidth, window.innerHeight);
  }
});
