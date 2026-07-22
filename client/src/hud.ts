import { STARTING_LIVES, type SkiState } from "@toebeans/shared";

// The real UI (M2). A DOM overlay on top of the game canvas — it only ever
// *reads* game state, per the core rule in CLAUDE.md.
//
// Style notes: every color is an Art Style Bible palette hex (or an allowed
// value shift — the deep slate text is the same shift skiRender uses for
// chasms; the bible bans pure black). Tone is the director's "middle ground"
// (DESIGN.md, 2026-07-21): the cat faces stay cute, but panels are soft
// rounded rectangles rather than pills, borders are hairlines, and lettering
// is semi-bold with a little air instead of chunky-heavy. Signal red is
// reserved for "look at this", which is exactly what the forfeit banner is.

const SUNLIT_SNOW = "#F8F5EF";
const SNOW_SHADOW = "#D3DFF0";
const BIRCH_AMBER = "#E9A960";
const SLATE_DEEP = "#2E3548"; // slate rock, deep value shift — never black
const SIGNAL_RED = "#C6473E";

export type HudMode = "lobby" | "slope";

export interface HudHandle {
  sync(mode: HudMode, state: SkiState): void;
}

// One little cat face: ears + head silhouette in the current text color so
// CSS can fade a spent life to snow-shadow blue, plus eyes and the signal-red
// scarf (the cat's accent color per the palette) that vanish when the life is
// spent — a spent life reads as the cat's shadow.
const CAT_FACE_SVG = `
<svg viewBox="0 0 32 32" aria-hidden="true">
  <g fill="currentColor">
    <path d="M5.5 15 L7.5 3.5 L15 9 Z"/>
    <path d="M26.5 15 L24.5 3.5 L17 9 Z"/>
    <ellipse cx="16" cy="17.5" rx="11.5" ry="10.5"/>
  </g>
  <g class="detail">
    <circle cx="11.5" cy="17" r="1.7" fill="${SLATE_DEEP}"/>
    <circle cx="20.5" cy="17" r="1.7" fill="${SLATE_DEEP}"/>
    <path d="M14 21.5 Q16 23.5 18 21.5" stroke="${SLATE_DEEP}"
      stroke-width="1.4" stroke-linecap="round" fill="none"/>
    <rect x="7" y="25.5" width="18" height="5" rx="2.5" fill="${SIGNAL_RED}"/>
  </g>
</svg>`;

const HUD_CSS = `
.hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  user-select: none;
  font-family: "Segoe UI", system-ui, sans-serif;
  color: ${SLATE_DEEP};
}

.hud-lives {
  position: absolute;
  top: 18px;
  left: 18px;
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 6px 12px;
  border-radius: 12px;
  background: ${SUNLIT_SNOW}CC;
  border: 1px solid ${SNOW_SHADOW};
}

.hud-life {
  width: 26px;
  height: 26px;
  color: ${BIRCH_AMBER};
  transition: color 0.45s ease, transform 0.45s ease, opacity 0.45s ease;
}
.hud-life svg { width: 100%; height: 100%; display: block; }
.hud-life .detail { transition: opacity 0.45s ease; }
.hud-life.lost {
  color: ${SNOW_SHADOW};
  opacity: 0.7;
  transform: scale(0.82);
}
.hud-life.lost .detail { opacity: 0; }

.hud-banner {
  position: absolute;
  top: 22%;
  left: 50%;
  transform: translate(-50%, 0) scale(0.94);
  padding: 10px 26px;
  border-radius: 12px;
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0;
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.hud-banner.visible {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
.hud-banner.crash {
  background: ${SUNLIT_SNOW}E6;
  border: 1px solid ${SNOW_SHADOW};
  color: ${SLATE_DEEP};
}
.hud-banner.forfeit {
  background: ${SIGNAL_RED}F2;
  border: 1px solid ${SUNLIT_SNOW};
  color: ${SUNLIT_SNOW};
}
.hud-banner .sub {
  display: block;
  margin-top: 6px;
  font-size: 14px;
  font-weight: 500;
  opacity: 0.9;
}

.hud-hints {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 6px 14px;
  border-radius: 10px;
  background: ${SUNLIT_SNOW}B3;
  border: 1px solid ${SNOW_SHADOW};
  white-space: nowrap;
}
.hud-hint {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 13px;
  font-weight: 500;
}
.hud-key {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 5px;
  background: ${SNOW_SHADOW};
  border: 1px solid ${SLATE_DEEP}26;
  border-bottom-width: 2px;
  font-size: 12px;
  font-weight: 600;
}

.hud-hidden { display: none; }
`;

