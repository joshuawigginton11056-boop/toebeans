// The settings menu (lobby session, 2026-07-24): a modal card over the lobby
// with a master-volume slider, a music on/off toggle, and rebindable controls.
// Pure view, same as the rest of the UI — it mutates the live Settings object
// it's handed and calls back out so main.ts can apply changes and audio can
// react live; it never touches game state.
//
// Styled to the Art Style Bible palette and the director's middle-ground tone
// (soft rounded rectangles, hairline borders, semi-bold lettering). Birch
// amber is the cozy accent (the "on"/active color); signal red stays reserved
// for the one warning it owns — the "press a key" rebind prompt, which is a
// "look at this, I'm listening" moment.

import {
  ACTION_META,
  keyLabel,
  saveSettings,
  type ControlAction,
  type Settings,
} from "./settings";

const SUNLIT_SNOW = "#F8F5EF";
const SNOW_SHADOW = "#D3DFF0";
const BIRCH_AMBER = "#E9A960";
const SLATE_DEEP = "#2E3548"; // deep value shift — the bible bans pure black
const SIGNAL_RED = "#C6473E";

const SETTINGS_CSS = `
.set-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${SLATE_DEEP}59;
  backdrop-filter: blur(2px);
  pointer-events: auto;
  z-index: 20;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.set-backdrop.set-open { opacity: 1; }
.set-backdrop.set-hidden { display: none; }

.set-card {
  width: min(440px, 92vw);
  max-height: 86vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 24px 24px;
  border-radius: 16px;
  background: ${SUNLIT_SNOW}F5;
  border: 1px solid ${SNOW_SHADOW};
  box-shadow: 0 12px 40px ${SLATE_DEEP}40;
  color: ${SLATE_DEEP};
  font-family: "Segoe UI", system-ui, sans-serif;
  transform: translateY(8px) scale(0.98);
  transition: transform 0.18s ease;
}
.set-backdrop.set-open .set-card { transform: translateY(0) scale(1); }

.set-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.set-title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.set-close {
  border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW};
  color: ${SLATE_DEEP};
  width: 30px;
  height: 30px;
  border-radius: 9px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
}
.set-close:hover { background: ${SNOW_SHADOW}; }

.set-section-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  opacity: 0.6;
  margin-bottom: 8px;
}

.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 7px 0;
}
.set-row-label { font-size: 15px; font-weight: 500; }

.set-slider {
  flex: 1;
  accent-color: ${BIRCH_AMBER};
  cursor: pointer;
}
.set-volume-value {
  width: 42px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  opacity: 0.85;
}

.set-toggle {
  min-width: 62px;
  padding: 7px 16px;
  border-radius: 999px;
  border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW};
  color: ${SLATE_DEEP};
  font: 600 14px "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.set-toggle.set-on {
  background: ${BIRCH_AMBER};
  border-color: ${BIRCH_AMBER};
  color: ${SLATE_DEEP};
}

.set-keycap {
  min-width: 74px;
  padding: 6px 12px;
  border-radius: 8px;
  background: ${SNOW_SHADOW};
  border: 1px solid ${SLATE_DEEP}26;
  border-bottom-width: 3px;
  color: ${SLATE_DEEP};
  font: 600 14px "Segoe UI", system-ui, sans-serif;
  text-align: center;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.set-keycap:hover { background: #C3D2E8; }
.set-keycap.set-listening {
  background: ${SIGNAL_RED};
  border-color: ${SIGNAL_RED};
  color: ${SUNLIT_SNOW};
  animation: set-pulse 0.9s ease-in-out infinite;
}
@keyframes set-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.set-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 2px;
}
.set-text-button {
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid ${SNOW_SHADOW};
  background: ${SUNLIT_SNOW};
  color: ${SLATE_DEEP};
  font: 600 14px "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
}
.set-text-button:hover { background: ${SNOW_SHADOW}; }

.set-hint {
  font-size: 12px;
  opacity: 0.6;
  text-align: center;
}
`;

export interface SettingsMenuCallbacks {
  /** The live settings object — the menu edits it in place and persists it. */
  readonly settings: Settings;
  /** Master volume moved (0..1); wire straight to audio for a live preview. */
  onVolume(volume: number): void;
  /** Music toggled. */
  onMusic(enabled: boolean): void;
  /** A key was rebound (or reset). main.ts re-reads bindings from settings. */
  onBindingsChanged(): void;
  /** The menu closed (via ✕, Esc, or backdrop click). */
  onClose(): void;
}

export interface SettingsMenuHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "set-section-title";
  el.textContent = text;
  return el;
}

