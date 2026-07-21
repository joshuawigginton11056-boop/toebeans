# Design Doc

Source of truth: [TOEBEANS_VISION.md](TOEBEANS_VISION.md) (written by the
director). This doc restates that vision in design-doc form and tracks what's
still open. When the two disagree, the vision file wins — update this doc to
match.

## Core Fantasy

You are a human with a pet cat. You design both: your character and your
cat. You live in a small environment — starting as a boring bedroom — that
you customize with furniture, decorations, paint, and more. The cat isn't
decoration: it's your best friend. You can pet it, pick it up, and hug it.

## Core Loop

Ski mountain slopes (cat strapped to your back) → earn XP → level up →
unlock new environments, furniture, appliances, and cosmetics → decorate and
interact with your space for more XP → repeat.

## Skiing

- **Controls:** left, right, up, down, jump, crouch, speed boost. Simple
  controls; the danger comes from the slopes.
- **Hazards:** giant snowballs chase from behind (jump to let them pass or
  get flattened), chasms to jump, tree limbs to duck under (crouch).
  Crashing sends you back to the last checkpoint.
- **The cat's nine lives:** hitting an obstacle costs one of the cat's 9
  lives. Run out and you forfeit the run — you still earn XP, but only half
  of what a completed run pays.
- **Slope structure (v1.0):** hybrid — handcrafted slopes with XP set by
  each slope's difficulty. Randomly generated slopes with selectable Easy /
  Difficult / Hard / Extreme modes (paying incrementally more XP) may come
  later if easier to add then.
- **Single-player skiing:** solo runs earn full XP. Finishing time affects
  XP — faster pays more, slower pays less. Crashing carries no penalty
  beyond a lost cat life and the time lost restarting at the checkpoint.

## Leveling & Unlocks

- Everyone starts at level 1 with basic items. **All players have identical
  base statistics** — no stat upgrades, ever. Greatness is earned only
  through high levels.
- Leveling unlocks:
  - **New environments:** bedroom → apartment → skyrise → and beyond (space
    shuttle, laboratory, Mars, Heaven, jungle, and others).
  - **Room customization:** beds, sheet/blanket/pillow colors, windows,
    curtains, appliances, furniture, optional technologies (computer, TV),
    carpet, flooring, rugs, optional fireplaces, indoor grill, and more.
  - **Cosmetics:** clothes for the character, outfits for the cat.
- **Environments are collected, not replaced.** Owned items are stored: in
  a new environment you can redeploy items you already own or buy new ones
  matching that environment's style.
- **Each environment saves its layout.** Switching environments preserves
  how each one is decorated. Later (post-v1.0), environment slots let you
  save multiple layouts per environment.

## Environment XP

- **Timed-task XP (appliances & tech):** interactable objects run a task on
  a timer — the grill cooks hot dogs, the TV is watched, a book is read by
  the fire, games are played on the computer, etc.
- **Passive/AFK XP (furniture):** the bed can be slept in, the couch laid
  on, and so on. Accrues even while the game is closed — on return, the
  game calculates what was earned while away. Accrual stops after 24 hours.

## Multiplayer (later phase — not in v1.0)

