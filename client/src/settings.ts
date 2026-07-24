// Player settings (lobby session, 2026-07-24): volume, music on/off, and
// rebindable controls. These are client-only *preferences*, deliberately kept
// OUT of the versioned game save (shared/src/save.ts is game *state*, and
// bumping SAVE_VERSION for a volume slider would be silly). They live under
// their own localStorage key, so tweaking them never risks a save migration.
//
// Pure data + load/save + a few label helpers. The settings menu
// (settingsMenu.ts) edits this; main.ts reads bindings/volume/music from it;
// the HUD's control hints (hud.ts) read the bindings so the ghost keyboard
// shows whatever keys you actually chose.

// The things a player can rebind. Each maps to one KeyboardEvent.code.
export type ControlAction =
  | "left"
  | "right"
  | "faster"
  | "brake"
  | "jump"
  | "boost"
  | "mute"
  | "lobby";

// Fixed facts about each action: the plain-language label (used in the
// settings menu and the in-game legend), the *default* rebindable key, and an
// optional fixed alternate that always works and isn't shown as rebindable —
// this is how WASD keeps working alongside the arrow keys even after someone
// rebinds one of them. Order here is the display order everywhere.
export interface ActionMeta {
  readonly action: ControlAction;
  readonly label: string;
  readonly defaultKey: string;
  readonly alt?: string;
}

export const ACTION_META: readonly ActionMeta[] = [
  { action: "left", label: "Steer left", defaultKey: "ArrowLeft", alt: "KeyA" },
  { action: "right", label: "Steer right", defaultKey: "ArrowRight", alt: "KeyD" },
  { action: "faster", label: "Speed up", defaultKey: "ArrowUp", alt: "KeyW" },
  { action: "brake", label: "Brake", defaultKey: "ArrowDown", alt: "KeyS" },
  { action: "jump", label: "Jump / spin", defaultKey: "Space" },
  { action: "boost", label: "Boost", defaultKey: "ShiftLeft", alt: "ShiftRight" },
  { action: "mute", label: "Mute sound", defaultKey: "KeyM" },
  { action: "lobby", label: "Back to lobby", defaultKey: "Enter" },
];

const META_BY_ACTION: Record<ControlAction, ActionMeta> = Object.fromEntries(
  ACTION_META.map((m) => [m.action, m]),
) as Record<ControlAction, ActionMeta>;

export interface Settings {
  /** Master loudness, 0..1. The gain the audio graph runs its master at. */
  masterVolume: number;
  /** Whether the ambient music bed plays (director left music off by default). */
  musicEnabled: boolean;
  /** Rebindable primary key per action (KeyboardEvent.code). */
  bindings: Record<ControlAction, string>;
}

// The current loudness the game shipped with was master gain 0.9, so that's
// the default the slider sits at — nothing gets quieter or louder on upgrade.
const DEFAULT_VOLUME = 0.9;

export function defaultSettings(): Settings {
  const bindings = {} as Record<ControlAction, string>;
  for (const meta of ACTION_META) bindings[meta.action] = meta.defaultKey;
  return { masterVolume: DEFAULT_VOLUME, musicEnabled: false, bindings };
}

const SETTINGS_KEY = "toebeans-settings";

// localStorage can throw (private mode, disabled, quota). Every failure falls
// back to defaults / plays on without saving — same posture as save.ts.

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return base;
    const parsed = JSON.parse(raw) as Partial<Settings> | null;
    if (!parsed || typeof parsed !== "object") return base;
    if (typeof parsed.masterVolume === "number") {
      base.masterVolume = clamp01(parsed.masterVolume);
    }
    if (typeof parsed.musicEnabled === "boolean") {
      base.musicEnabled = parsed.musicEnabled;
    }
    // Only accept known actions with string codes; anything else keeps its
    // default, so a stale/corrupt file can never strand an action unbound.
    if (parsed.bindings && typeof parsed.bindings === "object") {
      for (const meta of ACTION_META) {
        const code = (parsed.bindings as Record<string, unknown>)[meta.action];
        if (typeof code === "string" && code.length > 0) {
          base.bindings[meta.action] = code;
        }
      }
    }
    return base;
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — play on without persisting preferences.
  }
}

/** The fixed, non-rebindable alternate key for an action (WASD etc.), if any. */
export function actionAlt(action: ControlAction): string | undefined {
  return META_BY_ACTION[action].alt;
}

/** Is this KeyboardEvent.code the action's bound key (or its fixed alternate)? */
export function codeMatchesAction(
  settings: Settings,
  action: ControlAction,
  code: string,
): boolean {
  return code === settings.bindings[action] || code === actionAlt(action);
}

// Pretty, human-facing name for a KeyboardEvent.code — arrows become glyphs,
// letters drop the "Key" prefix, and the common named keys get friendly words.
// Anything unrecognized is shown verbatim (better a raw code than a blank cap).
export function keyLabel(code: string): string {
  switch (code) {
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "Space":
      return "Space";
    case "Enter":
      return "Enter";
    case "Escape":
      return "Esc";
    case "ShiftLeft":
    case "ShiftRight":
      return "Shift";
    case "ControlLeft":
    case "ControlRight":
      return "Ctrl";
    case "AltLeft":
    case "AltRight":
      return "Alt";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "⌫";
  }
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
