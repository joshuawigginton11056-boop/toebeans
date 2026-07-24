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
  Vitest. `npm run check` = typecheck + tests (~129 tests green).
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
  chasms/checkpoints placed to a beat sheet, a lane pinch at the rock gate). Flat
  (faked grade). **No longer the default run** — the branching map replaced it as
  what "Hit the slopes" loads; reachable at **`?overlook=1`** for comparison.
- **Momentum skiing:** inertial speed with a pole push-off from a standstill,
  boost that builds and coasts, braking that bites. Real turning (skis point
  where you steer; turning scrubs speed; fully sideways = hockey stop; **switch
  riding is first-class**), hold-to-charge jumps, held-Space air spins (180/360),
  a landing grip window, landing lockout + a "tired hop" cue.
- **Road system** (`client/src/slopePath.ts`): a presentation-only centerline,
  curve-ready but **straight/identity today** (bit-for-bit the old world).
- **Branching map (the "actual map") — the real §4 layout is in, as grayblock.**
  Per SLOPE_BRANCHING.md (director's direction: one continuous descent that grabs
  you into detour worlds, all obeying **"same clock, same flag"**), a sim-side
  **segment graph** (`shared/src/route.ts`) chains the real map: **summit →
  enchanted forest (Type A: road/tree) → frozen lake (Type A: around/into-water) →
  yeti's peak (Type B: cave/ledge)**, resolving to the three §4 routes —
  **Cave** (…yeti·cave·cliff), **Ice** (…yeti·ledge·valley·ice-castle), **Water**
  (…lake·water·cliff) — each **640** units by construction, with the Cave/Water
  reconvergence (`cliff`) landing at the identical route-offset (540) whichever
  way it's reached. The renderer places each segment in its own grayblock world
  corridor (`SEGMENT_PLACEMENTS`/`addBranchGrayblock`, now fully data-driven off
  the registry — boxes only, no `skiScene.ts`); `roadSegmentIds()` is the single
  source of truth for spine-vs-detour. **The corridors CURVE now (2026-07-24):**
  each segment is a constant-curvature arc (`SEGMENT_SHAPES` in `slopePath.ts`),
  the spine weaving a gentle S down the middle and the detours peeling off to
  their sides — chained smoothly on continuous runs (no kink), cut at fork
  handoffs; the grayblock floor/walls facet along the arc to follow it. 144 tests
  (incl. a behavioral proof all three routes + the tree no-op reach the flag on
  the same step, the grade, and the arcs' length/continuity).
  **It is now the DEFAULT slope (2026-07-24)** — "Hit the slopes" loads it at the
  live URL; **`?overlook=1`** keeps the old flat Overlook; the proof readout is
  gated dev-only (`?branch`/`?debug`).
- **Real 3D grade on the branching map (2026-07-24) — director-approved.** The run
  drops for real in world-Y: an elevated summit falling ~224 units to y=0 at the
  flag, a constant **~19° pitch** (`SEGMENT_GRADE` 0.35) keyed to route distance so
  every route drops the same total height ("same clock, same flag" in elevation
  too). Director rode it and called the angle **"invigorating" — locked in, not a
  pending tune.** `slopePath.ts` `segmentCenterline` carries the `y`; the skier,
  camera, hazards, and grayblock (descending floor ramps + tilted walls) all ride
  it; the Overlook stays flat (no placement). **Still grayblock, and the dressed
  snow is still FLAT under it** — tilting the snow surface to the grade is the
  slope-vis half (the urgent next visual piece; see IDEAS.md). Detour *content*
  (animal world, bird, penguin/ice castles) and per-route hazard balancing (§5)
  come after; §7's open reconciliations remain the director's.
- **Real assets:** frosted-green pines, rocks, etc. — painted detail rolled
  across all 24 slope models; decor scatter follows the run. (Old birches removed.)
- **Realism snow:** procedural displaced surface + GPU-carved ski trails.
- **Lighting/haze:** warm sun, palette-exact blue shadows, dawn-pink fog, sun disc.
  Now on a **`timeOfDay` phase** (`skiScene.ts`): 0 = that dawn (a verified no-op),
  1 = night, cycled by the debug key **N**. A first **moonlit night** was built
  (branching-map "sun sets as we race" idea, director 2026-07-24) but the
  look-pass called it **too bright / too evenly lit** → **redirected to an
  *enchanted forest*: extremely dark, a few moonlight rays, lit by glowing
  emissive assets** (plan in IDEAS.md). Landed so far (slope-vis 2026-07-24):
  (1) **darker-night pass** — `NIGHT` constants crushed toward black (open-snow
  floor `#3F4D70`→`#12182B`, sky zenith `#1A2138`→`#0B0F1C`); the moon stays a
  faint down-lane key so the lit lane (`#4E608A`) still reads until the glow
  assets carry lane light. (2) **the glowing-forest first layer** — the glow
  ramp (G1–G4, DESIGN.md) + code-built emissive mushroom clusters with faked
  additive snow pools scattered along both treelines, night-gated (`glowFactor`,
  fades in past dusk). **Director look-passed (2026-07-24):** keep the glowing
  props; **cut the fireflies** (too many colors, glued in front of the skier —
  realistic ones come from a CC0 pack later); and next: **stronger bloom**,
  **darken the snow sparkle at night**, and **make the tree trunks glow**.
  **Session 2 (slope-vis 2026-07-24):** snow sparkle now dims with the phase
  (`sparkleGain`, done — awaiting look-pass); glowing pine trunks first pass
  built then **sent back** — director wants the glow to **fade up the tree**
  (bright base → dark canopy) and to **keep the bark detail visible** (driven by
  a reference photo in a new session). Still to do (verdict-ordered): **trunk-glow
  revision (ref photo)**, bloom (strong), general decor/spray darkening, real
  MegaKit glow props, realistic fireflies, moonlight *rays*, the auto-transition,
  night audio. ⚠ amends the bible's "bright only" rule (DESIGN.md).
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

### Multiplayer — "Play with a friend" (ghost racing), experimental
- **Landed early vs. the plan** (real-time co-op is M7 in DESIGN.md) as a
  lightweight friend-testing layer, at Josh's request. **Client-only** — the sim
  never changes, `/server` stays a stub. Each browser stays authoritative over
  its own skier and just **broadcasts its pose ~12×/sec**; the friend is drawn as
  a **ghost** (reusing the real rig + cat), interpolated. Purely visual: no shared
  simulation, no collisions, no life loss — you can ski through a ghost.
- **Rooms by short code** in the lobby ("Play with a friend" → Create / Join).
  Two transports run at once: **Supabase Realtime broadcast** (a hosted relay, so
  players on *different networks* connect — needs `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY`, see `client/.env.example`) and a **BroadcastChannel**
  mirror (same-machine tabs, zero setup — the local-test path). Without the
  Supabase vars the room still works same-device and says so.
- **(lobby) Friends show in the lobby, not just on the slope** — a connected
  friend's character now stands in the lobby vignette beside you (lined up to
  your camera-left, the cat's side left clear), driven from the same pose
  packets. It hides while they're out on the slope (they're a ghost over there)
  and reappears when they're back in the lobby — mirroring ghost on-slope
  semantics, so one racer is only ever in one place. Managed in
  `lobbyRender.ts` (`createLobbyFriends`), fed by the loop in `main.ts`.