export function createSettingsMenu(
  callbacks: SettingsMenuCallbacks,
): SettingsMenuHandle {
  const { settings } = callbacks;

  const style = document.createElement("style");
  style.textContent = SETTINGS_CSS;
  document.head.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.className = "set-backdrop set-hidden";

  const card = document.createElement("div");
  card.className = "set-card";
  // Clicks inside the card mustn't close the menu (only the bare backdrop does).
  card.addEventListener("click", (e) => e.stopPropagation());

  // --- Header --------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "set-header";
  const title = document.createElement("div");
  title.className = "set-title";
  title.textContent = "Settings";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "set-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close settings");
  closeBtn.addEventListener("click", () => close());
  header.append(title, closeBtn);

  // --- Sound section -------------------------------------------------------
  const sound = document.createElement("div");
  const volRow = document.createElement("div");
  volRow.className = "set-row";
  const volLabel = document.createElement("span");
  volLabel.className = "set-row-label";
  volLabel.textContent = "Volume";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "set-slider";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  const volValue = document.createElement("span");
  volValue.className = "set-volume-value";
  function renderVolume(): void {
    const pct = Math.round(settings.masterVolume * 100);
    slider.value = String(pct);
    volValue.textContent = `${pct}%`;
  }
  slider.addEventListener("input", () => {
    settings.masterVolume = Number(slider.value) / 100;
    volValue.textContent = `${slider.value}%`;
    callbacks.onVolume(settings.masterVolume);
    saveSettings(settings);
  });
  volRow.append(volLabel, slider, volValue);

  const musicRow = document.createElement("div");
  musicRow.className = "set-row";
  const musicLabel = document.createElement("span");
  musicLabel.className = "set-row-label";
  musicLabel.textContent = "Music";
  const musicToggle = document.createElement("button");
  musicToggle.type = "button";
  musicToggle.className = "set-toggle";
  function renderMusic(): void {
    musicToggle.classList.toggle("set-on", settings.musicEnabled);
    musicToggle.textContent = settings.musicEnabled ? "On" : "Off";
  }
  musicToggle.addEventListener("click", () => {
    settings.musicEnabled = !settings.musicEnabled;
    renderMusic();
    callbacks.onMusic(settings.musicEnabled);
    saveSettings(settings);
  });
  musicRow.append(musicLabel, musicToggle);

  sound.append(sectionTitle("Sound"), volRow, musicRow);

  // --- Controls section ----------------------------------------------------
  // One row per rebindable action. Clicking a keycap arms it: the next key
  // pressed becomes the binding. If that key already belongs to another action
  // the two swap, so there's never a duplicate and no action is left unbound.
  const controls = document.createElement("div");
  const keycaps = new Map<ControlAction, HTMLButtonElement>();
  let listeningFor: ControlAction | null = null;

  function renderKeycaps(): void {
    for (const meta of ACTION_META) {
      const cap = keycaps.get(meta.action);
      if (!cap) continue;
      if (listeningFor === meta.action) {
        cap.classList.add("set-listening");
        cap.textContent = "Press a key…";
      } else {
        cap.classList.remove("set-listening");
        cap.textContent = keyLabel(settings.bindings[meta.action]);
      }
    }
  }

  function stopListening(): void {
    listeningFor = null;
    renderKeycaps();
  }

  for (const meta of ACTION_META) {
    const row = document.createElement("div");
    row.className = "set-row";
    const label = document.createElement("span");
    label.className = "set-row-label";
    label.textContent = meta.label;
    const cap = document.createElement("button");
    cap.type = "button";
    cap.className = "set-keycap";
    cap.addEventListener("click", () => {
      listeningFor = listeningFor === meta.action ? null : meta.action;
      renderKeycaps();
    });
    keycaps.set(meta.action, cap);
    row.append(label, cap);
    controls.append(row);
  }
  controls.prepend(sectionTitle("Controls"));

  const hint = document.createElement("div");
  hint.className = "set-hint";
  hint.textContent = "Click a key, then press the new key you want.";
  controls.append(hint);

  // --- Footer --------------------------------------------------------------
  const footer = document.createElement("div");
  footer.className = "set-footer";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "set-text-button";
  resetBtn.textContent = "Reset controls";
  resetBtn.addEventListener("click", () => {
    for (const meta of ACTION_META) settings.bindings[meta.action] = meta.defaultKey;
    stopListening();
    saveSettings(settings);
    callbacks.onBindingsChanged();
  });
  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "set-text-button";
  doneBtn.textContent = "Done";
  doneBtn.style.background = BIRCH_AMBER;
  doneBtn.style.borderColor = BIRCH_AMBER;
  doneBtn.addEventListener("click", () => close());
  footer.append(resetBtn, doneBtn);

  card.append(header, sound, controls, footer);
  backdrop.append(card);
  // Clicking the bare backdrop (outside the card) closes.
  backdrop.addEventListener("click", () => close());
  document.body.appendChild(backdrop);

  // Rebind capture + modal key guarding. Runs in the capture phase on window
  // so it fires *before* main.ts's gameplay/global key handlers (which are
  // bubble-phase on window): while the menu is open we don't want Enter to run
  // off to the slope or M to mute underneath us.
  function onKeyDownCapture(event: KeyboardEvent): void {
    if (backdrop.classList.contains("set-hidden")) return;

    if (listeningFor) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        stopListening();
        return;
      }
      rebind(listeningFor, event.code);
      stopListening();
      callbacks.onBindingsChanged();
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }

    // Let the card's own controls (slider arrows, button Enter/Space, Tab)
    // work; swallow everything else so page-level shortcuts stay dormant.
    if (!card.contains(event.target as Node)) {
      event.stopImmediatePropagation();
    }
  }
  window.addEventListener("keydown", onKeyDownCapture, { capture: true });

  function rebind(action: ControlAction, code: string): void {
    // Swap if the code is already someone else's, so bindings stay unique.
    for (const meta of ACTION_META) {
      if (meta.action !== action && settings.bindings[meta.action] === code) {
        settings.bindings[meta.action] = settings.bindings[action];
      }
    }
    settings.bindings[action] = code;
    saveSettings(settings);
  }

  function open(): void {
    renderVolume();
    renderMusic();
    stopListening();
    backdrop.classList.remove("set-hidden");
    // Next frame so the transition runs from the hidden state.
    requestAnimationFrame(() => backdrop.classList.add("set-open"));
  }

  function close(): void {
    if (backdrop.classList.contains("set-hidden")) return;
    stopListening();
    backdrop.classList.remove("set-open");
    backdrop.classList.add("set-hidden");
    callbacks.onClose();
  }

  return {
    open,
    close,
    isOpen: () => !backdrop.classList.contains("set-hidden"),
  };
}
