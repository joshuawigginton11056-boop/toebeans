// Character appearance (M2). Plain serializable data: who the player is.
// Pure logic, no rendering — the client turns this into a loaded model and
// material colors in client/src/skierModel.ts.
//
// Two kinds of choice live here, and they are deliberately different shapes:
//
//   * **Which character** you are. Director call, 2026-07-21: players pick
//     from Quaternius's Ultimate Animated Character Pack rather than
//     dressing one body. The outfit is therefore part of the model, baked
//     to the palette at conversion time by tools/gltf_character.py — not a
//     runtime choice, which is why the old coat/trousers/boots ramps are
//     gone.
//   * **Skin and hair color**, which stay live. Every character in the pack
//     carries a Skin material and most carry a Hair one, so these two work
//     across the whole roster.
//
// Colors are stored as **indices into the ramps below**, never as raw hex,
// and the character as an index into CHARACTERS. That's deliberate: an
// index can't drift off-palette or off-roster, it survives a ramp being
// re-tuned, and validating a save is a range check instead of a color
// parse. The ramps are the Art Style Bible's character palette (DESIGN.md →
// Character palette); the landscape's 12 colors are separate and untouched.

export interface CharacterModel {
  /** Matches the .glb filename in assets/characters/. */
  readonly id: string;
  /** Shown in the character picker when that gets built (M3). */
  readonly label: string;
}

/**
 * The roster. A curated subset of the pack's ~44 characters: the ones whose
 * outfits suit a cozy game about skiing with a cat, rather than the knights,
 * ninjas and pirates the pack also contains (parked in IDEAS.md as unlock
 * candidates). Every one of them shares the pack's single skeleton and clip
 * set, so adding or removing one costs nothing but the file.
 */
export const CHARACTERS: readonly CharacterModel[] = [
  { id: "Casual_Male", label: "Casual 1" },
  { id: "Casual_Female", label: "Casual 2" },
  { id: "Casual2_Male", label: "Casual 3" },
  { id: "Casual2_Female", label: "Casual 4" },
  { id: "Casual3_Male", label: "Casual 5" },
  { id: "Casual3_Female", label: "Casual 6" },
  { id: "Casual_Bald", label: "Casual 7" },
  { id: "OldClassy_Male", label: "Classic Coat 1" },
  { id: "OldClassy_Female", label: "Classic Coat 2" },
  { id: "Cowboy_Male", label: "Rancher 1" },
  { id: "Cowboy_Female", label: "Rancher 2" },
];

/**
 * The parts of a character that still take a runtime color. The rest of the
 * outfit comes with the character now.
 */
export type CharacterRegion = "skin" | "hair";

// Warm and slightly desaturated, so faces sit against snow rather than
// glowing off it.
export const SKIN_TONES = [
  "#F4DAC4", // porcelain
  "#EAC2A3", // sand
  "#DCA77E", // honey
  "#C4855A", // amber
  "#A2673F", // chestnut
  "#7E4C2E", // umber
  "#5C3722", // cocoa
  "#3F2418", // espresso
] as const;

export const HAIR_COLORS = [
  "#2B2622", // soft black — the bible bans pure black
  "#4A3628", // dark brown
  "#6E4B2E", // chestnut
  "#8A5A30", // auburn
  "#B4623C", // ginger — deliberately off signal red, which stays reserved
  "#C79A4A", // honey blonde
  "#E2CA92", // pale blonde
  "#8C8C94", // silver
] as const;

/** The ramp each region draws from, so callers can iterate generically. */
export const REGION_RAMPS: Record<CharacterRegion, readonly string[]> = {
  skin: SKIN_TONES,
  hair: HAIR_COLORS,
};

export interface Appearance {
  /** Index into CHARACTERS. */
  readonly character: number;
  readonly skin: number;
  readonly hair: number;
}

export function createDefaultAppearance(): Appearance {
  // Honey skin and dark brown hair on the first character in the roster.
  return { character: 0, skin: 2, hair: 1 };
}

/** The regions resolved to actual hex colors, ready for rendering. */
export type AppearanceColors = Record<CharacterRegion, string>;

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(value)));
}

/**
 * Pull every index back into range. A save written before a ramp shrank —
 * or before a character was cut from the roster — would otherwise point at
 * something that no longer exists; clamping heals that the same way
 * restoreSave heals stale positions.
 */
export function normalizeAppearance(appearance: Appearance): Appearance {
  return {
    character: clampIndex(appearance.character, CHARACTERS.length),
    skin: clampIndex(appearance.skin, SKIN_TONES.length),
    hair: clampIndex(appearance.hair, HAIR_COLORS.length),
  };
}

/** Which character model to load. */
export function resolveCharacter(appearance: Appearance): CharacterModel {
  return CHARACTERS[normalizeAppearance(appearance).character]!;
}

/** Turn the stored indices into the hex colors the renderer applies. */
export function resolveAppearance(appearance: Appearance): AppearanceColors {
  const safe = normalizeAppearance(appearance);
  return {
    skin: SKIN_TONES[safe.skin]!,
    hair: HAIR_COLORS[safe.hair]!,
  };
}

/**
 * Step to the next character, wrapping at the end of the roster. The picker
 * UI is its own session; until then this is how the roster is exercised,
 * tested, and looked at in-game.
 */
export function cycleCharacter(appearance: Appearance): Appearance {
  const safe = normalizeAppearance(appearance);
  return { ...safe, character: (safe.character + 1) % CHARACTERS.length };
}

/**
 * Step one region to its next color, wrapping at the end of its ramp. Same
 * story as cycleCharacter: a stand-in for the customization UI.
 */
export function cycleRegion(
  appearance: Appearance,
  region: CharacterRegion,
): Appearance {
  const ramp = REGION_RAMPS[region];
  const safe = normalizeAppearance(appearance);
  return { ...safe, [region]: (safe[region] + 1) % ramp.length };
}
