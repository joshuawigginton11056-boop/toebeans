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
      low-poly style *(slope-side trees/rocks in — characters, slope
      surface detail, and hazard art still gray-box)*
- [x] Lighting pass for that area *(2026-07-21 — sun, palette-exact blue
      shadows, dawn-pink haze, visible sun disc)*
- [x] Real UI (replace the plain-text HUD overlay) *(2026-07-21 —
      cat-face lives, crash/forfeit banners, keycap hints; title screen
      still open, parked in IDEAS.md)*
- [ ] Sound for that area (music + effects) *(effects in 2026-07-21,
      synthesized; music direction decided after the director hears them)*
- [ ] UI tone restyle to the middle-ground direction *(added 2026-07-21 —
      director call from the ratify pass; cat faces stay, panels calm down)*
- [ ] Save/load (browser storage)
- [ ] Ongoing: feel tuning as polish exposes rough edges *(director call,
      2026-07-21: picky visual tweaks wait until all M2 items land, then
      one tuning pass)*

### M3 — Content

Includes the vertical-slice systems that weren't part of the M2 area:

- [ ] The other area (bedroom or slope) brought to the same polish level
      — incl. the rotating bird's-eye camera if that area is the bedroom
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
