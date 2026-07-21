# Ideas

Parked ideas and observations — not commitments. Per CLAUDE.md, tangents
land here instead of in code.

## Character-pass playtest verdict (director, 2026-07-21)

Josh playtested the new pickable roster and flagged six issues. All parked
for a later session (his call — "we can get to them later"). Most are about
how the character looks *on the slope*, so they cluster naturally with the
already-planned ski-pose session; two are independent.

- **No feet.** The character reads as footless on the slope. Root cause to
  confirm: the Ultimate Animated Character Pack characters have **no shoe /
  boot / sock geometry at all** — their materials are Skin, Shirt, Pants,
  Belt, Face, Hair (no "Socks"/"Boots" like the old modular base had), so
  the legs just end in bare low-poly stumps. That, plus the feet possibly
  sinking into the snow surface on the slope (the skier's y placement vs the
  snow plane), is likely why they read as "no feet." Fixes to weigh:
  build simple flat-shaded ski boots in code (same trick as the cat's scarf
  and the planned skis — and boots are *part of* ski equipment anyway), or
  nudge the skier's ground placement so the existing foot geometry clears
  the snow. Best solved together with the skis/ski-pose work below.
- **Cat sits halfway in the character's hair.** The cat's mount on the
  skier's back is `(0, 0.95, 0.16)` in `client/src/skiRender.ts`, tuned
  against the *old* skier bases. On the new roster bodies that height lands
  at head/hair level, not the upper back. Needs re-tuning against the chosen
  character body — and it should be settled at the same time as the
  cat-facing fix (see that item below), since both are "where and how the
  cat rides."
- **Character stands straight while skiing — no response to lean.** Two
  parts: (a) the fixed forward ski-lean (`SKI_LEAN = -0.22` rad ≈ 13°,
  applied in `skiRender.ts`/`skierModel.ts`) is too subtle to read on a
  standing figure with no ski pose, so it looks like standing upright; and
  (b) the up/down *lean input* (which changes speed) produces **no visible
  change** in the character — Josh expected pressing up/down to visibly tuck
  forward / lean back. This is really the "ski pose" item below, extended: a
  real crouched ski pose *and* driving the torso bend from the lean input so
  the input is legible on the body. Belongs to the ski-pose session.
- **No ski equipment** — re-confirmed; see "the skier has no skis" below.
- **Hair does not move / is rigid.** The hair is part of the single skinned
  mesh (via the Hair material), not a separate object, so it should follow
  the head bone — verify it's actually weighted to `Head` and not to the
  root (if it floats while the head turns, that's a weighting bug worth a
  look). If it *is* head-weighted, "doesn't move" is just the low-poly
  reality of no hair bones / no secondary motion, which is arguably fine for
  this style — a taste call for the director, not necessarily a fix.
  Lowest priority of the six.
- **Character can be changed while skiing.** The `C`/`K`/`H` appearance keys
  in `client/src/main.ts` are handled regardless of scene, so you can cycle
  character/skin/hair mid-run on the slope. The code comment already claims
  these are "bedroom only" but nothing enforces it. Trivial independent fix:
  gate that keydown branch on `mode === "bedroom"`. (These keys are
  temporary stand-ins for the M3 picker UI anyway, but the gate is one line
  and stops the mid-run surprise.)

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
- **The skier has no skis, and no ski pose** (director playtest,
  2026-07-21, skier + character-pass sessions; **now unblocked** by the
  character pass, and re-confirmed by the character-pass playtest above): on
  the slope the character plays a *standing idle* (the shared Idle clip),
  because no CC0 pack contains a skiing clip. Three pieces now, all built
  once against the shared skeleton so they work for every character:
  **(1) skis and poles** in code out of simple flat-shaded shapes, the same
  way the cat's scarf is (cheap, bible-friendly) — and **ski boots** here
  too, which double as the fix for the "no feet" flag above; **(2) a real
  crouched ski pose** (bend knees, lean torso, arms forward) by setting bone
  rotations directly — no animation needed; **(3) make the up/down lean
  input legible on the body** — drive a visible torso bend from the lean, so
  the current invisible speed control reads as the character tucking/leaning.
  Strong candidate for the next session.
- **The cat should face downhill, not the camera — AND it sits too high**
  (director playtest, 2026-07-21, skier + character-pass sessions): two cat
  problems, both in `client/src/skiRender.ts`, to settle together as "how
  the cat rides." (1) The cat was deliberately left facing +z (back up the
  hill) so the player could see its face and signal-red scarf; the director
  doesn't want that — the one-line `cat.group.rotation.y = Math.PI` faces it
  downhill but costs scarf visibility. (2) **The cat mount `(0, 0.95, 0.16)`
  was tuned against the old skier bases; on the new roster bodies it lands
  halfway up the character's hair, not on the upper back.** The mount needs
  re-tuning against the chosen character body (probably a lower y, and a
  small forward/back offset), which is the same measurement pass the
  cat-facing decision wants — do them at once, alongside the ski pose.
- **Walking in the bedroom is jagged** (director playtest, 2026-07-21,
  skier session): movement is 8-way (four booleans in `BedroomInput`), but
  the player's *heading* snaps instantly between those eight fixed angles,
  and movement starts and stops instantly. So turning pops rather than
  turns. The fix is presentation-only and doesn't touch `/shared`: ease the
  rendered facing toward the target angle over a few frames (shortest way
  round, so it never spins the long way), and optionally ramp the walk
  animation in and out. Worth doing whenever the character work happens.
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
