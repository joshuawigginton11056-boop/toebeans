import { describe, expect, it } from "vitest";
import {
  BOOT_COLORS,
  COAT_COLORS,
  EYE_COLORS,
  HAIR_COLORS,
  REGION_RAMPS,
  SKIER_BASES,
  SKIN_TONES,
  TROUSER_COLORS,
  createDefaultAppearance,
  cycleBase,
  cycleRegion,
  normalizeAppearance,
  resolveAppearance,
  type CharacterRegion,
} from "./appearance";

const REGIONS = Object.keys(REGION_RAMPS) as CharacterRegion[];

describe("appearance", () => {
  it("resolves the default character to the documented colors", () => {
    const colors = resolveAppearance(createDefaultAppearance());
    // The default has to be the "you" the rest of the docs describe: the
    // reserved skier blue coat, so the player reads instantly on snow.
    expect(colors.coat).toBe("#4E72A8");
    expect(colors.skin).toBe("#DCA77E");
    expect(colors.hair).toBe("#4A3628");
    expect(colors.eyes).toBe("#3B2B22");
  });

  it("resolves every region to a color from that region's own ramp", () => {
    for (const region of REGIONS) {
      const ramp = REGION_RAMPS[region];
      for (let i = 0; i < ramp.length; i++) {
        let appearance = createDefaultAppearance();
        for (let step = 0; step < i; step++) {
          appearance = cycleRegion(appearance, region);
        }
        expect(ramp).toContain(resolveAppearance(appearance)[region]);
      }
    }
  });

  it("keeps every ramp color on the palette's hex format", () => {
    for (const ramp of Object.values(REGION_RAMPS)) {
      for (const color of ramp) {
        expect(color).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("never uses signal red, which stays reserved", () => {
    // The bible reserves #C6473E for "look at this" — the cat's scarf has
    // to stay the one red thing on a skier.
    for (const ramp of Object.values(REGION_RAMPS)) {
      expect(ramp).not.toContain("#C6473E");
    }
  });

  it("cycles a region back to where it started after a full lap", () => {
    for (const region of REGIONS) {
      let appearance = createDefaultAppearance();
      const start = resolveAppearance(appearance)[region];
      for (let i = 0; i < REGION_RAMPS[region].length; i++) {
        appearance = cycleRegion(appearance, region);
      }
      expect(resolveAppearance(appearance)[region]).toBe(start);
    }
  });

  it("cycling one region leaves the others alone", () => {
    const before = createDefaultAppearance();
    const after = cycleRegion(before, "hair");
    expect(after.hair).not.toBe(before.hair);
    for (const region of REGIONS.filter((r) => r !== "hair")) {
      expect(resolveAppearance(after)[region]).toBe(resolveAppearance(before)[region]);
    }
  });

  it("cycles through every base and wraps", () => {
    let appearance = createDefaultAppearance();
    const seen = [appearance.base];
    for (let i = 0; i < SKIER_BASES.length - 1; i++) {
      appearance = cycleBase(appearance);
      seen.push(appearance.base);
    }
    expect(new Set(seen).size).toBe(SKIER_BASES.length);
    expect(cycleBase(appearance).base).toBe(createDefaultAppearance().base);
  });

  it("cycling the base keeps the colors", () => {
    const before = { ...createDefaultAppearance(), skin: 6, hair: 7 };
    const after = cycleBase(before);
    expect(after.skin).toBe(6);
    expect(after.hair).toBe(7);
  });

  it("clamps indices that fall outside their ramp", () => {
    const wild = normalizeAppearance({
      base: "modular",
      skin: 999,
      hair: -5,
      eyes: Number.NaN,
      coat: 2.9,
      trousers: Number.POSITIVE_INFINITY,
      boots: 0,
    });
    expect(wild.skin).toBe(SKIN_TONES.length - 1); // too big → last color
    expect(wild.hair).toBe(0); // negative → first color
    expect(wild.coat).toBe(2); // truncated, not rounded
    // Non-finite isn't a stale index, it's garbage — so it falls back to the
    // first color rather than clamping to either end.
    expect(wild.eyes).toBe(0);
    expect(wild.trousers).toBe(0);
  });

  it("falls back to a known base when the stored one is unrecognized", () => {
    const healed = normalizeAppearance({
      ...createDefaultAppearance(),
      base: "claymation" as never,
    });
    expect(SKIER_BASES).toContain(healed.base);
  });

  it("does not mutate the appearance it is given", () => {
    const original = createDefaultAppearance();
    const copy = { ...original };
    cycleRegion(original, "coat");
    cycleBase(original);
    normalizeAppearance(original);
    resolveAppearance(original);
    expect(original).toEqual(copy);
  });

  it("offers enough range to be worth calling customization", () => {
    // Guards against a ramp being accidentally emptied or collapsed.
    expect(SKIN_TONES.length).toBeGreaterThanOrEqual(6);
    expect(HAIR_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(EYE_COLORS.length).toBeGreaterThanOrEqual(3);
    expect(COAT_COLORS.length).toBeGreaterThanOrEqual(3);
    expect(BOOT_COLORS.length).toBeGreaterThanOrEqual(2);
    for (const ramp of Object.values(REGION_RAMPS)) {
      expect(new Set(ramp).size).toBe(ramp.length); // no duplicate colors
    }
  });
});
