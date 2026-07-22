# Ideas

Parked ideas and observations — not commitments. Per CLAUDE.md, tangents
land here instead of in code.

## Ski-pose playtest verdict (director, 2026-07-22)

The crouch/gear session landed its mechanics (cat faces forward ✓, real
ski equipment exists ✓, no more mid-run customization ✓) but the look
needs a round 2. Eight issues, with what each fix takes:

- **Skier never turns.** Steering is a pure sideways slide — the character
  faces dead ahead regardless of input. Presentation-only fix in
  `skiRender.ts`/`skierModel.ts`: derive lateral velocity (compare
  `state.lateral` between frames, like the bedroom heading does), and feed
  it into a yaw toward the movement direction plus a carving *bank* (body
  rolls into the turn). Eased like the tuck so it flows.
- **Legs and arms aren't independent — the body is a rigid block.** Two
  causes: the pose is perfectly symmetric (both legs identical, both arms
  identical), and the base frame is frozen (the Idle sway was deliberately
  frozen so the poles wouldn't wave — see the paused-clip gotcha in the
  ROADMAP entry). Fixes: stagger the pose (lead foot slightly forward,
  arms at different heights — real skiers are never symmetric), and add
  *small procedural motion* — speed-driven bob, a little independent arm
  float — instead of unfreezing Idle (which swings arms too much for a
  pole-holder).
- **Ski equipment doesn't match the art style.** The gear is plain
  primitives (sharp boxes, thin cylinders) against chunky rounded
  characters. Wants a proportion-and-facet pass: chunkier boots, thicker
  poles, skis with real upturned shovel tips and a bit of bevel — still
  code-built, just styled to the bible's "faceted, chunky, cute" rules.
- **Skis are too short.** Sized "short and cute" on purpose (1.35 units vs
  the 1.6-unit character); the director wants longer. Real-skier
  proportion (~head height or a touch more) ≈ 1.7–1.8 units. One constant,
  but re-check the chasm-lip visual once longer.
- **The cat should HUG the character's back and peek over the shoulder** —
  not sit upright on it like a shelf ornament. That's a real redesign of
  the mount, not an offset tweak: pitch the cat's body against the back's
  slope (belly contact), place it higher and slightly off-center, head
  coming over one shoulder. May want a custom clinging pose for the cat —
  the ski-pose session proved the technique (procedural bone offsets over
  a frozen base) works, and the cat has the same kind of rig. Interacts
  with the two hair items below; settle together.
- **Hair should move — real physics.** The hair is skinned mesh vertices
  under the shared skeleton's Head bone (its own `Hair` material, so the
  triangles are identifiable). Real cloth sim is out of scope for a web
  game, but a credible middle exists: split the hair triangles into their
  own mesh at load (by material), parent it to the Head bone, and drive it
  with a cheap spring/pendulum sway from head motion + speed wind. That
  same split is the prerequisite for hair-vs-cat collision below.
- **Hair should react against the cat** (the cat still ends up inside the
  hair on some characters). Once hair is a separate mesh with a spring
  (above), pushing it away from a cat-proximity sphere is the same math.
  Per-character mount offsets (hats and long hair change where the cat
  fits) are the cheaper fallback if hair physics slips.
- **The character still reads as footless.** The boots fixed the slope but
  are gear, not feet: the bedroom still shows bare leg stumps, and boots
  read as equipment. Proper fix: simple code-built *shoes* attached to the
  Foot bones in BOTH scenes (they'd follow the walk animation for free),
  with the ski boots replacing them on the slope. The pack characters have
  no shoe geometry of their own — this closes that gap everywhere.

## Character-pass playtest verdict (director, 2026-07-21)

Josh playtested the new pickable roster and flagged six issues. All parked
for a later session (his call — "we can get to them later"). Most are about
how the character looks *on the slope*, so they cluster naturally with the
already-planned ski-pose session; two are independent.

- ~~**No feet.**~~ **(Partially resolved 2026-07-22 — REOPENED by the
  ski-pose verdict above):** code-built ski boots landed on the slope, but
  the director says the character still reads as footless — the bedroom
  still shows bare stumps and boots read as gear, not feet. See "still
  reads as footless" in the 2026-07-22 block above for the everywhere-fix.
- ~~**Cat sits halfway in the character's hair.**~~ **(Partially resolved
  2026-07-22 — REOPENED by the ski-pose verdict above):** re-mounted lower
  at `(0, 0.62, 0.30)` facing downhill, but the director still sees hair
  overlap AND wants the mount redesigned entirely (hugging the back,
  peeking over the shoulder, hair reacting physically). See the 2026-07-22
  block above.