- Files: `client/src/net.ts` (transport/room), `client/src/ghosts.ts` (remote
  skiers on the slope), `client/src/lobbyRender.ts` (friends standing in the
  lobby), friend panel in `lobbyUi.ts`, loop wiring in `main.ts`.
  Verified: typecheck + 139 tests + prod build green; UI flow, the net send +
  receive paths, and ghost spawn all exercised live (the on-slope *visual* of two
  racers is Josh's playtest — and needs the Supabase vars for the cross-network
  case). Fast-follows (name tags, a real synced race, lazy-loading Supabase) in
  IDEAS.md.

### Lobby, UI, systems
- **Menu lobby / title screen** (`lobbyRender.ts` + `lobbyUi.ts`) — a live 3D
  vignette of the character + cat on dawn snow; doubles as character select.
  This **replaced the scrapped walkable bedroom**; there is no walkable home space.
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
- [x] **"The actual map"** (SLOPE_BRANCHING.md — a branching summit-to-flag map
      with detour worlds). Segment/handoff mechanism de-risked, then the **ACTUAL
      §4 map laid out as grayblock (slope-mech, 2026-07-24):** real segments
      (summit → enchanted forest → frozen lake → yeti's peak) and the three
      same-clock routes to the flag (Cave / Ice / Water), replacing the toy
      `spine-1/2/3` topology in `route.ts`. See Ski slope for the shape. **Still
      open:** detour *content* (animal world, bird, penguin castle, ice castle),
      per-route hazard balancing (§5 — the road tenser, detours lower-stakes; the
      wide "signature" cliff), and §7's reconciliations (branching as the template
      for all slopes vs. one branching map; collectibles/achievements vs. XP;
      friend-race = later-phase MP, not v1.0). Art comes after the layout stands.
