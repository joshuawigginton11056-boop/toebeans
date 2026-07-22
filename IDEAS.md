# Ideas

Parked ideas and observations — not commitments. Per CLAUDE.md, tangents
land here instead of in code.

## (slope-mech) Turning round 6: sideways should scrub momentum — the stance flip jerks (playtest, 2026-07-22)

**The verdict (director, on round 5):** "Momentum should be lost if the
skis are sideways. Instead, it's jerking backwards while it should still
be sliding downhill. Sometimes it starts to go in reverse and then jerks
forward again." The round-5 stance flip fails playtest. (The other half
of round 5 — boost turning 1.4× harder — wasn't flagged and stands.)

**The new bar:** turning the skis sideways at speed *bleeds* the speed,
hard — a skid, like a real hockey stop. Sliding downhill continues while
the skis pivot; no phase of uphill travel (the round-5 bar that still
holds); and no jerk in either direction at the sideways moment.

**Why round 5 jerks** (`shared/src/skiing.ts`):

1. **The backwards jerk is the flip's lateral mirror.** Travel is
   constrained to the ski axis, so at the ±π/2 crossing the only way to
   keep the downhill component non-negative is to mirror the sideways
   component — measured +13.6 → −13.5 u/s lateral *in one frame*. The
   round-5 entry flagged this as the headline feel question ("edge bite
   or snap?"); the answer is snap.
2. **The reverse-then-forward jerk is the flip re-firing.** Steering
   that wiggles across ±π/2 flips the stance on every crossing, and the
   flip carries full magnitude each time — visible direction reversals
   back to back.
3. **The root enabler: nothing scrubs speed near sideways.** The cosine
   projection collapses the *target* to ~0 at sideways, but the decay
   toward it runs at `COAST_DRAG` (4 u/s²) — so a boosted pivot arrives
   at the crossing still carrying ~13.5 u/s for the flip to mirror. If
   the magnitude were small there, both jerks would be invisible.

**Fix options for the build session (director picks):**

1. **Skid scrub toward sideways** *(probably recommended — it is
   literally the director's sentence)*: the speed-loss rate scales with
   how far the skis are turned off the fall line — aligned coasting
   stays `COAST_DRAG` (4), ramping toward a hard scrub at full sideways
   (~`BRAKE_DECEL` 10, maybe 12–15; tune on the hill). Turning sideways
   then dumps momentum by itself: a boosted pivot reaches the crossing
   at a walking pace, the stance flip (kept, as the never-uphill
   guarantee) fires at near-zero magnitude, and both jerks dissolve
   without special-casing the crossing. Side effects, both deliberate:
   hockey stops get much quicker (today a sideways stop from boost
   takes ~4s), and the round-5 "W+Shift recovery carries your speed
   through the pivot" nicety goes away — a turnaround now passes
   through a slow point and rebuilds via `BOOST_ACCEL`, which is
   exactly the director's physics.
2. **Scrub at the crossing only**: replace the flip's magnitude-carry
   with a dump to ~0 right at ±π/2. Smaller patch, kills both jerks —
   but a boosted skier could still *hold* near-sideways at 13+ u/s, so
   "momentum lost when sideways" would only be true at the crossing
   itself, not on the approach. The model stays half-wrong.
3. **Hysteresis on the flip** (composes with either, if re-fire jitter
   somehow survives): the stance only flips once the heading is a small
   band (~0.1 rad) past ±π/2, so dithering on the boundary can't
   flip-flop. Probably unnecessary once the magnitude at the crossing
   is small.

**Tests that must change if 1 lands:** the round-5 tests pin the
magnitude-carry that is now wrong — "carries its magnitude through the
stance flip" and the bar test's riding-switch-at-boost-speed ending
(`speed < -MAX_SPEED`) must be rewritten to assert the scrub instead
(the pivot ends *slow*, then rebuilds). The frame-by-frame never-uphill
assertion stays exactly as is. The hockey-stop and below-epsilon tests
should survive; "bleeds to a stop held fully sideways" will just
converge faster.

**Current state until round 6 lands:** round 5 is merged to master, so
the jerky crossing is what's live.

## (bedroom) Where does the progression loop live now? (parked by director call, 2026-07-22)

The walkable bedroom is scrapped — the game opens on a **menu-style lobby**
(see ROADMAP, lobby session). That leaves the earn-your-furniture direction
(bare start → XP → furniture unlocks → decorate) without a stage, and the
director's call was explicitly **"decide later"**. Options when it's
picked up: transplant decorating to the lobby vignette (the diorama gains
earned props), bring a walkable home back as a *later* environment unlock
(the vision doc's bedroom → apartment → skyrise ladder starts one rung
up), or rethink progression around slope/character/cat unlocks only. The
`assets/bedroom/` furniture models and their CREDITS rows stay in the repo
as the unlock pool for whichever wins. DESIGN.md carries matching ⚠ notes
(Leveling & Unlocks, v1.0 scope).

## (slope) AudioMode still says "bedroom" for the quiet scene

`client/src/audio.ts` (slope territory) types its mode as
`"bedroom" | "slope"`; the bedroom is now the lobby, and `main.ts` maps at
the call site (`mode === "slope" ? "slope" : "bedroom"`). Behavior is
identical — the quiet scene silences all layers either way. Whenever
convenient, rename the type's `"bedroom"` to `"lobby"` and the call-site
adapter in `main.ts` (shared territory) can drop to a straight
pass-through.

## (bedroom) Lobby polish candidates (noticed building it, 2026-07-22)

Not built, deliberately — the session was the replacement itself:

- **Sound in the lobby**: it's silent (the slope keeps its effects). A soft
  wind bed or a purr when the cat sits would be cheap wins; music belongs
  to the M2 music session's direction.
- **A "pet the cat" click** on the vignette — pure charm, one raycast.
- **Character cycling animation**: swapping models is a hard cut; a quick
  turn-away/turn-back would sell it.
- The bundled rounded display font (Fredoka/Baloo) parked below would suit
  the title lettering especially — still needs the director yes/no.

## (slope) ~~Open up the skiable area~~ — BUILT 2026-07-22

**(BUILT 2026-07-22 — see ROADMAP. `LATERAL_LIMIT` 4 → 12 (a 24-unit
skiable width, 3× the old lane). Edge behavior: director call, keep the
hard clamp — the treeline hugging the new edge is the visible cue; the
berm and impassable-treeline options were offered and passed on. The
visual lane, chasm/checkpoint spans, and decor scatter now all derive
from `LATERAL_LIMIT` instead of a parallel hardcoded width; snowfield
plane and shadow frustum widened to cover. No SAVE_VERSION bump — the
position heal just clamps wider, as the sketch predicted.)**

Round-4 playtest: turning passes ("looks good"), and the follow-on call
is that **the lane is too narrow to really test it** — real turning
wants real width for carving lines, hockey stops, and switch riding.
Written for the next slope session; the width numbers are the session's
tuning calls, but what it touches is known:

- **`LATERAL_LIMIT`** (shared/src/skiing.ts, currently 4 — an 8-unit
  lane): the one-line core. It's exported and used by `save.ts` for the
  position heal, which just clamps — a wider limit heals fine, **no
  SAVE_VERSION bump**.
- **Decide the edge behavior while in there:** today the edge is a hard
  invisible-wall clamp, which reads worse the wider and more open the
  area gets. Options: keep the clamp (cheapest), soft snow berm that
  bleeds speed, or terrain that visibly ends (a treeline you can't ski
  through). Whatever's picked, the edge should be *visible* once the
  lane is wide — right now the flanking decor is the only cue.
- **Decor scatter** (client/src/skiRender.ts): trees/rocks scatter from
  the lane edge outward with a seeded layout ("nothing ever inside the
  lane") — the scatter bounds are keyed to the lane width and need
  re-tuning so the open area doesn't go empty-vast or the treeline
  doesn't sit miles away.
- **Checkpoint stripes and chasms** span the lane visually; chasm gaps
  are lateral-independent in the sim (start/width along distance), so a
  wider lane makes chasms *longer* obstacles side to side — fine for
  testing turning, but worth an eyeball on whether full-width gaps
  still read fair when there's room to route around... (they can't be
  routed around — that may itself be the point to check).
- **Camera/haze sanity:** the follow camera, sun + shadow-camera
  follow, and the snowfield plane all track the skier already; the
  shadow camera's frustum and the fog distances were tuned against a
  narrow lane and should get a look at the new width.

## (slope) ~~Turning round 4~~ — BUILT 2026-07-22 (W means "downhill")

**(BUILT 2026-07-22 — see ROADMAP. Option 1, director-picked: while W is
held the heading eases toward the fall line at the normal turn rate
through the same authority system — implemented as a target the heading
eases toward (0 alone; a ±45° carve diagonal with a steer key, so W+A/D
holds a stable diagonal instead of fighting the steer to a draw).
Shortest-way-around falls out of easing toward the nearest equivalent
angle — which is also the drift side — and exactly-backwards tie-breaks
to a right turn. Works mid-air too (one steering system; flight stays
ballistic). Left/right alone unchanged; S stays a pure brake; no
SAVE_VERSION bump. The renderer un-twist came free as predicted — the
over-shoulder look is eased with a deadband at the speed zero-crossing.)**

Verdict on turning round 3: **turning around feels good; turning back
around is clunky and not intuitive.** Holding W just continues in the
direction of travel — riding switch, W accelerates you *backward* — and
the director's bar is explicit: **you should be able to turn backwards
and return forward without ever letting off W.**

Cause: after round 3, heading is steered exclusively by left/right, and
W/S only scale the speed magnitude along the ski axis (projected by
cos(heading)). No input means "downhill" as a *direction*, so escaping
switch requires a deliberate left/right pivot — mechanically fine,
intuitively wrong: W reads as "go down the slope," not "more of whatever
the skis are doing."

Fix options for the build session (director picks):

1. **W seeks the fall line** *(probably recommended)*: while W is held,
   the heading also eases toward 0 at the normal carve turn rate — the
   shortest way around — on top of its speed-up meaning. One key, one
   intent: "downhill, faster." Left/right still add on top, so W+A/D
   carves a diagonal and a bare W always comes home to straight running,
   from any stance, without releasing. S stays a pure brake (it already
   reads correctly in switch: it slows you whatever end leads).
2. **Switch-only variant**: W pivots you back only when past sideways
   (|heading| > π/2), otherwise it's today's pure speed lean. Smaller
   change, but it puts a behavior seam at exactly sideways, and W would
   *still* do nothing directional at a 89° carve — the intuition gap
   just moves.
3. **Full screen-relative steering** (the bedroom's camera-relative walk,
   on snow): keys stop being ski-relative entirely and steer the desired
   travel direction; the sim derives heading. Biggest rework, changes the
   feel of everything that already passed playtest — only if 1 doesn't
   land.

Details option 1 must settle: the tie-break at exactly backwards (±π —
suggest: turn toward the side of your current lateral drift, else
right); whether W's pivot uses the same speed-scaled authority + 40%
standstill floor as manual steering (suggest: yes, one steering system);
and whether the heading collapse toward 0 also un-twists the renderer's
over-shoulder look smoothly (it should — the look keys off the speed
sign, which flips through the same continuous pivot).

## (bedroom) ~~Earn-your-furniture: bare rundown start, XP unlocks, unlock-tree UI~~ — SUPERSEDED 2026-07-22 (bedroom scrapped)

**(SUPERSEDED 2026-07-22, lobby session: the walkable bedroom is gone, so
this direction has no stage. The progression question is deliberately
parked — see "Where does the progression loop live now?" at the top of
this file. The furniture models stay as the unlock pool.)** Original entry
kept for the reasoning:

Director redirect at the furniture playtest — three connected calls, now
recorded in [DESIGN.md](DESIGN.md#leveling--unlocks):

1. **Don't start with furniture — a bare mattress at most.** The pieces
   built this session become the *unlock pool*, not the starting room.
2. **XP comes from races**; furniture and decoration arrive via level
   unlocks (this is the vision doc's loop, now concretely scoped to the
   bedroom's starting state).
3. **An unlocks-by-level UI** showing furniture/decoration unlocks per
   level — added to v1.0 scope.

What it touches when built: `/shared` needs owned/placed furniture in
state (and the save — SAVE_VERSION bump), `createInitialBedroomState`
loses its furnished layout, the renderer's FURNITURE map keys off owned
items, XP/leveling itself lands (M3), and hud.ts (or a real screen) gets
the unlock tree. Open question for the director: does the *house itself*
also upgrade with levels (rundown → renovated — see the next entry), or
only its contents?

## (bedroom) ~~Rundown house + the no-texture rule challenged~~ — texture half RESOLVED 2026-07-22 (direction session)

**(RESOLVED 2026-07-22, restructure/direction session: the director called
it — *Omno* stays the reference target, and texture happens within it via
**both** option (a) stylized painted textures and option (b) procedural
surface detail, with palette discipline kept. Recorded in the Art Style
Bible's "in transition" note in
[DESIGN.md → Art Style Bible](DESIGN.md#art-style-bible), which now
governs. First build slice: a side-by-side tree + snow test on the real
slope, slope-visuals session. The rundown-*house* half remains superseded —
no stage until the parked progression question lands.)** Original entry:

Two art calls from the same playtest, recorded together because the
second decides how the first can be built:

1. **The starting house should be rundown** — shaggy *stained* carpet,
   *peeling* wallpaper. (Fits the earn-your-furniture fantasy: a
   fixer-upper you renovate through play — whether renovation is itself
   an unlock track is the open question flagged above.)
2. **"I don't like the flat graphics. And there's no texture."** This
   challenges the Art Style Bible's core no-textures/flat-shaded rule —
   see the ⚠ under-review note now at the top of
   [DESIGN.md → Art Style Bible](DESIGN.md#art-style-bible). Note the
   rundown ask *requires* texture: stains and peeling are surface
   detail flat vertex colors can't say.

**This is game-wide** (slope session: don't invest in new flat-shaded
assets without checking here first). Options for the direction session,
roughly by cost: (a) stylized painted/hand-drawn textures on the
existing low-poly geometry (Quaternius packs have textured variants in
some lines; CC0 texture sources exist — ambientCG, Polyhaven); (b) keep
palette discipline but add procedural surface detail (noise grain,
baked AO, decals for stains/peeling); (c) full art-direction reset from
new references. Needs director references/examples of what "not flat"
looks like to them before anyone builds — the *Omno* references that
wrote the bible were themselves flat-shaded, so the target has genuinely
moved.

## (slope) ~~Turning round 3~~ — BUILT 2026-07-22 (no falls, backwards skiing, one turn rate)

**(BUILT 2026-07-22 — see ROADMAP. The design questions below were settled
in the build session: signed speed along the ski axis with the lean target
projected by cos(heading) — continuous through sideways, so carving past
90° pivots you into switch with no mirror seam, and holding sideways
bleeds to a genuine stop (a hockey stop; steer authority floors at 40% at
a standstill so a stop can't softlock). Steering while switch needed no
special-casing — the signed math self-mirrors, screen-left stays
screen-left in both stances. Flight is ballistic: travel direction frozen
at takeoff, spinning turns the body not the path, and landing compares
tips vs travel to pick the stance. Renderer: body yaws to the full
heading, bank runs off a stance-relative carve angle, and the head/torso
twist over the lead shoulder while riding switch. No SAVE_VERSION bump.
One consequence to ratify at playtest: at the uniform rate a full 360 no
longer fits inside a single jump's airtime.)**

Director verdict on air-spin round 2: **the double-press to flip doesn't
feel right — rejected.** New direction, superseding both the held/fresh
mechanic and the fall itself. Three parts, director-called:

1. **One turn rate everywhere.** Air steering runs at the same rate as
   ground carving. `AIR_TURN_RATE` and the two `heldSinceTakeoff`
   booleans come back out of `shared/src/skiing.ts` (they were never
   saved, so removing them needs no SAVE_VERSION bump either).
2. **Remove the fall.** The `FALL_HEADING` fall-over goes away — turning
   past sideways on the snow is legal, and chasms become the game's only
   crash. `save.ts`'s heading heal (collapse + clamp into the standing
   range) simplifies to just the whole-turn collapse.
3. **Landing backwards means skiing backwards** — riding switch, not a
   crash. This retires the two un-ratified turning-round-2 defaults
   (360s-legal via downhill-equivalence, crash-on-first-grounded-frame):
   with no fall there's nothing to ratify — any landing angle is legal
   and just sets your stance.

Design questions the build session must settle (the reason this is a
session and not a constant tweak):

- **Backwards movement physics.** Movement currently follows where the
  skis *point* (`cos`/`sin` of heading) — pointed uphill, that would ski
  you uphill. Riding switch means traveling down the hill along the ski
  axis while facing up it — movement needs to follow the downhill *end*
  of the axis, and the ground behavior between sideways and backwards
  needs defining (naïve mirroring flips the lateral direction
  discontinuously at exactly 90°). Decide whether braking-by-turning — a
  technique the director kept from the real-turning session — survives
  unchanged on the way to fully sideways.
- **Steering while switch.** Which key is "left" when you're facing
  uphill — screen-left or skier's-left? Mirrored controls are the
  classic switch-riding confusion; pick deliberately.
- **The renderer needs a switch stance** — body facing uphill while
  traveling downhill (look-over-the-shoulder?), and the directional
  tip-over loses its fall-over triggers (chasm falls remain).
- **Tests flip:** several currently assert the old behavior (air spins
  faster than ground, standstill hop spins, over-rotated landings crash,
  fall-over past FALL_HEADING costs a life) and get rewritten to assert
  the new physics instead.

## (bedroom) ~~Front door → slope select → that slope outside the window~~ — SUPERSEDED 2026-07-22 (bedroom scrapped)

**(SUPERSEDED 2026-07-22, lobby session: no room, no door, no window. The
useful kernel survives in menu form — when M3's "all 3 v1.0 slopes" item
lands, slope select becomes a lobby menu item, and the chosen slope could
drive the lobby vignette's backdrop the way it would have driven the
window's.)** Original entry:

From the interior-lighting playtest: **eventually, the bedroom gets a
front door.** Exiting through it takes you to *choosing which slope to
race* (instead of today's Enter-anywhere teleport), and when you come
home, the slope you picked is the one visible outside the window. Ties
the home↔slope loop together spatially: the window stops being generic
scenery and becomes *your* mountain. Not a now-item — the director said
"eventually" — but worth sketching because pieces of it should be built
door-shaped when their sessions come up anyway:

- **A door** in a wall (geometry + an opening in the wall segments, like
  the window) and a walk-up-to-it exit trigger — replaces/augments the
  Enter scene switch in `main.ts` (shared territory).
- **Slope select** — needs more than one slope to select (M3's "all 3
  v1.0 slopes" item); until then the door could lead straight to the one
  slope. The selection UI is its own piece (hud.ts or a real screen).
- **The chosen slope drives the window backdrop** — the backdrop in
  `bedroomRender.ts` is currently one generic dawn scene; it would take
  a per-slope variant (different silhouette/props outside). Cheap if the
  backdrop builder takes a slope id.
- **`/shared` + save:** a selected-slope id in state, persisted (save
  shape change → SAVE_VERSION bump when it lands).
- Both sessions touch this seam (scene switching is shared territory) —
  coordinate via ROADMAP entries when it starts.

## (bedroom) ~~Lamp shapes need a restyle~~ — BUILT 2026-07-22 (furniture-assets session)

**(BUILT 2026-07-22: the lamps are real Quaternius fixtures now —
`Light_CeilingSingle` pendant + two `Light_Desk` table lamps on the real
dresser and desk. The light itself — colors, intensities, positions —
is untouched, per the playtest pass.)** Original entry:

Interior-lighting playtest: the code-built primitive lamps (cone shade,
cylinder stem) read wrong. Director call: fine to fix when the room gets
real assets — folded into the **furniture-assets session**, where the
lamps should be re-sourced/rebuilt to match whatever furniture style
lands (and they move onto the real furniture tops; positions are keyed
to the gray-box tops in `addLamps`). The *light* itself passed playtest
— only the fixture shapes change.

## (slope) ~~Air spin round 2~~ — BUILT 2026-07-22, option (a); REJECTED same day

**(REJECTED at playtest 2026-07-22, same day it was built: the
double-press to flip doesn't feel right. Superseded by the
turning-round-3 redirect at the top of this file — the held/fresh
mechanic comes back out, along with the fall itself.)**

**(BUILT 2026-07-22, director picked option (a): a held key doesn't spin —
a fresh press does.)** Keys down at takeoff keep carving-rate steering
through the air; a key pressed fresh mid-air (including release-then-
re-press) spins at 9 rad/s. Two booleans in `SkiState` track
held-since-takeoff; not saved (no SAVE_VERSION bump — a restore drops the
keyboard state anyway, so post-restore presses are genuinely fresh). The
two un-ratified defaults below still stand. Original entry kept for the
reasoning:

Playtest verdict on turning round 2: **the air spin rate is way faster
than the ground rate, so jumping while already steering left whips you
into an accidental 360.** The 9 rad/s air rate was sized so a full spin
*fits* inside a jump's ~0.78s — but it applies to the same held key that
was gently carving a moment before takeoff, so a routine jump-while-
turning becomes an unwanted trick (and usually a crash: the spin rarely
completes back to a clean equivalent). Options for the fix, director
picks:

1. **A held key doesn't spin — a fresh press does.** Keys already down at
   takeoff keep steering at the ground rate (intentional line adjustment);
   pressing a steer key *after* leaving the snow spins at the fast rate.
   Classic trick-game solution; needs the sim's input to distinguish
   "held since takeoff" (one boolean carried in state, set on the jump
   frame). Probably the recommended shape.
2. **Ramp the air rate in** — air steering starts at the ground rate and
   accelerates the longer the key is held airborne, so a carried-over hold
   drifts a little but a deliberate full-jump hold still spins. No input
   changes, but the 360 gets harder to time.
3. **Dedicated trick input** — steer keys always re-aim at ~ground rate in
   the air; a separate key (or double-tap) does the spin. Most explicit,
   costs a control and a keycap hint.

Whichever wins, the two un-ratified defaults from the build session below
(spins-are-legal via downhill-equivalence, crash-on-first-grounded-frame)
still stand until the director calls them.

## (slope) ~~Turning round 2~~ — BUILT 2026-07-22, two design defaults to ratify

**(BUILT 2026-07-22, turning-round-2 session.)** All three landed: air
spins/re-aiming (9 rad/s in the air vs 1.8 on snow — a full 360 fits in a
jump), the tip-over now matches the fall (over-turn left tips left, right
tips right, chasm reads as a forward drop, animated over the pause's first
0.35s, with the body holding its steer through the pause), and TURN_RATE
went 1.2 → 1.8 with FALL_HEADING retuned 2.0 → 2.2 to keep the same
~0.35s margin past sideways. The sketch's two design questions went to the
director but got no answer in-session, so the recommended defaults went in
— **both need a ratify-or-change at playtest:**

- **Full 360° spins are a legal trick:** landing compares against the
  nearest downhill-equivalent angle (a completed spin lands clean, a half
  spin lands crashed). `downhillHeading()` in `shared/src/skiing.ts` is
  the equivalence; flipping this call decides it.
- **An over-rotated landing crashes on the first grounded frame** (botched
  landing = fall) — no grace window to steer back after touchdown.

## (bedroom) ~~Follow camera + complete room~~ — BUILT 2026-07-22; whole area SCRAPPED later that day (lobby session), follow-ups moot

**(BUILT 2026-07-22 in one chunk — the room and camera interlocked too
tightly to split.)** Landed as sketched: full-height walls + ceiling,
room grown 10×8 → 12×10 with furniture flush to the walls, chase boom
with auto-follow + drag/key orbit + wall/ceiling clamping, walk remap
retargeted, deterministic reset on coming home. Still live from this
sketch:

- ~~**Interior lighting design**~~ — **BUILT 2026-07-22 (bedroom
  session):** window in the north wall with the slope's dawn sun shining
  through (shadow-mapped, so light only enters at the opening), backdrop
  of the slope world outside, palette-derived ambient (unlit surfaces
  render exactly snow-shadow blue, the slope's own constraint trick), and
  three warm lamps (pendant + dresser + desk). See ROADMAP.md.
- **The cat rides behind you** — now permanently off-screen while
  walking. Playtest question first; if confirmed, a small `/shared`
  change (flank or lead instead of trail).
- **Tall furniture occlusion** — the camera boom skips furniture checks
  because every gray-box piece (0.6–0.9) sits below the boom's 1.1-unit
  origin. The day M3 furniture includes a wardrobe/shelves, the boom
  needs an occlusion check (marked in `maxBoomInside`).

Original sketch kept below for the reasoning:

- **The room becomes real.** Walls go full height (~2.6–3 units for a
  1.6-unit character; the current 1.2-unit walls exist only so a high
  camera sees over them) and gain a ceiling. The floor plan likely needs
  to grow — the current room was proportioned as a doll-house viewed from
  above, and rooms feel much smaller from inside. Check `/shared`'s
  `roomWidth`/`roomDepth` against how a follow camera frames the
  furniture; resizing is a `createInitialBedroomState` change (static
  layout isn't saved, so old saves survive — positions clamp).
- **The camera is a chase boom.** Behind the character at a tunable
  distance/height, easing toward a point behind their facing (reuse the
  eased-target pattern; the walk-facing state already exists). Mouse drag
  should orbit *around the character* (the drag plumbing and sensitivity
  from camera round 2 retarget directly); scroll zoom survives as boom
  length. Q/E/R/F may keep working for free on the same targets — decide
  in-session whether to keep the chips or simplify to drag-only.
- **The classic small-room problems, from day one:** the boom will back
  into walls constantly — clamp the camera inside the room and/or
  raycast-shorten the boom against walls/furniture (pull in, ease back
  out); consider fading/hiding a wall or furniture piece that ends up
  between camera and character. Near-plane clipping through the
  character's back at short boom lengths — set a boom minimum. The HUD
  hint bar and banners are screen-space and unaffected.
- **Walk input:** the camera-relative remap survives unchanged — feed it
  the follow camera's yaw instead of the orbit azimuth. "Up = walk away
  from camera" is exactly what a chase camera wants. The walk *feel*
  question moves though: with the camera at your back, walking toward
  the camera (turning around) is the case to playtest.
- **The cat:** it follows *behind* you, which is now permanently
  off-screen. Worth a playtest question — should the cat prefer flanking
  or running ahead so you actually see it? (Its brain is `/shared`; keep
  any change small and separate.)
- **Lighting becomes interior design.** A ceiling kills the current
  skylight-ish setup; the queued "room is ~45% too dark" fix becomes
  designing interior light — a window (sun + the slope's palette leaking
  in) and/or warm lamps (the vision's detail-touches want glowing lamps
  anyway). Probably its own session after the room exists.
- **Scene switch framing:** entering the bedroom from the slope should
  place the camera behind the character facing into the room, never
  inside a wall — pick a deterministic reset (same reasoning as the
  camera deliberately not being saved).

## (slope) Push-off audio — a pole scrape synced to the push cycle

The momentum session (2026-07-22) gave the push-off its visuals but no
sound: a soft rhythmic pole-scrape/crunch per push would sell the effort.
The catch: audio derives everything from `SkiState` diffs, but the push
cycle's *phase* is a renderer-side clock (`poseTime` in skierModel), so a
state-driven scrape would drift out of sync with the visible arm strokes.
Options when picked up: expose the push phase from the rig to the audio
module (crosses the current audio-reads-state-only boundary), or accept a
speed-gated aperiodic scuffing bed (no discrete strokes, nothing to
desync). Decide in-session; goes well with the end-of-M2 tuning pass or
the music session.

## (bedroom) ~~Orbit-camera playtest verdict (director, 2026-07-22)~~ — RESOLVED, then SUPERSEDED

**(RESOLVED 2026-07-22, bedroom camera round 2 — then SUPERSEDED the same
day: the director rejected the bird's-eye view entirely; see the follow-
camera entry at the top.)** Both items landed as sketched here:
pointer-event drag (any mouse button — left is the convention,
right/middle work with the canvas-only `contextmenu` suppression; touch
rides along via `touch-action: none`) feeding the same eased targets as
the keys, and elevation as a third eased orbit variable clamped 15°–85°
with R/F for keyboard parity. The walk-input remap needed no change. The
drag plumbing, eased targets, and remap all carry over to the follow
camera; the orbit-the-room-center model itself is what's gone. The
click-vs-drag threshold note for M3's click-to-interact still applies.

## Cat-hug + hair-physics playtest verdict (director, 2026-07-22) — parked

Two issues, parked by director's call ("will fix later"):

- **Hair roots float inside the head — characters look bald mid-turn.**
  The swinging hair is one rigid mesh rotating around a crown pivot, so a
  lateral swing (left/right turns are the worst case) translates the roots
  at the sides and front of the scalp off the head, exposing skull. The
  roots must be *welded to the scalp* while the tips keep swinging. Fix
  direction: make the swing fade in from root to tip instead of rotating
  the whole piece — weight each vertex's deflection by its distance below
  the crown (roots 0, tips 1). Cheapest robust route is doing that blend in
  the hair material's vertex shader (`onBeforeCompile`: pass the swing as a
  uniform, weight by vertex height); a coarser mesh-side alternative is
  splitting the hair into a welded cap + swinging lower section, but the
  shader blend avoids inventing a split line on 11 different hairdos. The
  spring/drag/gust/repulsor model itself passed — this is purely about how
  the swing is *applied* to the geometry.
- **The cat's tail is stiff — should swoosh and react to wind.** The
  clinging cat's tail only has the slow CLING_LIFE idle sway (small, low
  frequency, not speed-linked). Wanted: real swooshing driven by the wind
  and the run — which is exactly what the hair spring already models. Fix
  direction: drive the Tail bone with its own small damped spring fed by
  the same inputs as the hair (speed-scaled drag + gusts, gated off
  `SkiMotion`), with a bigger amplitude than the current sway. The tail is
  a single bone on this rig, so a two-stage delay (rotate the bone, lag the
  tip) would need either faking (phase-offset components) or accepting
  one-segment swoosh — decide by eye in-session.

## Angulation playtest verdict (director, 2026-07-22) — parked, focus shifted

The angulation session measured right but didn't *read* right. Two issues,
parked by director's call (work continues elsewhere first):

- **The movement must live in the legs — round 3.** The director: "It
  still doesn't feel like the legs are being pushed out. It feels like
  the front of the ski is turning everything else." Cause: the turn is
  still assembled at the *group* level — the carve group yaws and rolls
  the whole character, and the foot pins translate outward, but no leg
  BONE changes shape in response to a turn (the leg chain's rotations are
  identical at steer 0 and full carve; only the speed wobble touches
  them). The long skis sweeping under a group yaw are the most visible
  moving thing, so the eye reads "skis steer the mannequin" instead of
  "legs drive the skis." Fix direction for round 3: put the turn *into
  the leg chain* — lean the UpperLeg bones sideways toward the
  pushed-out feet so the knees visibly drive out from under the body,
  bend the outside leg deeper than the inside one (real carving is
  one long leg, one short leg), and shrink the group-level roll further
  so the legs supply the shape and the body just follows. The per-frame
  foot pins and per-side ski assemblies from this session are the right
  substrate; what's missing is the leg bones participating.
- **Feet out of the boots (regression, this session).** The snow-contact
  fix counter-rolls each boot assembly by (edge − bank) about its ground
  origin, but the foot bones keep their level rest orientation and only
  get position-compensated — so mid-carve the boot tilts around a level
  foot and the foot mesh shows outside the boot box. Fix: roll the foot
  pin's quaternion by the same angle its boot assembly gets (one
  setFromAxisAngle multiply against the rest quaternion), then re-verify
  at the MESH level, not the center level. Verification lesson recorded:
  boot↔foot center distance stayed 5mm through every probe — containment
  failures live in orientation and mesh extent, so the next pass should
  pixel-read the boot region or intersect bounding boxes instead of
  comparing centers.

## Motion & life playtest verdict (director, 2026-07-22)

The turn/bank + life-layer session moved things but didn't land the feel.
Six issues, with causes and what each fix takes:

- ~~**The whole body turns as one unit — not fluid.**~~ **(Attempted
  2026-07-22, angulation session — REOPENED by the verdict above):** the
  bank was split (carve roll = lean, spine counter-rotation, foot pins
  pushed out) and the skis now stay grounded through carves (the old
  center-roll lifted the outside ski — that fix stands), but the leg
  bones themselves still don't participate in the turn, and the director
  still reads the skis as steering the body. Round 3 is the top block
  above: the turn goes into the leg chain itself.
- ~~**The legs are still static.**~~ **(RESOLVED 2026-07-22, angulation
  session):** leg bones joined the wobble layer (knees pump independently;
  the root-level foot pins mean a boot can never slide off), and the gear
  was rebuilt into per-side assemblies driven by the same placement
  numbers as the foot pins, so stance width and stagger breathe slowly
  per side. (The *turn-driven* leg motion is the separate reopened item
  above — this one was about idle life, which landed.)
- ~~**No momentum: runs start at speed, and speed comes back instantly
  after nearly stopping.**~~ **(RESOLVED 2026-07-22, momentum session):**
  speed is inertial now — the inputs set a target, actual speed eases
  toward it (accel 4 u/s², boost accel 8, coast-down drag 4, braking bite
  10), runs and respawns start at a standstill, speed freezes mid-air, and
  steering authority scales with speed. The presentation side is a real
  double-pole push cycle at low speed: arms reach-plant-drive with the
  poles pivoting at the grip, trunk crunching into each drive. One
  follow-on parked below (push-off *audio*).
- ~~**Knees don't bend to jump.**~~ **(RESOLVED 2026-07-22, hold-to-charge
  session):** the feel/fairness call went past both sketched options —
  director call: jumping is hold-to-charge now. Holding Space loads a
  crouch (the sim carries a real `jumpCharge`), releasing launches — a tap
  is the old fixed jump, a full 0.6s charge jumps ~57% higher. The
  presentation side is the sketched envelope: charge drives the crouch
  depth, takeoff pops the legs out, landing absorbs. The charge also gets
  a rising audio layer, and the takeoff whoosh/landing thump scale with
  launch/impact speed.
- **The ski boots are blocky.** Folds into the already-parked gear-style
  pass below — noting the director specifically called out the boots.
  Chunky must not mean box: bevels, facets, a lip over the ski.
- **Still no feet in the bedroom.** Re-confirmed; the always-on-feet item
  below stands unchanged.

## Ski-pose playtest verdict (director, 2026-07-22)

The crouch/gear session landed its mechanics (cat faces forward ✓, real
ski equipment exists ✓, no more mid-run customization ✓) but the look
needs a round 2. Eight issues, with what each fix takes:

- ~~**Skier never turns.**~~ **(Partially resolved 2026-07-22 — REOPENED
  by the motion-life verdict above):** a carve layer now yaws the body
  toward the movement direction and banks it into the turn, skis on edge,
  cat riding along — but the bank rolls the *whole body* as one plank, and
  the director wants angulation (feet out, knees bent, torso upright). See
  "not fluid" in the 2026-07-22 motion-life block above.
- ~~**Legs and arms aren't independent — the body is a rigid block.**~~
  **(Partially resolved 2026-07-22 — legs REOPENED by the motion-life
  verdict above):** staggered stance + a procedural life layer landed
  (speed-scaled pelvis bob, independent arm float at incommensurate
  frequencies, torso rock, head corrections, airborne-gated snow chatter;
  Idle stays frozen per the paused-clip gotcha) — but the *legs* were
  deliberately left out of the wobble layer and still read static. See
  "legs are still static" in the block above for why leg wobble is cheap
  on this rig.
- **Ski equipment doesn't match the art style.** The gear is plain
  primitives (sharp boxes, thin cylinders) against chunky rounded
  characters. Wants a proportion-and-facet pass: chunkier boots, thicker
  poles, skis with real upturned shovel tips and a bit of bevel — still
  code-built, just styled to the bible's "faceted, chunky, cute" rules.
- **Skis are too short.** Sized "short and cute" on purpose (1.35 units vs
  the 1.6-unit character); the director wants longer. Real-skier
  proportion (~head height or a touch more) ≈ 1.7–1.8 units. One constant,
  but re-check the chasm-lip visual once longer.
- ~~**The cat should HUG the character's back and peek over the
  shoulder**~~ **(RESOLVED 2026-07-22, cat-hug + hair-physics session):**
  the mount is now a live back-frame glued to the spine bones, and the cat
  clings to it — belly contact, front legs hugging, head peeking over the
  right shoulder — via a procedural cling pose on the cat's own rig
  (absolute overwrite over a frozen base, the skier-crouch technique; the
  relative-nudge version tumbled, same mixer gotcha).
- ~~**Hair should move — real physics.**~~ **(RESOLVED 2026-07-22, same
  session):** exactly the planned split — the hair primitive (100%
  head-weighted on every character, verified) became its own crown-pivoted
  mesh under the Head bone, driven by a damped spring off real head motion
  plus speed-scaled gusts. Bedroom walking gets a gentle trail for free;
  hats don't flap and hatted characters swing at half amplitude.
- ~~**Hair should react against the cat**~~ **(RESOLVED 2026-07-22, same
  session):** the spring is repelled from a sphere at the cat's head,
  probed against the hair's closest mesh-box point — probing the *center*
  never fired (the boots' center-vs-extent lesson, hit again and applied).
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
- ~~**Hair does not move / is rigid.**~~ **(RESOLVED 2026-07-22, cat-hug +
  hair-physics session — see the 2026-07-22 block above.)**
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
- ~~**The bedroom's lighting predates the physical-lights fix**~~ —
  **RESOLVED 2026-07-22 (bedroom session, interior lighting):** the room
  now uses the same ×π physical-lights convention and palette-derived
  light colors as the slope; wall/floor/patch colors pixel-verified
  against the derivation. The cat should no longer look muddy at home —
  worth an eyeball at playtest. (Original note, for the record: the ski
  scene multiplies light intensity by `Math.PI` — Three.js folds 1/π into
  materials — and the bedroom never got that treatment, so everything in
  it rendered roughly 45% too dark, including the cat at `#93734E`.)
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
- ~~**Player facing lives in the renderer, not the state**~~ (noticed
  2026-07-21, skier session) — **moot 2026-07-22 (lobby session):**
  `BedroomState` and `bedroomRender.ts` are gone; the lobby has no shared
  state and no player-controlled walking at all. The principle stands if a
  walkable home ever returns: presentation-only facing until `/shared`
  needs it.
- **Dynamic title screen** (director direction, 2026-07-21, sound
  session) — **base landed 2026-07-22 (lobby session):** the menu lobby
  *is* the game's title screen now (name, Play, character + cat vignette,
  dawn scenery). The *growing showcase* half of the idea stays live: as
  the world gains snowballs, tree limbs, critters, and more slopes, the
  vignette should grow richer with them — today it shows trees, the sun,
  and the two characters, because that's what exists.
