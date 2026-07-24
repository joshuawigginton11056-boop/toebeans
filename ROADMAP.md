# Roadmap

Living status doc: **what exists now** and **what's still open** — not a
session-by-session diary. Keep it lean. The full blow-by-blow history through
2026-07-24 (~5,000 lines) was consolidated into this file on 2026-07-24 and
remains in git history if you ever need the detail.

**Convention:** still update this every session, but by *editing* the state
below and *checking off* milestones — do not append narrative entries. New
ideas go in [IDEAS.md](IDEAS.md); scope lives in
[DESIGN.md](DESIGN.md#scope-v10--v1x--steam).

---

## Where we are

- **M1 (gray-box prototype): COMPLETE** — fun-check gate PASSED, barely
  (2026-07-21). The loop justifies the art investment; feel tuning stays live.
- **M2 (vertical slice = the ski slope): nearly done.** The slope skiing feel,
  characters, cat, lobby, HUD, audio effects, and save/load are all real. What
  remains is the second hazard, music (deliberately last), a batch of parked
  character-life polish, and the end-of-M2 tuning pass. See *Open* below.
- Nothing is deployed anywhere; the game runs only via `npm run dev`.

---

## What exists now

### Foundation
- TypeScript strict + Three.js + Vite; npm workspaces (`client`/`server`/`shared`);
  Vitest. `npm run check` = typecheck + tests (~119 tests green).
- All game logic = pure functions in `/shared` over a serializable `GameState`;
  rendering reads state, never mutates it (multiplayer-proofing).
- Runs as **parallel git worktrees** — `lobby`, `slope-mechanics`,
  `slope-visuals`. Read [PARALLEL.md](PARALLEL.md) before touching code.
- Art Style Bible written in [DESIGN.md](DESIGN.md) (12-color palette, shape
  language, lighting/haze, "snow remembers"). ⚠ The no-texture rule is amended
  and under review — painted prop detail and realism snow are approved; full
  bible rewrite is pending.

### Ski slope (the M2 area)
- **Slope 1 "The Overlook"** — a finite track skeleton (finish at distance 800,
  a "finished" status that coasts to a stop and auto-returns to the lobby,
  chasms/checkpoints placed to a beat sheet, a lane pinch at the rock gate).
  Now framed as **the onboarding run**; the "actual map" is the next mechanics job.
- **Momentum skiing:** inertial speed with a pole push-off from a standstill,
  boost that builds and coasts, braking that bites. Real turning (skis point
  where you steer; turning scrubs speed; fully sideways = hockey stop; **switch
  riding is first-class**), hold-to-charge jumps, held-Space air spins (180/360),
  a landing grip window, landing lockout + a "tired hop" cue.
- **Road system** (`client/src/slopePath.ts`): a presentation-only centerline,
  curve-ready but **straight/identity today** (bit-for-bit the old world).
- **Real assets:** frosted-green pines, rocks, etc. — painted detail rolled
  across all 24 slope models; decor scatter follows the run. (Old birches removed.)
- **Realism snow:** procedural displaced surface + GPU-carved ski trails.
- **Lighting/haze:** warm sun, palette-exact blue shadows, dawn-pink fog, sun disc.
  Now on a **`timeOfDay` phase** (`skiScene.ts`): 0 = that dawn (a verified no-op),
  1 = a **moonlit night** (branching-map "sun sets as we race" idea, director
  2026-07-24) — cool dimmed lights solved onto palette-family snow (#8FA0BE lit /
  #3F4D70 shadow), moon disc, navy sky, fade-in stars. Debug key **N** cycles
  dawn→dusk→night for the look-pass; auto-transition not wired yet. ⚠ amends the
  bible's "bright only" rule (DESIGN.md note).
- **Loose snow:** ski-trail spray, screen flurries, and a lens splat of
  naturalistic snow-clump particles (director-approved).
- **Camera:** free zoom, fixed angle, pointer-lock mouse look.
- **Slope audio (effects):** synthesized in-browser via Web Audio, no files —
  speed-tracked wind + carve hiss, boost rush, jump/land/crash/checkpoint
  one-shots; **M** mutes.

### Character + cat
- **Playable roster of 11** cozy Quaternius characters (Casual/OldClassy/Cowboy),
  shared skeleton + one `CharacterClips.glb`. Appearance = `{character, skin, hair}`
  as palette indices (`shared/src/appearance.ts`), tinted skin/hair.
- **Ski pose:** code-built crouch on the shared skeleton, blending brake↔tuck off
  speed; code-built skis/boots/poles (slope-only); carve/bank/angulation, staggered
  stance, and a procedural life layer (pelvis bob, arm float, snow chatter).
- **Cat:** real rigged/animated CC0 model, palette vertex colors + scarf
  (`client/src/catModel.ts`, both scenes). Hugs the skier's back via a live
  spine-glued mount, peeks over a shoulder, faces downhill.
- **Hair physics:** spring-driven off head motion + wind, repelled from the cat.
- Temp keys (stand-ins for the M3 picker): **C** character, **K** skin, **H** hair
  — gated to the lobby.

### Lobby, UI, systems
- **Menu lobby / title screen** (`lobbyRender.ts` + `lobbyUi.ts` + `lobbyLayout.ts`)
  — a live 3D vignette on dawn snow; doubles as character select. This
  **replaced the scrapped walkable bedroom**; there is no walkable home space.
  Seats a **party of up to four** (you plus guests, left/middle/front rules in
  the unit-tested `lobbyLayout.ts`), **backed well off the camera** to leave
  foreground room for menu UI. Each player stands on a **glowing orb** — warm
  amber for you, cool ice for guests — that **darkens to contrast the backdrop**
  (`backdropContrast` / `setLobbyBackdropColor`, ready for a future re-tint).
  Each player has a **cat beside them** (yours strolls; guests' sit), and
  **nameplates** float a character name on each orb and a pet name above each
  cat. Party size is a `?players=` preview hook (`setLobbyPlayerCount`); guest
  looks and pet names are placeholders until multiplayer feeds real data.
- **HUD** (`client/src/hud.ts`): nine cat-face lives, crash/forfeit banners,
  keycap hints — middle-ground restyle.
- **Save/load:** browser storage, `SAVE_VERSION 5`. Snapshots dynamic state only;
  static layout reloads from `createInitial*`; strict + self-healing decode.

### Tooling / assets
- `tools/obj2glb_palette.py`, `tools/glb_palette.py`, `tools/gltf_character.py`
  (palette-recolor OBJ/GLB → bible palette). Every asset licensed in
  [assets/CREDITS.md](assets/CREDITS.md). Furniture models sit in `assets/bedroom/`
  as the future unlock pool (currently unused in-game).

---

## Open — still to resolve

### M2 remaining
- [ ] **Second hazard: tree limbs + the `crouch` control.** Crouch is deliberately
      unbuilt until there's a limb to duck under; build them together.
- [ ] **"Fling more" snow:** bigger plume + lens boost on hard carves, and a
      landing "poof" (needs a small `justLanded`/impact seam field, mechanics→visuals).
- [ ] **Slope 1 gentle S-curve:** give `slopePath.ts` `BENDS` real amplitudes — a
      joint slope-mech + slope-vis flip, once visuals draw against the centerline.
- [ ] **"The actual map"** beyond the onboarding run — next slope-mechanics
      session; scope pinned at that session's start (unscoped on purpose).
- [ ] **Night: sun sets *as you race*.** The night end-state look is built (see
      Ski slope); the auto-transition trigger is a director call (linear distance?
      which map branch?), plus a designed dusk/golden-hour midpoint and night
      decor/audio/lobby. IDEAS.md (slope-vis) has the full list.
- [ ] **Music:** timed per-slope songs à la Geometry Dash (tense before big jumps)
      — deliberately the **last** M2 item.
- [ ] **End-of-M2 tuning pass:** the parked picky visual tweaks + carve-hiss volume,
      done in one sweep rather than nibbled between features.

### Parked character-life polish (director-deferred, IDEAS.md top block)
- [ ] Angulation round 3 — put the turn into the **leg chain** itself, not a
      whole-plank roll; fix the feet-out-of-boots regression (roll foot pins to match).
- [ ] Always-on feet — boots are slope-only; the lobby character still shows stumps.
- [ ] Gear style pass + **longer skis** (real proportion, not "short and cute").
- [ ] Jump knee-bend / takeoff-anticipation; decision on purpose-built big jumps.
- [ ] Hair roots float mid-turn (fade swing root→tip); cat tail is stiff (wants
      wind-reactive swoosh via the hair spring model).

### Big open decisions
- [ ] **Where the decorate / earn-your-furniture loop lives** now that the bedroom
      is scrapped (lobby has no walkable home). The v1.0 decorate loop currently
      has no stage — options in IDEAS.md; DESIGN.md carries matching ⚠ notes.
- [ ] **Art-direction / bible rewrite:** finalize the amended texture rules
      game-wide and rewrite the bible section.

---

## Milestones (toward the v1.0 web-launch scope)

### M1 — Prototype (gray-box "is this fun?" gate) — COMPLETE
- [x] Character + cat in a gray-box room; one gray-box slope with a hazard;
      9 lives + crash/checkpoint loop.
- [x] Fun check: PASS (barely) — 2026-07-21; feel tuning stays live through M2.

### M2 — Vertical slice (polish the ski slope end to end)
- [x] Pick the area — **slope** (2026-07-21).
- [x] Real Omno-target assets (trees/rocks, realism snow, cat, character roster,
      ski pose + gear). *Remaining slope hazard art is tracked in Open.*
- [x] Lighting pass.
- [x] Real UI (cat-face lives, banners, keycap hints) + middle-ground restyle.
- [x] Save/load (browser storage).
- [x] Sound **effects** (synthesized, playtest-passed).
- [ ] Sound **music** (timed per-slope songs — built last).
- [ ] Second hazard (tree limbs + crouch).
- [ ] End-of-M2 feel/visual tuning pass.

### M3 — Content
- [x] ~~Bring the other area to slope-level polish~~ — superseded: the bedroom
      was scrapped for the menu lobby (built polished from day one).
- [ ] Decorate/progression loop — **blocked on the "where does it live" decision.**
- [ ] Furniture placement (place/move/store).
- [ ] One timed-task item + one passive/AFK item, end to end.
- [ ] XP and leveling wired to unlocks; unlocks-by-level UI.
- [ ] All 3 v1.0 slopes (slope select becomes a lobby menu item).
- [ ] Full 6–8 item furniture/appliance set.
- [ ] Character + cat customization options (picker UI replacing C/K/H).
- [ ] 24-hour offline XP catch-up.

### M4 — Polish
- [ ] Music + ambient across the rest of the game.
- [ ] Detail touches (ski trails, lamp glow, fireplace crackle, meows).
- [ ] 60fps on a mid laptop; under 15MB initial load.
- [ ] Full-loop playtest pass.

### M5 — Web launch
- [ ] Deploy to itch.io.
- [ ] Steam store page live (wishlist accumulation).
- [ ] Submit to web portals (Poki/CrazyGames or similar).

*(M6 async social and M7 Steam real-time co-op are post-v1.0 — see DESIGN.md.)*
