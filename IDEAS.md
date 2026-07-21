# Ideas

Parked ideas and observations — not commitments. Per CLAUDE.md, tangents
land here instead of in code.

- **Finish line / run completion** (noticed 2026-07-20, during the 9-lives
  session): the slope currently never ends — you ski past the last chasm
  forever. A finish line is needed before XP can exist, because "a
  forfeited run pays half of what a *completed* run pays" (DESIGN.md)
  requires "completed" to be a real thing. Probably part of the fun-check
  session or the first XP session.
- **The nature pack has ~126 more models we didn't use** (noticed
  2026-07-21, first slope-assets session): the Quaternius Ultimate Nature
  Pack's non-snow variants — regular/autumn/dead birches, pines, willows,
  common trees, mossy rocks, cacti, palms, plants — would dress future
  environments (the vision doc's jungle, Mars, etc.) through the same
  `tools/obj2glb_palette.py` pipeline. The pack zip isn't committed (only
  converted .glb files are); re-download it from the itch.io mirror linked
  in assets/CREDITS.md when needed. Two snow trees (BirchTree_Snow_4,
  PineTree_Snow_3) were skipped for being over the triangle budget —
  decimation in Blender could rescue them if variety ever runs thin.
- **Bundle a rounded display font for the UI** (noticed 2026-07-21, real-UI
  session): the HUD currently uses the system font (Segoe UI) with heavy
  weights. A properly chunky rounded font — Fredoka or Baloo 2, both free
  under the SIL Open Font License — would push the cozy tone further.
  Needs a director yes/no because it means downloading a font file into
  the repo (plus a CREDITS.md row). Cheap to do in any later UI session.
- **Turn down the ski-carve sound** (director playtest note, 2026-07-21,
  sound session): the sound effects passed playtest — speed feels real,
  the wind is the favorite — but the ski/carve hiss is too loud relative
  to the rest. A picky-tuning item, not a redo: lower the carve layer's
  loudness (the `carve` numbers in `client/src/audio.ts`'s
  `setLayerTargets`) in the end-of-M2 tuning pass, alongside the parked
  visual tweaks.
- **Timed per-slope music, Geometry Dash style** (director direction,
  2026-07-21, UI-restyle session): instead of a generic background track,
  each slope gets its own composed/timed song that plays in sync with the
  slope's layout — tense right before a huge cliff jump, and so on. Works
  because v1.0's slopes are handcrafted with fixed layouts, so the music
  can be authored against known hazard positions. Things to solve when it
  gets built: what happens to the sync on a crash/checkpoint respawn
  (Geometry Dash restarts the whole level *and* song; Toebeans respawns
  mid-slope), and how it layers with the existing speed-tracking wind/
  carve effects. This supersedes the old lofi vs ambient-only vs
  instrumental question for the slope. **Music is deliberately last in
  M2** (director call, same day): build save/load and the rest first,
  music comes at the end.
- **The bedroom's lighting predates the physical-lights fix** (noticed
  2026-07-21, cat-model session): the ski scene's lighting pass multiplies
  light intensity by `Math.PI` (Three.js folds 1/π into materials), which
  is why snow there renders at the exact palette hex. The bedroom never got
  that treatment, so *everything* in it renders roughly 45% too dark — the
  floor, the walls, and now the cat, which measures `#93734E` in the
  bedroom versus its correct amber on the slope. Not a bug in any asset;
  it's the gray-box lighting the room has always had. Fixing it properly is
  the M3 "bedroom to the same polish level" item, and it's more than a
  constant — the room wants its own lighting design. Flagged so the cat
  isn't blamed for looking muddy at home.
- **Wildlife on the slopes: foxes, deer, wolves** (director direction,
  2026-07-21, cat-model session): the
  [Ultimate Animated Animals Pack](https://quaternius.com/packs/ultimateanimatedanimals.html)
  (Quaternius, CC0, 12 animals, 12+ animations each) is the source. Same
  artist as the Nature Pack our trees came from and as the cat, so they'll
  match by construction, and `tools/glb_palette.py` already converts this
  exact format (single atlas material → palette vertex colors). Open
  questions when it's built: are they pure scenery (safe to ignore, like
  the trees), hazards, or XP-bearing "environment life"? The Art Style
  Bible's signal-red rule suggests small critters can wear red to read
  against the snow. Note the pack does **not** contain a cat — that came
  from a standalone Poly Pizza model.
- **Cat customization** (director direction, 2026-07-21, cat-model
  session): players should be able to customize their cat, matching the
  character customization in the v1.0 scope. The model is already built
  for it: `tools/glb_palette.py` bakes the cat into exactly four color
  regions (body / belly / eyes / nose), so a coat color is one attribute
  rewrite at runtime — no new meshes, no textures. Fur *pattern* (tabby,
  tuxedo, calico) would mean either per-region vertex groups or a second
  color set; breed/shape variety would mean new meshes. Should ship
  alongside character customization so both live in one place.
- **The skier is dressed for summer** (noticed 2026-07-21, skier session):
  measuring the modular base's parts showed its "Pants" region only covers
  0.49–0.87 units of a 1.6-unit body, with bare skin below and above — it's
  a **t-shirt and shorts**, on a ski slope. Lit skin is the single largest
  non-snow color in a rendered frame. The animated base is better dressed
  (its trousers region runs the full leg). Fixing it properly means real
  art: a jacket/trousers piece mined from the
  [Ultimate Modular Men Pack](https://quaternius.com/packs/ultimatemodularcharacters.html)
  (built for exactly this kind of part-swapping), or accepting it as a
  deliberate "this cat owner is very hardy" joke. Worth settling alongside
  the base-model choice, since it may decide it.
- **Hairstyle geometry** (director direction, 2026-07-21, skier session):
  the call was "colors + a few hairstyles" for v1.0. The **colors** half
  landed this session; hairstyles are geometry, not a recolor, so they need
  a hair slot on the head bone and N meshes to pick from — the Modular Men
  pack is the source. Its own session, and it should probably wait until
  the base model is chosen, since the hair has to fit that skull.
- **Player facing lives in the renderer, not the state** (noticed
  2026-07-21, skier session): `BedroomState` has a facing for the cat (its
  brain needs one) but not for the player, so `bedroomRender.ts` derives
  the player's heading from how their position moved between two frames.
  That's fine while facing is pure presentation, but the moment anything in
  `/shared` needs to know which way the player looks — interacting with
  furniture, picking the cat up, an emote — it should become real state
  with tests, like the cat's.
- **Dynamic title screen** (director direction, 2026-07-21, sound
  session): the game still drops you straight into the bedroom with no
  framing — no game name, no "press Enter". The director's call: when it
  gets built, it should be a *dynamic* title screen that showcases the
  game world — landscape, enemies, rough terrain, animals, and other
  objects — growing richer as those things are added to the game. Not
  scheduled yet; revisit once there's more world to show off (snowballs,
  tree limbs, critters are all still unbuilt).
