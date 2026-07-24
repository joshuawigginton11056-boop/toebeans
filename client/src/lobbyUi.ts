// The lobby menu (director call, 2026-07-22): the game's first real
// front-of-house. A DOM overlay on the lobby vignette — the title, the Play
// button, the character/skin/hair cyclers (the buttons the C/K/H keys were
// always stand-ins for), and the mute toggle. Pure view: every interaction
// goes out through a callback, and main.ts owns what they mean.
//
// Styled to the Art Style Bible palette and the director's middle-ground UI
// tone (DESIGN.md, 2026-07-21): soft rounded rectangles, hairline borders,
// semi-bold lettering. Signal red stays reserved for warnings, so the Play
// button is birch amber — the cozy accent, not the alarm.

const SUNLIT_SNOW = "#F8F5EF";
const SNOW_SHADOW = "#D3DFF0";
const BIRCH_AMBER = "#E9A960";
const SLATE_DEEP = "#2E3548"; // deep value shift — the bible bans pure black

const LOBBY_CSS = `
.lobby {
  position: fixed;
  inset: 0;
  pointer-events: none;
  user-select: none;
  font-family: "Segoe UI", system-ui, sans-serif;
  color: ${SLATE_DEEP};
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lobby-title {
  margin-top: 9vh;
  font-size: 64px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-shadow: 0 2px 0 ${SUNLIT_SNOW}, 0 3px 14px ${SNOW_SHADOW};
}

.lobby-menu {
  margin-top: auto;
  margin-bottom: 7vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  pointer-events: auto;
}

.lobby-button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 22px;
  border-radius: 12px;
  border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW}CC;
  color: ${SLATE_DEEP};
  font: 600 15px "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease;
}
.lobby-button:hover { transform: translateY(-1px); }
.lobby-button:active { transform: translateY(0); }

.lobby-play {
  padding: 14px 44px;
  font-size: 20px;
  background: ${BIRCH_AMBER}F2;
  border-color: ${SUNLIT_SNOW};
}
.lobby-play:hover { background: ${BIRCH_AMBER}; }

.lobby-row {
  display: flex;
  gap: 10px;
}

.lobby-key {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 5px;
  background: ${SNOW_SHADOW};
  border: 1px solid ${SLATE_DEEP}26;
  border-bottom-width: 2px;
  font-size: 11px;
  font-weight: 600;
}
.lobby-play .lobby-key { background: ${SUNLIT_SNOW}; }

.lobby-value {
  font-weight: 500;
  opacity: 0.85;
}

/* Play-with-a-friend panel (multiplayer session, 2026-07-24). A small card
   that drops open under the menu: create a room, or type a friend's code to
   join, with a live status line. Same palette + soft-rectangle tone. */
.lobby-friend-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW}E6;
  max-width: 320px;
}
.lobby-friend-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.lobby-code-input {
  width: 96px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW};
  color: ${SLATE_DEEP};
  font: 600 18px "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.14em;
  text-align: center;
  text-transform: uppercase;
}
.lobby-code-input::placeholder { color: ${SLATE_DEEP}66; letter-spacing: 0.14em; }
.lobby-room-code {
  font: 700 30px "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.22em;
  color: ${SLATE_DEEP};
}
.lobby-room-status {
  font-size: 13px;
  font-weight: 500;
  opacity: 0.85;
  text-align: center;
  min-height: 1.2em;
}
.lobby-friend-or { font-size: 12px; opacity: 0.6; }

.lobby-hidden { display: none; }
`;

export type LobbyCycle = "character" | "skin" | "hair";

export interface LobbyUiCallbacks {
  onPlay(): void;
  onCycle(kind: LobbyCycle): void;
  onToggleMute(): void;
  /** Create a new room; returns the code to show. */
  onCreateRoom(): string;
  /** Join an existing room by code (already normalized/uppercased). */
  onJoinRoom(code: string): void;
  /** Leave the current room. */
  onLeaveRoom(): void;
}

export interface LobbyUiHandle {
  /** Show or hide the whole menu (hidden while on the slope). */
  setVisible(visible: boolean): void;
  /** Reflect the current character's roster label on its cycler button. */
  setCharacterLabel(label: string): void;
  /** Reflect the mute state on the sound toggle. */
  setMuted(muted: boolean): void;
  /** Update the room panel's status line (connection + who's connected). */
  setRoomStatus(text: string): void;
}

