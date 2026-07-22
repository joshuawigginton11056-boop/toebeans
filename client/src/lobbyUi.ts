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

.lobby-hidden { display: none; }
`;

export type LobbyCycle = "character" | "skin" | "hair";

export interface LobbyUiCallbacks {
  onPlay(): void;
  onCycle(kind: LobbyCycle): void;
  onToggleMute(): void;
}

export interface LobbyUiHandle {
  /** Show or hide the whole menu (hidden while on the slope). */
  setVisible(visible: boolean): void;
  /** Reflect the current character's roster label on its cycler button. */
  setCharacterLabel(label: string): void;
  /** Reflect the mute state on the sound toggle. */
  setMuted(muted: boolean): void;
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

  menu.append(play.el, row);
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
  };
}