interface Hint {
  readonly key: string;
  readonly label: string;
}

// The lobby has no hint bar: its menu (lobbyUi.ts) is buttons with their
// keycaps printed on them, which is the hint bar's job done better.
const SLOPE_HINTS: readonly Hint[] = [
  { key: "← →", label: "steer" },
  // W's full meaning is "downhill, faster" (turning round 4) — one word
  // has to carry it, and "downhill" is the half a player can't guess.
  { key: "↑", label: "downhill" },
  { key: "↓", label: "brake" },
  // Hold-to-charge: the hold is the half of the control a player can't
  // guess from "jump" alone.
  { key: "Space", label: "hold to jump" },
  { key: "Shift", label: "boost" },
  { key: "M", label: "mute" },
  { key: "Enter", label: "lobby" },
];

function buildHints(container: HTMLElement, hints: readonly Hint[]): void {
  for (const hint of hints) {
    const item = document.createElement("span");
    item.className = "hud-hint";
    const key = document.createElement("span");
    key.className = "hud-key";
    key.textContent = hint.key;
    const label = document.createElement("span");
    label.textContent = hint.label;
    item.append(key, label);
    container.appendChild(item);
  }
}

export function createHud(): HudHandle {
  const style = document.createElement("style");
  style.textContent = HUD_CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "hud";

  const livesEl = document.createElement("div");
  livesEl.className = "hud-lives";
  const lifeEls: HTMLElement[] = [];
  for (let i = 0; i < STARTING_LIVES; i++) {
    const life = document.createElement("span");
    life.className = "hud-life";
    life.innerHTML = CAT_FACE_SVG;
    livesEl.appendChild(life);
    lifeEls.push(life);
  }

  const bannerEl = document.createElement("div");
  bannerEl.className = "hud-banner";
  const bannerText = document.createElement("span");
  const bannerSub = document.createElement("span");
  bannerSub.className = "sub";
  bannerEl.append(bannerText, bannerSub);

  const slopeHintsEl = document.createElement("div");
  slopeHintsEl.className = "hud-hints";
  buildHints(slopeHintsEl, SLOPE_HINTS);

  root.append(livesEl, bannerEl, slopeHintsEl);
  document.body.appendChild(root);

  function sync(mode: HudMode, state: SkiState): void {
    const onSlope = mode === "slope";
    livesEl.classList.toggle("hud-hidden", !onSlope);
    slopeHintsEl.classList.toggle("hud-hidden", !onSlope);

    if (!onSlope) {
      bannerEl.classList.remove("visible");
      return;
    }

    lifeEls.forEach((life, i) => {
      life.classList.toggle("lost", i >= state.lives);
    });

    if (state.status === "crashed") {
      bannerEl.classList.add("visible", "crash");
      bannerEl.classList.remove("forfeit");
      bannerText.textContent =
        state.lives > 0 ? "Crashed! Back to the checkpoint…" : "Crashed!";
      bannerSub.textContent = "";
    } else if (state.status === "forfeited") {
      bannerEl.classList.add("visible", "forfeit");
      bannerEl.classList.remove("crash");
      bannerText.textContent = "Out of lives — run forfeited";
      bannerSub.textContent = "Press Enter to head back to the lobby";
    } else {
      bannerEl.classList.remove("visible");
    }
  }

  return { sync };
}
