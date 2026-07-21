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

## Milestones

Tracking toward the v1.0 web launch scope in
[DESIGN.md](DESIGN.md#scope-v10--v1x--steam). Check items off as sessions
land them; each session still gets its own dated log entry above.

### M1 — Prototype (gray-box, "is this fun?" gate)

- [x] Character moves around a gray-box bedroom
- [x] Basic cat follows/sits in the room
- [x] One gray-box ski slope: movement, controls, one hazard type
- [x] Cat's 9 lives + crash/checkpoint loop
- [ ] Fun check: does the ski loop feel good before investing in art?

### M2 — Vertical slice

- [ ] Real (non-gray-box) bedroom environment with rotating camera
- [ ] Furniture placement system (place/move/store)
- [ ] One timed-task item and one passive/AFK item working end to end
- [ ] XP and leveling wired to a single unlock
- [ ] One polished ski slope with all hazard types + checkpoints
- [ ] Save system (browser storage)

### M3 — Content

- [ ] All 3 v1.0 slopes built
- [ ] Full 6–8 item furniture/appliance set
- [ ] Character + cat customization options
- [ ] All level-gated unlocks wired up
- [ ] 24-hour offline XP catch-up implemented

### M4 — Polish

- [ ] Audio: music + ambient sound hooked up
- [ ] Detail touches (ski trails, lamp glow, fireplace crackle, meows)
- [ ] Performance pass: 60fps on a mid laptop
- [ ] Load-size pass: under 15MB initial load
- [ ] Playtest pass on the full loop, fix rough edges

### M5 — Web launch

- [ ] Deployed to itch.io
- [ ] Steam store page live (wishlist accumulation starts; not the game
      itself — that's the Steam-version phase)
- [ ] Submitted to web portals (Poki/CrazyGames or similar)