function button(
  className: string,
  label: string,
  key: string,
  onClick: () => void,
): { el: HTMLButtonElement; value: HTMLSpanElement } {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `lobby-button ${className}`;
  const text = document.createElement("span");
  text.textContent = label;
  const value = document.createElement("span");
  value.className = "lobby-value";
  const keycap = document.createElement("span");
  keycap.className = "lobby-key";
  keycap.textContent = key;
  el.append(text, value, keycap);
  el.addEventListener("click", () => {
    onClick();
    // A clicked button keeps keyboard focus, and Enter/Space then re-fire
    // the *button* instead of meaning "play" — hand focus back to the page.
    el.blur();
  });
  return { el, value };
}

export function createLobbyUi(callbacks: LobbyUiCallbacks): LobbyUiHandle {
  const style = document.createElement("style");
  style.textContent = LOBBY_CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "lobby";

  const title = document.createElement("div");
  title.className = "lobby-title";
  title.textContent = "Toebeans";

  const menu = document.createElement("div");
  menu.className = "lobby-menu";

  const play = button("lobby-play", "Hit the slopes", "Enter", callbacks.onPlay);

  const row = document.createElement("div");
  row.className = "lobby-row";
  const character = button("", "Character", "C", () =>
    callbacks.onCycle("character"),
  );
  const skin = button("", "Skin", "K", () => callbacks.onCycle("skin"));
  const hair = button("", "Hair", "H", () => callbacks.onCycle("hair"));
  const mute = button("", "Sound", "M", callbacks.onToggleMute);
  row.append(character.el, skin.el, hair.el, mute.el);

  // --- Play with a friend (ghost racing) ---------------------------------
  // A toggle button that opens a card: create a room to get a code, or join a
  // friend's code. Once in a room the card shows the code big (to read aloud)
  // plus a live status line, and Leave tears it down.
  const friendToggle = button("", "Play with a friend", "", () =>
    setPanelOpen(panel.classList.contains("lobby-hidden")),
  );

  const panel = document.createElement("div");
  panel.className = "lobby-friend-panel lobby-hidden";

  // The pre-room controls: Create / or / join by code.
  const startRow = document.createElement("div");
  startRow.className = "lobby-friend-row";
  const createBtn = button("", "Create room", "", () => {
    const code = callbacks.onCreateRoom();
    enterRoom(code);
  });
  const or = document.createElement("span");
  or.className = "lobby-friend-or";
  or.textContent = "or";
  const codeInput = document.createElement("input");
  codeInput.className = "lobby-code-input";
  codeInput.placeholder = "CODE";
  codeInput.maxLength = 4;
  codeInput.autocapitalize = "characters";
  codeInput.spellcheck = false;
  const joinBtn = button("", "Join", "", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) return;
    callbacks.onJoinRoom(code);
    enterRoom(code);
  });
  // Enter in the code box joins, rather than bubbling up to "hit the slopes".
  codeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.stopPropagation();
      joinBtn.el.click();
    }
  });
  startRow.append(createBtn.el, or, codeInput, joinBtn.el);

  // The in-room view: the code (big), a status line, and Leave.
  const roomView = document.createElement("div");
  roomView.className = "lobby-friend-panel lobby-hidden";
  roomView.style.border = "none";
  roomView.style.background = "transparent";
  roomView.style.padding = "0";
  const codeLabel = document.createElement("div");
  codeLabel.className = "lobby-room-code";
  const status = document.createElement("div");
  status.className = "lobby-room-status";
  const leaveBtn = button("", "Leave", "", () => {
    callbacks.onLeaveRoom();
    leaveRoom();
  });
  roomView.append(codeLabel, status, leaveBtn.el);

  panel.append(startRow, roomView);

  function setPanelOpen(open: boolean): void {
    panel.classList.toggle("lobby-hidden", !open);
  }
  function enterRoom(code: string): void {
    // Just show the code and swap to the in-room view — the status line is
    // driven by main.ts via setRoomStatus (openRoom fires the first status
    // synchronously *before* this runs, so we must not clobber it here).
    codeLabel.textContent = code;
    startRow.classList.add("lobby-hidden");
    roomView.classList.remove("lobby-hidden");
  }
  function leaveRoom(): void {
    roomView.classList.add("lobby-hidden");
    startRow.classList.remove("lobby-hidden");
    codeInput.value = "";
  }

  menu.append(play.el, row, friendToggle.el, panel);
  root.append(title, menu);
  document.body.appendChild(root);

  return {
    setVisible(visible: boolean): void {
      root.classList.toggle("lobby-hidden", !visible);
    },
    setCharacterLabel(label: string): void {
      character.value.textContent = label;
    },
    setMuted(muted: boolean): void {
      mute.value.textContent = muted ? "off" : "on";
    },
    setRoomStatus(text: string): void {
      status.textContent = text;
    },
  };
}
