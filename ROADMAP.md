# Roadmap

## 2026-07-19 — Project scaffold

Set up the project from scratch: TypeScript (strict) + Three.js + Vite for
the client, npm workspaces for `client`/`server`/`shared`, Vitest for tests.

- `/shared` holds a serializable `GameState` (a list of cats with
  position/velocity) and pure functions (`step`, `setCatVelocity`) that
  return new state instead of mutating.
- `/client` renders that state with Three.js (`render.ts`) — reads state,
  never writes to it. Currently shows one placeholder cat (an orange box)
  drifting across a floor, just to prove the pipeline works.
- `/server` is a minimal stub that imports `/shared` — nothing real yet.
- `npm run check` (typecheck + Vitest) passes; `npm run build` succeeds.
- Fixed a real bug found while testing: the renderer read the container's
  size before layout had settled, producing a 0×0 canvas. Now sizes off
  `window.innerWidth/innerHeight` instead.

**Next:** first actual feature — replace the placeholder box with something
that reflects real gameplay (see [DESIGN.md](DESIGN.md) once that exists,
or [IDEAS.md](IDEAS.md) for candidates).

## 2026-07-20 — GitHub remote, design doc scribing

Created a private GitHub repo
([joshuawigginton11056-boop/toebeans](https://github.com/joshuawigginton11056-boop/toebeans))
and pushed the existing history to it. Going forward, every commit gets
pushed too.

Josh wrote and uploaded `TOEBEANS_VISION.md` — the director's full game
vision (core fantasy, ski loop, leveling/unlocks, environment XP, later-phase
multiplayer, look & feel). [DESIGN.md](DESIGN.md) was written from it as the
working design doc; the vision file stays the source of truth if the two
ever disagree.

The vision doc doesn't answer everything from the original design interview.
Three questions were still open; all three are now answered and folded into
[DESIGN.md](DESIGN.md):

1. Cozy = comfort and relaxation — a second home away from real-world stress,
   where players want to live with their cat and go on ski adventures.
2. Progression is open-ended (no fixed endgame), with slowing level-up rates
   and new environments/customization to stay interesting. Earliest version
   also supports manually adding friends to view their cat and environment,
   ahead of full multiplayer.
3. Differentiator from Stardew Valley / Animal Crossing is graphics and
   gameplay — visual target is *Omno*.

Director call: friend/cat/environment viewing deferred to M6; v1.0 is
strictly single-player.

Followed up the same day with the v1.0/v1.x/Steam scope split (Step 1.3):
proposed a feature-by-feature cost breakdown in build-time (sessions), the
director approved the recommended cut as-is, and it's now written into
[DESIGN.md](DESIGN.md#scope-v10--v1x--steam) — v1.0 is one environment
(bedroom), 6–8 furniture/appliance items, and 3 handcrafted slopes, enough
to run the full ski → XP → unlock → decorate loop end to end.

**Next:** start M1 (see milestone checklist below) — pick the first
prototype feature to build (see [IDEAS.md](IDEAS.md) for candidates).

## 2026-07-20 — M1: gray-box ski slope

Merged the scope-split branch to master directly (no PR), then built the
first M1 checklist item: a playable gray-box ski slope — placeholder box
shapes only, no art.

- `/shared` gets a new `skiing.ts`: a pure `stepSkiing(state, input, dt)`
  function plus `createInitialSkiState()`. The skier auto-skis downhill;
  `left`/`right` steer, `up`/`down` lean to speed up or brake, `jump` arcs
  over gaps, `boost` gives a temporary speed burst. One hazard type this
  session — **chasms** — 3 of them, placed at increasing distances down
  the slope. Landing inside a chasm without enough height ends the run
  (it just freezes for now — checkpoints/lives are the *next* M1 item, not
  this one). 8 new tests cover steering, boosting, jumping, and both
  crashing into and clearing a chasm.
- `crouch` is in the design but has no hazard to react to yet (that's tree
  limbs, not built this session) — left out entirely rather than wiring a
  control that does nothing, per the "no half-finished implementations"
  rule in CLAUDE.md. It'll get built alongside tree limbs.
- `/client` gets `skiRender.ts`: an isometric-ish three-quarter camera that
  follows the skier down the slope, plus placeholder box meshes (blue
  skier, small orange box for the cat riding along). Replaced the old
  scaffold demo in `main.ts` (the drifting-cat box that was only ever
  there to prove the rendering pipeline worked) with real keyboard input
  driving the ski loop: arrows/WASD to steer and lean, Space to jump,
  Shift to boost.
- Deleted `client/src/render.ts` — it was the old scaffold's renderer and
  nothing imports it anymore. The generic `Cat`/`GameState` types it used
  are untouched in `/shared` for whenever the bedroom gray-box gets built.
- `npm run check` passes (12 tests); verified in an actual browser (not
  just tests) — skiing with no input crashes into the first chasm right
  at distance 20 as designed, and holding jump while steering clears it
  with no crash.

**What to playtest:** run `npm run dev`, open the page, and just try
skiing. Arrow keys or WASD to steer/lean, Space to jump, Shift to boost —
there's no title screen or instructions yet, so use those controls
straight away. There are 3 gaps in the snow to jump over as you go. Things
to pay attention to: does steering feel responsive or sluggish, is the
jump timing for the gaps fair or cheap, does the auto-forward speed feel
right, and does holding boost feel meaningfully different. This is the
first half of the "fun check" gate — the second half (the cat's 9 lives
and crash/checkpoint loop) is next, and *then* comes the actual fun-check
verdict once both pieces are in.

**Next:** the "Cat's 9 lives + crash/checkpoint loop" M1 item — turn a
crash from "the run just stops" into a real checkpoint respawn with a
life counter, so repeated crashes have a defined cost.

## 2026-07-20 — M1: cat's 9 lives + crash/checkpoint loop

Crashing is no longer a dead end. Falling into a chasm now costs one of the
cat's 9 lives, pauses for 1.5 seconds (the skier visibly tips over
sideways), and respawns you at the last checkpoint you passed. Lose all 9
lives and the run is forfeited — a real end state, shown on screen. Per
DESIGN.md, a forfeit will eventually pay half XP; XP itself doesn't exist
yet.

- `/shared` `skiing.ts`: the old `crashed` true/false flag became a
  three-way run status — `skiing`, `crashed` (the brief pause), or
  `forfeited` — plus a lives counter, a respawn timer, and checkpoints.
  There's a checkpoint just past each chasm, so a crash only ever replays
  the one hazard that got you, never the whole slope. 9 new/updated tests
  (17 total) cover losing a life, the pause ignoring input, respawning at
  the right checkpoint, retrying the same chasm, forfeiting on the last
  life, and the forfeited state being final.
- `/client`: green stripe markers on the snow show where checkpoints are;
  the skier rotates onto their side during the crash pause; a new HUD
  overlay (plain text in the corner) shows "🐱 × lives" and the
  crash/forfeit messages.
- Noticed while building: the slope has no finish line, so "a completed
  run" isn't a real thing yet — parked in [IDEAS.md](IDEAS.md) rather than
  built, since XP needs it and XP is a later session.
- `npm run check` passes (17 tests). Browser verification hit a snag: the
  preview pane stayed hidden this session, which freezes the game's
  animation loop (browsers pause hidden tabs), so instead the real game
  modules were loaded in the live page and stepped manually — full loop
  confirmed: 9 crashes at the first chasm burn all 9 lives and end in
  forfeit at ~36s; clearing chasm 1 then crashing into chasm 2 respawns at
  checkpoint 26, not the start. The HUD text itself is the one bit only
  eyeballs have not confirmed — worth a glance when playtesting.

**What to playtest:** same as before (`npm run dev`, arrows/WASD, Space to
jump, Shift to boost) — but now crash on purpose. Does the 1.5s crash pause
feel right or annoying? Does respawning just past the previous gap feel
fair? Is 9 lives too generous for a 3-gap slope? Check the corner counter
counts down and the forfeit message appears when lives hit zero.

**Next:** the M1 fun check — both halves of the gate (slope + lives loop)
are now in, so the next session should be a playtest-and-verdict session:
does the ski loop feel good enough to invest in art? Feel fixes (tuning
speeds, jump arc, pause length) belong in that session too.

## 2026-07-20 — M1: gray-box bedroom walk

The character can now walk around a gray-box bedroom — the "home" half of
the core loop's stage. The game starts in the bedroom, and Enter switches
between the bedroom and the ski slope (each trip to the slope is a fresh
run with full lives, which doubles as the retry button after a forfeit).

- `/shared` gets `bedroom.ts`: a pure `stepBedroom(state, input, dt)` plus
  `createInitialBedroomState()`. Arrow/WASD walking on a flat floor,
  normalized so diagonals aren't faster, clamped at the walls, and blocked
  by three placeholder furniture pieces (bed, dresser, desk) with
  slide-along-the-edge collision, solved one axis at a time. 7 new tests
  (24 total) cover walking, standing still, diagonal speed, wall clamping,
  furniture blocking, sliding, and non-mutation.
- `/client` gets `bedroomRender.ts`: a fixed Sims-style bird's-eye camera
  (rotation is the M2 "real bedroom" item, not this one), gray floor, four
  low walls the camera sees over, gray furniture boxes, and the same blue
  box as the skier so it reads as "you" in both scenes. `main.ts` now owns
  a two-mode scene switch (two canvases, one hidden) and a HUD hint line
  showing the controls plus which key switches scenes.
- The cat is deliberately absent from the room — "basic cat follows/sits"
  is its own M1 item, next session's work, not a half-built extra here.
- `npm run check` passes (24 tests). Browser verification: the preview
  pane stayed hidden again (same quirk as last session — hidden tabs
  freeze the animation loop), so the real modules were driven manually in
  the live page: wall clamp at x=-4.7, desk blocks at exactly x=3.0, bed
  blocks at z=-0.2, and Enter swaps which canvas is visible both
  directions. The rendered look of the room is the one thing only eyeballs
  can confirm — worth a glance when playtesting.

**What to playtest:** `npm run dev` now starts you in the bedroom. Walk
around with arrows/WASD — bump into the bed, dresser, and desk, and slide
along their edges. Press Enter to go skiing, Enter again to come home.
Does walking speed feel right for a small room? Do the furniture bumps
feel solid or sticky? Does starting at home (instead of on the slope)
feel like the right shape for the game?

**Next:** the last M1 build item — the basic cat following/sitting in the
bedroom (director call, 2026-07-20). After that, only the fun-check
verdict remains in M1; it needs the director's playtest impressions, and
feel tuning (speeds, jump arc, pause length) belongs in that session.

## 2026-07-20 — M1: basic cat follows/sits in the bedroom

The cat is in the room — the last M1 build item. It starts the game sitting
beside the bed, trots over to greet you when the game starts, follows you
around the room, and sits back down when it catches up.

- `/shared` `bedroom.ts`: the bedroom state gains a cat (position, facing
  direction, and a mood — `sitting` or `following`). The cat's whole brain
  is: sit until the player is more than 2.2 units away, walk toward them at
  3.0 units/s (a touch slower than the player's 3.5, so it trails behind
  rather than gluing to your heels), and sit back down within 1.1 units.
  The two different distances stop it flickering between sitting and
  standing at one boundary. It collides with walls and furniture using the
  same slide-along-edges logic as the player, just with a smaller
  footprint. The cat thinks every frame, so it keeps walking toward you
  while you stand still. 4 new tests (28 total): greeting at game start,
  staying seated while you're close, facing its walk direction, and being
  blocked by the desk.
- `/client` `bedroomRender.ts`: an orange box for the cat (same orange as
  the ski scene's cat, so it reads as the same character), rotated to face
  where it's walking. Sitting is the same box stood up taller and
  shortened front-to-back so the two poses read at a glance from the
  bird's-eye camera.
- `npm run check` passes (28 tests). Browser verification: the preview
  pane's screenshot path was stuck again (third session running), so the
  real modules were stepped manually in the live page — the cat greets at
  game start and settles at ~1.06 units, follows during a walk (while the
  player correctly stops against the desk at x=3.0), and sits back down at
  ~1.07 units after you stop. The cat's rendered look (color, poses,
  rotation) is the one thing only eyeballs can confirm — worth a glance
  when playtesting.

**What to playtest:** `npm run dev` — you start in the bedroom and the cat
should trot over to you on its own. Walk around; does the follow distance
feel companionable or clingy? Trap it behind furniture — does it look
stuck-dumb or acceptably cat-like? Does the sit-down pose read as sitting?

**Next:** the M1 fun check — every build item is done, so the next session
is the playtest-and-verdict session: does the loop feel good enough to
invest in art? Feel tuning (speeds, jump arc, pause length, follow
distances) belongs in that session.

## 2026-07-21 — Fix: cat no longer gets stuck on furniture

Playtest feedback: the cat got stuck pressing against furniture. Cause:
it always walked in a straight line at the player, and the slide-along
collision can pin it against a face it can't slide around. Fix: the cat
now plans a route around whatever's in the way.

- `/shared` `bedroom.ts`: each frame, if the straight line to the player
  is blocked, the cat finds the shortest route around the blocking
  furniture — through its open corners (corners flush against a wall are
  skipped, so it always goes round the open side) — and walks toward the
  first waypoint. Recomputed every frame from state alone, so there's no
  stored path and the functions stay pure. A first, simpler attempt
  (always aim at the nearest corner) oscillated at the corner — the
  shortest-route version is why this is a proper little route search
  (at most 6 points, cat + 4 corners + player) rather than a one-liner.
- The stuck behavior was actually pinned down by the old "cat is blocked
  by furniture" test — that test now asserts the opposite: the cat walks
  *around* the desk, never clips into it on the way, and ends up sitting
  next to the player (28 tests total, all passing).
- Verified by stepping the real modules in the live page (screenshots
  still stuck): routes around the desk, the dresser, and the bed all end
  with the cat sitting ~1.05 from the player with zero furniture
  penetration — including starting the cat pressed flat against a desk
  face, the exact stuck pose from the playtest.

**What to playtest:** try to trap the cat again — walk so furniture is
between you and it, from a few angles. It should round the furniture and
settle next to you every time. Does the detour path look deliberate or
drunk?

**Next:** unchanged — the M1 fun-check verdict session (playtest +
feel tuning).

## 2026-07-21 — M1 fun check: PASS (barely) — M1 complete

The director playtested the full loop and gave the verdict: **the fun
loop passes, barely.** That closes the last M1 checkbox — the prototype
gate is cleared and the game has earned real art.

"Barely" is worth recording honestly: the margin is thin, so feel tuning
(speeds, jump arc, crash pause, follow distances) stays a live concern
through the next phase rather than a solved problem. Polish genuinely
helps here — sound, real assets, and visual feedback are a big part of
game feel — but tuning shouldn't hide behind it.

**Director call (2026-07-21):** the next phase — the director's
numbering calls it **phase 3** (scaffold was 1, prototype 2); it maps to
M2 below — is to **polish one area of the game end to end**: real
assets, lighting, UI, sound, and save/load. The M2 checklist has been
reshaped to match, and choosing which area (bedroom or slope) is the
first order of business next session. Vertical-slice items that aren't
part of the chosen area moved down into M3.

**Next:** start phase 3 / M2 — first decision: which area gets polished.

## 2026-07-21 — Art style bible written into DESIGN.md

First M2 groundwork: the director supplied five *Omno* reference images
and notes on what they liked in each (the sun haze, accurate soft
shadows, brightness, simple rock shapes, snow trails and motion blur,
reading distance via rolling hills and haze) and one dislike (snow with
no depth — no footprints or carved ski trails). From that,
[DESIGN.md](DESIGN.md#art-style-bible) gained a binding **Art Style
Bible**:

- A 12-color palette (snow whites with blue shadows, dawn-pink haze,
  birch amber, glacial ice, reserved skier-blue and signal-red) with a
  rough scene-balance guide.
- Shape language: faceted flat-shaded low poly, simple silhouettes,
  rolling-not-jagged terrain (jagged reserved for hazards), scale
  contrast, cute characters against an austere landscape, no textures.
- Lighting: one bright sun, soft blue shadows (never black), mandatory
  pink-tinted distance haze (it's also the gameplay depth cue), visible
  glowing sun.
- Snow & motion rules from the director's dislike: skis carve persistent
  grooves, feet leave prints, speed is visible in spray/blur — tracked
  as M2/M4 detail-touch work.
- Asset sourcing rules: free CC0 packs first (Kenney, Quaternius,
  Poly Pizza, OpenGameArt), CC-BY second, AI-generated last resort only
  if it matches the bible; a style-match test every asset must pass;
  props under ~2k triangles (characters/set pieces ~5k); `.glb`, meters,
  Y-up, origin at base.
- Created [assets/CREDITS.md](assets/CREDITS.md) — every asset gets a
  license row there before it's committed, no exceptions.

No code changed this session; `npm run check` unaffected.

**Next:** unchanged — pick which area (bedroom or slope) gets the M2
polish. The bible's snow/motion rules lean toward the slope being the
richer showcase, but that's the director's call.

## 2026-07-21 — M2: slope chosen; first real assets on the slope

Director calls: the M2 polish area is the **ski slope**, and assets come
from the **Quaternius Ultimate Nature Pack** (CC0). This session got those
assets into the game — the slope now has real snowy trees and rocks
instead of empty gray flanks.

- Downloaded the pack (150 models; the itch.io mirror, since the Google
  Drive folder was over its download quota) and kept the 24 snow-variant
  models that fit the slope: snowy birches, dead birches, pines, 7 rocks,
  a stump, a log, and 2 bushes. License confirmed CC0 by the License.txt
  inside the pack itself.
- New tool: `tools/obj2glb_palette.py` converts the pack's OBJ files to
  `.glb` while remapping every material to the Art Style Bible palette —
  foliage goes birch amber (the palette has no green on purpose), rock
  goes slate, snow goes sunlit snow. It also snaps each model's origin to
  its base and enforces the bible's 2,000-triangle prop budget: two
  over-budget tree variants (BirchTree_Snow_4, PineTree_Snow_3) were
  dropped rather than decimated — each still has 4 sibling variants.
- 24 `.glb` files landed in `assets/slope/` (1.3 MB total — comfortably
  inside M4's 15 MB load budget), each with a row in
  [assets/CREDITS.md](assets/CREDITS.md). Vite now serves `/assets` as
  its public dir, so they ship in the build automatically.
- `client/skiRender.ts` loads the models in the background (the run is
  playable before they arrive) and scatters 87 of them along both flanks
  of the skiable lane with a seeded random layout — same slope every run,
  nothing ever inside the lane, sparse oversized silhouettes farther out
  for the lonely-vast depth the bible asks for. Decor is pure scenery:
  no collision, no `/shared` changes.
- Palette alignment while in there: sky, snowfield, checkpoint stripes
  (green → glacial ice), chasms (near-black → deep slate; the bible bans
  pure black), and the characters — the skier now wears the reserved
  skier blue and the cat is birch amber in **both** scenes, so "you" and
  the cat stay the same colors everywhere.
- `npm run check` passes (28 tests, no logic changes) and `npm run build`
  ships the GLBs. Verified in the live page by stepping the real modules
  (screenshots timed out again — fourth session running): all 24 GLBs
  load with no console errors, 87 decor pieces placed, zero inside the
  skiable lane, and material colors round-trip to the exact bible hexes.
  The rendered look is the one thing only eyeballs can confirm — that's
  the headline playtest item below.

**What to playtest:** `npm run dev`, press Enter to hit the slope. Do the
treelines read as an *Omno*-ish place — lonely and vast, but cute? Is the
tree density right (the bible says too many warm trees kills the mood)?
Do the amber birches work against the snow? Does anything pop in that
shouldn't (a tree in the lane, floating props)? And per M1's verdict, the
feel question stays open: does the slope feel *better* to ski now that
speed has visible reference points?

**Next:** the slope lighting pass — the bible's sun + soft blue shadows +
the mandatory dawn-pink distance haze (it's also the depth-reading
gameplay cue). Direction questions for sound/music/UI are with the
director.

## 2026-07-21 — M2: slope lighting pass — sun, blue shadows, pink haze

The slope now has its weather: one low warm sun throwing long soft shadows,
every shadow on snow the bible's soft blue, dawn-pink haze eating the
distance, and a visible glowing sun hanging just above the horizon ahead.
All rendering-only (`client/skiRender.ts`) — no `/shared` changes, so the
test count stays at 28.

- **The palette does the math.** The bible's two snow colors fully
  determine the lighting: ambient skylight alone must render flat snow as
  snow-shadow blue (#D3DFF0), and ambient + sun together must render it as
  sunlit snow (#F8F5EF). The light colors are *derived* from those two
  constraints in code rather than tuned by eye — so shadows land on
  palette #2 by construction. The sun comes out warm (all red/yellow, no
  blue) and the ambient cool, which is exactly the dawn look the
  references have.
- **Shadows.** Shadow mapping is on with soft edges (a blur radius on the
  sun's shadow). Everything casts: trees, rocks, the skier — whose shadow
  on the snow is the bible's height cue during jumps. The sun and its
  shadow camera follow the skier down the slope so shadows stay crisp the
  whole run. Trees on the left flank throw long shadows right across the
  lane, like a real morning piste. Upstream wrinkle: Three.js retired the
  exact "PCFSoft" mode the bible's parenthetical named (r185 silently
  falls back and warns); the bible's implementation note was updated —
  same soft look, different knob.
- **Haze.** Distance fog tinted dawn pink (#F6D7CE) from 35 to 150 units —
  far trees lighten and melt into the horizon, which is the gameplay
  depth cue the bible mandates. A new sky dome blends dawn pink at the
  horizon up to sky blue overhead, so the fog fades into sky instead of
  hitting a flat wall. The snowfield plane now quietly follows the skier,
  so the snow never visibly ends — its far edge is always past full haze.
- **The sun is visible.** A sun-glow disc with a soft radial halo sits at
  the light's azimuth, cheated down to just above the horizon — the
  camera looks downhill, so the real 25°-up sun could never be in frame.
  You ski toward the light.
- Verified numerically in the live page by rendering a frame and reading
  pixels back (screenshots still time out — fifth session running): lit
  snow renders within 2/255 of palette #1, a tree shadow's core within
  1/255 of palette #2, the horizon fog *exactly* #F6D7CE, the sun disc
  core *exactly* #FFF4DA, and the shadow edge measures a ~13-pixel soft
  penumbra with a solid core. `npm run check` (28 tests) and
  `npm run build` both pass. The overall *look* — mood, balance, whether
  the haze feels like Omno — is the one thing only eyeballs can judge.

**What to playtest:** `npm run dev`, Enter to hit the slope. This is the
first session where the slope should feel like a *place with weather* —
does the dawn light land? Watch your own shadow while jumping a chasm: does
it help you judge the landing? Do the long tree shadows across the lane
read as morning light or as visual noise? Is the haze helping you sense
how far the next chasm is? And does the sun ahead make you want to ski
toward it?

**Playtest verdict (director, 2026-07-21):** "It's starting to come
together." The lighting pass stands as-is — picky visual tweaks are
deliberately parked until every M2 item is done, then handled as one
tuning pass rather than nibbled at between features.

**Next:** per the M2 list — real UI (replace the plain-text HUD). Direction
questions for sound/music/UI are with the director.

## 2026-07-21 — M2: real UI — cat-face lives, banners, keycap hints

The plain-text HUD is gone. The slope now has a real UI, styled to the Art
Style Bible's palette: the cat's 9 lives are nine little cat faces in a
snow-white pill (top left), crash/forfeit messages are proper centered
banners, and the controls hint is a row of keycap chips along the bottom.
All DOM overlay (`client/src/hud.ts`, new) — reads game state, never writes
it. No `/shared` changes; test count stays at 28.

- **Lives are nine cat faces.** Each is a chunky amber cat with eyes and the
  palette's signal-red scarf. Losing a life fades that cat to snow-shadow
  blue — eyes and scarf vanish, so a spent life reads as the cat's shadow.
  Nine icons sells the "9 lives" joke better than a number ever did.
- **Banners.** Crashing pops a soft snow-white banner ("Crashed! Back to
  the checkpoint…"); running out of lives pops the one signal-red panel in
  the game ("Out of lives — run forfeited", with "Press Enter to head
  home" under it) — red is reserved for "look at this", and this is the
  thing to look at.
- **Keycap hints.** Bottom-center pill with little keyboard-key chips:
  walk/ski keys in the bedroom; steer/lean/jump/boost/home on the slope.
  Each scene shows only its own hints.
- Also fixed while in there: the HUD now syncs once at startup, so the
  right panels show even before the first animation frame (hidden browser
  tabs pause frames — the same quirk that affects verification here).
- **Director calls made by default this session** (the direction questions
  were still open, so the recommended options went in — all cheap to
  change): scope was HUD-only (no title screen yet), lives as nine icons
  rather than icon-×-number, and a soft-rounded tone (pills, chunky
  lettering) rather than Omno-minimal. Flag anything that feels wrong.
- A proper rounded display font (e.g. Fredoka or Baloo, both open-license)
  would push the cozy tone further, but bundling one means downloading a
  file — parked in [IDEAS.md](IDEAS.md) for a director yes/no.
- `npm run check` (28 tests) and `npm run build` pass. Verified in the live
  page by driving the real ski module through a full run against the HUD:
  fresh run shows 9 amber cats, first crash fades one and pops the crash
  banner, burning all lives swaps it for the red forfeit banner, and going
  home hides all slope UI. Panel/icon/keycap colors computed-style-match
  the palette hexes exactly. The rendered *look* is the eyeballs item
  below (screenshots still time out — sixth session running).

**What to playtest:** `npm run dev` — check the bottom hint bar in the
bedroom, then Enter to ski. Crash on purpose: does the cat-face fading
read instantly as "I just spent a life"? Does the forfeit banner land with
the right weight? Are the keycap hints helpful or clutter? And the taste
questions: is soft-and-rounded the right tone against the austere slope,
and do you want a title screen session soon?

**Next:** per the M2 list — sound for the slope (music + effects), then
save/load. **Director instruction (2026-07-21): re-ask the direction
questions at the top of the next session** — both the sound/music
direction and a ratify-or-change pass on this session's three UI
defaults (HUD-only scope, nine icons, soft-rounded tone). Slope-side
character art (skier/cat models) also remains open under the M2 assets
item.

## 2026-07-21 — M2: slope sound effects (synthesized, no files)

Direction questions re-asked first, per last session's instruction.
Director calls: **effects before music** (pick the music direction after
hearing the effects in place); UI defaults — nine cat-face lives and
HUD-only scope ratified, but the **visual tone moves to a middle ground**
(cat faces stay cute; pills/chunk/panels calm down — that restyle is its
own next session), and the title screen idea evolved into a **dynamic
showcase title screen** (parked in IDEAS.md with the details).

The build: the slope now sounds like skiing. Every sound is synthesized
in the browser with the Web Audio API — no audio files in the repo, no
licenses to track, and the continuous sounds can follow your actual speed,
which a looped recording can't do. New `client/src/audio.ts`; audio reads
game state and never writes it, same rule as rendering.

- **Continuous layers:** wind (deep, gusting slowly, louder with speed and
  a bit louder mid-air) and the ski-carve hiss (louder *and* brighter with
  speed, silent while airborne — so every jump gets a held-breath hush and
  the landing brings the hiss back). Boosting adds a high rush on top.
- **One-shots on game events:** a rising whoosh on jump takeoff, a soft
  snow-compression thump on landing, a bigger flop-into-powder thump on
  crash (soft-bodied on purpose — it's a cozy game), two rising plucks
  when you bank a checkpoint, a small pluck on respawn, and three gentle
  falling notes for the forfeit. Events are detected by comparing the
  previous frame's state to the current one — `/shared` stays ignorant of
  audio, and the fresh-run reset (Enter) is guarded so it never fires
  fake sounds.
- **M mutes**, with a new keycap chip in both scenes' hint bars. Browsers
  only allow sound after the player's first input, so the audio engine
  wakes on the first keypress.
- `/shared` change is additive only: `MAX_SPEED` and `BOOST_SPEED` are now
  exported so audio can scale loudness off real speed instead of magic
  numbers. No logic changes; `npm run check` (28 tests) and
  `npm run build` pass.
- Verified in the live page by instrumenting the real audio module and
  driving it with real game states (screenshots still time out — seventh
  session running): the engine reports *running*, layer loudness matches
  the design numbers exactly at cruise/airborne/boost/crash, each
  transition fires exactly its own sound (jump 1, land 2, crash 2,
  respawn 1, checkpoint 2, forfeit 3 nodes), going home silences all
  layers, the fresh-run guard fires nothing, and mute swings the master
  volume 0.9 → 0 → 0.9. What the effects *sound like* is the one thing
  only ears can judge — that's the headline playtest item.

**What to playtest:** `npm run dev`, press Enter to ski — with sound on.
Does the carve hiss make speed feel real? Does the mid-air hush + landing
thump make jumps feel better? Crash on purpose: does the powder-flop
read as soft rather than punishing? Is the checkpoint pluck satisfying?
Is anything annoying after three runs (that's the real test of a
synthesized sound)? And the standing question, now answerable: with these
effects in your ears, what should the music be — lofi, ambient-only, or
calm instrumental?

**Playtest verdict (director, 2026-07-21):** the sounds land — "speed
feels real now," and the wind is the favorite. One note: the ski-carve
hiss is too loud relative to the rest — parked in
[IDEAS.md](IDEAS.md) for the end-of-M2 tuning pass rather than tweaked
now, per the no-nibbling rule. The music direction question stays open
until the director calls it (lofi vs ambient-only vs calm instrumental).

**Next:** the UI tone restyle (middle ground — this session's director
call), then save/load to finish the M2 list.

## 2026-07-21 — M2: UI tone restyle to the middle ground

The HUD calmed down. Last session's director call — cat faces stay cute,
everything around them quiets toward *Omno*-minimal — is now in. This is a
CSS-only change in `client/src/hud.ts`: no layout moved, no logic changed,
no `/shared` changes, test count stays at 28.

- **Pills became soft rounded rectangles.** The lives panel and hint bar
  had fully-round pill corners (999px); they're now gently rounded
  (10–12px), matching the banners, which also came down from 24px.
- **Lettering went from chunky to quiet.** Banner text dropped from 26px
  extra-bold to 20px semi-bold with a touch more letter-spacing; hint
  labels lightened a step; the keycap chips lost their thick 3D bottom
  edge (3px → 2px) and heavy weight. Everything still reads at a glance —
  it just stops shouting.
- **Panels became whispers.** All borders thinned from 2px to 1px
  hairlines, backgrounds got a bit more translucent, and the hint bar's
  dawn-pink border joined everything else on quiet snow-shadow blue — one
  fewer accent color competing with the scenery.
- **What deliberately did not change:** the nine cat faces (size, amber,
  scarf, the fade-to-shadow on a spent life), the forfeit banner staying
  the game's one signal-red panel, and all HUD behavior. The bundled
  rounded font stays parked in IDEAS.md pending a director yes/no.
- `npm run check` (28 tests) and `npm run build` pass. Verified in the
  live page by reading computed styles off the real HUD elements — every
  value matches the design exactly (12px/10px radii, 1px snow-shadow
  borders, 20px/600 banner, 5px keycaps, cat faces untouched at 26px
  birch amber). The rendered look is the eyeballs item below (screenshots
  still time out — eighth session running).

**What to playtest:** `npm run dev` — look at the hint bar in the bedroom,
then Enter to ski and crash on purpose to see the banners. Does the HUD
now sit *with* the landscape instead of on top of it? Do the cat faces
still pop now that their panel is quieter? Is anything now too quiet —
hard to read against bright snow? This is the restyle you asked for;
say if the middle landed in the right place.

**Next:** save/load (browser storage). **Music direction called by the
director (2026-07-21, after this session):** each slope gets a timed song
synced to its layout, Geometry Dash style — tense before the big jumps
(details in [IDEAS.md](IDEAS.md)) — and music deliberately waits until
the **end** of M2, after everything else. So the running order is:
save/load → character art / remaining slope assets → music → the
end-of-M2 tuning pass.

## 2026-07-21 — M2: save/load (browser storage)

The game remembers where you were. Close the tab mid-run and reopen it, and
you're back in the same scene, the same spot, with the same run in
progress — lives spent, checkpoint banked, mute setting and all.

- `/shared` gets `save.ts`: the pure save logic, so it's testable without a
  browser. A save is a JSON snapshot of only the *dynamic* game
  state — where the player and cat are, the ski run's distance/lives/status,
  and whether sound is muted. The **static layout is deliberately not
  saved**: room size, furniture, chasms, and checkpoints always come fresh
  from the `createInitial*` functions on load. So when the slope gets
  retuned later (M1's verdict says feel tuning stays live), old saves never
  trap a stale layout — they only carry your progress, which gets dropped
  onto today's slope.
- **Loading is strict and self-healing.** `decodeSave` rejects anything that
  isn't exactly right — corrupt JSON, an old `SAVE_VERSION`, a bad enum, a
  non-finite number, or an impossible combination like "still skiing with
  zero lives" — and the game just starts fresh (always safe this early).
  Values that are merely *stale* rather than *wrong* get healed instead of
  rejected: an out-of-range position is clamped back into the room, and a
  checkpoint that no longer exists snaps down to the nearest one you'd
  actually have passed.
- `/client` gets `save.ts` — the thin localStorage glue (the only file that
  touches storage), wrapped in try/catch so private-browsing or
  storage-disabled just plays on without persistence. `main.ts` restores on
  startup and saves at the moments that matter: scene switches, mute toggle,
  a 5-second autosave safety net, and when the tab is hidden or closed.
  `audio.ts` now takes an initial-muted flag so a restored mute setting is
  respected from the first frame.
- 10 new tests (38 total): a mid-game snapshot round-trips through
  encode → decode → restore; a restored run steps *identically* to the
  original for 120 more frames; static layout comes from code not the save;
  garbage/version/enum/non-finite/impossible-combo saves are all rejected;
  stale checkpoints snap and wild positions clamp; and a run saved
  mid-crash-pause still respawns correctly on load.
- `npm run check` (38 tests) and `npm run build` pass. Verified in the live
  page on this session's own dev server (screenshots still time out — ninth
  session running, so state was read via the DOM): a fresh load writes the
  default save; pressing Enter switches to the slope and persists `mode:
  slope` immediately; a hand-crafted "6 lives, past checkpoint 26" save
  reloads into the slope with exactly 3 cat faces faded; toggling mute
  persists `muted: false`; and a deliberately corrupted save reloads to a
  clean fresh bedroom with all 9 lives. (One wrinkle worth noting: the
  save-on-close is *so* prompt that it overwrites a hand-injected fixture
  during a test reload — real behavior, working as intended; the test just
  had to block the unload-save to observe the fixture.)

**What to playtest:** `npm run dev`, then just play — walk around, go
skiing, crash a couple times, maybe mute. Now **close the tab entirely and
reopen it**. You should land right back where you were: same scene, same
position, same lives, same mute setting. Try it mid-run on the slope, and
try it from the bedroom. Does resuming feel seamless, or is there anything
that resets when it shouldn't (or *doesn't* reset when it should)?

**Playtest verdict (director, 2026-07-21):** "The saves are working
perfectly." Shipped as-is — no follow-ups.

**Next:** per the M2 list — character art / remaining slope assets
(skier + cat models are still gray boxes), then music (the deliberately
**last** M2 item: timed per-slope songs, see IDEAS.md), then the
end-of-M2 tuning pass.

## 2026-07-21 — M2: the cat is a real cat

The orange box is gone. The cat is now an actual rigged, animated model —
the same one in both scenes, so it's recognizably one animal whether it's
trotting around the bedroom or riding on your back down the slope.

- **Sourced, not built.** Asset research first, per the director's ask: no
  CC0 skiing *human* exists anywhere (only CC-BY or paid), but a **CC0 cat
  by Quaternius** does — [on Poly Pizza](https://poly.pizza/m/qKICY6xla2),
  rigged with 8 animation clips. Quaternius is the same artist as the
  Nature Pack all 24 slope trees and rocks came from, so it matches the
  existing scenery by construction. Director call: take this cat now, and
  decide the human separately.
- **New tool: `tools/glb_palette.py`.** The downloaded `.glb` colored
  itself with a shared 512×512 texture atlas, and the Art Style Bible bans
  textures outright. So the tool reads the flat swatch each vertex lands
  on, remaps it to a palette color, writes that into the mesh's vertex
  colors, and deletes the texture entirely. The cat came out as exactly
  four color regions: body → birch amber, belly → birch bark, eyes → deep
  slate (the bible bans pure black), nose → signal red. 2,448 triangles,
  inside the bible's ~5,000 character budget.
- **The four regions are the customization seam.** Because every vertex
  knows which region it came from, recoloring the cat later is one
  attribute rewrite at runtime — no new meshes, no textures. Parked in
  [IDEAS.md](IDEAS.md) as the director asked.
- `client/src/catModel.ts` (new) owns the model's quirks in one place, so
  both scenes share it: it measures the loaded model and normalizes it to
  0.42 units tall with its paws on the ground (rather than hardcoding a
  magic scale), cross-fades between clips, and adds the signal-red scarf —
  built in code, positioned off the actual head bone — that ties the animal
  to the nine cat faces in the HUD.
- **Two moods, two clips.** The bedroom cat's existing `sitting` /
  `following` states now drive the Idle and Walk animations instead of the
  old trick of squashing a box taller to mean "sitting". On the slope the
  cat sits on your back, parented to the skier, so it tips over with you on
  a crash for free.
- No `/shared` changes — this is all rendering. Test count stays at 38;
  `npm run check` and `npm run build` both pass, and the build ships the
  `.glb`.
- Verified in the live page by driving the real modules (screenshots timed
  out again — tenth session running): the model loads with palette vertex
  colors intact and all four hexes round-tripping exactly, feet land on
  y=0 and the model measures 0.29 × 0.42 × 0.49, the head bone sits at +Z
  so the existing facing math needed no offset, the Walk clip genuinely
  moves the leg bones and the pose switch settles them, and a pixel window
  around the cat on the skier's back reads skier blue `#5776A8`, cat amber
  `#C69960`, and cream belly `#EEDFCB` — all palette colors under the ski
  scene's lighting. Two bugs were caught and fixed this way: the scarf
  floated above the cat's head, and it was oriented like a halo instead of
  a collar.
- **Found, deliberately not fixed:** the cat renders muddy (`#93734E`) in
  the *bedroom* — but so does everything else in that room. The bedroom's
  gray-box lighting predates the ski scene's physical-lights fix, so the
  whole room is ~45% too dark. That's the M3 "bedroom to the same polish
  level" item, not a cat problem; flagged in [IDEAS.md](IDEAS.md) so the
  cat doesn't get blamed for it at playtest.

**What to playtest:** `npm run dev` — the cat should trot over to you in
the bedroom on its own, now actually walking rather than sliding. Watch its
legs; watch it sit back down. Then Enter to ski and look over your
shoulder — the cat is riding on your back with its red scarf. Crash on
purpose: it should tip over with you. Questions: does the cat read as
*your* cat (does the scarf tie it to the HUD faces)? Is it the right size
in both scenes — too big, too small? Does the walk animation match how fast
it's actually moving, or does it look like it's moonwalking? And ignore how
dark it looks in the bedroom — that's the room's lighting, fixed in M3.

**Next:** the skier — but three questions get answered **at the top of
that session, before any code**, because they change how the skier is
built and they're all cheap now and expensive later. Written up in full in
[DESIGN.md → Characters & customization](DESIGN.md#characters--customization--open-needs-a-director-call).

> **Carried-over questions for the next session (director instruction,
> 2026-07-21):**
>
> 1. **The palette has no skin tones.** The bible's 12 colors were written
>    for a landscape; its one character color is a coat (skier blue).
>    Character customization can't happen without extending it. Pick one:
>    (a) add a separate character ramp of 6–8 skin tones + hair colors
>    alongside the 12 *(recommended)*; (b) fold them into the 12; or
>    (c) stylize past it with non-realistic skin tones drawn from the
>    existing palette.
> 2. **How deep does customization go in v1.0?** Colors only — skin, hair
>    color, eye color, clothing — is nearly free with the tooling that
>    already exists. Swappable *shapes* (hairstyles, face variety) cost
>    real art per option. v1.0 scope says "basic options"; how basic?
> 3. **Which base character?** The director likes the proportions in
>    Quaternius's
>    [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html),
>    but the
>    [Ultimate Modular Men Pack](https://quaternius.com/packs/ultimatemodularcharacters.html)
>    is built for part-swapping (4 swappable pieces per character). Same
>    artist, so either matches the cat; the modular one trades some
>    proportion preference for real shape customization.
>
> Recommended split regardless of the answers: build the skier next
> session **with the customization seams in place** (regions split into
> materials, colors read from state with defaults) but **without** the
> customization UI — that already lives in M3's "character customization
> (basic options)", and keeps this to one feature per session.

After the skier: music (the deliberately **last** M2 item), then the
end-of-M2 tuning pass.

## 2026-07-21 — M2: the skier is a real character (and customizable)

The blue box is gone from both scenes. You are a real rigged person now,
walking around the bedroom and skiing down the slope — and the character
customization seam the director asked for is in and working, minus its UI.

**Three director calls first, per last session's instruction:**

1. **Skin and hair get their own palette**, leaving the landscape's 12
   colors alone. Written into [DESIGN.md](DESIGN.md#character-palette-separate-from-the-12)
   as a character-only ramp: 8 skin tones, 8 hair colors, 5 eye colors, 5
   coats, 4 trousers, 3 boots. Signal red is deliberately in none of them —
   it stays reserved, so the cat's scarf is still the one red thing on a
   skier.
2. **Customization depth: colors + a few hairstyles.** Colors landed this
   session. Hairstyles are geometry rather than a recolor, so they're their
   own session — parked in [IDEAS.md](IDEAS.md) rather than half-built.
3. **Which base model** — this one changed shape mid-session, see below.

**The base model question got re-opened by the facts.** The Animated
Character Pack's *male* model turned out to be unusable: one material, no
texture, no color separation at all, so it renders monochrome and can't be
customized without re-authoring it. Two other CC0 Quaternius bases work,
and the director's call was to **ship both and pick at playtest**:

- `Skier_Modular.glb` — six named materials out of the box, no textures,
  1,852 tris, 11 clips. The better seam.
- `Skier_Animated.glb` — the animated pack's female model, 1,908 tris, 10
  clips, texture atlas baked to palette vertex colors by the same tool the
  cat used.

**Press B in the bedroom to swap between them.** That key is temporary and
goes away with the losing model.

- `/shared` gets `appearance.ts`: the ramps plus the character's chosen
  colors, stored as **indices into the ramps** rather than raw hex — an
  index can't drift off-palette, it survives a ramp being re-tuned, and
  validating a save becomes a range check instead of a color parse. 12 new
  tests (53 total) cover resolving, cycling, wrapping, non-mutation, and
  the reserved-red rule.
- Appearance rides in the save, so it persists for free. `SAVE_VERSION`
  went 1 → 2, which **discards existing saves** — that costs a position and
  a run in progress, and the alternative was supporting two save shapes
  forever. Out-of-range indices are healed by clamping, like stale
  positions already were; wrong *types* are still rejected outright.
- `/client` gets `skierModel.ts`, which hides the two bases behind one
  interface — the rest of the game sets an appearance and never learns
  which base is loaded. The modular base recolors by setting material
  colors; the animated base rewrites the color-attribute entries belonging
  to each region, matched once at load against their baked colors.
- The bedroom player now faces the way they're walking and switches between
  standing and walking animations. That heading is derived in the renderer
  from the movement between frames rather than added to `BedroomState` —
  it's presentation, not simulation. Flagged in IDEAS.md for the day
  something in `/shared` needs it.
- `npm run check` (53 tests) and `npm run build` pass. Verified in the live
  page by driving the real modules (screenshots timed out again — eleventh
  session running): both bases load and normalize to 1.6 units with feet on
  the ground, all six regions resolve to exactly the colors
  `resolveAppearance` predicts on both bases, recoloring one region leaves
  the other five untouched, every animation clip name resolves on both
  bases (a wrong name would silently do nothing), swapping bases keeps
  exactly one model mounted, and a rendered frame reads the coat, skin,
  hair, trousers and the cat's amber in their correct lit palette colors —
  with flat snow landing within 2/255 of palette #1, matching the lighting
  session's own measurement.

**Two real bugs were caught by that verification, not by the tests:**

- **The skier leaned uphill.** The ski pose is a forward lean, and the lean
  was being applied *inside* the half-turn that points the skier downhill —
  which flipped it, tipping them back into the hill by a third of a unit of
  head travel. The rig now applies lean above the turn, and the fix is
  measured: the head moves 0.33 units downhill instead of uphill.
- **The cat was riding inside the skier's chest.** Its offset was tuned
  against the old 1-unit box; on a real 1.6-unit person leaning downhill it
  landed *in* the torso. Now it sits against the back with a 22mm gap,
  still facing back toward the camera so you can see its face and scarf.

**Found, deliberately not fixed:** the modular base is wearing a **t-shirt
and shorts** on a ski slope — lit skin is the single largest non-snow color
in a frame. The animated base is better dressed. Parked in IDEAS.md,
because it may well decide the base-model question by itself.

**What to playtest:** `npm run dev`. In the bedroom, walk around — does the
character turn and walk convincingly, and is 1.6 units the right size next
to the furniture and the cat? Then **press B** to swap between the two
candidate bodies, and **K** and **H** to cycle skin and hair. The real
questions: **which of the two bodies should the game keep** (proportions,
how they read at ski distance, and whether the shorts are a dealbreaker),
do the skin and hair ramps have the range you want, and does the character
still read as "you" at slope distance now that they're not a blue box? Then
Enter to ski: does the forward lean look like skiing, and can you see the
cat on your back?

**Playtest verdict (director, 2026-07-21): the character needs another
pass.** Five issues, and the headline is the last one:

1. **No animation on the slope.** The skier stands there. *Diagnosed after
   the report: the animation system is fine* — idle drives 12 bones on the
   modular base and 38 on the animated one, verified by watching bone
   transforms. The problem is that the slope plays a **standing idle**,
   because neither CC0 pack contains a skiing clip, and subtle idle
   breathing on a small figure at slope distance reads as frozen.
2. **No skis.** There is no ski equipment on the character at all — he's
   sliding downhill in his shoes.
3. **The cat faces the camera.** That was a deliberate call this session
   (so you could see its face and scarf) and it's wrong; it should face
   downhill with the skier.
4. **Walking in the room is jagged.** Movement is 8-way (four booleans), but
   the *heading* snaps instantly between those eight fixed angles with no
   turn smoothing, and starts and stops with no easing — so turning pops.
5. **The characters don't match the art style.** The bible asks for
   "chunky, rounded, big-headed" characters whose cuteness carries the
   warmth against an austere landscape. Both candidate bases are
   realistically-proportioned humans (~6 heads tall). This is the real
   problem, and the director's call is to **work on the characters as their
   own next session**.

All five are parked in [IDEAS.md](IDEAS.md) with what each would take. Note
that (1), (2) and (5) interact: if the character is re-based or re-modeled
for style, the ski pose and the skis should be built against whatever body
wins, not against a body we're about to replace.

**Next:** the **character pass** (director call, 2026-07-21) — art style
first, since it decides the body that the ski pose, the skis, and any
hairstyle geometry all hang off. The cheap independent fixes (cat facing,
turn smoothing) can ride along. Then music (the deliberately **last** M2
item: timed per-slope songs, see IDEAS.md), then the end-of-M2 tuning pass.

## 2026-07-21 — M2: the character pass — a pickable, cozy roster

The realistic humans are gone. The playtest verdict was that they didn't
match the art style — too tall, too realistic, a stray asset next to the
chunky cat. The fix wasn't to pick between the two realistic bases; it was
to change what a Toebeans human *is*. Directive this session:
**https://quaternius.com/packs/ultimatedanimatedcharacter.html — let players
select from these.** That's exactly what landed.

- **The pack, and a surprise.** Quaternius's Ultimate Animated Character
  Pack is 50 CC0 characters — chunky, big-headed, cute, same artist as the
  cat and the scenery, so they match by construction. The site only
  advertises FBX/OBJ/Blend, but the download's Google Drive folder has a
  `glTF` subfolder — directly usable. **A correction fell out of checking:**
  the model the repo called `Skier_Animated.glb` was never actually from
  this pack (it had a 41-bone Mixamo-style rig, pulled from Poly Pizza).
  Last session's "animated base" was a stray. CREDITS.md is fixed.
- **You pick a character now.** `shared/src/appearance.ts` changed shape:
  the old six color regions (skin/hair/eyes/coat/trousers/boots on one body)
  became `{character, skin, hair}` — you choose a character whose outfit is
  baked in, and still tint skin and hair. The starter roster is 11 cozy
  characters (Casual ×7, OldClassy ×2, Cowboy ×2); the pack's costume
  characters (knights, ninjas, …) are parked in IDEAS.md as XP-unlock
  candidates. Stored as indices, so a choice can't drift off-roster or
  off-palette. 15 tests (55 total).
- **New tool: `tools/gltf_character.py`**, the third converter in the
  family. The pack is textureless with named materials, so recoloring is
  rewriting `baseColorFactor` — nothing to bake. It recolors every material
  to the palette (Skin/Hair get the character-ramp defaults; the outfit is
  fixed), and exploits the pack's one shared skeleton: `--strip-animations`
  drops the clips from each character, `--animations-only` keeps one shared
  `CharacterClips.glb`. 11 characters + clips = ~5 MB instead of ~20.
- **`client/src/skierModel.ts` rewritten.** Loads a character by id plus the
  shared clips (bound to its bones by name), tints the Skin/Hair materials,
  and scales off the Head bone so hats add height instead of shrinking the
  body. Much simpler than the two-base version: no atlas vertex-color
  rewriting, no per-base branching. Both old `Skier_*.glb` files deleted.
- **`SAVE_VERSION` 2 → 3** (appearance changed shape); old saves are
  discarded, indices heal by clamping as before. The temporary `B`
  (swap-base) key became `C` (cycle character); `K`/`H` still cycle
  skin/hair. All three are stand-ins for the M3 picker UI.
- `npm run check` (55 tests) and `npm run build` pass. Verified in the live
  page by driving the real modules and pixel-reading rendered frames
  (screenshots still time out — twelfth session running). This session's
  verification was unusually deep because three.js skinned-mesh scaling
  *looked* broken through a long chain of camera-clipping artifacts; ground
  truth, once framed correctly, is clean: **every character renders feet-on-
  ground at a consistent 1.56–1.64 units** (hats push OldClassy to 1.83,
  Cowboy to 1.72 — as intended), scaling is perfectly linear, skin/hair
  recolor to the exact palette hexes, the baked outfit is palette-correct
  (shirt → skier blue, pants → charcoal), and the running game cycles
  characters/colors with `C`/`K`/`H`, persists them to the v3 save, and
  switches scenes — all with no console errors. What the roster *looks* like
  in motion (which characters are keepers, whether they read as cozy against
  the slope) is the eyeballs item below.

**What to playtest:** `npm run dev`. In the bedroom, press **C** to cycle
through the 11 characters, **K** and **H** for skin and hair. The real
questions: do these chunky characters finally sit right next to the cat and
the world (the whole point of this pass)? Which of the 11 are keepers, and
are any misfits worth cutting? Is 11 the right *number* to start with? Then
Enter to ski — the character rides down with the forward lean (still no skis
or ski animation; that's the next session, now unblocked). Ignore that the
bedroom looks dark — that's the room's lighting, an M3 fix.

**Playtest verdict (director, 2026-07-21): the roster reads right, but the
character on the slope needs a polish pass.** Six issues, all parked in
[IDEAS.md](IDEAS.md) for a later session (director's call):

1. **No feet** — the pack characters have no shoe/boot geometry (legs end in
   bare stumps), and the feet likely sink into the snow on the slope.
2. **Character can be changed while skiing** — the `C`/`K`/`H` keys aren't
   gated to the bedroom (trivial independent fix in `main.ts`).
3. **Hair doesn't move** — it's part of the skinned mesh; verify it's
   weighted to the head bone, otherwise it's just the low-poly no-secondary-
   motion look (a taste call).
4. **No ski equipment** — re-confirmed (already the next session's work).
5. **Character stands straight while skiing** — the fixed forward lean is
   too subtle to read, and the up/down lean *input* produces no visible body
   change; wants a real ski pose driven by the lean.
6. **Cat sits halfway in the character's hair** — the cat's back-mount
   `(0, 0.95, 0.16)` was tuned to the old bodies and lands at head height on
   the new ones; needs re-tuning (settle with the cat-facing fix).

Issues 1, 4, 5, 6 cluster into the ski-pose session; 2 is a one-line gate; 3
is a low-priority cosmetic. The roster itself (which 11, is 11 right) is the
director's remaining eyeballs judgment.

**Next:** the **ski pose + skis + character-on-slope polish** (now
unblocked — built once on the shared skeleton for the whole roster): a real
crouched ski pose driven by the lean input, code-built skis/poles/**boots**
(the "no feet" fix), and the cat re-mounted and faced downhill. The one-line
"change character only in the bedroom" gate and the bedroom turn-smoothing
fix can ride along. Then music (the deliberately **last** M2 item), then the
end-of-M2 tuning pass.

## 2026-07-22 — M2: ski pose, skis, boots, poles — the character finally skis

The character no longer stands bolt upright sliding downhill in bare leg
stumps. This is the ski-pose session the character-pass playtest asked for:
a real crouch driven by the lean input, code-built ski gear, the cat
re-mounted and faced downhill, plus the two small ride-alongs (the
change-character-only-in-the-bedroom gate and bedroom turn smoothing).

- **A real crouched ski pose, posed in code.** No CC0 pack has a skiing
  clip, so the crouch is built directly on the pack's shared skeleton:
  rotation offsets on the spine, neck, arms, and legs, applied every frame
  on top of a frozen Idle base frame. Because it's built on the shared
  skeleton, it works for all 11 roster characters (and any added later)
  with zero per-character work. A rig quirk made the crouch natural: the
  pack's foot bones are separate root-level bones (the animations use them
  IK-style), so dropping the pelvis folds the knees while the feet stay
  planted on the skis — exactly what skiing is.
- **The lean input is finally visible on the body.** The pose blends
  between two keyed extremes — *braking* (nearly upright, weight back) and
  *full tuck* (deep crouch, folded torso, hands low) — driven by the run's
  speed, which fully encodes the lean input (up = tuck, down = brake,
  boost = deepest tuck). Going airborne adds a little extra tuck. The
  blend is eased, so pose changes roll through the body instead of
  snapping. This was playtest issue #5: "up/down produces no visible
  change" — now it's the most visible thing on the character.
- **Skis, boots, and poles, built in code** out of flat-shaded primitives
  (the same approach as the cat's scarf — no assets exist to download, and
  the bible likes visible facets). The chunky boot boxes are also the fix
  for the roster's missing feet: the pack characters have no shoe
  geometry, and now their leg stumps disappear into proper ski boots. The
  poles glue to the fist bones every frame, so they follow the hands
  through the brake↔tuck blend for free. Skis are birch amber — pale
  bark-wood was tried first and measured near-invisible against sunlit
  snow — which also ties the gear to the amber cat riding above it. Gear
  only exists on the slope; nobody wears skis in the bedroom.
- **The cat rides right, facing downhill** (director call — it used to
  face the camera for scarf visibility, and that read wrong). The mount
  dropped from head height (tuned against the old tall bodies) to the
  upper back of the crouched pose, measured against the actual crouch
  rather than guessed.
- **Ride-alongs:** the C/K/H appearance keys are now bedroom-only (the HUD
  hints already claimed they were — now it's true; no more swapping your
  whole body mid-run), and the bedroom heading eases toward the movement
  direction the shortest way round instead of snapping between the 8 input
  angles — turning finally looks like turning.
- `/shared` change is one additive export (`MIN_SPEED`, so the crouch can
  map speed onto tuck depth without magic numbers) — no logic changes;
  55 tests unchanged and passing, `npm run build` passes.
- Verified in the live page by driving the real modules and pixel-reading
  rendered frames into ASCII silhouettes (screenshots still time out —
  thirteenth session). The verification caught four real bugs the code
  alone hid: (1) the loader strips dots from bone names ("Foot.L" arrives
  as "FootL"), so the entire pose was silently a no-op at first; (2) the
  pelvis bone's name collides with a mesh node and gets renamed, so it's
  now found structurally (as Hips' parent) instead of by name; (3) a
  three.js optimization skips re-writing bones when a paused clip's values
  don't change, which made relative pose offsets accumulate into a spin —
  the pose now overwrites bones absolutely from a captured base frame;
  (4) the first pole design was 0.78 units long and punched 0.25 units
  through the snow — measured, shortened, and re-angled to hover just off
  it. Final numbers: feet planted at ±0.13 exactly on the skis at every
  tuck level, pole grips at 0.000 gap from the fists, the neck dropping
  0.97 → 0.73 units from brake to full tuck, and brake/neutral/tuck ASCII
  silhouettes that visibly read as three different skiing intensities.

**What to playtest:** `npm run dev`, Enter to ski. The big question: does
the character finally look like they're *skiing* — crouched, poles back,
cat on the upper back facing ahead? Hold ↑ and ↓ while watching the body:
does the tuck-vs-brake difference read at gameplay distance? Jump — does
the extra mid-air tuck feel right? Check the boots and amber skis: do they
read as ski gear, and is amber the right call for the skis? Then go home
and walk circles in the bedroom: does turning feel smooth now instead of
snapping? And confirm C/K/H do nothing on the slope but still work at home.

**Playtest verdict (director, 2026-07-22): needs a second pass.** What
landed well: the cat facing forward, having real ski equipment at all, and
the customization gate. But eight issues, honestly recorded — the through-
line is that the *pose* works and the *life* is missing:

1. **The skier always faces straight forward** — steering left/right slides
   the character sideways with no turn or bank.
2. **Legs and arms aren't independent** — the pose is symmetric and frozen,
   so the body reads as one rigid block instead of a person balancing.
3. **The ski equipment doesn't match the graphics** — the primitive
   boxes/cylinders don't sit right against the chunky character style.
4. **The skis aren't long enough.**
5. **The cat floats on the back** — it should be *hugging* the character's
   back, trying to peek over the shoulder.
6. **The hair still doesn't move** — it should have real physics.
7. **The cat still ends up halfway in the character's hair** — the hair
   should react physically against the cat (ties into 5 and 6).
8. **The character still reads as having no feet** — the boots are
   slope-only gear, so the bedroom still shows bare leg stumps, and the
   boots read as equipment rather than feet.

All eight are parked in [IDEAS.md](IDEAS.md) with cause analysis and what
each fix would take.

**Next:** a **character-on-slope polish round 2** session working down that
list (director's picks first), then music (still deliberately last), then
the end-of-M2 tuning pass.

## 2026-07-22 — M2: slope polish round 2 — motion & life (turning, banking, a body that balances)

Director's pick from the round-2 list: the **motion & life** chunk — the
two issues behind the "rigid block" headline. The character now turns and
banks into every steer, and the body works and balances instead of holding
one frozen shape. All rendering-side (`client/src/skierModel.ts` and
`skiRender.ts`); no `/shared` changes, test count stays at 55.

- **Steering finally turns the body.** A new carve layer in the skier rig
  (facing → carve → model + gear) yaws the character toward where they're
  actually going — derived the same way the bedroom derives its walk
  heading, by comparing this frame's sideways position to last frame's —
  and rolls them into a carving bank on top. The skis turn and tilt onto
  their edges with the body, because carving *is* the skis tilting. Both
  are eased like the tuck, so a swerve flows through the character instead
  of snapping. Braking while steering points the body further across the
  hill than steering at speed — which is just what slow-and-turning looks
  like, and it comes straight out of the atan2.
- **The cat rides the turn.** The cat's mount moved inside that carve
  layer, so it swings and banks with the back it's sitting on — before
  this, the body would have yawed out from under a cat hovering in place.
  (The full hug-the-back mount redesign stays parked in IDEAS.md — this
  just keeps the current mount attached to a body that now moves.)
- **The stance is staggered.** Left ski, boot, and foot lead by a tenth of
  a unit, the right trails; the left leg rides straighter while the right
  folds deeper; the left arm carries higher and more bent; the torso
  twists a touch toward the lead side with the neck counter-turning so the
  face stays downhill. Real skiers are never symmetric — the mirrored
  mannequin is gone.
- **The body has a life layer.** Small procedural motion on top of the
  brake↔tuck blend: the pelvis bobs (and because the feet are pinned to
  the skis, a bobbing pelvis reads as knees pumping), the arms float
  independently at deliberately incommensurate frequencies so they never
  sync into a march, the torso rocks with shifting weight, the head makes
  tiny corrections. It all scales with speed — quiet balance drift while
  braking, busy working-body at full tuck — plus a high-frequency snow
  chatter at speed that cuts out mid-air, on the same reasoning as the
  carve hiss going silent in the audio. The Idle base frame stays frozen
  (unfreezing it waves the poles around — last session's gotcha); life
  comes from these tuned layers instead.
- `npm run check` (55 tests) and `npm run build` pass. Verified in the
  live page by driving the real modules (screenshots still time out —
  fourteenth session): steering right swings the body's forward vector to
  exactly the atan2 the movement implies (eased over ~½s), bank rolls
  ±0.25 into the turn and caps before a swerve could tip the character
  over, pushing against the lane's edge wall correctly straightens the
  body back out, and a checkpoint-respawn teleport reads as zero swerve
  (the guard works). The life layer measures: pelvis bob 0.024 units,
  fists floating ~0.035 independently, feet welded to the skis with
  *zero* drift through all of it, pole grips at 0.000 from the fists,
  boots within 0.001 of the feet. Grounded frames carry ~50% more
  high-frequency chatter than airborne ones. And an ASCII-silhouette
  pixel read of a mid-carve frame visibly shows what the numbers say:
  body tilted into the turn, skis sweeping a diagonal, cat leaning with
  it.

**What to playtest:** `npm run dev`, Enter to ski, and steer hard left and
right: does the character finally *turn* — body banking into the carve,
skis on edge — instead of sliding sideways? Watch the body at a steady
cruise: does it read as a person balancing (knees pumping, arms floating)
rather than a statue? Brake, then tuck: does the asymmetric stance hold up
at both extremes? Jump mid-carve and land: anything jarring? And the taste
question: is the amount of life right — too twitchy, too calm, or close
enough to park for the end-of-M2 tuning pass?

**Playtest verdict (director, 2026-07-22): moved, but didn't land — six
issues**, honestly recorded and parked in [IDEAS.md](IDEAS.md)'s new top
block with cause analysis:

1. **The turn isn't fluid** — the whole body banks as one plank. Wants real
   ski *angulation*: feet/skis pushing out from under the body with knees
   bent while the torso stays relatively upright.
2. **The legs are still static** — differently positioned now, but frozen;
   wants random movement and spacing. (The life layer deliberately left
   the leg bones and foot pins alone — that gap is now the complaint.)
3. **No momentum** — runs start at speed and speed returns instantly after
   nearly stopping; wants resistance and a **pole push-off** to get going.
   ⚠️ Flagged in IDEAS.md as a `/shared` gameplay change (the first since
   M1) — speed is currently computed directly from input every frame. Its
   own session, not a ride-along.
4. **Knees don't bend to jump** — no takeoff extension or landing absorb.
5. **The ski boots are blocky** — folded into the parked gear-style pass,
   with the boots specifically called out.
6. **Still no feet in the bedroom** — re-confirmed; the always-on-feet
   item stands.

**Next (new session):** work down the round-2 list by director's pick —
now: turn angulation + leg life (the reopened motion items), the momentum/
pole-push-off gameplay session, jump anticipation, plus the still-parked
cat hug + hair physics, gear style + longer skis, and always-on feet.
Then music (still deliberately last), then the end-of-M2 tuning pass.

## 2026-07-22 — M2: turn angulation + leg life — the plank becomes a skier

Director's pick from the round-2 list: the two reopened motion items. The
carve no longer tilts the whole body as one plank — it's now real ski
*angulation*: the legs and skis drive out from under the body into the
turn while the torso stays nearly upright over the snow. And the legs
finally live: knees pump independently, and the stance itself slowly
breathes in width and stagger instead of holding one frozen spacing. All
rendering-side (`client/src/skierModel.ts`); no `/shared` changes, test
count stays at 55.

- **The bank got split into two systems, like a real skier.** The carve
  group's roll still supplies the lean (and got *stronger* — the gain rose
  0.45 → 0.62 — because the rest of this list makes it safe), but now the
  spine bones counter-roll against it (~75% comes back out through the
  abdomen and chest, the neck levels the head almost fully, because a
  skier's eyes stay on the hill) and the foot pins push laterally out from
  under the body toward the outside of the turn. Measured mid-carve: the
  leg line tilts **0.65 radians** into the turn while the torso tilts just
  **0.10** — legs carry 6.6× the torso's lean, which is exactly the
  angulated silhouette the director asked for, confirmed by an ASCII
  pixel-read: feet planted outside, body stacked over laterally-shifted
  hips.
- **The skis stay ON the snow now.** Found while measuring: the old
  one-plank roll happened at the body's center, so it quietly lifted the
  outside ski off the ground (0.09 units at a cruise carve — worse the
  further the feet push out). Each ski assembly now counter-rolls so its
  world tilt is exactly the intended edge angle (~0.13 rad, edging into
  the turn a touch harder than the body), and its position is pre-rotated
  to land back on the ground plane. Verified across braking swerves, boost
  tucks, and airborne frames: ski centers at 0.0173–0.0175 (= resting on
  the snow) in every case.
- **The legs joined the life layer.** Upper and lower leg bones wobble at
  slow incommensurate frequencies — free on this rig, because the feet are
  separate root-level bones pinned to the skis, so knee wiggle can't slide
  a boot off a ski. Measured working range ±0.03–0.045 rad, scaling with
  speed like the rest of the life layer.
- **The stance breathes.** The ski gear was rebuilt from one static group
  into per-side assemblies (ski + tip + boot), each repositioned every
  frame from the *same* placement numbers the foot pins use — one source
  of truth, so a boot can never disagree with its ski. On top of base
  stance and stagger, each side wanders slowly and independently: width
  varies ~0.05 units over seconds, stagger similarly — the frozen
  mannequin spacing is gone.
- Verified in the live page by driving the real modules (screenshots still
  time out — fifteenth session): the spine-counter sign was wrong on the
  first try (the measured head drift matched the bank instead of opposing
  it — the guessed bone-axis convention was backwards) and was flipped
  against the live measurement; carves mirror exactly left/right; boots
  stay glued to feet within 5mm through continuous steer sweeps (13.5mm
  worst case at the full-clamp braking swerve — still inside the boot);
  feet height varies just 3mm through everything; and a 30-second
  continuous drive returns the pose bit-exact to baseline — no drift
  through the paused-clip overwrite path. Zero console errors in the
  running game.

**What to playtest:** `npm run dev`, Enter to ski, and carve hard both
ways. The headline: does the turn finally look *fluid* — skis pushing out
under a bent-knee crouch, torso staying calm and upright over them —
instead of the whole body tipping like a plank? Watch the knees at cruise:
do the legs read as alive now? Watch the feet through a few turns: does
the spacing drifting slightly feel natural or noticeable? And since the
bank got stronger: does a hard swerve feel dynamic or excessive?

**Playtest verdict (director, 2026-07-22): not landed — and parked.** Two
issues, honestly recorded:

1. **It still doesn't feel like the legs are being pushed out** — it feels
   like the front of the ski is turning everything else. The movement
   needs to be *in the legs*. (Cause analysis in [IDEAS.md](IDEAS.md): the
   turn is still assembled at the group level — yaw and roll carry the
   whole character while the leg bones stay turn-blind, so the eye reads
   the sweeping ski tips as the thing doing the turning.)
2. **The feet are no longer actually in the boots** — a regression from
   this session's snow-contact fix: the boots now counter-roll mid-carve
   while the foot bones keep their level rest orientation, so the boot
   tilts around the foot and the foot shows. Worth recording as a
   verification gap too: the live checks measured boot↔foot *center
   distance* (5mm — glued) but never orientation or mesh containment,
   which is exactly where this hid.

**Director's call: park both and change focus** — angulation round 3 and
the boot fix go back on the round-2 list rather than being nibbled at now.

**Next:** director picks the new focus from the remaining list — the
momentum/pole-push-off gameplay session, jump anticipation, cat hug + hair
physics, gear style + longer skis, always-on feet, or the parked
angulation round 3 + boot-containment fix. Then music (still deliberately
last), then the end-of-M2 tuning pass.

## 2026-07-22 — M2: cat hug + hair physics — the big character-life item

Director's pick from the round-2 list: the cat now genuinely **hugs your
back** — belly against it, front legs reaching around, head craned up to
peek over your shoulder with its red scarf showing — and the character's
**hair finally moves**: it trails back at speed, swings through carves and
crashes, gusts in the wind, and physically pushes away from the cat instead
of swallowing it. All rendering-side (`catModel.ts`, `skierModel.ts`,
`skiRender.ts`); no `/shared` changes, test count stays at 55.

- **The mount is now the actual back.** The old cat mount was a fixed point
  floating in space behind the skier; it's now a live frame glued every
  frame to the spine bones themselves (built from the Abdomen→Neck line, so
  it doesn't depend on the pack's bone-axis conventions — those have burned
  this project twice). The cat folds with the crouch automatically: upright
  hug while braking, lying flat along the folded back in a full tuck, and
  it banks through carves and tips over in crashes with zero slope code.
  Verified: the cat's head holds a constant position *in the back's frame*
  across the whole brake↔tuck range (±4mm), exactly what "attached to the
  back" should measure.
- **The cling is a real pose.** No CC0 cat has a hug animation, so the
  cling is posed procedurally on the cat's own skeleton — front legs
  spread into the hug, back legs folded for grip, head craned to peek, tail
  swept round — over a frozen base frame, with a small life layer (slow
  breathing, lazy tail sway, tiny head adjustments at incommensurate
  frequencies) so the clinging cat reads alive, not taxidermied.
- **Hair is real geometry with real spring physics.** Every roster
  character's hair turned out to be a single mesh piece 100%-attached to
  the head bone (checked across all 11 files) — so it was lifted off the
  skeleton into its own swinging mesh, pivoted at the crown (roots stay
  put, tips do the swinging — and stay tucked under hats, which
  deliberately don't flap; hatted characters swing at half amplitude). A
  damped spring drives it from the head's real motion through the air —
  saturating, so slope speed leans the hair back convincingly without
  pinning it flat — plus wind gusts that scale with speed, and it works in
  the bedroom too (a gentle trail when you walk). The bald character simply
  has no hair to split; recoloring with **H** still works on the swinging
  hair.
- **Hair reacts against the cat.** The spring is pushed away from a sphere
  where the cat's head rides, probed against the hair's actual extent — so
  the hair rests *against* the peeking cat instead of the cat sitting
  halfway inside it. Measured: with the cat mounted, the hair rides
  measurably further from the cat's head than without the repulsor, and
  the two never interpenetrate at the mesh-box level.
- **Four real bugs caught by verification, none by the compiler:** (1) the
  first hair bake rendered double-sized — the exact skinning math was
  verified against the real renderer until the rigid copy matched the
  skinned original *bit-exactly* (max error 0.000000 across sampled
  vertices); (2) the first cling implementation nudged bones relatively on
  top of a playing clip and the cat slowly tumbled off the back — the same
  mixer gotcha the skier's crouch hit, fixed the same way (absolute
  overwrite from a captured base frame; drift now 8mm over a minute of
  hard driving, which is the breathing, not drift); (3) the first
  cat-repulsor probed the hair's *center* and never fired — the boots
  taught this exact lesson last session (containment lives in the mesh
  extent, not center distances) and probing the hair's closest point fixed
  it; (4) the cat floated off the back at the hips — caught by ASCII
  silhouette reads, closed by flattening the lay until the belly line
  touches the coat.
- Teleport guard: a checkpoint respawn moves the world 30 units in one
  frame — the hair spring explicitly ignores it (no whip on respawn),
  same guard the carve layer needed. `npm run check` (55 tests) and
  `npm run build` pass; the real game boots and runs the slope with zero
  console errors.

**What to playtest:** `npm run dev`, Enter to ski. The headline: does the
cat finally read as *hugging* you — belly on your back, head peeking over
your right shoulder, scarf visible? Watch it through brake → tuck: does it
lie down along your back as you fold? Then watch the hair at speed: does
it trail and swing like hair (brake hard and swerve — does the follow-
through feel right)? Crash on purpose — the hair should whip with the
flop. Press **C** in the bedroom: check a hatted character (does hair
clipping under the hat bother you?) and the bald one. And the taste
question: is the hair's amount of motion right — too floaty, too stiff?

**Playtest verdict (director, 2026-07-22): two issues, parked by the
director's call ("will fix later") — recorded honestly:**

1. **The hair roots float inside the head** — especially during left/right
   turns, making characters look bald from some angles. The roots should be
   welded to the scalp. (Cause: the hair swings as one rigid piece around
   the crown pivot, so a lateral swing translates the roots at the sides of
   the scalp right off the head. The fix needs the swing to *fade in* down
   the hair — roots pinned, tips swinging — details in
   [IDEAS.md](IDEAS.md).)
2. **The cat's tail is stiff** — it should be swooshing, and reacting to
   the wind. (The current tail motion is a slow idle sway; it isn't
   connected to speed or wind at all. The hair spring already knows how to
   do this — the tail wants the same treatment. Details in
   [IDEAS.md](IDEAS.md).)

Both parked in [IDEAS.md](IDEAS.md)'s top block for a later session.

**Next:** remaining round-2 list by director's pick — momentum/pole
push-off (the `/shared` gameplay session), jump anticipation, gear style +
longer skis, always-on feet, angulation round 3 + the boot-containment
fix, or the hair-roots + cat-tail fixes above. Then music (still
deliberately last), then the end-of-M2 tuning pass.

## (bedroom) 2026-07-22 — Bedroom orbit camera: spin the room, zoom in and out

First chunk from the new bedroom session (see [PARALLEL.md](PARALLEL.md) —
two sessions now work the repo in parallel; this one owns the bedroom).
Director's pick: **zoom into and out of the room, spin the room around.**
The fixed Sims-style bird's-eye camera is now an orbit camera — hold
**Q / E** to swing the room around its center, **scroll** to zoom — which
pulls the M3 "rotating bird's-eye camera" note forward. All presentation:
no `/shared` changes, test count stays at 55.

- **The camera orbits the room center** at the same downward tilt as
  before; the opening view is *derived from* the old fixed camera's
  numbers, so the game still opens on exactly the familiar framing —
  rotation and zoom are additions, not a reframing. Zoom is clamped
  (6–20 units out) and multiplicative per wheel notch, so every notch
  changes the view by the same proportion whether close in or far out.
  Both angle and distance are eased, like the character's turn — the room
  swings round rather than teleporting.
- **Walking is now camera-relative.** Spinning the camera 180° would have
  made "up" walk *toward* you — so the walk keys are read in screen
  space, rotated by the camera's current angle into world space, and
  quantized back to the 8-way input `/shared` expects. The shared
  simulation stays camera-ignorant; mid-spin, a held key curves the walk
  naturally as the camera comes round.
- Camera state lives in the renderer handle next to the walk-facing state
  (same reasoning: pure presentation, deliberately not saved — reopening
  the game always starts from the classic view). Wheel input drains every
  frame in both scenes, so scrolling on the slope can't pile up and lurch
  the camera when you get home.
- The bedroom hint bar gains **Q / E · spin room** and **scroll · zoom**
  chips.
- `npm run check` (55 tests) and `npm run build` pass. Verified in the
  live page by driving the real modules (screenshots still frozen —
  sixteenth session running): the opening camera lands on the derived
  (0, 11, 9) exactly; a 1-second held spin settles at exactly 2.0 radians
  with radius and tilt invariant and the camera pointed dead at room
  center (dot 1.000000); 3 wheel notches change distance by exactly
  1.13³; slam-scrolls clamp at 6 and 20; and the *shipped* input-remap
  code (extracted from the served source) passes 11 direction cases —
  identity at the classic view, full flip at 180°, both quarter turns,
  diagonals, negative and wrapped angles. Zero console errors. How the
  spin *feels* (speed, easing, zoom range) is the eyeballs item below.

**What to playtest:** `npm run dev` — in the bedroom, hold **Q** or **E**
to spin the room and scroll to zoom. Does the spin speed feel right for
looking around a small room? Is the zoom range enough at both ends? And
the important one: walk while spinning — "up" should always mean "away
from the camera"; does walking stay intuitive mid-spin, or does the
remapping ever surprise you?

**Playtest verdict (director, 2026-07-22): two things missing** — recorded
and parked in [IDEAS.md](IDEAS.md) for the next bedroom session:

1. **No mouse control** — the camera can't be changed by dragging with the
   mouse; Q/E-plus-scroll is keyboard-only.
2. **No vertical movement** — the downward tilt is fixed; you can't orbit
   the camera up toward overhead or down toward eye level.

**Next (bedroom session):** the camera round 2 (mouse drag + vertical
orbit, details in IDEAS.md), unless the director redirects — real
furniture assets and the bedroom lighting pass are still queued.

## (slope) 2026-07-22 — M2: momentum + pole push-off — runs start from a standstill

Director's pick from the round-2 list: the momentum session — the first
`/shared` gameplay change since M1. Speed is no longer teleported from
input every frame: runs (and every checkpoint respawn) start at a
standstill, and the character visibly double-poles up to cruise speed
before gravity takes over.

- **Speed is inertial now** (`shared/src/skiing.ts`). The lean/boost
  inputs set a *target* speed, and the actual speed eases toward it:
  4 u/s² of push-off/gravity acceleration, 8 under boost, 4 of drag when
  coasting down from a released boost, 10 when braking bites. Getting up
  to speed takes ~2 seconds; losing it is quicker than gaining it — the
  "resistance" the playtest asked for. `createInitialSkiState` starts
  speed at 0, and a crash scrubs your speed too: respawning means pushing
  off again, so momentum lost is a real part of the crash's cost.
- **Speed freezes mid-air.** Airborne there's no snow to push against or
  brake with, so you land carrying exactly your takeoff speed — the same
  reasoning as the audio's mid-air carve hush, now in the sim. Jump slow
  and you'll land slow; hit a chasm without speed and you won't clear it.
- **Steering authority scales with speed.** The old sim steered at full
  rate even at speed 0, which would have let you moonwalk sideways at a
  standstill (and slammed the renderer's carve angle to ±88°). Carving
  comes from the skis biting: no authority at 0, full from MIN_SPEED up.
- **The pole push-off is a real double-pole cycle** (`skierModel.ts` /
  `skiRender.ts`, presentation only). The scene detects "on the snow,
  below cruise, actually gaining" by frame-diffing speed — the same
  pattern as the carve steer — so braking never pumps the arms, and
  passes a push strength that fades out toward cruise speed. On the body:
  both arms reach forward together on the pack's adduction axis with the
  elbows straightening, the poles pivot at the grip to plant tip-forward,
  then arms and poles drive back past the hips while the trunk crunches
  into the stroke (neck countering, eyes downhill) and the body dips into
  each drive. At cruise the whole layer eases out and the poles settle
  back to their rest tilt.
- `/shared` exports gained `BASE_SPEED` (the client fades the push cycle
  against it). No save-shape change — the save layer already clamps speed
  to [0, BOOST_SPEED], so **no SAVE_VERSION bump**; old saves load fine.
- Tests: 55 → 59 (two speed tests rewritten for the momentum model, six
  new: push-off curve, standstill steering, boost ramp, coast-down,
  brake-vs-coast rates, airborne freeze, respawn-at-zero).
- Verified in the live page by driving the real modules on this session's
  own dev server (5302): the sim's curve lands exactly on design (0 → 2 →
  4 → 8 u/s at 0.5/1/2s; boost 8→16 in 1s; coast 16→12 in 1s; brake 10
  u/s²; airborne speed pinned; crash at 20.03; respawn skiing at speed 0).
  On the renderer: during push-off the fists sweep 0.225 units fore-aft
  phase-locked to the pole pivot (correlation 0.93) — pole tip plants
  0.15 *ahead* of the body just off the snow and releases 0.15 *behind*
  with the basket kicked up, measured against the live bones — while the
  feet stay welded to the skis (zero y-variation through the whole cycle);
  at cruise the cycle fades to nothing and the poles settle at exactly
  their 0.7 rest tilt. Crash pause shows no pushes, pushes resume after
  respawn, and outside the (pre-existing) 90° tip-over frames the largest
  frame-to-frame fist step is 19mm — no pops. ASCII silhouette reads at
  the reach and drive extremes show two clearly different arm shapes.
  Fresh page load: game boots to the bedroom with zero console errors.

**What to playtest:** `npm run dev`, Enter to ski — and just wait a beat
at the top. The character should pole-push up to speed over the first
couple of seconds: does the push-off read as *effort* (arms reaching,
poles planting, body dipping into each stroke)? Does earning your speed
make the run's start feel better or just slower? Crash on purpose: does
respawning at a standstill and pushing off again feel like a fair cost or
an annoying one? Then feel the momentum everywhere else: boost ramps in
and coasts out instead of snapping — better? And jump while slow versus
fast: the air now keeps your takeoff speed, so slow jumps land short.
Anything that feels sluggish rather than weighty, say so — the accel
numbers are one-line tunes for the end-of-M2 pass.

**Next:** remaining round-2 list by director's pick — jump anticipation,
gear style + longer skis, always-on feet, angulation round 3 + the
boot-containment fix, or the hair-roots + cat-tail fixes. Then music
(still deliberately last), then the end-of-M2 tuning pass.

## (bedroom) 2026-07-22 — Bedroom camera round 2: mouse drag + vertical tilt

The two things the orbit-camera playtest asked for. **Drag the room with
the mouse** — sideways to spin, up/down to tilt — and the camera can
finally **orbit vertically**, from nearly eye-level (15°, just above where
the low walls would block the view) up to nearly overhead (85°, stopping
short of where the camera math flips). **R / F** tilt from the keyboard,
for parity with Q/E. All presentation: no `/shared` changes, test count
stays at 55.

- **Drags and keys feed the same eased targets**, so the two control
  styles feel identical — only how the target moves differs (keys by hold
  time, drags by pixels traveled). Drag signs follow the grab-the-world
  convention (and three.js's own OrbitControls): drag right pulls the room
  round to the right, drag down tips the view toward overhead. Sensitivity
  is sized so a drag across the window swings the room about a half-turn.
- **Pointer events, not mouse events** — so touch-dragging works the same
  way for free (the M5 web portals run on touch devices). The canvas gets
  `touch-action: none` so a finger drag orbits instead of scrolling the
  page.
- **Any mouse button drags** (an in-session call — IDEAS.md left the
  button choice open): left-drag is the Sims convention players try
  first; right- and middle-drag also work, with the right-click menu
  suppressed on the canvas only. If M3's click-to-interact furniture
  wants left-click to itself later, a click-vs-drag movement threshold
  keeps both.
- Robustness details: one drag at a time (a second finger is ignored);
  the pointer is captured so a drag survives leaving the canvas
  mid-gesture, and capture failing (possible for a pointer that's already
  gone) just means the drag ends at the canvas edge instead of erroring;
  drag pixels accumulate between frames like wheel notches and are
  drained on the slope so they can't pile up and lurch the camera when
  you get home. Elevation joins azimuth/radius in the deliberately-
  unsaved camera state — reopening the game still always starts from the
  classic view, which is also unchanged (the tilt *default* is exactly
  the old fixed angle).
- Housekeeping: the worktree's `.claude/launch.json` gained the
  `toebeans-bedroom` (port 5301) dev-server entry PARALLEL.md already
  referenced — a small additive edit in shared territory; the slope
  session can add its own the same way.
- `npm run check` (55 tests) and `npm run build` pass. Verified in the
  live page on this session's own dev server (screenshots still frozen —
  seventeenth session running): the opening camera still lands on exactly
  (0, 11, 9); a 100px right-drag moves the azimuth target by exactly
  −0.35 rad and eases to it; a 100px down-drag moves elevation by exactly
  +0.35; holding R/F clamps at exactly 85.000°/15.000° with the camera
  height matching the trig at both ends; the camera stays pointed dead at
  room center through everything (dot 1.000000) with radius invariant to
  4 decimals; and the *shipped* drag-handler code (extracted from the
  served source) accumulates exact pixel deltas, ignores second pointers
  and wrong-pointer releases, survives a failed pointer capture, and
  stops accumulating after release. Synthetic pointer events on the real
  canvas run the real handlers with zero console errors. How dragging
  *feels* (sensitivity, tilt range, easing) is the eyeballs item below.

**What to playtest:** `npm run dev` — in the bedroom, **drag the room
around with the mouse**: sideways to spin, up and down to tilt between
nearly-overhead and nearly-eye-level. Try **R / F** for the same tilt on
keys. The feel questions: is the drag sensitivity right (does a natural
hand motion move the room the amount your hand expects)? Is the 15° floor
low enough to feel like "looking into the room" without the walls getting
in the way? Try a drag on a touchscreen/trackpad if you have one handy.
And walking while tilted low — does camera-relative walking still feel
intuitive near eye level?

**Next (bedroom session):** director's pick — real bedroom furniture
assets or the bedroom lighting pass (the room is still ~45% too dark next
to the slope; both queued from earlier verdicts).

## (bedroom) 2026-07-22 — Director call: scrap the bird's-eye view — follow camera inside a complete room

**Playtest verdict on camera round 2, and a redirect:** the director
doesn't like the top-down view *at all* — not the tuning, the whole idea.
The new direction: **play inside a complete room, with the camera
following behind the character.** Scribing session only — no code; this
entry, [DESIGN.md](DESIGN.md), and [IDEAS.md](IDEAS.md) were updated so
the next session starts clean.

- **What this supersedes, honestly:** the two bedroom camera chunks (the
  Q/E orbit and this session's drag + tilt) built out a bird's-eye view
  that is now rejected as the way to see the room. The *substrate*
  largely survives retargeted — the eased-target camera math, the
  pointer-drag plumbing, the camera-relative walk remap — but the
  top-down framing, the see-over-the-walls room, and the orbit-the-room-
  center model are gone. DESIGN.md's camera direction (which came from
  the vision doc) is updated with the director's call; TOEBEANS_VISION.md
  still says bird's-eye and is the director's own file to amend.
- **What the new direction implies** (full sketch in
  [IDEAS.md](IDEAS.md), written for the next session): full-height walls
  and a ceiling (the current 1.2-unit walls exist *only* so a high camera
  sees over them), a follow camera behind the character with the classic
  third-person problems a small room forces (walls behind the camera,
  furniture between camera and character), a room that may need to grow —
  its proportions were tuned for a doll-house view — and the queued
  bedroom lighting pass becoming an *interior* lighting design (a room
  with a ceiling has no skylight; it needs a window and/or lamps, which
  the vision's detail-touches already want anyway).
- The M3 milestone line ("rotating bird's-eye camera") is updated to
  match, and IDEAS.md's superseded orbit entries are annotated rather
  than deleted — the history of why stays readable.

**Next (bedroom session):** build the follow camera + complete room
(sketch in IDEAS.md). This replaces the furniture/lighting queue as the
first order of business — both of those now depend on what the room
becomes.

## (bedroom) 2026-07-22 — The room view rebuilt: follow camera inside a complete room

The bird's-eye view is gone. You now play *inside* the bedroom — full-height
walls, a ceiling overhead, and a camera that rides behind the character and
drifts round to follow wherever you walk. This is the director's redirect
from the last bedroom session, built as one chunk: the room and the camera
interlocked too tightly to split (full walls are pointless from above; a
follow camera is pointless in a doll house).

- **The room is a real interior.** Walls went from the 1.2-unit fence (sized
  to be seen over) to full 2.8-unit walls with a ceiling closing the box.
  The floor plan grew 10×8 → 12×10 — rooms feel much smaller at eye level —
  and the furniture moved flush against the walls, where bedroom furniture
  actually lives; mid-floor boxes read fine from above and as clutter from
  inside. This is the one `/shared` change (`createInitialBedroomState`
  only); static layout isn't saved, so **old saves survive** — positions
  clamp back in on load, no `SAVE_VERSION` bump.
- **The camera is a chase boom** (`bedroomRender.ts`): hung behind the
  character at chest height, eased like everything else in the game. While
  you walk, it drifts round to sit behind your walk direction — but only as
  hard as you're walking *away* from it (walking toward the camera doesn't
  swing it 180° and flip your controls mid-step, the classic chase-camera
  death spiral), and it keeps its hands off for 1.5s after any manual orbit
  so a deliberate look-around isn't fought. **Dragging orbits around the
  character** (same plumbing, sensitivity, and grab-the-world signs as the
  rejected orbit camera — that substrate survived retargeted), **scroll
  zooms the boom** (1.2–6.5), Q/E/R/F still work on the same targets.
- **The small-room problems, handled from day one:** the boom shortens
  instantly against walls and ceiling (inset 0.25, comfortably past the near
  plane) and eases back out when space returns, so backing into a corner
  gives an over-the-shoulder close-up instead of a camera in the void — plus
  a last-resort position clamp so the camera *provably* can't leave the
  room. Furniture can't occlude: every gray-box piece tops out below the
  boom's 1.1-unit origin (the check that tall M3 furniture will need is
  marked in code).
- **Walking stays camera-relative** — the remap from the orbit sessions
  survived unchanged; it just reads the follow camera's yaw now. "Up" is
  always away from the camera, which is exactly what a chase camera wants.
- **Coming home is deterministic:** every scene entry (and game load)
  resets to the same framing — character facing into the room, camera
  behind, squeezed inside the walls if the character stands near one. The
  camera still deliberately isn't saved.
- `npm run check` (59 tests — bedroom tests updated for the new layout) and
  `npm run build` pass. Verified in the live page by driving the real
  modules on this session's own dev server (screenshots still frozen —
  eighteenth session running): the opening camera lands on the exact
  derived numbers (boom wall-clamped to 2.653, camera z at exactly 4.75);
  auto-follow settles within 0.05 rad of dead-behind after 3s of walking;
  walking back toward the camera moves the yaw by only 0.04 (the gate
  holds); a drag mid-walk applies, freezes auto-follow for exactly its
  cooldown, then re-converges; walking backwards into a wall pins the
  camera at exactly the 4.75 bound with the boom on its 0.3 floor; tilt
  clamps at exactly 60° with the camera at exactly the 2.55 ceiling bound;
  3 wheel notches multiply the boom by exactly 1.13³; and a pixel-read of
  a rendered frame shows **zero background-colored pixels** — the room is
  genuinely sealed. Fresh page load: zero console errors.

**What to playtest:** `npm run dev` — you're inside the room now. Walk
around and let the camera drift behind you: does the follow feel like a
companion or a leash (too eager, too lazy)? Drag to look at your
character's face, then walk — the camera should wait a beat before
swinging behind you again. Walk straight at the camera: it holds its
ground and you get a close-up as you pass — does that read okay, or
disorienting? Back into a corner: the close-up squeeze — acceptable? Scroll
both ways for the zoom range. And two known things: **the room is dark**
(the ceiling makes the parked lighting problem worse — the interior
lighting session is next, judge the camera not the gloom), and **the cat
now rides behind you**, permanently off-screen while walking — is that a
problem worth changing its brain for?

**Playtest verdict (director, 2026-07-22): "Looks great."** The rebuilt
room view stands as-is — no follow-ups called on the camera feel, the
squeeze behavior, or the room proportions. The two flagged questions (the
dark room, the cat riding off-screen behind you) weren't ruled on and stay
open in [IDEAS.md](IDEAS.md).

**Next (bedroom session):** the interior lighting design (window + lamps —
now unblocked and urgent, the room reads near-black in places), then real
bedroom furniture assets. Playtest verdicts on the camera feel numbers
(follow rate, cooldown, zoom range) fold into the end-of-M2-style tuning
pass for the bedroom.

## (slope) 2026-07-22 — M2: real turning — the skis point where you steer them, and you can overdo it

Director's pick this session (a new item, not from the parked list): steering
is no longer a sideways slide with a built-in stop. The skis now genuinely
*turn*: holding left/right keeps rotating them — through diagonal, all the
way to fully sideways-across-the-hill, and past it — and nothing straightens
them for you (director call: keep the direction, like real skiing). Turn too
far past sideways and the skier can't hold the edge: they fall over, which
is a normal crash (director call: costs a life, tip-over pause, respawn at
the checkpoint pointing straight downhill).

- `/shared` `skiing.ts`: the run gains a **heading** — which way the skis
  point (0 = downhill, out past sideways). Movement follows it: turned
  halfway, you're carving a diagonal; fully sideways, all your speed goes
  across the hill and none of it down (which also makes hard turning a real
  way to kill your descent — braking by turning now works like it does on
  real snow). Steering authority still builds with speed, and the heading —
  like speed — freezes mid-air: no snow under the skis, nothing to carve
  against. The fall threshold and turn rate are single tunable numbers for
  the end-of-M2 pass.
- **The renderer got simpler.** The visible turn used to be *derived* by
  frame-diffing lateral position, and topped out at 45° of visible body
  turn; now the sim knows the true heading and the body just turns to it —
  the model's existing easing, bank, and angulation all run off the real
  angle. The fall-over reuses the whole crash kit for free: tip-over,
  banner, cat-face fade, crash thump, respawn pluck.
- `shared/src/save.ts`: the heading rides in the save; **SAVE_VERSION
  3 → 4** (bumped after syncing down master, per the parallel-session
  rule), so existing saves are discarded on first load — costs a position
  and a run in progress, same acceptable price as the last two bumps. A
  restored heading past the fall threshold is healed by clamping, so a save
  can never fall over on frame 1.
- Tests 59 → 67: turning keeps accumulating while held; the heading stays
  put when released (and movement keeps following it); mid-air freeze;
  sideways = zero descent; falling over past the threshold costs a life;
  respawning from a fall points you back downhill; riding at exactly
  sideways forever is legal; and a wild saved heading heals to the edge of
  standing.
- `npm run check` (67 tests) and `npm run build` pass. Verified in the live
  page by driving the real served modules on this session's own dev server
  (5302): heading accumulates at exactly the design turn rate and falls
  over at exactly the threshold (9 → 8 lives, 1.5s pause), holds bit-exact
  when the key is released and while airborne, respawns at the checkpoint
  pointing downhill at speed 0, and the save round-trips a mid-turn heading
  while healing a tipped-over one. On the renderer, with the character
  actually loaded: the body settles at *exactly* the sim's heading (−1.2
  local yaw at a 1.2 heading — the old derivation would have shown ~0.45),
  banks 0.46 into it, and eases back upright during the crash tip-over.
  Fresh page load: the old v3 save is discarded, a clean v4 save is
  written, zero console errors.

**What to playtest:** `npm run dev`, Enter to ski. Hold a steer key and
*keep holding it*: the skis should swing through diagonal to fully sideways
— watch your downhill speed die as they do — and then tip you over if you
push past it. Release mid-turn: you should keep going the way you pointed
until you steer back. The feel questions: is the turn rate right (too
twitchy, too slow)? Is the margin past sideways before falling fair, or
does it feel like a cheap shot? Does braking-by-turning feel like a real
technique worth using alongside the down-key brake? And does needing to
steer *back* make the slope more engaging or just more work?

**Playtest verdict (director, 2026-07-22): three issues** — recorded and
parked in [IDEAS.md](IDEAS.md)'s top block with cause analysis:

1. **Can't spin or change direction mid-air** — the heading freeze while
   airborne (this session's deliberate mirror of the speed freeze) reads
   as a limitation, not physics; jumps should allow spinning/re-aiming.
2. **The fall animation doesn't match the direction you fell** — the
   tip-over is one fixed sideways rotation whatever actually killed you.
3. **The turn rate is too slow** — `TURN_RATE` is a one-line tune,
   director-called, so it's sanctioned to change with the fixes above
   rather than waiting for the end-of-M2 tuning pass.

**Next:** turning round 2 (the three items above, sketched in IDEAS.md)
unless the director redirects — then the remaining round-2 list (jump
anticipation, gear style + longer skis, always-on feet, angulation round 3
+ the boot-containment fix, hair-roots + cat-tail), then music (still
deliberately last), then the end-of-M2 tuning pass.

## (bedroom) 2026-07-22 — Interior lighting: a window, the dawn outside, and warm lamps

The room is no longer lit from nowhere in particular. It now has the same
morning the slope does: a window in the north wall with the dawn sun
pouring through it onto the floor, the slope's pink-and-blue sky visible
outside, and three warm lamps pooling against the cool daylight. This was
the "unblocked and urgent" item from the room rebuild — the ceiling had
made the gray-box lights read near-black in places. All rendering
(`bedroomRender.ts`); no `/shared` changes, test count stays at 67.

- **The lighting math is the slope's, on purpose.** Same two-constraint
  derivation from the bible's snow colors: the walls are painted sunlit
  snow (a warm off-white), the ambient is derived so any surface the sun
  can't reach renders *exactly* snow-shadow blue — "shadows are soft
  blue, never black" by construction — and the sun color follows from
  ambient + sun rendering full albedo. Same ×π physical-lights
  convention too, which by itself closes the parked "room renders ~45%
  too dark" issue from the cat-model session. The sun *direction* is
  also the slope's exact vector — one world, one dawn, and it's what
  makes the north wall the right wall for a window.
- **Sunlight only enters through the window.** The north wall is built
  from segments around a real opening (sill 1.0, head 2.4, in the clear
  stretch between bed and dresser), everything casts shadows, and the
  sun's shadow map does the rest: a bright warm patch on the wooden
  floor, crossed by the shadow of the window frame's mullions. Stand in
  it and you cast a shadow too.
- **Out the window: the slope's world.** An unlit vertex-colored
  backdrop beyond the wall — snow to a dawn-pink horizon melting into
  sky blue, the same three palette colors the ski scene's fog and dome
  use. It deliberately casts no shadow (it would block the very sun it
  depicts). Look up from near the window and you get pure sky.
- **Three warm lamps** (the vision's detail-touches want glowing lamps):
  a pendant over the room's center — hung so its lowest point clears the
  camera's ceiling clamp, so the boom can never clip it — plus small
  lamps on the dresser and desk. Sun-glow bulbs under birch-bark shades,
  warm point lights, no lamp shadows (a soft shadowless fill is what
  lamp light feels like, and point-light shadow maps cost six faces
  each). The lamps are cozy warmth *on top of* the daylight, not what
  keeps the room visible.
- **The floor went wood** (birch bark — the bible's pale-wood color);
  walls and ceiling wear the albedo the math is derived against. The
  gray-box furniture stays gray — it's placeholder, and the real
  furniture session should decide its colors.
- `npm run check` (67 tests) and `npm run build` pass. Verified in the
  live page by driving the real modules on this session's own dev server
  and reading pixels back (screenshots still frozen — nineteenth
  session): an ambient-only wall renders the derivation's prediction
  *exactly* (217,228,242 — snow-shadow blue plus the pendant's faint
  warmth), the sun patch and shadowed floor match their oracles within
  1/255, the backdrop's pink horizon and sky rows hit their palette
  hexes exactly, the pendant bulb reads #FFF4DA exactly, the mullion
  cross-shadow is measurable on the floor, the character standing in the
  patch darkens it by a measured 30/255, and an 11-pose sweep (including
  through-window views) found **zero** background-sentinel pixels — the
  room is still sealed, now with a hole in the wall. Zero console errors
  on a fresh boot. One verification wrinkle worth recording: the first
  "character casts no shadow" result was a false alarm — a bare
  `createSkierRig()` loads no character until `setAppearance` is called
  (the game always calls it; the test harness hadn't).

**What to playtest:** `npm run dev` — the room should finally feel like
a bright morning indoors. Walk into the sun patch; watch your shadow.
Look out the window from a few angles — does the outside read as *the
slope's world*, and does looking up at the sky feel right? Are the lamps
warm enough to register next to the daylight, or do they need to matter
more? Does the blue-shadow-plus-warm-lamp mix read cozy or cold
anywhere? And check the cat at home — it should finally be its real
amber indoors, not mud.

**Playtest verdict (director, 2026-07-22): the light lands.** "I really
like the shadow and the light from the window." Two notes, both parked
in [IDEAS.md](IDEAS.md):

1. **The lamp shapes aren't right** — fine to fix when the room gets
   real assets; folded into the furniture-assets session rather than
   nibbled at now.
2. **New direction (eventually): a front door.** Exiting through it
   leads to *choosing which slope to race*, and coming home, the slope
   you picked is the one visible outside the window. Not a now-item —
   sketched in IDEAS.md with what it touches.

**Next (bedroom session):** real bedroom furniture assets (the last big
gray-box item in the room; includes the lamp restyle), unless the
director redirects. The lamp positions are keyed to the gray-box
furniture tops and move with whatever the furniture session builds.

## (slope) 2026-07-22 — M2: turning round 2 — air spins, directional falls, faster turning

The three items from the real-turning playtest, in one session. Jumps are
now a place for style: steering works mid-air at a much faster spin rate —
fast enough to fit a full 360 inside a jump — and the crash tip-over
finally falls the way you actually fell.

- **Air spinning** (`shared/src/skiing.ts`): the airborne heading freeze is
  gone. In the air the skis have nothing to bite, so spinning runs at
  9 rad/s (vs 1.8 carving on snow) at full authority whatever your speed —
  even a standstill hop can spin. A jump's ~0.78s of air fits a full 360
  with margin.
- **Two design defaults went in un-ratified** (the questions were asked but
  not answered this session — both are one-line flips, flag at playtest):
  **(a) full 360° spins are a legal trick** — landing collapses the
  accumulated heading to its nearest downhill-equivalent (new exported
  `downhillHeading()`), so a completed spin lands clean and a half spin
  lands pointing backward; **(b) an over-rotated landing crashes on the
  first grounded frame** — a botched landing is a fall, no grace window.
- **The fall matches the fall** (`skiRender.ts`, renderer-only): over-
  rotating right tips you right, left tips left, and a chasm crash reads as
  a forward drop instead of the old fixed sideways flop. The tip is now
  animated too — an accelerating topple over the first 0.35s of the crash
  pause (the respawn timer doubles as the clock; a forfeit holds fully
  tipped). And the body keeps its steer through the pause: the renderer
  used to zero it the moment status ≠ "skiing", which visibly unwound the
  turn while tipping.
- **Turn rate 1.2 → 1.8 rad/s** (director-sanctioned tune) with
  `FALL_HEADING` retuned 2.0 → 2.2 alongside it, keeping the margin-of-
  error window past sideways at the same ~0.35s it was before the speedup.
- **A landed spin can't unwind the body**: the model's steer easing now
  shifts by whole turns first (a 2π jump is visually identity), so when
  the sim collapses a landed 360 the body settles instead of visibly
  spinning a full rotation backward.
- `shared/src/save.ts`: a saved heading now heals by collapsing to its
  downhill-equivalent before clamping (a save taken mid-air mid-spin can
  carry whole turns). No save-shape change, so **no SAVE_VERSION bump** —
  old saves load fine.
- Housekeeping: the worktree's `.claude/launch.json` gained the
  `toebeans-slope` (port 5302) dev-server entry PARALLEL.md references,
  mirroring the bedroom session's addition.
- Tests 67 → 71 (the mid-air-freeze test now asserts the opposite: air
  spins beat ground carving; plus standstill hop spin, a completed spin
  landing clean and collapsed, an over-rotated landing crashing on the
  first grounded frame, and a mid-spin save healing to its equivalent).
- `npm run check` (71 tests) and `npm run build` pass. Verified in the
  live page by driving the real served modules on this session's own dev
  server (5302): ground turn measures exactly 1.8 rad/s and air exactly
  9, a real jump gives 0.783s of air and a held spin reaches 7.05 rad
  (> 2π) then lands clean, collapsed to 0.767; a half-spin landing is
  legal while airborne and crashes on the first grounded frame (9 → 8
  lives); the tip animates quadratically to exactly −π/2 for a rightward
  fall, +π/2 leftward, forward −π/2 for a chasm, holds through forfeit,
  and snaps upright on respawn; the body's carve node holds exactly −2.3
  through a crash pause (the old code eased it to 0); and a landed 360's
  visual jump measures 0.0000 mod a full turn — no backward unwind. Zero
  console errors throughout. What a spin *looks and feels* like at speed
  is the eyeballs item below.

**What to playtest:** `npm run dev`, Enter to ski. Jump and hold a steer
key: you should whip around in the air — try to land a full 360 (land
clean) and a half-spin (should crash you the moment you touch down). Does
spinning feel like style or like chaos? Is 9 rad/s the right spin rate —
can you control a re-aim, or is it all-or-nothing? Crash each way on
purpose: over-turn left, over-turn right, and ski into a chasm — does each
tip-over now read as *that* fall? Is the faster ground turning (1.8) right,
or still too slow? And the two defaults to ratify: should full 360s stay a
legal trick, and should an over-rotated landing crash instantly (or get a
brief grace window to steer back)?

**Playtest verdict (director, 2026-07-22): one problem** — the air spin
rate is way faster than the ground rate, so jumping while already holding
a steer key whips you into an accidental 360. The rate was sized so a
full spin fits inside a jump, but it applies to the same held key that
was gently carving at takeoff — a routine jump-while-turning becomes an
unwanted trick. Parked in [IDEAS.md](IDEAS.md)'s top block with three fix
options (held-key-doesn't-spin / ramp the air rate in / dedicated trick
input). The two un-ratified design defaults (spins legal via downhill-
equivalence, crash-on-first-grounded-frame) stand until called.

**Next:** air spin round 2 (the held-steer fix above, director's pick of
option) unless the director redirects — then the remaining round-2 list
(jump anticipation, gear style + longer skis, always-on feet, angulation
round 3 + the boot-containment fix, hair-roots + cat-tail), then music
(still deliberately last), then the end-of-M2 tuning pass.

## (slope) 2026-07-22 — M2: air spin round 2 — a held key carves, a fresh press spins

The accidental 360 is fixed. Director's pick from the three parked options:
**(a) a held key doesn't spin — a fresh press does.** Steer keys already
down when the skis leave the snow keep adjusting your line at the normal
carving rate (1.8 rad/s), exactly as they were a frame earlier; only a key
pressed *fresh* in the air gets the 9 rad/s trick spin. Jumping mid-carve
is routine again, and a spin is always something you asked for.

- `/shared` `skiing.ts`: the ski state gains two booleans — which steer
  keys have been held continuously since takeoff. While grounded they
  simply track the keys, so the takeoff frame captures exactly what was
  held as the snow fell away; airborne they can only decay, so releasing
  a key mid-air makes its next press fresh (release-and-re-press *is* the
  trick input — you can carve into a jump, let go, and then call a spin
  in the same airtime). A held key's air steering uses the same
  speed-scaled authority as the ground, so it's continuous through
  takeoff; a fresh press spins at full authority even from a standstill
  hop, as before. Crash respawns clear both flags.
- **No SAVE_VERSION bump.** The new fields are transient air-only state
  and deliberately not saved — `restoreSave` spreads them in as `false`,
  which is semantically right: reloading drops the physical keyboard
  state anyway, so any key after a restore *is* a fresh press.
- The two design defaults from turning round 2 (full 360s legal via
  downhill-equivalence, over-rotated landings crash on the first grounded
  frame) are untouched and still await ratify-or-change.
- Tests 71 → 74: identical airborne skiers differing only in the flag
  steer at 2×-different rates; the exact playtest scenario (carve right,
  jump, hold through the whole jump) gains only a modest line adjustment
  and lands clean with all 9 lives; and a mid-air release-then-re-press
  spins at the fast rate.
- `npm run check` (74 tests) and `npm run build` pass. Verified against
  the real served modules in the live page (this session's port 5302 was
  held by an older chat's server for the same folder, so verification ran
  through it — same live source): ground carve measures exactly 1.8
  rad/s, held-since-takeoff air steering exactly 1.8, fresh press exactly
  9; the jump-while-carving case captures the flag on the takeoff frame,
  gains 1.404 rad over its 0.78s of air (= 1.8 × 0.78, nowhere near 2π),
  and lands clean at 9 lives; release mid-air clears the flag and the
  re-press measures exactly 9 rad/s. Fresh page load: zero console
  errors.

**What to playtest:** `npm run dev`, Enter to ski. Jump while already
holding a steer key — the thing that used to whip you around: you should
drift your line a little and land clean, no surprise 360. Then do a
deliberate trick: jump, *release*, and press a steer key fresh mid-air —
the fast spin should still be all there (360s land clean, half-spins
still crash). Does the distinction feel natural, or do you find yourself
wanting to spin off a held key sometimes? And the two standing defaults
to ratify whenever: 360s as a legal trick, and over-rotated landings
crashing instantly vs a brief grace window.

**Next:** the remaining round-2 list (jump anticipation, gear style +
longer skis, always-on feet, angulation round 3 + the boot-containment
fix, hair-roots + cat-tail) unless the director redirects — then music
(still deliberately last), then the end-of-M2 tuning pass.

## Milestones

Tracking toward the v1.0 web launch scope in
[DESIGN.md](DESIGN.md#scope-v10--v1x--steam). Check items off as sessions
land them; each session still gets its own dated log entry above.

### M1 — Prototype (gray-box, "is this fun?" gate)

- [x] Character moves around a gray-box bedroom
- [x] Basic cat follows/sits in the room
- [x] One gray-box ski slope: movement, controls, one hazard type
- [x] Cat's 9 lives + crash/checkpoint loop
- [x] Fun check: does the ski loop feel good before investing in art?
      *(PASS, barely — 2026-07-21; feel tuning stays live through M2)*

### M2 — Vertical slice (director's "phase 3": polish one area for real)

Per the director (2026-07-21): take **one area of the game** — bedroom or
ski slope — and polish it end to end, so one part of Toebeans looks and
sounds like the real game.

- [x] Pick the area to polish (bedroom or slope) — first decision of the
      phase *(slope — director call, 2026-07-21)*
- [ ] Real (non-gray-box) assets for that area, in the *Omno*-target
      low-poly style *(slope-side trees/rocks in 2026-07-21; the cat is a
      real rigged model as of 2026-07-21; the **character** is now a
      pickable, chunky, customizable roster of 11 from Quaternius's Ultimate
      Animated Character Pack as of 2026-07-21 — this replaced the two
      rejected realistic bases and settled the art-style-match question.
      The ski pose + skis/boots/poles landed 2026-07-22, with the crouch
      driven by the lean input. Slope surface detail and hazard art are
      still gray-box)*
- [x] Lighting pass for that area *(2026-07-21 — sun, palette-exact blue
      shadows, dawn-pink haze, visible sun disc)*
- [x] Real UI (replace the plain-text HUD overlay) *(2026-07-21 —
      cat-face lives, crash/forfeit banners, keycap hints; title screen
      still open, parked in IDEAS.md)*
- [ ] Sound for that area (music + effects) *(effects in 2026-07-21,
      synthesized and playtest-passed; music: timed per-slope songs à la
      Geometry Dash — director call 2026-07-21, see IDEAS.md — built
      **last** in M2, after everything else)*
- [x] UI tone restyle to the middle-ground direction *(2026-07-21 — pills →
      soft rectangles, hairline borders, semi-bold type; cat faces untouched)*
- [x] Save/load (browser storage) *(2026-07-21 — dynamic-state-only JSON
      snapshot; static layout reloads from code; strict, self-healing
      decode; autosave + save-on-close)*
- [ ] Ongoing: feel tuning as polish exposes rough edges *(director call,
      2026-07-21: picky visual tweaks wait until all M2 items land, then
      one tuning pass)*

### M3 — Content

Includes the vertical-slice systems that weren't part of the M2 area:

- [ ] The other area (bedroom or slope) brought to the same polish level
      — for the bedroom that now means the complete room + follow camera
      (director call, 2026-07-22 — replaced the rotating bird's-eye view;
      *room + camera landed 2026-07-22; interior lighting (window, dawn
      backdrop, lamps) landed 2026-07-22 — real furniture still open*)
- [ ] Furniture placement system (place/move/store)
- [ ] One timed-task item and one passive/AFK item working end to end
- [ ] XP and leveling wired to unlocks
- [ ] All 3 v1.0 slopes built
- [ ] Full 6–8 item furniture/appliance set
- [ ] Character + cat customization options
- [ ] All level-gated unlocks wired up
- [ ] 24-hour offline XP catch-up implemented

### M4 — Polish

- [ ] Audio: music + ambient sound across the rest of the game (the M2
      area gets its sound in M2)
- [ ] Detail touches (ski trails, lamp glow, fireplace crackle, meows)
- [ ] Performance pass: 60fps on a mid laptop
- [ ] Load-size pass: under 15MB initial load
- [ ] Playtest pass on the full loop, fix rough edges

### M5 — Web launch

- [ ] Deployed to itch.io
- [ ] Steam store page live (wishlist accumulation starts; not the game
      itself — that's the Steam-version phase)
- [ ] Submitted to web portals (Poki/CrazyGames or similar)
