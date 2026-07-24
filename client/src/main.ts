import {
  createBranchingSkiState,
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
import { createBranchDebug, type BranchDebug } from "./branchDebug";
import { createGhosts } from "./ghosts";
import { createHud } from "./hud";
import { createLobbyScene, renderLobby, syncLobbyScene } from "./lobbyRender";
import { createLobbyUi, type LobbyCycle } from "./lobbyUi";
import {
  connectRoom,
  makePlayerId,
  makeRoomCode,
  normalizeRoomCode,
  type NetRoom,
} from "./net";
import { readSave, writeSave } from "./save";
import {
  codeMatchesAction,
  loadSettings,
  type Settings,
} from "./settings";
import { createSettingsMenu } from "./settingsMenu";
import {
  addBranchTerrain,
  createSkiScene,
  render,
  syncSkiSceneToState,
} from "./skiRender";
import { cycleTimeOfDay } from "./skiScene";

// The branching map (SLOPE_BRANCHING.md — "the actual map") is the DEFAULT slope
// now (director, 2026-07-24: the graded "real mountain" run must be what the live
// build shows — no more hiding it behind a dev flag; the old flat Overlook felt
// unchanged because the grade only ever lived on the branching map). Every trip to
// the slope loads the graded grayblock branching route (createBranchingSkiState).
// `?overlook=1` still loads the old flat Overlook for comparison. It's grayblock
// today (boxes + descending corridors, no dressing) — the real snow/forest is the
// slope-visuals session's parallel job; the mechanics (the 3D drop) are here now.
const params = new URLSearchParams(location.search);
const BRANCH_MAP = !params.has("overlook");
// The live proof readout stays a dev-only overlay (?branch or ?debug) so the
// default run isn't covered in dev text; the grayblock scenery always shows
// because it's the only ground until the visuals seam dresses it.
const BRANCH_DEBUG = params.has("branch") || params.has("debug");
let branchTerrainAdded = false;
let branchDebug: BranchDebug | null = null;

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

// On the branching map (now the default), never resume a saved slope run: a
// restore always rebuilds the Overlook (branching state isn't saved), so resuming
// would silently drop you onto the wrong slope with no grayblock. Force a clean
// lobby start; appearance/mute still come from the save. (`?overlook=1` turns
// BRANCH_MAP off and restores the saved Overlook run as before.)
let mode: SceneMode = BRANCH_MAP ? "lobby" : (restored?.mode ?? "lobby");
let skiState = restored?.ski ?? createInitialSkiState();
let muted = restored?.muted ?? false;
let appearance: Appearance = restored?.appearance ?? createDefaultAppearance();

// Player preferences — volume, music, key bindings (see settings.ts). Kept
// separate from the game save (they're settings, not progress). The live
// object is mutated in place by the settings menu; input reads bindings from
// it, so a rebind takes effect immediately.
const settings: Settings = loadSettings();

const lobbyScene = createLobbyScene(container);
const skiScene = createSkiScene(container);

// Ghost racing (multiplayer session, 2026-07-24). The other players' skiers,
// drawn into the slope scene from the pose packets net.ts relays. Client-only:
// no game state, no collisions — see ghosts.ts / net.ts.
const ghosts = createGhosts(skiScene.scene);
const myId = makePlayerId();
let room: NetRoom | null = null;
// Who we've heard from lately (id → last-seen ms), so the lobby status line
// can say "friend connected" / "waiting" and notice a friend leaving. Mirrors
// (deliberately, kept simple) the timeout ghosts.ts uses to drop stale rigs.
const peers = new Map<string, number>();
const PEER_TIMEOUT_MS = 3000;
// How often we broadcast our own pose while in a room (~12×/sec).
const NET_SEND_INTERVAL = 0.08;
let netSendTimer = 0;

function updateRoomStatus(): void {
  if (!room) return;
  if (peers.size > 0) {
    lobbyUi.setRoomStatus("Friend connected! Both hit the slopes to race.");
    return;
  }
  const caveat = room.canReachRemote
    ? ""
    : " (Heads up: same-device only until Supabase is set up.)";
  lobbyUi.setRoomStatus(`Waiting for your friend — share the code above.${caveat}`);
}

function openRoom(code: string): void {
  room?.close();
  peers.clear();
  ghosts.clear();
  lobbyScene.friends.clear();
  room = connectRoom(code, {
    onPacket: (packet) => {
      // BroadcastChannel has no self-filter, so drop echoes of our own pose.
      if (packet.id === myId) return;
      const isNew = !peers.has(packet.id);
      peers.set(packet.id, performance.now());
      ghosts.ingest(packet);
      // Also stand the friend up in the lobby vignette (lobbyRender.ts owns
      // the presentation; it hides them while they're onSlope). onPacket has
      // already dropped our own echo above, so this is only real friends.
      lobbyScene.friends.set(packet.id, packet.appearance, packet.onSlope);
      if (isNew) updateRoomStatus();
    },
    onStatus: (status) => {
      if (status === "connecting") lobbyUi.setRoomStatus("Connecting…");
      else if (status === "connected") updateRoomStatus();
      else if (status === "error")
        lobbyUi.setRoomStatus("Connection problem — check the code and try again.");
    },
  });
}

function leaveRoom(): void {
  room?.close();
  room = null;
  peers.clear();
  ghosts.clear();
  lobbyScene.friends.clear();
}

// Both scenes show the same character, so they always get the same
// appearance. Pushing it in (rather than the rigs reading state) keeps the
// renderers free of game-state knowledge.
function applyAppearance(): void {
  lobbyScene.player.setAppearance(appearance);
  skiScene.skier.setAppearance(appearance);
  lobbyUi.setCharacterLabel(resolveCharacter(appearance).label);
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
  if (BRANCH_MAP) {
    skiState = createBranchingSkiState();
    // The mountain terrain lives in the scene for good once dropped in — only
    // the run state resets per trip.
    if (!branchTerrainAdded) {
      addBranchTerrain(skiScene);
      branchTerrainAdded = true;
    }
    // The proof readout only under the dev flag (?branch/?debug) — see BRANCH_DEBUG.
    if (BRANCH_DEBUG) {
      if (!branchDebug) branchDebug = createBranchDebug();
      branchDebug.reset();
    }
  } else {
    skiState = createInitialSkiState();
  }
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
  onOpenSettings: () => settingsMenu.open(),
  // Ghost racing (multiplayer session). Create hands back a fresh code to
  // show; join/leave open and tear down the relay room. Deliberately not
  // saved — a room is a per-sitting thing, not game progress.
  onCreateRoom: () => {
    const code = makeRoomCode();
    openRoom(code);
    return code;
  },
  onJoinRoom: (code) => openRoom(normalizeRoomCode(code)),
  onLeaveRoom: leaveRoom,
});