- ~~**Character stands straight while skiing — no response to lean.**~~
  **(RESOLVED 2026-07-22, ski-pose session):** real crouched pose blending
  braking ↔ full tuck off the run's speed (which encodes the lean input);
  airborne adds extra tuck. The old whole-body `SKI_LEAN` rotation is gone.
- ~~**No ski equipment**~~ **(RESOLVED 2026-07-22)** — skis, boots, and
  hand-following poles, built in code; see the ski-pose session in
  ROADMAP.md.
- **Hair does not move / is rigid.** *(Escalated by the 2026-07-22 verdict
  above: no longer a taste call — the director wants real hair physics,
  including reacting against the cat. See that block for the
  split-hair-mesh + spring approach.)*
- ~~**Character can be changed while skiing.**~~ **(RESOLVED 2026-07-22,
  ski-pose session):** the C/K/H branch in `client/src/main.ts` is gated on
  `mode === "bedroom"`, matching what the HUD hints always claimed.

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
- ~~**The characters don't match the art style**~~ **(RESOLVED 2026-07-21,
  character-pass session).** The two realistic ~6-heads-tall bases were
  replaced wholesale by Quaternius's **Ultimate Animated Character Pack** —
  chunky, big-headed, cute-by-construction, and by the same artist as the
  cat and the scenery. The player now *picks a character* from a curated
  cozy roster rather than dressing one body. See ROADMAP for the build.
- **Costume characters as level-unlocks** (noticed 2026-07-21,
  character-pass session): the Ultimate Animated Character Pack has ~44
  wearable characters; the starter roster ships 11 cozy ones (`CHARACTERS`
  in `shared/src/appearance.ts`). The rest — knights, ninjas, pirates,
  vikings, the witch, wizard, elf, chefs, doctors, cowboys' hats aside —
  are held back as candidates to gate behind XP levels, tying character
  choice into the progression loop (DESIGN.md → Leveling & Unlocks). Adding
  one is a one-line `CHARACTERS` entry plus a `tools/gltf_character.py`
  conversion; they all share the pack's skeleton and the shared
  `CharacterClips.glb`, so there's no per-character animation cost. A few of
  the pack's characters (the two Doctors, Casual3_Female, Chef_Female,
  Kimono_Female) are over the bible's ~5k-tri budget and would want a
  Blender decimate first.
- **The cat is a real Poly Pizza model; the pack has no cat** — unchanged
  note, but now the humans and the cat are finally the same art family.
- ~~**The skier has no skis, and no ski pose**~~ **(RESOLVED 2026-07-22,
  ski-pose session):** all three pieces landed, built once against the
  shared skeleton — code-built skis/boots/poles, a real crouched pose (bone
  offsets over a frozen Idle base; the pack's root-level IK-style foot
  bones mean dropping the pelvis folds the knees while the feet stay
  planted), and the tuck depth driven by speed so the lean input reads on
  the body. See ROADMAP.md for the four rig/loader bugs the verification
  caught.
- ~~**The cat should face downhill, not the camera — AND it sits too
  high**~~ **(RESOLVED 2026-07-22, ski-pose session):** faced downhill
  (director's call; the scarf is now mostly hidden from the game camera —
  the accepted cost) and re-mounted at the crouched pose's upper back.
- ~~**Walking in the bedroom is jagged**~~ **(RESOLVED 2026-07-22,
  ski-pose session):** the rendered heading eases toward the movement
  direction (shortest way round) in `bedroomRender.ts`; verified it never
  spins the long way. Start/stop animation ramping wasn't needed — the
  existing walk/idle cross-fade already covers it.
- ~~**The skier is dressed for summer**~~ **(RESOLVED 2026-07-21,
  character-pass session):** the t-shirt-and-shorts modular base is gone.
  The roster characters are fully dressed (casual coats, the OldClassy
  overcoat, the Cowboy jacket), and their outfits bake to the palette's
  saturated coat colors, so lit skin is no longer the largest non-snow
  color in a frame. Whether any of them read as *ski* clothing specifically
  (jackets, not cardigans) is a taste question for playtest — a proper
  parka would still be real art from the Modular Men pack.
- **Hairstyle geometry** (director direction, 2026-07-21, skier session):
  the call was "colors + a few hairstyles" for v1.0. **Reframed by the
  character pass:** picking a character already gives real hair-*shape*
  variety across the roster (bald, short, long, hats), which may satisfy
  "a few hairstyles" on its own. If the director still wants hair swappable
  independently of the character, that's geometry — a hair slot on the
  shared head bone and N meshes, mined from the
  [Ultimate Modular Men Pack](https://quaternius.com/packs/ultimatemodularcharacters.html).
  Its own session; revisit after the director sees the roster's built-in
  variety.
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
