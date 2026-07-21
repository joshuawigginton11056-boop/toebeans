// Character appearance (M2, skier session). Plain serializable data: which
// colors the player's character wears. Pure logic, no rendering — the client
// turns these into material colors in client/src/skierModel.ts.
//
// Colors are stored as **indices into the ramps below**, never as raw hex.
// That's deliberate: an index can't drift off-palette, it survives a ramp
// being re-tuned, and validating a save is a range check instead of a color
// parse. The ramps themselves are the Art Style Bible's character palette
// (DESIGN.md → Character palette) — the landscape's 12 colors are separate
// and untouched.

/** Which base model the character is built on. */
export type SkierBase = "modular" | "animated";

/**
 * Both bases ship while the director picks between them by eye (DESIGN.md →
 * Character assets). The loser gets deleted once that call is made.
 */
export const SKIER_BASES: readonly SkierBase[] = ["modular", "animated"];

/**
 * The six parts of a character that take a color. Every base model splits
 * into exactly these, however it happens to carry them.
 */
export type CharacterRegion =
  | "skin"
  | "hair"
  | "eyes"
  | "coat"
  | "trousers"
  | "boots";

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

export const EYE_COLORS = [
  "#3B2B22", // brown
  "#4E6E7A", // blue-gray
  "#5A7A5C", // green
  "#6B5B45", // hazel
  "#2B2622", // near-black
] as const;

// Saturated mid-darks only: whatever the coat is, the player has to read
// instantly against a field of snow.
export const COAT_COLORS = [
  "#4E72A8", // skier blue — palette #11, the documented "you" color
  "#2F6D63", // pine teal
  "#7A4E8C", // plum
  "#C0663A", // rust
  "#B23A48", // cranberry
] as const;

export const TROUSER_COLORS = [
  "#3E3A3A", // charcoal
  "#5A5F6B", // slate gray
  "#6E6152", // taupe
  "#2E3548", // deep navy
] as const;

export const BOOT_COLORS = [
  "#3A2F2F", // dark brown
  "#2B2622", // soft black
  "#66738C", // slate
] as const;

/** The ramp each region draws from, so callers can iterate generically. */
export const REGION_RAMPS: Record<CharacterRegion, readonly string[]> = {
  skin: SKIN_TONES,
  hair: HAIR_COLORS,
  eyes: EYE_COLORS,
  coat: COAT_COLORS,
  trousers: TROUSER_COLORS,
  boots: BOOT_COLORS,
};

export interface Appearance {
  readonly base: SkierBase;
  readonly skin: number;
  readonly hair: number;
  readonly eyes: number;
  readonly coat: number;
  readonly trousers: number;
  readonly boots: number;
}

/** Region → the appearance field holding its index. */
const REGION_FIELDS: Record<CharacterRegion, keyof Omit<Appearance, "base">> = {
  skin: "skin",
  hair: "hair",
  eyes: "eyes",
  coat: "coat",
  trousers: "trousers",
  boots: "boots",
};

export function createDefaultAppearance(): Appearance {
  // Honey skin, dark brown hair, brown eyes, and the reserved skier blue
  // coat — so a brand-new player looks the way the rest of the docs
  // describe "you".
  return {
    base: "modular",
    skin: 2,
    hair: 1,
    eyes: 0,
    coat: 0,
    trousers: 0,
    boots: 0,
  };
}

/** The six regions resolved to actual hex colors, ready for rendering. */
export type AppearanceColors = Record<CharacterRegion, string>;

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(value)));
}

/**
 * Pull every index back into its ramp's range. A save written before a ramp
 * shrank would otherwise point at a color that no longer exists; clamping
 * heals that the same way restoreSave heals stale positions.
 */
export function normalizeAppearance(appearance: Appearance): Appearance {
  const base: SkierBase = SKIER_BASES.includes(appearance.base)
    ? appearance.base
    : "modular";
  return {
    base,
    skin: clampIndex(appearance.skin, SKIN_TONES.length),
    hair: clampIndex(appearance.hair, HAIR_COLORS.length),
    eyes: clampIndex(appearance.eyes, EYE_COLORS.length),
    coat: clampIndex(appearance.coat, COAT_COLORS.length),
    trousers: clampIndex(appearance.trousers, TROUSER_COLORS.length),
    boots: clampIndex(appearance.boots, BOOT_COLORS.length),
  };
}

/** Turn the stored indices into the hex colors the renderer applies. */
export function resolveAppearance(appearance: Appearance): AppearanceColors {
  const safe = normalizeAppearance(appearance);
  const colors = {} as Record<CharacterRegion, string>;
  for (const region of Object.keys(REGION_RAMPS) as CharacterRegion[]) {
    const ramp = REGION_RAMPS[region];
    colors[region] = ramp[safe[REGION_FIELDS[region]]]!;
  }
  return colors;
}

/**
 * Swap to the next base model. This exists so the director can compare the
 * two candidate bases in-game; it goes away with the losing model.
 */
export function cycleBase(appearance: Appearance): Appearance {
  const index = SKIER_BASES.indexOf(appearance.base);
  return {
    ...appearance,
    base: SKIER_BASES[(index + 1) % SKIER_BASES.length]!,
  };
}

/**
 * Step one region to its next color, wrapping at the end of its ramp. The
 * customization UI is an M3 item; until then this is how the colors are
 * exercised and tested.
 */
export function cycleRegion(
  appearance: Appearance,
  region: CharacterRegion,
): Appearance {
  const field = REGION_FIELDS[region];
  const ramp = REGION_RAMPS[region];
  const safe = normalizeAppearance(appearance);
  return { ...safe, [field]: (safe[field] + 1) % ramp.length };
}
