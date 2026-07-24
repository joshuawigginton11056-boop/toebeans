# Ideas

Parked ideas and observations — not commitments. Per CLAUDE.md, tangents
land here instead of in code.

## (multiplayer) Ghost racing — fast-follows past the first slice (2026-07-24)

The first slice landed (see ROADMAP): two players in a room by code, each
broadcasting pose ~12×/sec over a Supabase relay (+ a same-device
BroadcastChannel mirror), drawn as ghost skiers. Purely visual — no shared sim,
no collisions. Client-only (`client/src/net.ts`, `ghosts.ts`; UI in
`lobbyUi.ts`; wiring in `main.ts`). This is EARLY vs. the plan — DESIGN.md/
ROADMAP put real-time co-op at M7, post-v1.0 — built now as a lightweight
testing/fun layer at Josh's request. Parked next steps, roughly ordered:

- **Name tags over ghosts.** The packet already carries `name` (hard-coded
  "Friend" today); add a name-entry field in the friend panel and a floating
  label sprite over each ghost so you can tell who's who with >2 players.
- **A real race:** synced countdown + start gate, a finish-line "who won"
  readout. Needs a tiny shared agreement on "go" time over the channel (still no
  server sim — just a broadcast timestamp both count down to).
- **Lobby presence.** Ghosts only show on the slope right now; showing the
  friend's character in the lobby vignette would make "we're both here" legible
  before the run.