applyAppearance();
showActiveCanvas();

// HUD: DOM overlay on top of the canvas (see hud.ts). Reads state only,
// never writes it. Synced once up front so the right panels show even
// before the first animation frame (browsers pause frames in hidden tabs).
const hud = createHud(settings);
hud.sync(mode, skiState);

// Sound effects (see audio.ts). Reads state only, like the HUD.
const audio = createAudio(muted);
lobbyUi.setMuted(muted);
// Apply saved preferences to the audio graph up front (they take hold once
// the graph builds on the first keypress).
audio.setVolume(settings.masterVolume);
audio.setMusicEnabled(settings.musicEnabled);

// The settings menu (volume, music, controls). It edits the live `settings`
// object; we apply sound changes to audio immediately, and input reads the
// updated bindings on its own each frame — nothing else to re-wire.
const settingsMenu = createSettingsMenu({
  settings,
  onVolume: (volume) => audio.setVolume(volume),
  onMusic: (enabled) => audio.setMusicEnabled(enabled),
  onBindingsChanged: () => {
    /* Input reads settings.bindings live; nothing to refresh here. */
  },
  onClose: () => {
    /* Focus returns to the page automatically; nothing to restore. */
  },
});

// ?branch/?debug: drop straight into the map so it's on screen immediately (a dev
// convenience). The default flow keeps the lobby first — load, see the menu, press
// "Hit the slopes" to ride the graded mountain.
if (BRANCH_DEBUG) goSkiing();

