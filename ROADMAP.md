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
  the curved centerlines + varying grade. **DRESSED (mountain-graphics, 2026-07-25):**
  it now wears the realism snow material (world-pinned dune/lump relief, palette
  lit/shadow shading, sparkle — `createTerrainSnowMaterial`), so the open run reads as
  sculpted powder instead of the old plain-shaded pink wash. The pretty snow *window*
  is still welded to y=0 and so is invisible during the descent (it lives ~290u below
  the elevated run) — the terrain dressing is what the skier now sees; the window still
  owns near-skier ski-trail carving, which therefore does not show on the branch run
  (parked in IDEAS). Fork spots marked by boulders, not
  gray boxes. 153 tests (incl. a behavioral proof all three routes + the tree no-op
  reach the flag on the same clock, plus the arcs' length/continuity).
  **It is the DEFAULT slope** — "Hit the slopes" loads it at the live URL;
  **`?overlook=1`** keeps the old flat Overlook; the proof readout is gated dev-only
  (`?branch`/`?debug`). **NO FINISH LINE yet (director, 2026-07-24):** a terminal
  segment's end opens into a flat runout — you coast off the mountain rather than
  winning + auto-returning to the lobby (leave by forfeiting). The Overlook still
  finishes at 800.
  **⚠ REDIRECT (director look-pass, 2026-07-24 — slope-mech):** the branching is PARKED
  for the played path. Target: **one solid mountain, a SINGLE smooth trail summit →
  forest, no switching to other areas.**
  **✅ SMOOTH SINGLE TRAIL LANDED (slope-mech, 2026-07-24):** the played run rides ONE
  continuous-curvature centerline summit → the back of the forest — `TRAIL_LINE` in
  `slopePath.ts` (a gentle S, heading a full sine period, so curvature never jumps at a
  seam and both heading + lateral return to ~0 at the forest: no kink, no drift). Forks
  are parked behind a new `SkiState.singleTrail` flag (`createSingleTrailSkiState` is what
  "Hit the slopes" loads); `stepSkiing` walks `route.ts`'s `SINGLE_TRAIL` (summit →
  forest-road) and never arms a trigger. The trail ends at the back of the forest into the
  flat runout (`singleTrailNext` → null). `addBranchTerrain` builds only the two trail
  segments + runout. The §4 branching graph stays in `route.ts`, still proven by the
  same-clock tests (they use the unflagged `createBranchingSkiState`). 159 tests.
  **Both forest bugs fixed:** speed-drop (earlier) and drift-right (subsumed by the trail).
  **Remaining piece (next chunk, Josh split it off):** merge the two per-segment
  placeholder meshes into ONE seamless dressed surface — coordinate with slope-vis.
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
  stays a hard no-op. **Forest speed, round 2 (slope-mech, 2026-07-25 — director "my
  speed still feels extremely slow through the forest"):** the forest/lake plateau in
  `GRADE_PROFILE` jumped 0.33→0.42 (from *below* the 0.35 reference to above it), so the
  forest stops being a mellow-slow zone and becomes a fast glide that carries momentum
  through the trees — cruise ~11.3→14.4 u/s (+27%), ~84% of the summit instead of 66%;
  hold-W ~21.6. Steeps (0.5) stay clearly above it so "steeper = faster" still reads.
  Side effect for slope-vis: the mountain is ~19% taller (total drop ~282 vs ~238) — a
  genuinely steeper forest, rendered from `routeHeightAt`. Detour *content* (animal world, bird, penguin/ice castles) and
  per-route hazard balancing (§5) come after; §7's open reconciliations remain the
  director's.
- **Real assets:** frosted-green pines, rocks, etc. — painted detail rolled
  across all 24 slope models; decor scatter follows the run. (Old birches removed.)
- **Realism snow:** procedural displaced surface + GPU-carved ski trails. Plus
  **coarse dune form-shading** (mountain, 2026-07-25): the big wind-dunes get a
  self-cast blue (#2) shade on their sun-away faces so their form reads on open,
  shadowless ground — the summit, which has no trees to rake the shadows the
  forest snow reads by. In-palette, mood-untouched.
- **Starting-mountain backdrop** (mountain, 2026-07-25): the empty summit horizon
  now carries a **distant snowy peak vista** — `createMountainBackdrop`
  (`mountainGraphics.ts`), a 360° procedural mountain ring parented to the sky
  dome so it recenters on the camera like a skybox layer (always on the horizon,
  never reached, inside the 200u far plane). Real graded heightfield (foothills →
  peaks), coloured **unlit + baked** — snow shaded cool-blue-shadow↔warm-white-lit
  (the palette's two snow values), slate rock on the summits, vertical dawn-pink
  aerial haze; an azimuth envelope keeps it tall toward the downhill-front and low
  at the sides so the ring's near walls don't loom in the wide FOV. Verified live
  at the summit + through the forest. **KNOWN LIMIT:** the follow-camera looks ~18°
  DOWN the fall line, so the sky band above the horizon is only ~7° — the range
  reads as a horizon ridge, not the towering reference peak. Making it dramatic is
  entangled with the summit **brightness/sky decision Josh deferred** (see IDEAS).
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
  **Session 2 (slope-vis 2026-07-24):** snow sparkle dims with the phase
  (`sparkleGain`). **Snow sparkle FIXED (forest-graphics 2026-07-25):** the
  "still too bright" note had a root cause, not a tuning miss — `setSnowNightFade`
  updated a `sparkleGain` holder captured *inside* `onBeforeCompile`, which
  three.js rebuilds on every recompile, so the fade was writing a dead uniform
  and the twinkle ran at full DAY gain all night. Now a persistent module-scope
  `snowSparkleUniform` is shared across every compile, so the fade lands; floor
  dropped `0.12`→`0.045` and the sparkle roughness-map flecks also fade toward
  matte at night (`roughnessFactor = mix(1.0, roughnessFactor, sparkleGain)`) so
  the moon key stops blazing them. Result: calm matte moonlit snow with a faint
  glint, verified in the live forest. (mountain-graphics' `mountainGraphics.ts`,
  touched cross-territory for this look-pass — small + flagged.) **Self-glowing tree trunks: tried
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
  bypassed, daylight untouched). **Bloom + plant brightness re-tuned (forest-graphics 2026-07-25,
  director "the bloom increase just brightened the mushrooms"):** pushing
  `BLOOM_STRENGTH` 2.2 + `GLOW_EMISSIVE` 3.5 didn't grow the halo, it piled
  brightness back onto the mushroom bodies. Reverted the source over-drive
  (`GLOW_EMISSIVE` 3.5→2.0 = dimmer caps, `BLOOM_STRENGTH` 2.2→1.5) and grew the
  halo the right way instead — `BLOOM_RADIUS` 0.7→0.9, `BLOOM_THRESHOLD`
  0.55→0.42 — so the dimmer caps still bloom into a soft glow. Verified: soft
  glowing mushrooms with a real halo, not bright dots. **Fog blend fixed
  (forest-graphics 2026-07-25, "the fog doesn't blend, there's a line at the
  bottom"):** night `NIGHT.skyHorizon`/`skyZenith` were dark enough that the
  partly-fogged bright snow band hit a near-black sky in a value cliff = a hard
  horizon line. Lifted both (`#1E2740`→`#293651`, `#0B0F1C`→`#121829`, night-only;
  fog rides the horizon color) so the ground melts into a continuous horizon glow
  — real aerial-perspective fog, verified open + in-forest. **Moonlight rays
  re-tuned (forest-graphics 2026-07-25, "too strong / spotlight / straight down /
  randomly dropped in"):** `RayField` beams were near-vertical + bright with a
  crisp ground pool = a spotlight read. Now angled (`RAY_DIR` ~31°→~42° off plumb,
  raking down-lane from the moon), thinner, ~half opacity with the ground pool cut
  hardest (the biggest spotlight tell), fewer (`RAY_DENSITY` 0.7→0.45) and mostly
  at the treeline not over the lane (`RAY_CENTRAL_CHANCE` 0.32→0.12). Verified: a
  few soft angled shafts breaking through the canopy, no spotlights. Knobs:
  `RAY_ONSET`, `RAY_CELL`/`RAY_DENSITY`, `RAY_CENTRAL_CHANCE`, `RAY_COLOR`, `RAY_DIR`.
  **Glow now CASTS light on the trees (forest-graphics 2026-07-25, "the bloom
  should glow on the trees"):** the mushroom clusters were pure emissive + a
  *faked* additive snow disc, casting zero real light, so a trunk beside a
  glowing cap stayed dead black. Each cluster now carries a real hue-matched
  `PointLight` (`GLOW_LIGHT_INTENSITY`/`GLOW_LIGHT_RANGE` in `forestGraphics.ts`,
  no shadows, intensity rides `glowLightFactor` = the eased night factor) so the
  glow spills onto the nearest trunks + ground and that lit bark clears the bloom
  threshold — the bloom haloes the tree where the glow touches it. Deliberately
  NOT the self-emissive trunk rejected 2026-07-24: real light = a hotspot that
  falls off ("cast on"), and trees away from any cluster stay dark silhouettes.
  Verified live at night: amber/green/violet pools light the adjacent trunks,
  distant trees still dark. Knobs: `GLOW_LIGHT_INTENSITY`, `GLOW_LIGHT_RANGE`.
  **Ground-mist distance fade (forest-graphics 2026-07-25, "fog should float like
  real fog, not a sharp line where it stops"):** the additive `MistField` banks
  held constant opacity out to `DECOR_AHEAD` (170m) — past the fog's far=150m —
  then stopped dead; perspective crushes those far cells into a thin horizon strip
  and additive blending sums them into a bright WALL with a hard top edge that ends
  abruptly. Added a forward-distance falloff (`MIST_FADE_START` 50m full →
  `MIST_FADE_END` 130m gone, smoothstep) in `updateMistField` (`forestGraphics.ts`)
  so the mist thins into the distance and dissolves; near/mid haze stays full.
  Removed the mist wall — verified in-forest at night with bloom quieted.
  **⚠ FOG STILL NOT RESOLVED — sharp lines remain (Josh, 2026-07-25, with
  screenshot).** The mist fade fixed ONE contributor; a SECOND, different artifact
  remains: discrete **horizontal steps/terraces across the fogged night snow** in
  the mid-ground (center/center-right of the night-forest view), where brightness
  jumps in stripes instead of grading smoothly. This is NOT the mist — likely the
  fog/lighting gradient **posterizing** on the low-contrast night snow (8-bit
  banding), or the snow's own distance-fog / height stepping, or terrain LOD seams.
  **A fresh session must DIAGNOSE this properly first — do not assume it's the mist
  again** (the prior pass over-anchored on the mist and declared victory under
  flattering conditions: bloom off + an open-lane camera). Repro: slope, debug key
  **N** cycles to full night; the `UnrealBloomPass` blows out the bright
  clearing/snow-caps, so drop `BLOOM_STRENGTH` to read the horizon, then zoom the
  stepped region. Likely fix once identified: dither the fog output, smooth the snow
  distance-fog, or match the snow's fog color/curve to `scene.fog`.
  Still to do (verdict-ordered): general decor/spray darkening, real MegaKit glow
  props, realistic fireflies, the auto-transition, night audio. ⚠ amends the bible's
  "bright only" rule (DESIGN.md).
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
  The vignette's background trees are the MegaKit `StylizedPine` models, matching
  the slope (lobby, 2026-07-25 — swapped off the old Ultimate Nature Pack
  birches/amber-pines; those 13 tree GLBs + their CREDITS rows were deleted, the
  pack's rocks/bushes/stump/log stay).
- **HUD** (`client/src/hud.ts`): nine cat-face lives with a **"N lives left!"**
  caption, crash/forfeit banners. **Losing a life plays out** (lobby, 2026-07-24):
  the spent cat takes a red X, shakes, and tumbles off the row, leaving a faint
  ghost of where it was so the count reads at a glance. The old one-line hint bar
  became a **ghost keyboard** — at the start of a run the control keys flash on a
  translucent keyboard with a legend beside it, then after 5s it fades to a small
  strip of just the key images + what they do. Keys shown follow the player's
  actual bindings.
- **Settings menu** (`client/src/settings.ts` + `settingsMenu.ts`, lobby
  2026-07-24): a modal from the lobby with a master-volume slider, a music
  on/off toggle, and **rebindable controls** (click a key, press the new one;
  swaps to avoid duplicates). Stored under its own `toebeans-settings`
  localStorage key — client preferences, kept out of the versioned game save.
  Input in `main.ts` reads bindings from it live.
- **Save/load:** browser storage, `SAVE_VERSION 5`. Snapshots dynamic state only;
  static layout reloads from `createInitial*`; strict + self-healing decode.

### Tooling / assets
- `tools/obj2glb_palette.py`, `tools/glb_palette.py`, `tools/gltf_character.py`
  (palette-recolor OBJ/GLB → bible palette). Every asset licensed in
  [assets/CREDITS.md](assets/CREDITS.md). Furniture models sit in `assets/bedroom/`
  as the future unlock pool (currently unused in-game).
- **Slope scenery lives in three files** (split from `skiScene.ts`, 2026-07-25):
  `skiScene.ts` = shared core (palette, snow-light solve, day/night engine,
  `createEnvironment`/`syncEnvironment`/`renderSlope`); `mountainGraphics.ts` =
  ground + sky + snow shader/FX + hazard/checkpoint meshes (mountain-graphics);
  `forestGraphics.ts` = decor scatter + glow props + mist + painted detail
  (forest-graphics). See [PARALLEL.md](PARALLEL.md) for ownership.

---

## Open — still to resolve

### M2 remaining
- [ ] **Night fog still shows sharp horizontal banding (Josh, 2026-07-25, screenshot).**
      The additive-mist wall was fixed (distance fade), but discrete horizontal
      steps/terraces remain across the fogged night snow in the mid-ground — a
      *different* artifact (likely fog-gradient posterization on low-contrast night
      snow, snow distance-fog stepping, or terrain LOD). DIAGNOSE before fixing; do
      not re-assume the mist. Full context + repro under Ski slope → night look.
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
      - **(slope-mech) — trail extended past the forest into the FROZEN LAKE ✅
        (2026-07-25, "extend past the forest," Josh):** the single played trail is
        now summit → forest → the frozen lake (`SINGLE_TRAIL` += `lake`); it ends at
        the back of the lake, coasting into the runout (still no finish line). This
        brings the trail's **first hazard**: the lake's `lake-gap` chasm + its
        checkpoint now ride the played run (design §4 — "all three routes learn the
        jump here"), so the summit→forest ride stays gentle and the lake is where
        you first jump. The lake's own fork (into `water`) stays parked with the
        other forks. Presentation: `TRAIL_LINE` (slopePath.ts) refactored to
        per-area **lobes** — each a full-sine S that returns to the fall line at the
        area's end (no drift, generalized), with a gentle lake lobe tuned for a
        near-zero seam-curvature step; the terrain builder + chasm/checkpoint
        rendering follow `SINGLE_TRAIL` automatically. **Look-pass knobs (Josh, live
        build):** each lobe's `amplitude` in `TRAIL_LOBES`; the grade through the
        lake (`GRADE_PROFILE` in route.ts). 159 tests. **Next area = append one lobe
        + one `SINGLE_TRAIL` id.**
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
      — deliberately the **last** M2 item. *Partial (lobby, 2026-07-24):* the
      settings menu now has a **music on/off toggle** backed by a deliberately
      minimal ambient bed in `audio.ts` (a pad + a slow pentatonic bell), default
      **off**. It's a placeholder so the toggle means something — the real
      per-slope direction is still (slope-vis)'s to pick; see IDEAS.md.
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
