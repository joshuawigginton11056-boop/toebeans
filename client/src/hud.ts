import { STARTING_LIVES, type SkiState } from "@toebeans/shared";
import {
  ACTION_META,
  keyLabel,
  type ControlAction,
  type Settings,
} from "./settings";

// The real UI (M2). A DOM overlay on top of the game canvas — it only ever
// *reads* game state, per the core rule in CLAUDE.md.
//
// Style notes: every color is an Art Style Bible palette hex (or an allowed
// value shift — the deep slate text is the same shift skiRender uses for
// chasms; the bible bans pure black). Tone is the director's "middle ground"
// (DESIGN.md, 2026-07-21): the cat faces stay cute, but panels are soft
// rounded rectangles rather than pills, borders are hairlines, and lettering
// is semi-bold with a little air instead of chunky-heavy. Signal red is
// reserved for "look at this" — the forfeit banner, and the red X that marks
// the life you just lost.
//
// This session's rework (lobby, 2026-07-24):
//  • Lives now carry a "N lives left!" caption over the cat row, and losing
//    one *plays out*: the spent cat takes a red X, shakes, and tumbles off
//    the row, leaving a faint ghost of where it was so the count reads at a
//    glance.
//  • The old one-line hint bar became a "ghost keyboard": at the start of a
//    run the control keys flash on a translucent keyboard with a legend
//    beside it, then after 5 seconds it fades to a small strip of just the
//    key images and what they do. The keys shown follow your actual bindings
//    (settings.ts), so a rebind is reflected here too.

const SUNLIT_SNOW = "#F8F5EF";
const SNOW_SHADOW = "#D3DFF0";
const BIRCH_AMBER = "#E9A960";
const SLATE_DEEP = "#2E3548"; // slate rock, deep value shift — never black
const SIGNAL_RED = "#C6473E";

// How long the full ghost keyboard lingers at the start of a run before it
// fades down to the compact key strip.
const CONTROLS_INTRO_MS = 5000;

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

