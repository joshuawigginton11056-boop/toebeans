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
- **Branching map (the "actual map") — the real §4 layout is in, on real terrain.**
  Per SLOPE_BRANCHING.md (director's direction: one continuous descent that grabs
  you into detour worlds, all obeying **"same clock, same flag"**), a sim-side
  **segment graph** (`shared/src/route.ts`) chains the real map: **summit →
  enchanted forest (Type A: road/tree) → frozen lake (Type A: around/into-water) →
  yeti's peak (Type B: cave/ledge)**, resolving to the three §4 routes —
  **Cave** (…yeti·cave·cliff), **Ice** (…yeti·ledge·valley·ice-castle), **Water**
  (…lake·water·cliff) — each **640** units by construction, with the Cave/Water
  reconvergence (`cliff`) landing at the identical route-offset (540) whichever
  way it's reached. The renderer places each segment in its own world corridor
  (`SEGMENT_PLACEMENTS`, data-driven off the registry); `roadSegmentIds()` is the
  single source of truth for spine-vs-detour. **The corridors CURVE:** each segment
  is a constant-curvature arc (`SEGMENT_SHAPES` in `slopePath.ts`), the spine
  weaving a gentle S down the middle and the detours peeling off to their sides —
  chained smoothly on continuous runs (no kink), cut at fork handoffs.
  **REAL TERRAIN now, no longer grayblock boxes (slope-mech, 2026-07-24 — "create
  the real mountain," director):** `addBranchTerrain` (skiRender.ts) builds a
  continuous mountain SURFACE per segment — a smooth playable lane flush with the
  sim's ground, flanked by snowbanks that rise into rolling mountainside — following
  the curved centerlines + varying grade. Plain-shaded placeholder (slope-vis owns
  the dressed look and re-skins/replaces it). Fork spots marked by boulders, not
  gray boxes. 153 tests (incl. a behavioral proof all three routes + the tree no-op
  reach the flag on the same clock, plus the arcs' length/continuity).
  **It is the DEFAULT slope** — "Hit the slopes" loads it at the live URL;
  **`?overlook=1`** keeps the old flat Overlook; the proof readout is gated dev-only
  (`?branch`/`?debug`). **NO FINISH LINE yet (director, 2026-07-24):** a terminal
  segment's end opens into a flat runout — you coast off the mountain rather than
  winning + auto-returning to the lobby (leave by forfeiting). The Overlook still
  finishes at 800.
  **⚠ REDIRECT (director look-pass, 2026-07-24 — NEXT, slope-mech):** the branching
  is being PARKED for the played path. The per-segment constant-curvature arcs kink at
  their seams (curvature sign flips) — "jerky" — and the forks aren't wanted yet.
  Target: **one solid mountain, a SINGLE smooth trail summit → forest, no switching to
  other areas.** Two forest bugs to fix with it (speed instantly drops; character drifts
  right). Full spec in the START HERE banner atop IDEAS.md. The branching graph stays in
  `route.ts` (tested), just isn't the active run.
  **(slope-mech) speed-drop bug FIXED (2026-07-24):** the summit→forest grade shed no
  longer slams in at the forest mouth. `GRADE_PROFILE` (route.ts) was reshaped into an
  **ease-out** — the grade drops steeply high on the summit (`[60, 0.36]`, where bleeding
  the plunge's speed is natural) then LEVELS onto a gentle leg (`[180, 0.28]`) that carries
  THROUGH the forest entrance (route 120), so at the forest the decel is a fraction of the
  COAST_DRAG cap instead of pinned to it. Verified by a numeric trace through the real
  sim: worst decel in the forest window (route 90–150) dropped to **0.27 u/s² cruise /
  1.07 u/s² boosted** (cap is 4.0); the hard shed now lives up high, not at the forest.
  New route.test.ts test pins the ease-out (no grade "wall" at the mouth). Trail-scope
  call from Josh: the single trail will **end at the back of the forest** (forest = the
  bottom, for gauging its size). Still TODO for this redirect: the smooth single trail
  itself (item 1) + the drift-right (item 3, subsumed by item 1).
- **Real 3D grade on the branching map (2026-07-24) — director-approved, now VARYING.**
  The run drops for real in world-Y: an elevated summit falling ~216 units to y=0 at
  the flag. The pitch is **no longer one constant — it varies down the route** (a
  steep ~27° summit plunge, a mellow ~15° forest/lake, a steep lower pitch into the
  flag), a shared height/grade profile in `shared/src/route.ts` (`routeGradeAt` /
  `routeHeightAt`) keyed to route distance so every route still drops the same total
  ("same clock, same flag" in elevation). The reference ~19° is the director's
  locked-"invigorating" baseline. `slopePath.ts` embeds the profile (world-Y +
  per-point `segmentPitch(id, distance)`); the skier, camera, hazards, and the real
  terrain surface all ride it; the Overlook stays flat (no placement). **The corridors
  also curve (see the branching-map bullet).** The playable lane of the real terrain
  now sits + tilts to the grade; the slope-vis half is to DRESS that surface (snow
  material/displacement/decor/trails), following the VARYING per-point pitch — see
  IDEAS.md.
- **Steepness → speed (2026-07-24, director "the steeper the area, the faster the
  skiing").** The sim (`shared/src/skiing.ts`) reads the local grade and scales the
  target cruise (and boost) by it — `gradeSpeedFactor` in route.ts, 1.0 (a no-op) at
  the reference ~19° and on the flat Overlook, so the Overlook's locked feel is
  untouched and only the graded map gains terrain-driven pace: steep pitches
  genuinely fast, mellow flats slower, capped at `GRADE_TOP_SPEED`. **Turned UP
  (slope-mech, 2026-07-24 — director "increase speed on slopes"):** a
  `SLOPE_SPEED_GAIN` (1.5) amplifies the coupling so the whole graded mountain skis
  faster — steeps really move, even the mellow forest out-paces the flat baseline;
  `GRADE_TOP_SPEED` raised 22→28. Both are live-build LOOK-PASS knobs; the Overlook
  stays a hard no-op. Detour *content* (animal world, bird, penguin/ice castles) and
  per-route hazard balancing (§5) come after; §7's open reconciliations remain the
  director's.
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
  (`sparkleGain`, done — awaiting look-pass). **Self-glowing tree trunks: tried
  twice, REJECTED and REMOVED** (director, 2026-07-24 — "tacky; I don't want the
  trees to glow themselves"): flat wash, then a base-bright bark-textured
  gradient, both cut. New direction from the reference photos: **trees are dark
  silhouettes; the glow lives in the environment** (ground props, mist/haze, a
  light shaft/rays, motes) — a fresh session rebuilds night from the photos.
  **Environmental night look, started (slope-vis 2026-07-24):** **enchanted
  ground mist** — soft additive cool-blue haze banks (`MistField` in
  `skiScene.ts`) drift along both treelines (faint wisps across the lane so
  hazards stay readable), night-gated (`mistFactor`, rolls in at dusk just
  ahead of the glow). Additive, so it lifts the near-black floor into glow-haze
  without darkening the crushed ambient. **Director-approved (2026-07-24, "looks
  great").** **Bloom BUILT (slope-vis 2026-07-24, awaiting look-pass):** a
  full-scene `UnrealBloomPass` (EffectComposer in `skiScene.ts`, drawn via
  `renderSlope`) night-gated on `glowFactor` — strength 0 by day (composer
  bypassed, daylight untouched), pushed strong (1.5) at full night. The night
  scene is crushed near-black so only the emissive glow caps clear the luminance
  threshold (0.55) — the full-scene bloom is naturally selective to the glowing
  plants; mist/pools sit below it and don't smear. Still to do (verdict-ordered):
  the **light shaft / moonlight rays** (the other half of the env look), general
  decor/spray darkening, real MegaKit glow props, realistic fireflies, the
  auto-transition, night audio. ⚠ amends the bible's "bright only" rule
  (DESIGN.md).
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
      2026-07-24).** Turn the map into something you actually *play*, starting with the
      top: drop in at the summit and ride down into the forest, dressed for real (this
      is the run that becomes the game). A coordinated cross-session slice — the ride
      works mechanically (proven by tests), what's missing is a smooth single trail +
      real visuals.
      **⚠ REDIRECT (director look-pass, 2026-07-24): NO branching for this slice — one
      solid mountain, a single SMOOTH trail summit → forest (the per-segment arcs kink;
      forks not wanted yet), + fix two forest bugs (instant speed drop, drift right).
      Full spec: START HERE banner atop IDEAS.md (slope-mech, next chat).**
      - **(slope-mech) — real 3D grade + curves + steepness→speed ✅ landed
        (2026-07-24):** the branching map drops for real ("ride down a REAL mountain",
        director). `slopePath.ts`'s `segmentCenterline` returns a `y`; the corridors
        descend from an elevated summit (~216) to y=0 at the flag AND **curve** (each
        a constant-curvature arc, `SEGMENT_SHAPES` — the spine an S, detours peeling
        off). The pitch now **VARIES** down the route (steep ~27° summit, mellow ~15°
        forest/lake, steep lower — `routeHeightAt`/`routeGradeAt` in
        `shared/src/route.ts`, keyed to route distance so every route falls the same
        total: same-clock → same floor). The sim couples cruise/boost to it
        (**steepness → speed**, `gradeSpeedFactor`; a no-op at the reference ~19° and
        on the flat Overlook). The skier, camera, hazards, and grayblock (descending,
        curving, per-point-pitched ramps) ride it; the `anchor` carries `anchor.y`.
        153 tests. Reference ~19° stays the director-locked "invigorating" baseline.
      - **(slope-vis) — DRESS THE REAL MOUNTAIN (the geometry now exists).** The
        grayblock ramp is GONE: (slope-mech) built a real terrain surface
        (`addBranchTerrain`, skiRender.ts — smooth playable lane + rising snowbank
        flanks, following the curved centerlines + varying grade). It's a
        PLAIN-SHADED placeholder. slope-vis's job is now to DRESS it — snow
        material/displacement, decor, ski-trail carving — re-skinning or replacing
        that mesh, using the same `segmentCenterline`/`segmentToWorld`/`segmentPitch`
        exports. (No more "make the flat snow plane segment-aware and tilt it"; the
        ground already sits + tilts to the grade.) See the START HERE banner in
        IDEAS.md.
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
      floor) — done, awaiting look-pass; (4) glowing pine trunks — first pass
      (flat wash) built then sent back. **Session 3 (slope-vis 2026-07-24) —
      trunk glow REVERSED, then REMOVED.** A base-bright vertical gradient
      textured by the bark was built to the "fade up the tree / keep bark
      visible" note, but the director rejected the whole idea on sight: *"the tree
      glow looks tacky; I don't want the trees to glow themselves."* Reading the
      reference photos again, the trees are **dark silhouettes** and the glow
      belongs to the **environment around them** (ground mushrooms, mist/haze, a
      light shaft/rays, floating motes) — not the wood. **All self-glowing-trunk
      code was removed from `skiScene.ts`** (`npm run check` green, 153 tests).
      The night look restarts in a **fresh session with the reference photos**;
      the trunk-glow direction is dead. **Environmental night look — started
      (slope-vis 2026-07-24, from the photos):** enchanted **ground mist** —
      soft additive cool-blue haze banks (`MistField`) drifting along the
      treelines, faint wisps across the lane, night-gated (`mistFactor`, rolls
      in at dusk ahead of the glow); additive so it never darkens the crushed
      floor. **Director-approved (2026-07-24, "looks great").** **Bloom BUILT
      (slope-vis 2026-07-24, awaiting look-pass):** full-scene `UnrealBloomPass`
      (EffectComposer, drawn via `renderSlope`; a small render-seam add in
      `skiRender.ts`), night-gated on `glowFactor` — strength 0 by day so the
      composer is bypassed and daylight is byte-identical, pushed strong (1.5) at
      full night. Because night is crushed near-black, only the emissive glow
      caps clear the luminance threshold (0.55), so the whole-frame bloom is
      *naturally* selective to the glowing plants — no per-object bloom layer;
      the darker mist/pools stay under threshold and don't smear. Still open,
      verdict-ordered: the **light shaft / moonlight rays** (env look, other
      half), general decor/spray darkening, **real MegaKit
      glow props**, **realistic fireflies (CC0)**, a designed dusk midpoint,
      night audio/lobby. **The auto-transition trigger is answered** (director,
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
