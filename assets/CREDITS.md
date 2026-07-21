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
| `characters/Skier_Modular.glb` | The skier — candidate base A. Rigged, 11 clips (Idle, Walk, Run, Jump, Sitting, …), 1,852 tris | [Poly Pizza](https://poly.pizza/m/HMnuH5geEG) | Quaternius | CC0 | None to the file — it already ships textureless with six named materials (Shirt, Skin, Pants, Eyes, Socks, Hair). Those six are the customization regions, and their colors are set at runtime from the character palette in `client/src/skierModel.ts`. |
| `characters/Skier_Animated.glb` | The skier — candidate base B. Rigged, 10 clips (Idle, Walking, Running, Jump, Sitting, …), 1,908 tris | [Poly Pizza](https://poly.pizza/m/9kF7eTDbhO) | Quaternius | CC0 | Texture atlas baked out to palette vertex colors via `tools/glb_palette.py` (skin, hair, eyes, coat, trousers, boots → the character palette's defaults); all textures/images stripped, per the bible's no-textures rule. |
| `characters/Cat.glb` | The cat — rigged, 8 animation clips (Idle, Walk, Run, Jump, …), 2,448 tris | [Poly Pizza](https://poly.pizza/m/qKICY6xla2) | Quaternius | CC0 | Texture atlas baked out to palette vertex colors via `tools/glb_palette.py` (body → birch amber, belly → birch bark, eyes → deep slate, nose → signal red); all textures/images stripped. Red scarf is added in code, not part of the model. |

**Two skier bases on purpose:** the director is picking between them by eye
(see [DESIGN.md](../DESIGN.md#scope-v10--v1x--steam) → Character assets).
The losing one gets deleted from the repo and from this table.

Notes:

- **Source** is a URL to the exact pack/page the asset came from. For
  AI-generated assets, name the tool and write "AI-generated" here.
- **License** is the license at time of download (CC0, CC-BY 4.0, …).
  CC-BY and similar attribution licenses must also be credited in-game at
  launch.
- **Modifications** records what we changed: palette recolor, decimation,
  re-origin, etc. Write "none" if untouched.