- **Head-to-head races:** invite a friend or match online to race a slope.
  Crashing respawns you at the last checkpoint, behind your opponent. Only
  one skier (and their cat) wins and earns the most XP — losers still earn
  100% of the loss reward (25% less than the winner's). Losing all nine cat
  lives mid-race still pays the full loss XP. If your opponent forfeits, you
  auto-win and can either finish the slope or end the run.
- **Leaderboards:** weekly and all-time win/loss-rate, plus leaderboards for
  the biggest winner and the biggest loser.
- **Friend visits:** invite friends into your environment for shared XP.
  Every interaction is available to guests — any appliance, technology, or
  furniture, exactly as the host would use it. Playing together grants both
  players a **15% XP boost**, which also applies when skiing online
  together.
- **Cats socialize too:** visiting cats play together and nap together.
- **Social design:** the friend boost gives low-level players a reason to
  find high-level partners (nice appliances, faster XP) and high-level
  players a reason to host (easy boost toward the next unlock) — a
  community, perhaps on Reddit, grows around this.

## Look & Feel

- **Graphics:** low-poly, cute, wholesome.
- **Cameras:** environments use a Sims-style bird's-eye view with full room
  rotation (so all walls can hold art). Skiing uses a 2.5D
  isometric/axonometric side-scroller with a three-quarter front
  perspective — you clearly see what's ahead, and (multiplayer phase only)
  behind you, the friend you just passed getting crushed by a snowball.
- **Detail touches — skiing:** skis carve marks into the snow; a visible
  snow trail changes with speed.
- **Detail touches — environments:** colors run warm or dark depending on
  decor; lamps glow; fireplaces crackle; book pages bend; cats meow.
- **Audio:** LOFI music plus ambient sounds — rain, birdsong, wind — and
  appropriate sounds for furniture, appliances, and decorations.
  *Director call (2026-07-21): on the slope, effects come first — done,
  playtested, passed. Slope music direction (director, same day): each
  slope gets a **timed song synced to its layout**, Geometry Dash style —
  tense before a big cliff jump, etc. (details in IDEAS.md; this
  supersedes the lofi vs ambient-only vs instrumental question for the
  slope). Music is deliberately the **last** M2 item — save/load and the
  rest come first. The LOFI direction above still stands for the
  environments (bedroom etc.), which get their audio in M4.*
- **UI tone (director call, 2026-07-21):** middle ground between
  soft-rounded and Omno-minimal — the cat faces stay cute, but panels,
  pills, and lettering calm down (less pill, less chunk, quieter panels).
  Lives-as-nine-icons and HUD-only scope stand; the title screen idea
  evolved into the dynamic showcase concept in IDEAS.md.

## Art Style Bible

The binding reference for all art in the game. Written 2026-07-21 from the
director's five *Omno* reference images and their notes on each. When
choosing or making any visual asset, it must pass this section. Expands the
"Graphics" line in Look & Feel above.

**What the director singled out in the references:** the haze from the sun
and in the distance (called out in 3 of 5 images); accurate, soft shadows;
brightness; simple-but-admirable rock shapes; snow trails and motion blur
showing speed; being able to *read distance* — rolling hills and haze
telling you how far away things are. **Called out as missing:** the snow
had no depth — no footprints, no ski trails carved into it.

**Emotional target:** lonely-and-vast, littered with obstacles — but cute.
Big empty bright spaces where the skier and cat are small; the warmth comes
from the characters, not the landscape.

### Palette (12 colors)

Every material in the game comes from this list (small value shifts for
shading are fine; new hues are not).

| # | Hex | Name | Used for |
|---|-----|------|----------|
| 1 | `#F8F5EF` | Sunlit snow | Default ground. Warm off-white — never pure `#FFFFFF`. |
| 2 | `#D3DFF0` | Snow shadow | Every shadow cast on snow. Soft blue — never gray or black. |
| 3 | `#AFC2DE` | Carved snow | Inside of ski trails, footprints, drifts, chasm lips. |
| 4 | `#BFDCF5` | Sky blue | Upper sky on a bright day. |
| 5 | `#F6D7CE` | Dawn pink | Horizon, and the distance-fog tint. |
| 6 | `#FFF4DA` | Sun glow | The sun and its halo — brightest value in any scene. |
| 7 | `#E9A960` | Birch amber | Tree canopies. The main warm accent in the landscape. |
| 8 | `#E3DCCD` | Birch bark | Trunks, branches, pale wooden props. |
| 9 | `#66738C` | Slate rock | Cliffs, boulders, chasm walls, distant ridges. |
| 10 | `#79B7D8` | Glacial ice | Ice walls and frozen hazards — the coldest, most saturated blue. |
| 11 | `#4E72A8` | Skier blue | The player's coat. Reserved — nothing else in a scene uses it, so the player always reads instantly. |
| 12 | `#C6473E` | Signal red | The cat's scarf/accent, hazard warnings, small critters. Also reserved — red means "look at this." |

Rough scene balance: ~60% snow whites (1–3), ~25% sky/haze (4–6), ~10%
landscape accents (7–10), ~5% character/signal (11–12). If a screenshot
feels wrong, count the warm accents first — too many birch-amber trees
kills the lonely-vast feeling.

### Shape language

- **Faceted, flat-shaded low poly.** One color per face; visible triangles
  are the style, not a budget compromise. No smooth shading on terrain or
  rocks (characters may be smoothed lightly to stay cute).
- **Simple silhouettes, admirable from far away.** Rocks and ridges are a
  few big confident facets, like the reference spires — if a shape needs a
  close look to read, it's too detailed.
- **Rolling, not jagged.** Slopes are long soft curves built from large
  triangles. Jagged is reserved for hazards (ice, chasm edges) so danger
  has its own shape vocabulary.
- **Scale contrast.** The skier and cat stay small in frame; hills roll
  away to a hazy horizon. Wide open negative space is a feature.
- **Cute lives in the characters.** Chunky, rounded, big-headed skier and
  cat against an austere landscape — never cartoon-ify the landscape
  itself.
- **No texture detail.** Color comes from flat materials or vertex colors.
  No photo textures, no painted-on detail, no normal maps.

### Lighting & atmosphere

- **One sun, bright and high-key.** A single directional light, sun low
  enough to throw long readable shadows. The whole game is bright — dark
  moods are out of scope.
- **Shadows are soft blue, never black.** Shadow color is palette #2. Use
  soft shadow edges (in Three.js: PCF shadows with a blur radius — the old
  PCFSoft mode was retired upstream in r185). The director called out
  "accurate" shadows — shadows must track objects correctly, especially
  the skier's shadow on the snow, which is a key height cue during jumps.
- **Haze is mandatory.** Distance fog tinted dawn pink (#5) near the
  horizon fading from sky blue (#4). Faraway objects lighten and lose
  saturation toward the fog color. This is the single most-praised thing
  in the references *and* it's gameplay: haze plus rolling hills is how
  the player reads how far away the next obstacle is.
- **The sun glows.** Visible sun disc in sun-glow (#6) with a soft halo.
  Subtle bloom is welcome; lens-flare streaks are not.

### Snow & motion rules

The director's one explicit dislike in the references: snow with no depth.
Snow in Toebeans is a surface that *remembers*.

- **Skis carve.** The ski trail is a visible carved groove (palette #3),
  not a decal painted on top. It persists behind the skier.
- **Feet print.** The cat and any critters leave footprints. Depth of
  impression matches the creature's size.
- **Speed is visible.** Trail spray/kick-up grows with speed; at high
  speed, slight motion blur or speed-lines on the world edges (as in the
  birch-forest reference). Boost should be readable from a screenshot.

(These are rendering features, not just style notes — tracked as the
"detail touches" items in [ROADMAP.md](ROADMAP.md) M2/M4.)

### Asset sourcing rules (.glb)

Priority order:

1. **Free CC0 packs first.** Check in order: [Kenney](https://kenney.nl)
   (all CC0), [Quaternius](https://quaternius.com) (CC0),
   [Poly Pizza](https://poly.pizza) with the license filter set to CC0,
   [OpenGameArt](https://opengameart.org) filtered to CC0. CC0 means no
   legal strings attached — we credit anyway (see below).
2. **Other free licenses (CC-BY etc.) second**, only if CC0 has no match —
   attribution requirements go in CREDITS.md and must be honored in-game
   at launch.
3. **AI-generated only as a last resort**, and only if the result actually
   matches this bible after cleanup (flat-shaded, palette-recolored, under
   budget). Mark it clearly as AI-generated in CREDITS.md, including the
   tool used. If it doesn't match the bible, we model it ourselves or cut
   the prop.

Every asset must pass the **style-match test** before it enters the repo:

- Flat-shaded low poly, no photo/painted textures, no normal maps.
- Recolorable: materials swapped to the 12-color palette. If an asset
  can't be cleanly recolored, it doesn't come in.
- Silhouette reads at gameplay distance in the 2.5D ski camera.
- **Props stay under ~2,000 triangles.** Characters and large one-off set
  pieces may go to ~5,000. Check in Blender or with `gltf-transform
  inspect` before committing.
- Format: `.glb`, real-world meters, Y-up, origin at the base of the
  object (where it touches the ground).

**Every asset gets a line in [assets/CREDITS.md](assets/CREDITS.md)** —
filename, what it is, source URL, author, license, and what we changed
(recolor, decimation, etc.). No exceptions, including CC0 and
AI-generated. An asset with no CREDITS.md line gets removed.

## Design intent

- **What "cozy" means:** Cozy is about comfort. The game should feel
  relaxing. Players should want to live in their environments with the cat,
  and go on snowy ski adventures. It should be a second home, away from the
  stress and worries of the world.

- **Progression and endgame:** Progression is open-ended, not building to a
  fixed endgame. Levels continue to rise (at a slower rate each level). New
  environments and customization keep players interested. Friend/cat/
  environment viewing is deferred to M6 (async social) per director
  decision, July 20, 2026 — v1.0 has no friend-viewing and is fully
  single-player. So: relax, ski, get creative, and love on your cat.

- **What makes Toebeans different from Stardew Valley / Animal Crossing:**
  The graphics and gameplay separate it from both. The visual target is
  graphics like *Omno*.

## Scope: v1.0 / v1.x / Steam

Approved by the director, July 20, 2026. This is the answer to "what do we
actually build first" — see [ROADMAP.md](ROADMAP.md) for the milestone
checklist that delivers it.

**Gate result (July 21, 2026):** the M1 prototype fun check **passed,
barely** — the loop is fun enough to invest in art, with feel tuning
staying a live concern. Director call for the next phase (their numbering:
"phase 3"; the roadmap's M2): polish **one area** of the game end to end —
real assets, lighting, UI, sound, save/load — rather than spreading
vertical-slice work across both areas at once.

**Area chosen (July 21, 2026, director call):** the **ski slope**, with
assets sourced from the Quaternius Ultimate Nature Pack (CC0) — its snow
variants matched the bible's birch/pine/rock needs directly. The bedroom
reaches the same polish level in M3.

### v1.0 — smallest shippable version (web launch, M5)

Everything needed for the full loop — ski → earn XP → level up → unlock →
decorate → repeat — to work end to end. Strictly single-player (friend/cat/
environment viewing is deferred to M6, per the existing director call
above).

- Character customization (basic options)
- Cat customization (basic options)
- One environment: the starting bedroom, with the Sims-style rotating
  bird's-eye camera
- Furniture/appliance placement system (place, move, store owned items)
- **6–8 starter furniture/appliance items**: at least one timed-task item
  (e.g. a TV or grill) and one passive/AFK item (the bed), plus a few
  decorative pieces
- Skiing: core movement/controls/camera, hazards (snowballs, chasms, tree
  limbs), checkpoints, the cat's 9 lives and forfeit-for-half-XP rule
- **3 handcrafted slopes**
- XP and leveling (earning, level curve, save/persist)
- Level-gated unlocks connecting XP to environment/furniture/cosmetic
  access
- Timed-task XP (appliance timers) and passive/AFK XP (with 24-hour
  offline catch-up)
- Save system (browser storage — no accounts yet; see IDEAS.md note on
  cloud saves)
- Audio hookup for music + ambient sound

### v1.x — post-launch (still browser, still single-player)

Grows the same loop; adds nothing that changes how it works.

- Additional environments beyond the bedroom (apartment, skyrise, and
  onward per the vision doc's list)
- Additional handcrafted slopes beyond the initial 3
- Procedurally generated slopes with selectable Easy/Difficult/Hard/
  Extreme difficulty
- Environment save slots (multiple saved layouts per environment)
- Expanded furniture/cosmetic catalog beyond the v1.0 starter set
- M6 async social: friend/cat/environment viewing

### Steam version (later phase)

Requires systems v1.0 and v1.x have no reason to build.

- Electron wrapper + steamworks.js packaging
- Real-time head-to-head slope races (the largest single system in the
  full vision — needs server-authoritative netcode)
- Leaderboards (weekly/all-time win-loss, biggest winner/loser)
- Friend visits with shared XP boost and cats socializing together
- Achievements