// The red X stamped over the cat the instant a life is lost.
const CAT_X_SVG = `
<svg viewBox="0 0 32 32" aria-hidden="true">
  <path d="M7 7 L25 25 M25 7 L7 25" stroke="${SIGNAL_RED}" stroke-width="4"
    stroke-linecap="round" fill="none"/>
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

.hud-lives-wrap {
  position: absolute;
  top: 16px;
  left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-start;
}
.hud-lives-text {
  padding: 3px 11px;
  border-radius: 9px;
  background: ${SUNLIT_SNOW}CC;
  border: 1px solid ${SNOW_SHADOW};
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.hud-lives-text .count { color: ${BIRCH_AMBER}; }
.hud-lives-text.low .count { color: ${SIGNAL_RED}; }

.hud-lives {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 6px 12px;
  border-radius: 12px;
  background: ${SUNLIT_SNOW}CC;
  border: 1px solid ${SNOW_SHADOW};
}

.hud-life {
  position: relative;
  width: 26px;
  height: 26px;
}
/* The live cat — the layer that shakes and tumbles when the life is spent. */
.hud-life-cat {
  position: absolute;
  inset: 0;
  color: ${BIRCH_AMBER};
  transition: opacity 0.4s ease;
}
.hud-life-cat svg { width: 100%; height: 100%; display: block; }
/* The faint "where it was" marker, revealed once the cat has fallen away. */
.hud-life-ghost {
  position: absolute;
  inset: 0;
  color: ${SNOW_SHADOW};
  opacity: 0;
  transform: scale(0.9);
  transition: opacity 0.5s ease;
}
.hud-life-ghost svg { width: 100%; height: 100%; display: block; }
.hud-life-ghost .detail { display: none; }
/* The red X overlay, only visible during the death beat. */
.hud-life-x {
  position: absolute;
  inset: -2px;
  opacity: 0;
}
.hud-life-x svg { width: 100%; height: 100%; display: block; }

/* Steady "already spent" state (e.g. a life lost before this frame): the cat
   is gone, the ghost marks the spot — no animation. */
.hud-life.lost .hud-life-cat { opacity: 0; }
.hud-life.lost .hud-life-ghost { opacity: 0.55; }

/* The death beat: red X flashes on + a quick shake, then the cat tumbles down
   and fades while the ghost eases in beneath it. */
.hud-life.dying .hud-life-cat {
  animation: life-die 1.05s ease-in forwards;
}
.hud-life.dying .hud-life-x {
  animation: life-x 1.05s ease-out forwards;
}
.hud-life.dying .hud-life-ghost { opacity: 0.55; }

@keyframes life-x {
  0% { opacity: 0; transform: scale(1.6); }
  14% { opacity: 1; transform: scale(1); }
  40% { opacity: 1; }
  60% { opacity: 0; }
  100% { opacity: 0; }
}
@keyframes life-die {
  0% { transform: translate(0, 0) rotate(0); opacity: 1; }
  8% { transform: translate(-3px, 0) rotate(-9deg); }
  16% { transform: translate(3px, 0) rotate(9deg); }
  24% { transform: translate(-3px, 0) rotate(-8deg); }
  32% { transform: translate(2px, 0) rotate(7deg); }
  40% { transform: translate(0, 0) rotate(0); opacity: 1; }
  100% { transform: translate(6px, 120px) rotate(40deg); opacity: 0; }
}

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
.hud-banner.finish {
  background: ${BIRCH_AMBER}F2;
  border: 1px solid ${SUNLIT_SNOW};
  color: ${SLATE_DEEP};
}
.hud-banner .sub {
  display: block;
  margin-top: 6px;
  font-size: 14px;
  font-weight: 500;
  opacity: 0.9;
}

/* --- The ghost keyboard (intro) --------------------------------------- */
.hud-controls {
  position: absolute;
  left: 50%;
  bottom: 8%;
  transform: translateX(-50%);
  display: flex;
  gap: 26px;
  align-items: center;
  padding: 18px 24px;
  border-radius: 16px;
  background: ${SUNLIT_SNOW}D9;
  border: 1px solid ${SNOW_SHADOW};
  box-shadow: 0 10px 30px ${SLATE_DEEP}26;
  opacity: 0;
  transition: opacity 0.6s ease;
}
.hud-controls.visible { opacity: 1; }

.hud-kb {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.hud-kb-row { display: flex; gap: 6px; justify-content: center; }
.kb-key {
  min-width: 44px;
  height: 44px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  /* Translucent "ghost" caps. */
  background: ${SUNLIT_SNOW}80;
  border: 1px solid ${SLATE_DEEP}33;
  border-bottom-width: 3px;
  color: ${SLATE_DEEP};
  font-size: 16px;
  font-weight: 600;
  animation: kb-flash 2.4s ease-in-out infinite;
}
.kb-key.kb-wide { min-width: 150px; }
@keyframes kb-flash {
  0%, 100% {
    background: ${SUNLIT_SNOW}80;
    border-color: ${SLATE_DEEP}33;
    box-shadow: none;
    color: ${SLATE_DEEP};
  }
  50% {
    background: ${BIRCH_AMBER};
    border-color: ${BIRCH_AMBER};
    box-shadow: 0 0 14px ${BIRCH_AMBER}CC;
    color: ${SLATE_DEEP};
  }
}

.hud-legend {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.hud-legend-row {
  display: flex;
  gap: 9px;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
}
.hud-legend-cap {
  min-width: 40px;
  padding: 2px 8px;
  border-radius: 6px;
  background: ${SNOW_SHADOW};
  border: 1px solid ${SLATE_DEEP}26;
  border-bottom-width: 2px;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

/* --- The compact key strip (after the intro fades) -------------------- */
.hud-chips {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 6px 14px;
  border-radius: 10px;
  background: ${SUNLIT_SNOW}B3;
  border: 1px solid ${SNOW_SHADOW};
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.6s ease;
}
.hud-chips.visible { opacity: 1; }
.hud-chip {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
}
.hud-chip-cap {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: ${SNOW_SHADOW};
  border: 1px solid ${SLATE_DEEP}26;
  border-bottom-width: 2px;
  font-size: 12px;
  font-weight: 600;
}

.hud-hidden { display: none; }
`;

// Which actions form the keyboard's directional cluster (drawn in a + shape)
// vs. the wide/among-keys row. The legend and the compact strip list them all.
const CORE_CHIP_ACTIONS: readonly ControlAction[] = [
  "left",
  "right",
  "faster",
  "brake",
  "jump",
  "boost",
];

function labelFor(action: ControlAction): string {
  return ACTION_META.find((m) => m.action === action)?.label ?? action;
}