- [ ] **Play the branching map — first slice: the summit → forest ride (director,
      2026-07-24).** Turn the grayblock map into something you actually *play*,
      starting with the top: drop in at the summit and ride down into the forest,
      dressed for real (this is the run that becomes the game). A coordinated
      cross-session slice — the ride already works mechanically (proven by tests),
      what's missing is a real entry + real visuals:
      - **(slope-mech) — real 3D grade ✅ landed (2026-07-24):** the branching map
        drops for real now ("ride down a REAL mountain", director). `slopePath.ts`'s
        `segmentCenterline` returns a `y` — the corridors descend from an elevated
        summit (~224) to y=0 at the flag, a constant **~19° pitch** (`SEGMENT_GRADE`
        0.35, steepened from 0.18 on the director's ride) keyed to route distance so
        every route falls the same total height (same-clock → same floor); the
        Overlook stays flat (no placement → y=0). The skier, camera, hazards, and
        grayblock (now descending floor ramps + tilted walls) ride the grade, and the
        environment `anchor` carries `anchor.y`. **Snow-follow is the slope-vis half**
        (tilt the surface to the grade — folds into the main lift; see IDEAS.md).
        139 tests. **Angle director-approved at ~19° ("invigorating", 2026-07-24)
        — locked, not a pending tune.**
      - **(slope-mech) — branching map is now the DEFAULT slope ✅ (2026-07-24):**
        director couldn't see the grade because it was hidden behind `?branch=1` and
        the live build's plain URL served the flat Overlook. Promoted: the graded
        branching map is what "Hit the slopes" loads at the plain URL now
        (`main.ts` — `BRANCH_MAP` defaults on; **`?overlook=1`** opts back to the
        flat Overlook); the proof readout is gated dev-only (`?branch`/`?debug`).
        Verified live in the production bundle. **This answers the (lobby) open
        decision below as replace-as-default.** Still grayblock — the flat dressed
        snow now shows under a *default* descending run, so the slope-vis snow-tilt
        (below / IDEAS.md) is the urgent next visual piece.
      - **(slope-vis) — the main lift:** dress the summit + forest corridors. The
        grayblock map renders boxes only (`addBranchGrayblock`, mechanics-owned) and
        `skiScene.ts` draws along the *single* Overlook road, not per-segment — it
        must become **segment-aware**, laying snow/lighting/decor along each
        segment's centerline (`segmentCenterline`/`segmentToWorld` in `slopePath.ts`,
        importable). **The forest segment *is* the enchanted forest** — this is where
        the night → enchanted-forest work lands, and the parked "sun sets *as you
        race*" auto-transition now has its trigger: **the summit→forest descent**
        (sunset up top → dark/enchanted in the forest). See IDEAS.md.
      - **(slope-mech) — real entry ✅ mostly done (2026-07-24):** the branching map
        is now what "Hit the slopes" loads (off the `?branch=1` flag — see the
        default-slope entry above); the debug readout is gated dev-only. The
        grayblock scenery still shows because it's the only ground until the snow
        follows the grade. Remaining: gate the grayblock off once the dressed
        surface is under the run (with slope-vis), and the summit→forest ride is
        gentle (no hazards until the lake) as intended.
      - **(lobby) — how you get there ✅ decided (2026-07-24):** the open
        replace-vs-coexist question is answered **replace-as-default** — the
        branching map is the default slope now (`main.ts`), `?overlook=1` keeps the
        old flat Overlook reachable. A proper slope-select menu (if the Overlook
        earns a permanent spot as onboarding) is a later lobby polish, not required.
- [ ] **Night → the enchanted forest (director redirect 2026-07-24).** First
      moonlit night was too bright; new target is an *extremely dark* forest with
      a few moonlight rays, lit by **glowing emissive assets** (mushrooms/crystals/
      fireflies). **Done so far (slope-vis 2026-07-24):** (1) the darker-night pass
      — `NIGHT` ambient/sky crushed toward near-black, faint moon key kept for lane
      readability; (2) the **glow ramp signed off** (G1–G4, DESIGN.md) and the
      **glowing-forest first layer** — code-built emissive mushroom clusters +
      additive snow pools, night-gated (MegaKit sourcing call made, CC0).
      **Director look-pass verdict (2026-07-24):** keep the props; **fireflies cut**
      (rainbow + glued to the skier — realistic ones from a CC0 pack later);
      **bloom must be stronger**, **snow sparkle too bright at night**, **tree
      trunks need to glow**. **Session 2 (slope-vis 2026-07-24):** (3) **snow
      sparkle now dims with the night phase** (`sparkleGain` uniform → `NIGHT_SPARKLE_GAIN`
      floor) — done, awaiting look-pass; (4) **glowing pine trunks — first pass
      built then SENT BACK:** the emissive lit the whole trunk evenly; director
      wants it to **fade out up the tree** (bright base → dark canopy) and to
      **keep the painted bark detail visible** under the glow. Josh is opening a
      new session with a **reference photo** to drive the trunk-glow revision —
      that's the next chunk. Still open, verdict-ordered: **trunk-glow revision
      (ref photo)**, **bloom (strong)**, general decor/spray darkening, **real
      MegaKit glow props**, **realistic fireflies (CC0)**, **moonlight rays**, a
      designed dusk midpoint, night audio/lobby. **The auto-transition trigger is answered** (director,
      2026-07-24): the enchanted forest *is* the branching map's forest segment, so
      the sunset→dark transition rides the **summit→forest descent** — folds into
      the "play the summit → forest ride" slice above.
      Full plan in IDEAS.md (slope-vis).
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
