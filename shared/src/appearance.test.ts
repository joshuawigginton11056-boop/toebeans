import { describe, expect, it } from "vitest";
import {
  CHARACTERS,
  HAIR_COLORS,
  REGION_RAMPS,
  SKIN_TONES,
  createDefaultAppearance,
  cycleCharacter,
  cycleRegion,
  normalizeAppearance,
  resolveAppearance,
  resolveCharacter,
  type CharacterRegion,
} from "./appearance";

const REGIONS = Object.keys(REGION_RAMPS) as CharacterRegion[];

describe("appearance", () => {
  it("resolves the default to the documented skin and hair", () => {
    const colors = resolveAppearance(createDefaultAppearance());
    expect(colors.skin).toBe("#DCA77E"); // honey
    expect(colors.hair).toBe("#4A3628"); // dark brown
  });

  it("defaults to the first character in the roster", () => {
    expect(resolveCharacter(createDefaultAppearance())).toBe(CHARACTERS[0]);
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

  it("cycles through every character and wraps", () => {
    let appearance = createDefaultAppearance();
    const seen = [resolveCharacter(appearance).id];
    for (let i = 0; i < CHARACTERS.length - 1; i++) {
      appearance = cycleCharacter(appearance);
      seen.push(resolveCharacter(appearance).id);
    }
    expect(new Set(seen).size).toBe(CHARACTERS.length);
    // One more step wraps back to the start.
    expect(resolveCharacter(cycleCharacter(appearance)).id).toBe(
      resolveCharacter(createDefaultAppearance()).id,
    );
  });

  it("cycling the character keeps the colors", () => {
    const before = { ...createDefaultAppearance(), skin: 6, hair: 7 };
    const after = cycleCharacter(before);
    expect(after.character).not.toBe(before.character);
    expect(after.skin).toBe(6);
    expect(after.hair).toBe(7);
  });

  it("every character id maps to a distinct model file", () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // Filenames only — the client turns these into asset URLs.
      expect(id).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it("clamps indices that fall outside their range", () => {
    const wild = normalizeAppearance({
      character: 999,
      skin: 999,
      hair: -5,
    });
    expect(wild.character).toBe(CHARACTERS.length - 1); // too big → last
    expect(wild.skin).toBe(SKIN_TONES.length - 1); // too big → last color
    expect(wild.hair).toBe(0); // negative → first color
  });

  it("heals a non-finite index to the first entry rather than an end", () => {
    // Non-finite isn't a stale index, it's garbage — so it falls back to the
    // first entry rather than clamping to either end.
    const healed = normalizeAppearance({
      character: Number.NaN,
      skin: Number.POSITIVE_INFINITY,
      hair: 2.9, // and a fractional index truncates, not rounds
    });
    expect(healed.character).toBe(0);
    expect(healed.skin).toBe(0);
    expect(healed.hair).toBe(2);
  });

  it("does not mutate the appearance it is given", () => {
    const original = createDefaultAppearance();
    const copy = { ...original };
    cycleRegion(original, "skin");
    cycleCharacter(original);
    normalizeAppearance(original);
    resolveAppearance(original);
    expect(original).toEqual(copy);
  });

  it("offers enough range to be worth calling customization", () => {
    // Guards against a ramp being accidentally emptied or collapsed.
    expect(SKIN_TONES.length).toBeGreaterThanOrEqual(6);
    expect(HAIR_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(6);
    for (const ramp of Object.values(REGION_RAMPS)) {
      expect(new Set(ramp).size).toBe(ramp.length); // no duplicate colors
    }
  });
});