- **Lazy-load Supabase.** `@supabase/supabase-js` added ~0.9MB to the bundle
  (241KB gzip). Dynamic-import it only when a room is actually opened, so the
  solo-play initial load stays lean (M4's <15MB / fast-load bar).
- **Crash tip-over + tired-hop on ghosts.** Ghosts skip the frame-diff pose
  niceties (pole push, jump envelope, tired hop) and the crash tip, since those
  need local input history. If ghosts start reading "stiff," broadcast a couple
  extra derived flags rather than re-deriving.
- **Reconnect/robustness.** Supabase channel drop currently just shows an error
  status; a retry/backoff would help flaky Wi-Fi. Peer timeout is a flat 3s.
- **Segment-seam interpolation.** On the branching map a ghost snaps (doesn't
  interpolate) across a segment boundary — fine for the Overlook (single
  segment), revisit when detour worlds are playable.

## (slope-mech ✅ LANDED 2026-07-24) Steepness → speed — the steeper the terrain, the faster the run (director)

Director directive: **"steepness increases speed. the steeper the area, the faster
the skiing."** **Built (slope-mech, 2026-07-24), director picked "pronounced/punchy":**
both halves landed. (1) **Grade variation** — the constant `SEGMENT_GRADE` is gone;
the branching map's grade is now a shared profile in `shared/src/route.ts`
(`GRADE_PROFILE` control points → `routeGradeAt`/`routeHeightAt`), keyed to route
distance so "same clock, same flag" holds in elevation for free: a steep ~27° summit
plunge, a mellow ~15° forest/lake, a steep lower pitch. `slopePath.ts` embeds it
(world-Y + per-point `segmentPitch(id, distance)`); `skiRender.ts` rides the varying
pitch (skier/camera/hazards + per-facet grayblock). (2) **Speed coupling** — the pure
sim reads `gradeSpeedFactor(segmentId, distance)` and scales the target cruise + boost
by grade/`REFERENCE_GRADE` (1.0 no-op at the locked ~19° and on the flat Overlook),
capped at `GRADE_TOP_SPEED`. **Tuning knobs** (Josh look-passes on the live build):
`GRADE_PROFILE` (steepness spread — steep zones held under the camera's ~27° framing,
raise the camera to go steeper), `REFERENCE_GRADE`, `GRADE_TOP_SPEED`. **Follow-ups
parked:** per-route (not per-depth) steep zones would need breaking the height=f(route
distance) invariant (deferred — it'd complicate equal-drop); a steeper-than-27° pitch
wants a camera-elevation change too.

**↳ (slope-vis) the snow-surface tilt must now follow the VARYING pitch.** The parked
"sit + tilt the snow to the grade" task (below) can no longer use one constant pitch —
use `segmentPitch(id, distance)` per-point (it varies down the route now).

## (slope-mech ✅ curves landed 2026-07-24 / rest still open) Branching map — the §4 layout landed; now make it PLAYABLE (2026-07-24)

> **⏭ START HERE (slope-vis): DRESS THE REAL MOUNTAIN. The geometry now exists.**
> The grayblock ramp is GONE. (slope-mech, 2026-07-24, director "create the real
> mountain") replaced it with a real terrain SURFACE — `addBranchTerrain` in
> `skiRender.ts` builds a continuous mountain mesh per segment: a smooth playable
> lane flush with the sim's ground, flanked by snowbanks rising into rolling
> mountainside, following the curved centerlines AND the varying grade. It's a
> **plain-shaded placeholder** (a soft off-white MeshStandard, fork spots marked by
> boulders). **slope-vis's job is to DRESS it** — snow material/displacement, decor,
> ski-trail carving — re-skinning that mesh or replacing it with your own segment-aware
> surface. The old framing ("make skiScene's flat snow plane segment-aware and tilt it
> to the grade") is obsolete: the ground already sits + tilts to the grade and follows
> the curves. What you build against, all on `slopePath.ts` (already in `client/src`):
>
> 1. **Follow the CURVES.** Corridors are constant-curvature arcs — sample
>    `segmentCenterline(id, distance)` (world x/z + `heading`) and
>    `segmentToWorld(id, distance, lateral)`, per segment. The spine weaves an S;
>    detours peel to the sides (`SEGMENT_SHAPES`).
> 2. **Follow the VARYING grade.** Height is `segmentCenterline(...).y`; local pitch is
>    `segmentPitch(id, distance)` **per-point** (steep ~27° summit, mellow ~15°
>    forest/lake, steep lower pitch). Raw truth: `routeHeightAt`/`routeGradeAt` in
>    `shared/src/route.ts`. Past the flag both go flat — that's the no-finish runout.
>
> Reference `addBranchTerrain` for the lane/flank cross-section it uses (lane
> `|lateral| ≤ LATERAL_LIMIT` flat at the centerline y; flanks rise to ±46). If you
> replace the mesh, (slope-mech) can retire `addBranchTerrain` — coordinate. Detour
> worlds (lake/yeti/penguin/ice-castle) still dress in later; summit→forest is the
> first slice.

**Shaped corridors landed (slope-mech, 2026-07-24):** the branching map's segments
CURVE now — each a constant-curvature arc (`SEGMENT_SHAPES` in `slopePath.ts`), the
spine a gentle centered S and the detours peeling to their sides, chained smoothly
on continuous runs and cut at fork handoffs; the grayblock floor/walls facet along
the arc. The straight parallel-box layout is gone. (Amplitudes are a grayblock
tuning knob — adjust `SEGMENT_SHAPES` turns; verified at runtime, look-pass on the
live build still welcome.) The rest of this section (real entry, visuals dressing,
hazard balancing) is unchanged below.

The **real §4 map is laid out** (slope-mech, 2026-07-24 — see ROADMAP +
SLOPE_BRANCHING.md): `route.ts` now chains summit → enchanted forest (Type A) →
frozen lake (Type A) → yeti's peak (Type B) into the three same-clock routes
(Cave / Ice / Water, each 640), `slopePath.ts` places the corridors, and 134
tests pin "same clock, same flag." It's still **dev-only grayblock behind
`?branch=1`**. **Director redirect (2026-07-24): make it actually playable,
starting with the summit → forest ride** — drop in at the summit and ride down
into the forest, dressed for real. This is the run that becomes the game; the
rest of the map (lake, yeti's peak, detour content) dresses in later. The ride
*already works mechanically* — what's missing is a real entry and real visuals.
The cross-session split:

- **(slope-vis) Dress the summit + forest corridors — this is the main lift, and
  the hold on dressing the branching map is now LIFTED for these two segments.**
  (It stays on for the detour worlds — lake/yeti/penguin/ice-castle — those are a
  whole scene each and dress in later.) The blocker: `skiScene.ts` draws the
  ground/lighting/decor along the *single* Overlook road (the `SLOPE` centerline),
  but the branching map is per-segment — so `skiScene` must become
  **segment-aware**, laying its surface + scatter along each segment's centerline.
  Everything you need is in `client/src/slopePath.ts` (already in `client/src`,
  importable): `segmentCenterline(id, distance)` and `segmentToWorld(id, distance,
  lateral)` give world x/z + tangent for a segment-local point, and
  `SEGMENT_PLACEMENTS` is each corridor's world anchor. The grayblock boxes live
  in `skiRender.ts` (`addBranchGrayblock`), NOT your scene — they get gated off
  once the real surface is under the run. **The forest segment IS the enchanted
  forest** (see the night section below): summit = open sunset mountain, forest =
  the dark/glowing enchanted look — and the "sun sets *as you race*"
  auto-transition's trigger is now answered: **it rides the summit→forest
  descent.** Wire `setTimeOfDay` off route progress (`routeDistanceOf`, or the
  segment id: summit → dusk, forest → dark).
- **(slope-mech ✅ landed / slope-vis TODO) The branching map has a REAL, VARYING 3D
  grade — the snow surface must follow it.** Director call 2026-07-24 ("ride down a
  REAL mountain into the forest") + the 2026-07-24 "steepness → speed" pass:
  `slopePath.ts`'s `segmentCenterline(id, d)` returns a `y`, and the pitch now VARIES
  down the route (steep ~27° summit, mellow ~15° forest/lake, steep lower pitch —
  `routeHeightAt`/`routeGradeAt` in `shared/src/route.ts`, embedded as
  `segmentCenterline(...).y` and `segmentPitch(id, distance)`; the Overlook stays y=0,
  untouched). `skiRender.ts` rides it end-to-end: the skier, camera, hazards, and
  grayblock corridors (descending, CURVING floor ramps + tilted walls, faceted per-
  point) all sit at the real y + local pitch, and the **environment `anchor` carries
  `anchor.y = the ground y`.** BUT the dressed snow surface in `skiScene.ts` still
  ignores `anchor.y` — it recenters the flat plane on `anchor.z` only (line ~479,
  `slope.position.z = centerZ`), so on the branching map the skier rides the grayblock
  ramp while the real snow stays flat at y=0. **The slope-vis half (this is the
  "replace the ramp with a real mountain" task banner'd at the top of this section):
  sit + TILT the snow surface (and treeline/trails/decor) to the grade** — follow
  `anchor.y` for height and pitch the surface by **`segmentPitch(id, distance)`
  per-point (NOT a single `slopeGradePitch` — the grade varies now)**, along each
  segment's curved centerline. Do it with the segment-aware surface rework above (same
  chunk). **The branching map is the DEFAULT slope** (main.ts — plain URL; `?overlook=1`
  opts out), so the flat snow under a descending, curving run is what everyone sees on
  the live build now. The grayblock ramp is the stand-in ground until this lands. The
  Overlook (now `?overlook=1`) is unaffected (its anchor.y stays 0).
- **(slope-mech) Real entry + grayblock cleanup.** Promote entry off the
  `?branch=1` dev flag into real play (the exact UX is lobby's — below); gate the
  debug readout (`branchDebug.ts`) and the grayblock markers (`addBranchGrayblock`)
  so they only show under the dev flag, not in a real run. Confirm the
  summit→forest ride feels right — it's deliberately gentle (no hazards until the
  lake gap two segments down), a clean drop-in intro. Expose whatever
  segment-placement the visuals seam needs as a small additive change (per
  PARALLEL.md), and note it in the ROADMAP entry.
- **(lobby) How you enter it.** A slope-select menu choice, or make the branching
  map what "Hit the slopes" loads. **Open decision for the kickoff:** does the
  branching map *replace* the Overlook as the default, or *coexist* (Overlook =
  onboarding, branching = the real map, selectable)? These docs assume coexist,
  per the existing framing — confirm with the director.
- **(slope-mech) Per-segment differing hazards are a data change, deferred (§5).**
  The layout keeps hazards sparse (one gap each on lake / cliff / valley — enough
  to prove chasms fire on every route and across handoffs). §5's balancing (road
  tenser, detours lower-stakes; the wide "signature" cliff jump — kept width-3
  grayblock for now) is just editing each segment's `chasms`/`checkpoints` in
  `route.ts`. Not needed for the summit→forest slice (those segments have none).
- **(slope-mech) Grayblock rough edges, still open:** the `routeDistanceOf`
  offsets in `route.ts` are hand-authored (a general graph would derive them);
  old-segment chasm/checkpoint meshes may linger in the scene after a transition
  (fine off in a passed corridor, worth a look if a segment is ever reused).
- **Type B (Yeti's Peak) needed no new mechanics — RESOLVED by the layout.** The
  worry was that a fork which doesn't rejoin until the flag would need a new
  routing shape. It didn't: the existing `trigger`→`divertTo` + `next` primitive
  models it directly (yeti's `next` is the cave chain, its trigger diverts to the
  ledge chain, and both run independently to their own flag at the same clock).
  Same-clock is guaranteed by the length construction, not by rejoining. So the
  segment model already handles both branch kinds — nothing to build here.

## (slope-vis) NIGHT → the enchanted forest — director redirect (2026-07-24)

> **⏭ START HERE NEXT SESSION (slope-vis, handoff 2026-07-24):** the darker
> night **and** the glowing-forest *first layer* are merged, and the director has
> now **look-passed** the first layer (verdict below). Settled: darkness values
> are the base (Josh: "feels right"); the **glow ramp is signed off** — G1
> `#5FE9D0` cyan, G2 `#8CF08A` moss, G3 `#B98CF0` violet, G4 `#F0C06A` warm
> lantern (DESIGN.md, `GLOW` in `skiScene.ts`); **sourcing = MegaKit mushrooms/
> plants** (CC0). Live tuning knobs are named constants at the top of the
> ENCHANTED NIGHT section (`GLOW_EMISSIVE`, `POOL_ALPHA`, `GLOW_ONSET`,
> `GLOW_CELL`/`GLOW_DENSITY`).
>
> **★ Director look-pass verdict on the first layer (2026-07-24) — the punch
> list for next session:**
> 1. **Fireflies: CUT and re-source.** The code-built mote cloud was "too many
>    colors and always in front of the skier" — **removed from `skiScene.ts`**
>    this session. Josh wants **realistic fireflies from a CC0 pack** (not
>    stylized additive dots). New sourcing task: find a CC0 firefly asset —
>    likely a small animated/particle firefly, or a sprite sheet of a warm-white
>    firefly glow — and scatter it in the world (NOT glued to the camera/skier;
>    place it in world space near the treeline so the skier passes through it).
>    Realistic ⇒ warm-white/amber, sparse, blinking — not the rainbow ramp.
> 2. **Snow sparkle is too bright at night. ✅ BUILT (slope-vis 2026-07-24,
>    session 2 — awaiting look-pass.)** The realism-snow glitter was a
>    *light-independent* additive flash (`reflectedLight.directSpecular +=` in
>    `createSnowMaterial`), so it stayed full-bright once the scene went black.
>    Added a `sparkleGain` uniform that fades with `timeOfDay` down to a faint
>    `NIGHT_SPARKLE_GAIN` (0.12) floor at full night — a bare moonlit shimmer,
>    not dead matte. Set from `applyTimeOfDay`.
> 3. **Tree trunks glowing: TRIED TWICE, REJECTED, REMOVED (director, 2026-07-24,
>    session 3).** ~~Self-glowing `PineBark` emissive.~~ Two passes shipped — a
>    flat wash up the whole trunk (session 2), then a base-bright vertical
>    gradient textured by the bark (session 3, built to the "fade up the tree /
>    keep bark visible" note above). The director rejected the *whole idea* on
>    the second look: **"the tree glow looks tacky; I don't want the trees to
>    glow themselves."** All trunk-glow code (`collectPineTrunkMaterials`,
>    `primeTrunkGlowGradient`, the `TRUNK_*` constants, the `applyGlowPhase` ramp)
>    was **removed from `skiScene.ts`**. New reading of the reference photos: the
>    trees are **dark silhouettes** in an enchanted world; the glow is **around**
>    them, never *in the wood*. This item is dead — its replacement is the
>    **environmental night look** (#0 below).
> 4. **Bloom must be STRONGER for glowing plants.** When bloom lands (next
>    chunk), crank it — the director wants "a greater bloom for glowing plants";
>    the caps/plants should really bleed halo, not just brighten. `GLOW_EMISSIVE`
>    is already pushed >1 to give bloom headroom; tune the bloom strength/radius/
>    threshold high and re-check.
>
> **↳ This work's concrete home (director, 2026-07-24):** the enchanted forest
> *is* the branching map's forest segment; the priority is the **summit → forest
> ride playable**, and the sunset→dark auto-transition rides that descent. See the
> branching-map section up top — the first visuals step there (make `skiScene`
> segment-aware to dress the summit + forest corridors) is the gateway this
> glow/rays work fills in. For now the glow layer lives on the ordinary Overlook
> night (the **N** debug phase) and carries over once the corridor is dressed.
>
> **Next chunks, in order (verdict-driven):**
> 0. **★ Environmental night look — DO THIS FIRST with Josh's reference photos
>    (director restart, 2026-07-24).** Trunk self-glow is dead (see verdict #3);
>    the trees stay **dark silhouettes** and the enchantment comes from the world
>    *around* them. Read the photos and build the glow into the environment, not
>    the trees: brighter/nearer **glowing ground props** (mushrooms/plants) that
>    pool light onto the snow, **atmospheric mist/haze** catching the glow, a soft
>    **light shaft / moonlight rays**, and (later, CC0) floating **motes**. The
>    trunk materials are back to plain painted bark — do not re-add emissive to
>    them. Judge every pass by the photos: dark trees, lit surroundings.
> 1. **Bloom** — the halo that makes emissive read as *glowing*, tuned STRONG
>    (verdict #4). A render-seam add: `render()` in `skiRender.ts` (mechanics)
>    calls `renderer.render(scene, camera)`; route it through an `EffectComposer`
>    (`three/addons/postprocessing/…`, present in r185) with an `UnrealBloomPass`
>    owned by `skiScene.ts`. Smallest additive seam change, mark `// slope-vis`.
> 2. **Phase-aware darkening:** snow sparkle (verdict #2, ✅ built), driven off
>    `timeOfDay`/`glowFactor`. (Trunk glow is gone — verdict #3 — so nothing to
>    darken there. Also the general decor/spray darkening flagged earlier —
>    still open.)
> 3. **Real MegaKit glow props** — download + convert the mushrooms/plants Josh
>    picks, swap them for the code-built `makeGlowCluster` primitives.
> 4. **Realistic fireflies** from a CC0 pack (verdict #1), world-placed.
> 5. **Moonlight rays**, then the auto-transition + night audio.
> **Do NOT crush the ambient further until bloom + real glow-pool light exist** —
> past the current values the lane stops being readable (see the ✅ bullet below).

**Redirect after the first night look-pass (director, 2026-07-24):** the
moonlit night I built is **too bright and too evenly lit**. The new target:

> **Night should be much darker. The forest should be *extremely dark*, with
> only a few rays of moonlight breaking through. We light it with *glowing
> assets* that make the forest look *enchanted*.**

So night stops being "the same scene, dimmed and cooled" and becomes its own
mood: a near-black enchanted forest where **the light sources are objects in
the world** — glowing props — not a moon fill. The **darker-night first pass is
done** (the ✅ bullet below); the rest of this plan — glow props, bloom, rays —
is the remaining work.

**What's already there to build on** (this session, see ROADMAP): a `timeOfDay`
phase in `skiScene.ts` lerps dawn → night across every atmosphere param
(ambient, directional light, fog, sky dome, the sun/moon disc, a star field),
cycled by the debug key **N**. The knobs to push are the `NIGHT` constants +
the `nightAtmosphere` endpoint. What the redirect changes:

- **Crush the ambient + moon fill toward black. ✅ DONE (slope-vis 2026-07-24).**
  The night snow targets (#8FA0BE lit / #3F4D70 shadow) were far too luminous.
  Dropped to `#4E608A` lit / `#12182B` shadow, sky zenith `#1A2138`→`#0B0F1C`:
  the open snow floor now reads near-black cool blue and you only see form
  where the moon rakes. Kept the moon on as a *faint down-lane key* (the lane
  it rakes still resolves to the lit `#4E608A`) so the run stays readable
  *until* the glow assets exist to carry lane light — at that point the ambient
  can drop further and the moon key can go fainter still. **Readability is a
  gameplay concern: don't crush past this without glow-pool lighting in place.**
- **Moonlight = a few *rays*, not a wash.** "A few rays breaking through" is
  discrete light shafts through the canopy — god-ray cones / volumetric-ish
  beams hitting the snow in bright patches, dark everywhere between — not the
  even directional light we have now. Options to weigh next session: cheap
  faked light-shaft cones (additive cones/quads angled from the canopy gaps),
  a real volumetric pass, or a handful of tight spot-lights masked to look like
  beams. The current single directional moon likely stays only as a very faint
  key so silhouettes don't vanish.
- **Glowing assets are the new lighting model — the big piece.** Emissive props
  scattered in the forest that actually cast light: think enchanted-forest
  vocabulary — glowing mushrooms, luminous plants/flowers, crystals, floating
  spores / fireflies, maybe lanterns. Each = an emissive material (reads as
  "lit" regardless of scene light) + a real light (point light, or a cheaper
  faked glow pool on the snow) so it pools light on the ground around it.
  **Bloom** almost certainly wanted here — emissive without bloom won't feel
  "glowing"; that's a post-processing add (EffectComposer / UnrealBloomPass),
  a first for this renderer, so budget for it. Sub-decisions for the session:
  - *Sourcing* (per the bible checklist): do the glow props come from a CC0
    pack (Quaternius/Kenney have mushrooms/crystals/plants), or are the
    existing frosted-green pines/rocks re-lit and a few new glow props added?
    Ask the director's download preference first, per the download rule.
  - *A glow palette.* The 13-color palette is all daylight and has no emissive
    hues. Enchanted glow probably needs its **own small ramp** (cool bioluminescent
    teals/greens/violets — maybe a warm lantern amber), added by director call
    the way the character ramps were carved out separately from the landscape 12.
    Signal red stays reserved; glow must not fight the cat's scarf.
  - *Firefly / spore motes* — drifting emissive points (the star field code is a
    near-template) sell "enchanted" cheaply and double as ambient sparkle.
- **Decor / spray / audio still ride the phase.** The pines/rocks and the snow
  spray currently render as if lit at dawn regardless of `timeOfDay`; in a
  near-black forest that breaks completely — their materials must darken with
  the phase (and pick up the glow-pool light). Night audio (`audio.ts`) wants
  its own enchanted-forest bed (sparse, magical — chimes/hush over the cold
  wind) once the look lands.

**Still open from the first pass (unchanged by the redirect):**

- **The auto-transition — "the sun sets *as you race*." TRIGGER NOW ANSWERED
  (director, 2026-07-24).** The enchanted forest *is* the branching map's forest
  segment, so the transition rides the **summit → forest descent**: sunset at the
  summit, dark/enchanted once you're in the forest. This lands as part of the
  "play the summit → forest ride" slice (see the branching-map section up top and
  ROADMAP). Drive `setTimeOfDay` off route progress — `routeDistanceOf(segmentId,
  distance)` (from `@toebeans/shared`), or simply the segment id (summit → ramp to
  dusk, forest → dark) — from `syncEnvironment`. Only the two endpoint looks are
  built; the mid-descent ramp is the wiring. (Note: this couples the phase to the
  branching map — on the plain Overlook, `timeOfDay` stays where it is / the debug
  **N** still cycles it.)
- **A designed dusk / golden hour.** The mid-phase is a plain lerp, not a
  designed warm sunset. If the sunset should be its own moment, add a third warm
  endpoint (dawn → sunset → night 3-stop ramp).
- **The lobby vignette's own night.** The lobby (`lobbyRender.ts`, lobby
  session) has its own dawn sky and can't see `skiScene`'s phase — a
  lobby-session port if the menu should turn enchanted too.
- **Bible amendment.** With the enchanted-dark direction, the bible's "the whole
  game is bright — dark moods are out of scope" is firmly amended for the night
  slope, and glow/emissive + a glow palette are new art vocabulary. DESIGN.md
  carries the ⚠ pointer; the framing (slope-only vs game-wide) and the glow
  ramp fold into the bible's pending rewrite.

## (slope-vis) Adopt the road centerline so the curve can turn on (2026-07-24)

**Hand-off from slope-mech.** The route bend is now a *shared road*, not a
straight axis: `client/src/slopePath.ts` maps the sim's `(distance, lateral)`
to a world `(x, z, heading)`, and the mechanics side (skier, camera, chasm/
checkpoint meshes, the environment anchor) already places through it. It ships
**straight** (`BENDS` is empty → `slopeToWorld(d, lat) === { x: lat, z: -d }`,
heading 0), on purpose: the director wants the curve turned on *together* so the
skier never drifts off a straight treeline.

To let the curve turn on, `skiScene.ts` needs to draw the ground against the
same road instead of the straight `-z` axis. Import from `../slopePath` (already
in `client/src`) and use `slopeCenterline(distance)` / `slopeToWorld(distance,
lateral)`:

- **Snow window** (`syncEnvironment` / the snowfield plane): today it slides a
  flat plane along the anchor's `z` only. Under a curved road the anchor's world
  `x` moves too (already passed correctly), so the plane should follow the
  anchor's world x/z and ideally orient to the tangent — or be wide enough /
  re-centered so the skier stays on it through the bend.
- **Decor scatter** (`updateSlopeDecor` + the bands): trees are laid in straight
  world-`z` strips at fixed `x = ±LANE_EDGE`. They must instead scatter along
  the centerline — place each at `slopeToWorld(cellDistance, ±(LANE_EDGE +
  jitter))` and, if oriented, yaw by `-slopeCenterline(cellDistance).heading`.
  This is the piece that actually breaks if skipped (trees end up in the lane).
- **Ski trails / spray** (`updateSnowTrail`, `updateSnowEffects`): they build
  from the anchor's world motion, so they mostly follow for free, but the
  `SnowTrailInput.heading` handed across the seam is still **fall-line-relative**
  (from the sim). For world-space grooves, combine it with the centerline
  tangent: `worldHeading = state.heading + slopeCenterline(distance).heading`.
  (slope-mech left it fall-line-relative rather than change the seam field's
  meaning while straight — flagged in `skiRender.ts` at the `syncEnvironment`
  call.)
- Also note `laneHalfWidth(distance)` (the rock-gate pinch) still wants the
  visual lane to follow it — the older seam note in `skiing.ts` — which composes
  naturally once the lane is drawn along the road.

Once `skiScene.ts` is drawing against the centerline, slope-mech gives `BENDS`
real amplitudes (a gentle S: bend around the vista ~300–420, an opposite dogleg
past the rock gate ~560) and the curve appears coherently on both sides. Keep it
gentle (DESIGN's "scenic showcase" lean, not a slalom).

## (slope-mech) ~~Slope 1 "The Overlook" skeleton — the mechanics build~~ — SKELETON BUILT 2026-07-23

**BUILT 2026-07-23** (see the ROADMAP entry): items #1 (length + finish) and
#2 (layout to the beats) landed, and #4 (variable width) was pulled forward as
the rock-gate pinch (director call). **#3 route bending — road system built
straight 2026-07-24** (`client/src/slopePath.ts`; see that ROADMAP entry): the
centerline that maps `(distance, lateral) → world (x, z, heading)` now exists
and the mechanics side (skier, camera, hazards) routes through it, but shipped
with an *empty* `BENDS` list so it's still a straight axis — the actual curve is
a joint flip pending slope-vis adopting the road (the next entry). By design, #5
grade stays flat. The `(slope-vis)` visuals half at the bottom is now unblocked
— real finish distance (800) + beat positions exist to build against, and
`laneHalfWidth(distance)` is exported for the visual lane / rock-gate spires to
follow (the pinch is an invisible narrowing until they do). Original spec kept
below for reference.

The first real slope. Full design + beat sheet + rationale is in DESIGN.md
("The handcrafted slopes — Slope 1: The Overlook"). This entry is the
concrete mechanics build list. Identity is locked (scenic showcase, director
2026-07-23); new hazards beyond chasms are **deferred** by director call —
skeleton first ("the hazards aren't the main point").

**Actionable now (turns the endless sandbox into a finite track):**

1. **Length + finish.** `createInitialSkiState` has no length and the run
   never ends (`SLOPE_LENGTH = 100` in `skiScene.ts` is dead — nothing reads
   it, confirmed by grep). Add a finish distance (recommend ~800; ≈ 75–90 s
   at cruise) and a new `RunStatus "finished"` that fires at
   `distance >= finishDistance`: the run stops advancing, input stops
   driving it, and the result is ready to pay XP once XP exists. This is the
   spine everything else hangs on.
2. **Layout to the beat sheet.** Place chasms / checkpoints / finish at the
   beats (illustrative distances, tune freely): warm-up chasm ~120 (width
   ~3), checkpoint ~150; signature cliff-jump crevasse ~380 (wide, width
   ~5–6), checkpoint ~420; rock gate ~560; finish 800. The current
   test values (`checkpoints: [0, 26, 52]`, chasms at 20/45/70) retire.

**Bigger decisions (flagged; do NOT block #1–2):**

3. **Route — does Slope 1 bend?** Slope-vis lean: yes (2–3 sweeping turns
   make the showcase reveal itself). Cost: the sim models the slope as a
   straight distance axis; bending needs a curved centerline (distance →
   world position + heading), and `skiRender.ts`, the snowfield window, and
   the decor scatter all key off the straight axis today — a real cross-seam
   change. Recommend building the finite *straight* skeleton first, then
   deciding bends as its own chunk.
4. **Variable width.** `LATERAL_LIMIT` is one constant; a distance-varying
   clamp would let the lane pinch at the rock gate and open at the vista.
   Nice-to-have, not blocking.
5. **Grade.** Recommend keeping the flat-underneath model (downhill reads
   from motion + framing). Flagged only so it stays a conscious choice.

**The visuals half (slope-vis, mine — gated on #1–2 landing):** start gate +
drop-in, finish arch + finish-area dressing, the vista reveal (open the
treeline, distant slate ridge + hazy hills), the crevasse art (ice walls +
real depth, upgrading the flat chasm slab), the rock-gate spires, and
scatter composed to the beats instead of pure procedural. I build these
against the real finish distance + beat positions once they exist.

## (slope-mech) Tired hop should block the next jump until the animation finishes (2026-07-23)

**Director, 2026-07-23** (right after the held-jump edge fix landed): *"tired
hop animation needs to finish playing before allowing next jump. will fix
later."*

Today the jump gate is the landing lockout alone — `landingRecovery`
(`LANDING_RECOVERY` = 0.3s). The tired-hop cue runs longer on purpose:
`tiredHop` (`TIRED_HOP_DURATION` = 0.5s, deliberately ≥ the lockout so one
press can't restart it). So once the lockout ends there's a ~0.2s tail where
the tired-hop bob is still animating but the player can already charge and
launch a fresh jump. Worse, a real launch during that tail currently
*cancels* the bob — that's the existing "cancels a leftover cue on a real
launch — takeoff owns the body" behavior (comment + test in `skiing.ts` /
`skiing.test.ts`). Josh wants the opposite: while the tired hop is playing,
the next jump stays locked out until it finishes.

**Fix direction (its own session):** gate the jump on `tiredHop` as well as
`landingRecovery` — no charge or launch while `tiredHop > 0`. Two routes:
extend the lockout to cover the whole cue, or add `tiredHop > 0` to the
grounded jump guard in `stepSkiing` (the `if (grounded)` block). Either way it
reverses the current "a launch mid-cue clears it early" intent — that test and
its comment must be rewritten to the new behavior (the launch now *waits* for
the cue instead of owning the body through it). Keep the one-attempt-per-lockout
invariant intact, and mind that a key held across the whole cue shouldn't
auto-launch the instant it ends (reuse the rising-edge logic from the
2026-07-23 fix if needed). Presentation is already handled — the renderer
shapes the bob off the `tiredHop` clock; this is purely a sim-gate change.

## (slope-mech) Clamp the frame dt — background tabs teleport the run (2026-07-23)

Noticed while verifying the camera rig: browsers suspend
`requestAnimationFrame` in hidden/undisplayed tabs, and `main.ts`
computes `dt = now - lastTime` with no ceiling — so on resume the loop
feeds `stepSkiing` one enormous step (minutes, potentially) and the
unattended skier teleports far downhill, usually straight into a chasm.
Watched it happen: a fresh run came back from a stall already crashed
with a life gone. Fix is a one-liner in the shared `main.ts` loop
(`dt = Math.min(dt, 0.1)` or similar) but it's shared territory and
deserves its own tiny chunk with a think about the right cap — a low cap
also pauses the game during long frames (probably desirable: Vite
hot-reload stalls, laptop sleep).

## (slope-vis) Decor stops 30 units uphill — visible now that players can look back (2026-07-23)

The camera rig (slope-mech, 2026-07-23) lets players drag a full
half-turn to look uphill; `DECOR_AHEAD/DECOR_BEHIND` in `skiScene.ts`
assume "the camera never looks back far" (30 units behind vs 170 ahead,
fog far plane 150), so a deliberate uphill peek can catch the treeline
ending well inside the fog. Brief and self-correcting (the look snaps
back on release), so parked rather than fixed — if playtest catches it,
the knob is `DECOR_BEHIND`, at whatever uphill reach the recycling
window can afford.

**Update (2026-07-23):** camera round 3 is now **built** (entry in
ROADMAP) — the mouse peek is Pointer-Lock relative mouselook with
**unbounded yaw**, so while the pointer is locked a player can rest the
camera pointed straight uphill for as long as they like (it only eases
home on Esc/unlock, not automatically). Touch drag still snaps back, but
the mouse no longer does. That turns this from a brief self-correcting
glimpse into a holdable view, which raises the priority: `DECOR_BEHIND`
(and possibly the fog far plane on the uphill side) likely wants to reach
as far back as the locked view can hold.

## (slope-vis) Dressing the tired hop (from the locked-out-jump cue, 2026-07-23)

A jump press during the landing lockout now plays a "tired attempt" —
`SkiState.tiredHop` is a short clock (`TIRED_HOP_DURATION`; being
retuned slower-and-deeper per the 2026-07-23 verdict) the mechanics
renderer shapes into a weak knee-buckle and a few-centimeter bob
(skiRender.ts, existing rig knobs only — no `skierModel.ts` change was
needed). Two polish layers
would sell it, both slope-vis territory: a sound (a soft effortful "hup"
or ski-scuff that goes nowhere — `audio.ts` can frame-diff the clock
starting, same trick as the jump whoosh), and a rig touch (a head-drop or
arm slump reading "legs are spent" beats what tuck alone can say —
`skierModel.ts`). The clock and `TIRED_HOP_DURATION` are already exported
from `@toebeans/shared` for exactly this.

## (slope-vis) Ski-trick flourishes for the air spin (from turning rounds 8–9, 2026-07-23)

The slope has an air trick now: hold Space mid-air and the body spins at
a trick rate (180s, 360s, more if you hold it), landing switch or clean.
The sim and the rig's default heading easing carry it, but it's begging
for presentation: a dedicated spin pose (tuck the body, cat visibly
holding on), a landing-slide carve-spray *burst* through the round-8 grip
window, and spin/slip/landing audio flourishes to match. All
`skierModel.ts` / `skiScene.ts` / `audio.ts` territory. (The everyday
ski-trail spray now exists — see the loose-snow ROADMAP entry, 2026-07-23;
this is the trick-landing flourish riding on top of it.)

## (slope-vis) Loose-snow follow-ups (from the spray/flurries chunk, 2026-07-23)

The ski-trail spray + screen flurries landed and merged. Open threads on
them, all `skiScene.ts`:

- **Spray must read in BOTH sun and shadow — DONE (built 2026-07-23), awaiting
  director look-pass.** The old flat cool tint (`SPRAY_COLOR` = `#D3DFF0`) read
  in the sun but vanished on shadowed snow (which renders as *that exact blue*).
  Fixed with the front-runner plan: **per-grain two-tone** — each grain is
  randomly `SPRAY_COLOR_SUN` `#F8F5EF` or `SPRAY_COLOR_SHADOW` `#D3DFF0` (split
  `SPRAY_SHADOW_FRAC` = 0.5), via a per-particle `aColor` vertex attribute
  through the shared shader (`color * vColor`). Palette-legal, no bible change.
  *Open only as a look-pass:* the mix ratio (`SPRAY_SHADOW_FRAC`) is a director's
  eye call on a composited frame. See ROADMAP 2026-07-23 build entry.
- **Lens splash make-it-read — BUILT 2026-07-24, open only as a look-pass.**
  The director's "splash not noticeable enough" (2026-07-24) was cashed in: all
  the levers below were pushed — `LENS_PEAK_ALPHA` 0.34 → 0.6 (big-splat center
  69 → 122/255), base radius up + big multiplier 2.1 → 2.4 (big radius 71 → 111
  px) + `LENS_BIG_CHANCE` 0.12 → 0.24, `LENS_SPLAT_RATE` 16 → 28/s and
  `LENS_SPLAT_MAX` 70 → 110, **plus** the edge-frost vignette (the "buried in it"
  rim — a smoothed `frost` level drives a corner vignette, ~50/255 at the corner
  at full carve, 0 at center). Idle-skip zero-fill preserved. See ROADMAP
  2026-07-24. *Now open only as a director look-pass on a composited moving frame*
  (the render loop pauses when the Browser pane is hidden, so no in-session
  capture): whether the new opacity/size/frequency/frost read right — the knobs
  above are all named constants at the top of the lens block.
- **Lens splat: real snow particles, not crystal flakes — DONE + APPROVED
  2026-07-24 ("looks good").** The director's "the snowflakes are tacky, I wanted
  actual snow particles" was cashed in (see ROADMAP 2026-07-24 build entry): the
  six-arm crystal is gone, replaced by `makeSnowSprites()` → 4 naturalistic
  `makeSnowClump()` variants — a packed-powder core (3–5 overlapping soft blobs at
  jittered offsets → asymmetric feathered mass) + a center-biased scatter of
  12–21 tiny grains, all cool `LENS_TINT`. Each flake picks a variant + full-2π
  birth rotation at emit; blits under a mild `scale(1.28,0.82)` for a subtle
  flung-at-an-angle smear. Smaller/sticky levers all kept. Closes the whole
  lens-splat thread (make-it-read → smaller/sticky → real particles). The
  size/persistence/mix knobs (`base`, `LENS_LIFE`, `LENS_SPLAT_RATE`,
  `LENS_BIG_CHANCE`) and the smear scale remain named constants in `skiScene.ts`
  if the mix ever wants a nudge, but no ask is open on the splat itself.
- **Fling MORE on hard turns and jump landings — OPEN (director ask 2026-07-24:
  "want it to fling more when turning or landing a jump").** Both the plume and
  the lens splash should surge on a hard carve and burst on touchdown. Two parts:
  - **Turning:** crank the carve boost. Spray emit today is `SPRAY_BASE_RATE ·
    speedF · (1 + 1.4·sideF)` and the velocity `fan` scales with `sideF`; lens
    intensity is `speedF · (0.4 + 0.6·sideF) · closeness`. Raise the `sideF`
    multipliers (and/or make the launch velocity `back`/`up` scale with it) so a
    hard turn visibly throws a bigger, wider plume + more lens hits than a
    straight glide. Keep the pool headroom (`SPRAY_MAX` 4000) in mind.
  - **Landing a jump — the "poof" (elevated to a real ask, was parked below):**
    a one-shot outward burst of powder on the airborne→grounded transition (and
    the trick-landing slide), plus a heavier one-shot lens splat sharing the same
    impulse. The spray emitter's already there; it needs a **landing impulse
    signal**. `skiRender.ts` knows the transition via `jumpMemory` (mechanics-
    owned — read-only to us). Cleanest is a small **additive seam field**: have
    `setSkiMotion`/`syncEnvironment` pass a one-frame `justLanded` (or a
    0..1 landing-impact strength from fall speed) — mark it `// slope-vis` per
    PARALLEL.md and note it in the ROADMAP entry. Fallback if we don't want a
    seam change: infer the landing from the anchor's vertical motion the same way
    the plume infers speed (a sudden downward-then-flat in `anchor.y`), but the
    seam signal is more reliable (impact strength for free). Decide at build time.
- **Particle point-size vs. live fov.** `particleSizeScale()` bakes the fov
  (50°) and viewport height at load; a `resize` handler updates it, but a live
  fov change (none today) wouldn't. Cheap to drive off the camera each frame if
  it ever matters.
- **Spray ignores cast shadows** (same simplification as the snow glitter) —
  a plume under a tree still lights fully. Almost certainly not worth fixing.

## (slope-vis) Realistic snow — the follow-up test (director verdict, 2026-07-22)

> **Status 2026-07-23: route 2 (procedural) was built and failed the
> director's eye** — "flat, pixelated trails, no depth" (full diagnosis
> in ROADMAP 2026-07-23). Round 2 = *displaced geometry*: subdivided
> snowfield, vertex-displaced dunes, hollows AO-tinted shadow blue, and
> ski trails carved as real depressions in that heightfield (stamped via
> GPU brushes into a render-target the vertex shader samples — also
> kills round 1's 4 MB/frame canvas re-upload). Route 1 (photo textures)
> is the fallback comparison; the director has a **paid** pack candidate
> (ask for the link when needed) — the CC0 sources below get checked
> first if it comes to buying vs. downloading. Round-1 tangents parked:
> the glitter pass ignores cast shadows (a tree's shadow still twinkles
> faintly). Sideways carve-spray tied to carve angle **is now built** (the
> loose-snow ROADMAP entry, 2026-07-23); landing "poof" puffs (a burst on
> touchdown) are still open — see the loose-snow follow-ups entry below.

The texture test's split verdict: trees promoted, but **"I'm going for
realism snow"** — the painted dapple patch is out. What the realism test
needs to settle, sketched for the build session:

- **The snowfield plane HAS proper UVs** (planes always do), so real
  image textures work there — the no-UV constraint only bites on the
  converted GLB models. Two routes, can compose:
  1. **CC0 photo-based snow** (ambientCG / Polyhaven have snow sets with
     albedo + normal + roughness): most literal "realism," needs a
     download (Josh's ask first, per the download rule), a CREDITS.md
     row, and a check against the M4 15 MB load budget (a 1K set is
     usually ~1–3 MB compressed; 2K can blow past it fast).
  2. **Procedural realistic**: generated normal-map micro-relief +
     roughness-noise sparkle (glints that shift as the camera moves —
     real snow's signature), no files, no credits. Less literal but
     composes with the dawn lighting for free.
- **Palette constraint carried over:** believable white that still
  averages to sunlit-snow #F8F5EF, shadows still going to snow-shadow
  blue — realism in *surface*, not in *color grading*.
- **Tint trap from the lighting pass:** the scene's lights were solved so
  a #F8F5EF albedo renders exactly right; a photo texture's own color
  cast will fight that. Neutralize the albedo (desaturate/normalize to
  the palette family) before it goes in.
- **Snow-cap question:** the trees' snow caps are on no-UV meshes, so
  they can't wear the image texture — either the triplanar grain (kept
  from the approved tree look) reads close enough beside realistic
  ground snow, or the caps need a matching-family treatment. Judge in
  the test.
- **"Snow remembers" composes here:** carved ski trails / spray (the
  bible's standing rule, still unbuilt) will sit ON this surface —
  normal-map-based relief makes trail carving cheaper later (draw into
  the same maps) than a painted-color approach would have.
- Replace the painted patch in `skiScene.ts` with the realism patch,
  same side-by-side placement, and re-run the director verdict.

## (lobby) Texture showcase in the lobby background (director ask, 2026-07-22)

The director wants the lobby vignette to **feature the new textures** for
a close-up look — the lobby camera sits much nearer its trees than the
slope camera ever gets, so it's the natural inspection stage.

- The vignette already frames seven slope-pack trees/rocks (read-only use
  of `assets/slope/`). Applying the painted detail to them needs
  `applyPaintedDetail(...)`, which lives in `client/src/skiScene.ts`
  (slope-visuals territory) and is currently **not exported** — the
  smallest hand-off is slope-visuals exporting it (plus
  `getPaintedTextures` if the ground wants the snow maps), then
  `lobbyRender.ts` calling it on its decor. Per PARALLEL.md seam rules
  that export is a one-line additive change either session may make —
  tag it in the ROADMAP entry when it happens.
- Ground plane: swap to the **realistic snow** surface once that test
  lands (it's a plane, UVs fine) — until then the painted trees alone
  are already worth showing.
- Keep the dawn-vignette lighting as is — the point is seeing the
  textures under the game's real light, up close.

## (slope-mech) ~~Turning round 7~~ — BUILT 2026-07-23 (stance-aware W + sin⁴)

**(BUILT 2026-07-23 — see ROADMAP. Director-picked: fix option 1
(stance-aware W — the seek targets the fall line in your current
stance, which re-calls round 4's bar and retires the exactly-backwards
tie-break) plus the sin⁴ softening. Measured results: W riding switch
reaches −12, W+Shift −16, mirrored diagonals ±3π/4 exact; 45° carve
bleed halved (24.5 → 14.25 u/s²), hockey stop unchanged ~0.36s. One
sketch claim measured wrong: sin⁴ does NOT keep the *boosted* crossing
spent — it arrives at ~3.7 u/s and the backstop dump eats it, a
~4.4 u/s one-frame bite (unboosted still arrives spent at ~0.02).
Raising the peak to fix it would undo the softening, so the bite
shipped as the tuning knob — the headline playtest question.)**

**The verdict (director, on round 6):** the round-5 jerk is gone, but
"it feels abrupt" — and the real ask is bigger: **"I want to be able to
turn around and continue down the slope backwards. Currently, when I go
backwards I can only go base speed, and if I press W I flip forwards
again."** Riding switch should be a first-class way down the hill, not
just the aftermath of a pivot.

**The new bar:** turn around smoothly, then *stay* backwards at full
speed — lean and boost both working — until you choose to come back.

**Diagnosis** (`shared/src/skiing.ts`):

1. **"Only base speed backwards" is W being unavailable riding switch.**
   The target magnitude is stance-symmetric (the cosine handles it), and
   Shift-boost genuinely works backwards (16 u/s — worth re-checking at
   playtest whether it *felt* broken). But the only speed lean is W, and
   round 4 made W *seek the fall line* — so the one key that should mean
   "faster" while backwards instead whips you through a 180. That's also
   likely a chunk of the "abrupt": trying to speed up mid-switch fires
   an unwanted full turnaround at 1.8+ rad/s through the scrub zone.
2. **Round 4's bar and this ask directly conflict — needs a director
   call.** Round 4's directive was "return from switch to forward on W
   alone, never released" (there's a test pinning exactly that). The new
   ask is that W must *not* flip you forward. Both cannot hold; one bar
   has to be re-called.
3. **The abruptness knob:** SKID_SCRUB is 45, tuned (measured, round 6)
   so a boosted pivot arrives at the crossing below the flip epsilon.
   But the backstop dump landed in the same session — crossings are
   never-reversed regardless now — so 45 is no longer load-bearing for
   correctness; it's pure feel. Caveat: plainly lowering it re-opens a
   visible snap *at the crossing* (at 25, a boosted pivot arrives ~7 u/s
   and the dump eats it in one frame — ~8 u/s of lateral change). The
   gentler-without-snap option is a steeper curve, not a smaller peak.

**Fix options for the build session (director picks):**

1. **Stance-aware W** *(probably recommended)*: W always applies the
   speed lean, and its seek targets the fall line *in your current
   stance* — forward it eases heading → 0 as today; riding switch it
   eases heading → ±π, so W backwards means "straighten out and go
   faster backwards". W+steer holds the mirrored carve diagonals in
   switch (π ∓ π/4). Coming back forward becomes a deliberate held
   carve through sideways — which pays the skid toll and lands at the
   epsilon, i.e. exactly the round-6 physics; whether that return path
   feels fine (vs round 3's era, when it was clunky enough to spawn
   round 4) is the headline playtest question. Inverts the round-4 bar
   test and retires the exactly-backwards tie-break (dead backwards
   becomes switch's *stable point*, not a boundary to dither across).
2. **Seek only from forward stances**: keep round 4's seek when
   |heading| < π/2; plain lean (no seek) when riding switch. Smaller
   change, keeps more round-4 tests — but switch doesn't
   self-straighten, and a sloppy diagonal backwards stance just stays
   sloppy; the ±π/2 boundary sits in the scrub zone so the behavior
   change there is at near-zero speed anyway.
3. **Dedicated flip input**: W is always a pure lean; returning forward
   gets its own control (double-tap, or hold S while switch). Most
   explicit, but a new input on an already-full hint bar — probably
   overkill if 1 or 2 lands well.

**Softening options (composable with any of the above; may matter less
once W stops firing surprise 180s):**

- **sin² → sin⁴ on the scrub curve**: keeps the full 45 skid at dead
  sideways (hockey stops stay decisive, crossings stay spent) but
  roughly halves the bleed at a 45° carve (24.5 → 14 u/s²) — gentler
  everywhere except the stop itself, no crossing snap re-opened.
- **Lower SKID_SCRUB too** (e.g. ~30): softer stop, at the cost of a
  modest dump at the crossing (~4–5 u/s of lateral change from a boosted
  pivot). Numbers above; tune on the hill.
- First ask the director *where* it felt abrupt: the mid-turn bleed,
  the hockey stop, the switch slow-point, or the W-whip (fixed by part
  2 alone).

**Tests that must change:** option 1 inverts "returns from switch to
forward running on W alone" and retires "breaks the exactly-backwards
tie with a right turn"; "seeks the fall line the shortest way around"
and "boosts the W-seek home too" re-target to the stance-aware goal;
"keeps W a pure speed lean when already pointing downhill" survives and
gains a switch twin. The round-6 scrub/dump/never-uphill tests all
survive untouched.

## (slope-mech) ~~Turning round 6~~ — BUILT 2026-07-23 (the skid scrub)

**(BUILT 2026-07-23 — see ROADMAP. Option 1, director-picked: the
speed-loss rate ramps with sin² of how far the skis are off the fall
line, from plain coast drag (4) at aligned to a hard skid at full
sideways. The sketch's 12–15 guess for the sideways rate measured too
weak — a boosted pivot still reached the crossing at ~10 u/s, which
would re-create the round-5 jerk — so it shipped at 45: the boosted
worst case now arrives at ~0.13 u/s, below the flip epsilon, and the
easing-through-zero handles the crossing with no jerk at all. The
stance flip stays as the never-uphill backstop, and now *dumps* to the
epsilon instead of carrying magnitude — closing the one path that
skipped the scrubbed approach (landing a jump pointed near sideways at
speed, where a wiggle across ±π/2 would have mirrored full boost
speed). Both predicted side effects landed: hockey stop from boost
~0.4s, and W+Shift turnaround passes through a slow point and rebuilds
— 2.2s back to full boost speed.)**

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

~~**Current state until round 6 lands:** round 5 is merged to master, so
the jerky crossing is what's live.~~ *(Round 6 landed 2026-07-23.)*

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
- **(slope-vis) MegaKit twisted trees as landmarks** (pine-sourcing
  session, 2026-07-23) — the Stylized Nature MegaKit's five Twisted Trees
  have spectacular gnarled, spiraling trunks — the most "mystical" shapes
  in the pack — but they're ~9k tris (over even the set-piece budget),
  deciduous, and red-canopied. Parked: one, decimated and snow-recolored,
  could be a rare once-per-run landmark (a crossroads marker, a shrine
  tree) rather than scatter. Needs the bible rewrite's word on decimation
  and on how far "set piece" stretches. Models inspected at
  https://poly.pizza/m/9aWlx82xUf (and 4 siblings, all CC0).
- **(lobby) Swap the lobby's old pines for StylizedPine models** (director
  call, 2026-07-23) — the slope's tree direction is now the MegaKit
  stylized pines, and the old Ultimate Nature Pack trees are ordered off
  the slope entirely. `lobbyRender.ts` still places
  `PineTree_Snow_{1,4,2}.glb`; swap them to `StylizedPine_*` equivalents
  (watch the height fields — the new pines are 7–10m at scale 1) so
  slope-vis can delete every `PineTree_Snow`/`BirchTree_*` file and their
  CREDITS rows. Note the frosted-green canopy retune (bible transition
  note) may re-export the GLBs first — coordinate, don't race it.
