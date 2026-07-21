# Asset Credits

Every asset in `/assets` gets a row here **before** it's committed — no
exceptions, including CC0 and AI-generated assets. The sourcing rules and
style-match test live in
[DESIGN.md → Art Style Bible](../DESIGN.md#art-style-bible).

An asset with no row here gets removed.

| File | What it is | Source | Author | License | Modifications |
|------|-----------|--------|--------|---------|---------------|
| `slope/BirchTree_Snow_{1,2,3,5}.glb` | Snowy birch trees (4 variants) | [Ultimate Nature Pack](https://quaternius.com/packs/ultimatenature.html) ([itch.io mirror](https://quaternius.itch.io/150-lowpoly-nature-models)) | Quaternius | CC0 | Palette recolor + OBJ→GLB via `tools/obj2glb_palette.py`; origin snapped to base. Variant 4 dropped (2,478 tris, over prop budget). |
| `slope/BirchTree_Dead_Snow_{1,2,3,4,5}.glb` | Dead snowy birches (5 variants) | same | Quaternius | CC0 | Same pipeline. |
| `slope/PineTree_Snow_{1,2,4,5}.glb` | Snowy pines (4 variants) | same | Quaternius | CC0 | Same pipeline; foliage recolored birch amber (palette has no green). Variant 3 dropped (2,392 tris, over prop budget). |
| `slope/Rock_Snow_{1,2,3,4,5,6,7}.glb` | Snow-capped rocks (7 variants) | same | Quaternius | CC0 | Same pipeline; rock faces recolored slate. |
| `slope/TreeStump_Snow.glb` | Snowy tree stump | same | Quaternius | CC0 | Same pipeline. |
| `slope/WoodLog_Snow.glb` | Snowy fallen log | same | Quaternius | CC0 | Same pipeline. |
| `slope/Bush_Snow_{1,2}.glb` | Snowy bushes (2 variants) | same | Quaternius | CC0 | Same pipeline. |
| `characters/{Casual_Male,Casual_Female,Casual2_Male,Casual2_Female,Casual3_Male,Casual3_Female,Casual_Bald,OldClassy_Male,OldClassy_Female,Cowboy_Male,Cowboy_Female}.glb` | The playable characters (11-strong cozy roster) — a curated subset of the pack's 50. Each rigged to the pack's shared 23-bone skeleton; 2.3k–8.4k tris | [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html) (glTF via the pack's Google Drive) | Quaternius | CC0 | Materials recolored to the palette and geometry-only (clips stripped) via `tools/gltf_character.py`. The pack ships textureless with named materials (Skin, Face, Hair, Shirt, Pants, Belt, …); `Skin`/`Hair` are recolored at runtime from the character palette in `client/src/skierModel.ts`, the rest baked at conversion time. |
| `characters/CharacterClips.glb` | The shared animation clips (16: Idle, Walk, Run, Jump, SitDown, …) — geometry stripped, skeleton kept | same | Quaternius | CC0 | `tools/gltf_character.py --animations-only`. Every character above shares this one skeleton, so the game binds these clips to any of them by bone name — one clip file instead of one per character. |
| `characters/Cat.glb` | The cat — rigged, 8 animation clips (Idle, Walk, Run, Jump, …), 2,448 tris | [Poly Pizza](https://poly.pizza/m/qKICY6xla2) | Quaternius | CC0 | Texture atlas baked out to palette vertex colors via `tools/glb_palette.py` (body → birch amber, belly → birch bark, eyes → deep slate, nose → signal red); all textures/images stripped. Red scarf is added in code, not part of the model. |

**Roster is curated on purpose:** the pack's costume characters (knights,
ninjas, pirates, vikings, the witch, chefs, doctors) are held back as
level-unlock candidates rather than shipped in the starter set — see
[IDEAS.md](../IDEAS.md). Adding one back is a one-line entry in
`CHARACTERS` plus a conversion; they all share the skeleton and clips.

Notes:

- **Source** is a URL to the exact pack/page the asset came from. For
  AI-generated assets, name the tool and write "AI-generated" here.
- **License** is the license at time of download (CC0, CC-BY 4.0, …).
  CC-BY and similar attribution licenses must also be credited in-game at
  launch.
- **Modifications** records what we changed: palette recolor, decimation,
  re-origin, etc. Write "none" if untouched.