const AUTOSAVE_SECONDS = 5;
let autosaveTimer = 0;

const heldKeys = new Set<string>();

// The air spin's side (turning round 9): holding Space airborne spins the
// body — toward the steer key held right now, else the last steered
// direction (director call, 2026-07-23), defaulting right before any
// steer. The sim takes the side as an input and owns everything else.
let lastSteerSide: -1 | 1 = 1;

window.addEventListener("keydown", (event) => {
  // Global/gameplay keys read their codes from the player's bindings
  // (settings.ts) so rebinds take effect here without any extra wiring.
  if (codeMatchesAction(settings, "mute", event.code)) {
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
  // Debug (slope-vis, 2026-07-24): N cycles time of day dawn → dusk → night →
  // dawn so the director can look-pass the night atmosphere. Slope-only; a
  // stand-in until the "sun sets as you race" auto-transition lands.
  if (event.code === "KeyN") {
    if (mode === "slope") cycleTimeOfDay();
    return;
  }
  // Camera round 3 (slope-mech): the slope camera is all mouse/touch now —
  // wheel/pinch zoom and Pointer-Lock mouse look (click to engage, Esc to
  // release), wired in skiRender.ts. No keyboard camera control (V is gone).
  if (codeMatchesAction(settings, "lobby", event.code)) {
    if (mode === "lobby") goSkiing();
    else backToLobby();
    return;
  }
  if (codeMatchesAction(settings, "left", event.code)) lastSteerSide = -1;
  if (codeMatchesAction(settings, "right", event.code)) lastSteerSide = 1;
  heldKeys.add(event.code);
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));

function readSkiInput(): SkiInput {
  // Each action is "down" if its bound key or its fixed alternate (WASD etc.)
  // is held — see codeMatchesAction. Checking the whole held set keeps this
  // agnostic to which physical key a player chose.
  const down = (action: Parameters<typeof codeMatchesAction>[1]): boolean => {
    for (const code of heldKeys) {
      if (codeMatchesAction(settings, action, code)) return true;
    }
    return false;
  };
  const left = down("left");
  const right = down("right");
  const jump = down("jump");
  // The spin side: a held steer key wins (both held = the last pressed),
  // else the last steered direction. The sim only spins airborne — on the
  // snow a held jump key stays the jump charge.
  const spin = jump ? (left && !right ? -1 : right && !left ? 1 : lastSteerSide) : 0;
  return {
    left,
    right,
    up: down("faster"),
    down: down("brake"),
    jump,
    boost: down("boost"),
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
    // Ghost racing: place/animate the friend's skier(s) before drawing.
    ghosts.update(performance.now(), dt);
    render(skiScene);
    // The branching map's live proof readout (dev-only, ?branch=1).
    branchDebug?.update(skiState, dt);
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

  // Ghost racing: while in a room, broadcast our own pose a few times a second
  // (lobby or slope — onSlope tells the friend whether to show our ghost), and
  // let the status line notice a friend who's gone quiet.
  if (room) {
    netSendTimer += dt;
    if (netSendTimer >= NET_SEND_INTERVAL) {
      netSendTimer = 0;
      room.send({
        id: myId,
        name: "Friend",
        appearance,
        onSlope: mode === "slope",
        seg: skiState.segmentId,
        dist: skiState.distance,
        lat: skiState.lateral,
        h: skiState.height,
        spd: skiState.speed,
        hd: skiState.heading,
        st: skiState.status,
      });
    }
    const nowMs = performance.now();
    let pruned = false;
    for (const [id, seen] of peers) {
      if (nowMs - seen > PEER_TIMEOUT_MS) {
        peers.delete(id);
        // Their lobby stand-in leaves with them (ghosts.ts expires its own
        // rig on the same timeout).
        lobbyScene.friends.remove(id);
        pruned = true;
      }
    }
    if (pruned && mode === "lobby") updateRoomStatus();
  }

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