function makeCap(className: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

export function createHud(settings: Settings): HudHandle {
  const style = document.createElement("style");
  style.textContent = HUD_CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "hud";

  // --- Lives (caption + cat row) -----------------------------------------
  const livesWrap = document.createElement("div");
  livesWrap.className = "hud-lives-wrap";
  const livesText = document.createElement("div");
  livesText.className = "hud-lives-text";
  const livesTextCount = document.createElement("span");
  livesTextCount.className = "count";
  const livesTextRest = document.createElement("span");
  livesText.append(livesTextCount, livesTextRest);

  const livesEl = document.createElement("div");
  livesEl.className = "hud-lives";
  const lifeEls: HTMLElement[] = [];
  for (let i = 0; i < STARTING_LIVES; i++) {
    const life = document.createElement("div");
    life.className = "hud-life";
    const ghost = document.createElement("div");
    ghost.className = "hud-life-ghost";
    ghost.innerHTML = CAT_FACE_SVG;
    const cat = document.createElement("div");
    cat.className = "hud-life-cat";
    cat.innerHTML = CAT_FACE_SVG;
    const x = document.createElement("div");
    x.className = "hud-life-x";
    x.innerHTML = CAT_X_SVG;
    life.append(ghost, cat, x);
    livesEl.appendChild(life);
    lifeEls.push(life);
  }
  livesWrap.append(livesText, livesEl);

  // --- Banner ------------------------------------------------------------
  const bannerEl = document.createElement("div");
  bannerEl.className = "hud-banner";
  const bannerText = document.createElement("span");
  const bannerSub = document.createElement("span");
  bannerSub.className = "sub";
  bannerEl.append(bannerText, bannerSub);

  // --- Controls: ghost keyboard (intro) + compact strip ------------------
  const controlsEl = document.createElement("div");
  controlsEl.className = "hud-controls";
  const kbEl = document.createElement("div");
  kbEl.className = "hud-kb";
  const legendEl = document.createElement("div");
  legendEl.className = "hud-legend";
  controlsEl.append(kbEl, legendEl);

  const chipsEl = document.createElement("div");
  chipsEl.className = "hud-chips";

  // Build (or rebuild) the keyboard, legend, and chips from the current
  // bindings — called at each run start so a rebind since last time shows.
  function buildControls(): void {
    kbEl.textContent = "";
    legendEl.textContent = "";
    chipsEl.textContent = "";

    const cap = (action: ControlAction, wide = false): HTMLElement =>
      makeCap(`kb-key${wide ? " kb-wide" : ""}`, keyLabel(settings.bindings[action]));

    // A keyboard-ish arrangement: the steer/speed cluster in a + shape, then
    // the wide jump bar, then the modifier row.
    const rowUp = document.createElement("div");
    rowUp.className = "hud-kb-row";
    rowUp.append(cap("faster"));
    const rowMid = document.createElement("div");
    rowMid.className = "hud-kb-row";
    rowMid.append(cap("left"), cap("brake"), cap("right"));
    const rowSpace = document.createElement("div");
    rowSpace.className = "hud-kb-row";
    rowSpace.append(cap("jump", true));
    const rowMods = document.createElement("div");
    rowMods.className = "hud-kb-row";
    rowMods.append(cap("boost"), cap("mute"), cap("lobby"));
    kbEl.append(rowUp, rowMid, rowSpace, rowMods);

    // Stagger the flash so keys light up in sequence rather than in unison.
    const keys = kbEl.querySelectorAll<HTMLElement>(".kb-key");
    keys.forEach((k, i) => {
      k.style.animationDelay = `${(i * 0.18).toFixed(2)}s`;
    });

    // Legend: every action, key then plain-language meaning.
    for (const meta of ACTION_META) {
      const row = document.createElement("div");
      row.className = "hud-legend-row";
      const legendCap = makeCap("hud-legend-cap", keyLabel(settings.bindings[meta.action]));
      const text = document.createElement("span");
      text.textContent = meta.label;
      row.append(legendCap, text);
      legendEl.append(row);
    }

    // Compact strip: just the in-game keys and what they do.
    for (const action of CORE_CHIP_ACTIONS) {
      const chip = document.createElement("div");
      chip.className = "hud-chip";
      const chipCap = document.createElement("span");
      chipCap.className = "hud-chip-cap";
      chipCap.textContent = keyLabel(settings.bindings[action]);
      const chipLabel = document.createElement("span");
      chipLabel.textContent = labelFor(action);
      chip.append(chipCap, chipLabel);
      chipsEl.append(chip);
    }
  }

  root.append(livesWrap, bannerEl, controlsEl, chipsEl);
  document.body.appendChild(root);

  // --- Run-intro sequencing ----------------------------------------------
  let introTimer: number | null = null;
  function startControlsIntro(): void {
    buildControls();
    if (introTimer !== null) window.clearTimeout(introTimer);
    // Full keyboard on, compact strip off.
    controlsEl.classList.remove("hud-hidden");
    chipsEl.classList.remove("hud-hidden");
    controlsEl.classList.add("visible");
    chipsEl.classList.remove("visible");
    introTimer = window.setTimeout(() => {
      // Fade the keyboard down to the compact strip.
      controlsEl.classList.remove("visible");
      chipsEl.classList.add("visible");
      introTimer = null;
    }, CONTROLS_INTRO_MS);
  }
  function hideControls(): void {
    if (introTimer !== null) {
      window.clearTimeout(introTimer);
      introTimer = null;
    }
    controlsEl.classList.remove("visible");
    chipsEl.classList.remove("visible");
    controlsEl.classList.add("hud-hidden");
    chipsEl.classList.add("hud-hidden");
  }

  // --- Lives display ------------------------------------------------------
  function renderLivesText(lives: number): void {
    livesTextCount.textContent = String(lives);
    livesTextRest.textContent = lives === 1 ? " life left!" : " lives left!";
    livesText.classList.toggle("low", lives <= 3);
  }
  // Set a life to a resting state instantly (no death beat) — used on a fresh
  // run and when catching up more than one life at once.
  function setLifeResting(life: HTMLElement, lost: boolean): void {
    life.classList.remove("dying");
    life.classList.toggle("lost", lost);
  }
  function playDeath(life: HTMLElement): void {
    life.classList.remove("lost");
    // Restart the animation if it's somehow mid-flight.
    life.classList.remove("dying");
    void life.offsetWidth; // reflow so re-adding the class replays it
    life.classList.add("dying");
  }

  let prevMode: HudMode | null = null;
  let prevLives = STARTING_LIVES;

  function sync(mode: HudMode, state: SkiState): void {
    const onSlope = mode === "slope";
    livesWrap.classList.toggle("hud-hidden", !onSlope);

    const enteringSlope = onSlope && prevMode !== "slope";
    if (enteringSlope) {
      startControlsIntro();
      // Fresh run: every cat present, no lingering death state.
      lifeEls.forEach((life, i) => setLifeResting(life, i >= state.lives));
      prevLives = state.lives;
      renderLivesText(state.lives);
    } else if (!onSlope) {
      hideControls();
      bannerEl.classList.remove("visible");
      prevMode = mode;
      return;
    }

    // A life (or more) just lost this frame → play the death beat on each.
    if (onSlope && !enteringSlope && state.lives < prevLives) {
      for (let i = state.lives; i < prevLives; i++) {
        const life = lifeEls[i];
        if (!life) continue;
        // The topmost freshly-spent cat gets the animated death; any extras
        // (shouldn't happen — one crash costs one life) settle instantly.
        if (i === prevLives - 1) playDeath(life);
        else setLifeResting(life, true);
      }
      renderLivesText(state.lives);
    } else if (onSlope && !enteringSlope && state.lives > prevLives) {
      // Defensive: lives went up without a scene change (not expected) —
      // just resync every cat to the current count.
      lifeEls.forEach((life, i) => setLifeResting(life, i >= state.lives));
      renderLivesText(state.lives);
    }
    prevLives = state.lives;

    if (state.status === "crashed") {
      bannerEl.classList.add("visible", "crash");
      bannerEl.classList.remove("forfeit", "finish");
      bannerText.textContent =
        state.lives > 0 ? "Crashed! Back to the checkpoint…" : "Crashed!";
      bannerSub.textContent = "";
    } else if (state.status === "forfeited") {
      bannerEl.classList.add("visible", "forfeit");
      bannerEl.classList.remove("crash", "finish");
      bannerText.textContent = "Out of lives — run forfeited";
      bannerSub.textContent = "Press Enter to head back to the lobby";
    } else if (state.status === "finished") {
      // Crossing the line wins the run — a celebratory beat before the coast
      // auto-returns to the lobby (no keypress; the sub says so).
      bannerEl.classList.add("visible", "finish");
      bannerEl.classList.remove("crash", "forfeit");
      bannerText.textContent = "Run complete!";
      bannerSub.textContent = "Heading back to the lobby…";
    } else {
      bannerEl.classList.remove("visible");
    }

    prevMode = mode;
  }

  return { sync };
}
