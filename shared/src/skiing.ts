import { BRANCH_SEGMENTS, BRANCH_START, type Segment } from "./route";

export interface SkiInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly jump: boolean;
  readonly boost: boolean;
  // The air spin (turning round 9, director redirect 2026-07-23: "hold
  // Space in air to spin — faster spin than the ground turn"; this replaced
  // round 8's rejected double-tap 180): ±1 while the jump key is held
  // airborne rotates the body at AIR_SPIN_RATE toward that side; 0 = not
  // spinning. The *client* owns the side (the held steer key, else the last
  // steered direction) — the sim stays pure and just takes the trick as an
  // input. Grounded it's deliberately nothing: on the snow Space means the
  // jump charge, and only that.
  readonly spin: -1 | 0 | 1;
}

export interface Chasm {
  readonly id: string;
  readonly start: number;
  readonly width: number;
}

// "skiing" — normal play. "crashed" — brief pause after losing a life,
// before respawning at the last checkpoint. "forfeited" — all nine lives
// gone; the run is over (half XP once XP exists — see DESIGN.md).
// "finished" — crossed the finish line: the run is won. Input stops driving
// it, the skier coasts to a stop past the line, and after FINISH_LINGER the
// client returns to the lobby (full XP once XP exists).
export type RunStatus = "skiing" | "crashed" | "forfeited" | "finished";

export interface SkiState {
  readonly distance: number;
  readonly lateral: number;
  // Which way the skis point, in radians. 0 = straight downhill, positive =
  // turned right, negative = turned left. Steering turns this and it STAYS
  // turned when the key is released (like real skiing — you steer back
  // yourself). There is no "turned too far" (turning round 3, director
  // redirect): carve past sideways and you pivot into riding switch,
  // tails-first down the hill, instead of falling over. Turning off the
  // fall line skids speed away (turning round 6), so by the time the skis
  // cross sideways the run is nearly spent and the speed just eases
  // through zero; a residual-speed crossing flips the stance instead, so
  // the momentum never turns uphill (round 5's surviving guarantee). A
  // held turn ends at straight-backwards (turning round 10): grounded
  // steer saturates at ±π instead of wrapping through it, so one hold is
  // at most one turnaround — carve to sideways, pivot into switch, settle
  // riding backwards — never the endless rotate-die-rebuild serpentine.
  // On the snow the heading lives in [-π, π] — the sign at the ends
  // remembers which way you turned around, and the opposite key carves
  // back. Mid-air it can accumulate whole spins, and landing collapses it
  // (see downhillHeading).
  readonly heading: number;
  // The direction the run is actually traveling, everywhere. Airborne it's
  // frozen on the takeoff frame — flight is ballistic (nothing to carve
  // against), so spinning mid-air turns the body, not the path. Grounded it
  // *grips* onto the ski axis at GRIP_RATE instead of snapping (turning
  // round 8): ordinary carving turns slower than the grip closes, so on the
  // snow this equals the ski axis exactly — but a landing can put the skis
  // a wide angle off the flight direction, and then you keep sliding the
  // way you were flying for a beat while the skis bite into the new line.
  // Transient state, deliberately not saved: a restore re-derives it from
  // heading + stance (a restore mid-slip grips instantly — same spirit as
  // a mid-air restore losing its spin).
  readonly flightHeading: number;
  readonly height: number;
  readonly verticalVelocity: number;
  // Signed travel speed: magnitude is how fast the run is moving (along
  // flightHeading), sign is the stance — positive = traveling toward the
  // ski tips, negative = tails-first, riding switch (turning round 3 —
  // landing backwards is a stance, not a crash). Gripped (the usual case)
  // travel follows the ski axis, so this is "speed along the skis"; during
  // a landing slip the skis are off the travel line and the magnitude is
  // the slide itself.
  readonly speed: number;
  // How long the jump key has been held while grounded, in seconds, capped
  // at JUMP_CHARGE_TIME. Jumping is hold-to-charge (director call,
  // 2026-07-22): holding crouches into a load, releasing launches — deeper
  // charge, higher jump. Transient input state, deliberately not saved: a
  // restore starts uncharged, same spirit as flightHeading above.
  readonly jumpCharge: number;
  // Seconds left in the touchdown lockout (see LANDING_RECOVERY): set on the
  // landing frame, ticks down on the snow, and while it's running the jump
  // key neither loads nor launches. Transient input-adjacent state,
  // deliberately not saved: a restore lands (or resumes) recovered, same
  // spirit as jumpCharge above.
  readonly landingRecovery: number;
  // Seconds left in the tired-hop cue (see TIRED_HOP_DURATION): set when the
  // jump key presses into the landing lockout, so the renderer can show the
  // locked-out attempt — the skier's legs are spent, and the eaten input
  // should read as *their* failure, not the game ignoring the key. The sim
  // itself does nothing with it: height never leaves the snow, no physics
  // change — it's a clock the renderer shapes the tired little bob from.
  // Transient presentation cue, deliberately not saved: a restore resumes
  // with nothing to apologize for, same spirit as landingRecovery above.
  readonly tiredHop: number;
  // Whether the jump key was held on the *previous* frame, so the tired-hop
  // trigger can require a rising edge (up→down) instead of firing on any
  // held key. Without it, a jump key carried through an air spin counts as a
  // failed attempt the instant you touch down, even though you never
  // re-pressed (bug, 2026-07-23). The charge path still uses the level
  // signal (input.jump) — only the tired-hop cue needs the edge. Transient
  // input bookkeeping, deliberately not saved: a restore starts with the key
  // "up", same spirit as jumpCharge above.
  readonly prevJumpHeld: boolean;
  readonly status: RunStatus;
  readonly lives: number;
  readonly respawnTimer: number;
  readonly lastCheckpoint: number;
  readonly checkpoints: readonly number[];
  readonly chasms: readonly Chasm[];
  // Which segment of the route the run is on (the branching map — see
  // route.ts). "main" is the un-branched single-segment run (Slope 1, the
  // Overlook): one segment, `next` null, so it never transitions and behaves
  // exactly as before segments existed. On the branching map this names the
  // spine or detour segment you're skiing, and `distance` is measured from
  // THIS segment's entrance. Deliberately not saved: the branching map is
  // dev-only for now, and a restore rebuilds from createInitialSkiState (the
  // Overlook), which is "main".
  readonly segmentId: string;
  // A pending Type A fork (branching map): set to a detour segment's id while
  // the run is inside that segment's trigger volume (the great tree grabbing
  // you), consumed at the next segment boundary to route into the detour
  // instead of the road, then cleared. null when no fork is pending. Transient
  // routing intent, not saved — same spirit as flightHeading; a restore starts
  // with no fork pending.
  readonly divertTo: string | null;
  // Where the CURRENT segment ends. Crossing it (distance >= finishDistance)
  // either transitions to the next segment (branching map) or, when the segment
  // is terminal (`next` null — always the case for the Overlook's single
  // "main" segment), wins the run: status flips to "finished". The name is
  // historical (it was the whole slope's finish before segments); for a
  // one-segment run it still is exactly that. Static layout, like
  // chasms/checkpoints: it comes fresh from the initial-state builders and is
  // deliberately not saved, so retuning a segment's length never leaves an old
  // value trapped in a save.
  readonly finishDistance: number;
  // Seconds left in the post-finish coast-out before the client auto-returns
  // to the lobby (see FINISH_LINGER). Set on the finish frame, ticks down
  // while "finished". Transient — not saved: a restore mid-coast resumes with
  // 0 and the client returns immediately, same spirit as respawnTimer's kin.
  readonly finishTimer: number;
}

// Exported for the client: audio scales wind/carve loudness off these
// (|speed| / BOOST_SPEED, and "is this a boost" = |speed| > MAX_SPEED), the
// ski pose maps |speed| across [MIN_SPEED, BOOST_SPEED] onto the crouch
// depth, and the pole push-off cycle fades out as speed approaches
// BASE_SPEED — speed encodes where the run is at, so the body can read it
// back from state alone.
export const BASE_SPEED = 8;
export const MIN_SPEED = 4;
export const MAX_SPEED = 12;
const LEAN_SHIFT = 6;
export const BOOST_SPEED = 16;
// Momentum (M2): speed is inertial. The lean/boost inputs set a *target*
// and the actual speed eases toward it — runs start from a standstill with
// a pole push-off instead of teleporting to cruise speed. Growing the speed
// magnitude is slower than losing it (braking bites, gravity builds), and a
// released boost coasts down through drag rather than snapping back.
const SKI_ACCEL = 4;
const BOOST_ACCEL = 8;
const COAST_DRAG = 4;
const BRAKE_DECEL = 10;
// The skid scrub (turning round 6, director verdict 2026-07-22: "momentum
// should be lost if the skis are sideways"). The speed-loss rate ramps with
// how far the skis are turned off the fall line — aligned coasting sheds at
// plain COAST_DRAG, fully sideways skids at this rate, blended by sin⁴ of
// the heading (which is also symmetric for switch: tails-first down the
// fall line is aligned too, no scrub). The exponent was sin² through round
// 6; round 7 steepened it to sin⁴ (director pick, 2026-07-23, answering
// round 6's "it feels abrupt"): the full 45 skid at dead sideways is
// untouched — hockey stops stay decisive at ~0.36s from boost — but the
// mid-carve bleed roughly halves (a 45° carve scrubs at 14.25 u/s² instead
// of 24.5), so held diagonals and slalom swings keep their flow. Measured
// cost of the steeper curve: the boosted worst-case pivot (BOOST_SPEED 16,
// boosted turn rate 2.52 rad/s → sideways in ~0.62s) now crosses the high-
// scrub zone too fast to die entirely and reaches the crossing at ~3.7 u/s
// (sin² spent it to ~0.1), where the backstop flip dumps it — a ~4.4 u/s
// one-frame lateral change, far under round 5's rejected ~27 but no longer
// nothing. Unboosted pivots still arrive spent (~0.02). Raising the peak to
// re-spend the boosted crossing would undo the softening (at 90, a 45°
// carve is back to sin² bleed) and sharpen the hockey stop — the wrong
// trade against the "abrupt" verdict, so the small boosted-crossing bite
// stands as the tuning knob to revisit at playtest.
const SKID_SCRUB = 45;
// Steering is a real turn (M2 heading session): holding left/right keeps
// rotating the skis, up to fully sideways and beyond — no stop at sideways,
// and no fall either (turning round 3): past sideways you pivot into
// riding switch. The rotation does end, though: a grounded hold saturates
// at straight-backwards (turning round 10 — see the clamp in stepSkiing).
// TURN_RATE is how fast the skis rotate at full authority —
// ONE rate everywhere, grounded or airborne (director call, 2026-07-22:
// the 9 rad/s air-trick rate and the held/fresh key split are gone).
const TURN_RATE = 1.8;
// Steering authority builds with speed (carving comes from the skis
// biting), but never drops to zero: a stopped skier can still pivot their
// skis in place. Without the floor, braking-by-turning down to a full
// sideways stop would leave you unable to steer back — a softlock.
const STANDSTILL_AUTHORITY = 0.4;
// Boost commits harder into direction changes (turning round 5, director
// call 2026-07-22: "Shift should speed up direction changing"). Holding
// boost multiplies the turn rate — everywhere steering runs, manual and
// W-seek alike, so it stays one steering system.
const BOOST_TURN_MULTIPLIER = 1.4;
// The stance flip (turning round 5): grounded travel follows the ski axis,
// so a pivot at speed would rotate the momentum with the skis — carry it
// past sideways and you'd be redirected tips-first up the hill (the boost ×
// turnaround bug: 3.5s of uphill travel at 9+ u/s). When a grounded pivot
// carries the heading across ±π/2 above this epsilon, the speed sign flips
// so the downhill component of travel never turns uphill. Since round 6's
// skid scrub, the flip is a backstop rather than the normal path: an
// unboosted held pivot arrives at the crossing already scrubbed below this
// epsilon (see SKID_SCRUB), where the easing-through-zero handles it. The
// flip fires on states that outrun the scrubbed approach — landing a jump
// pointed near sideways at speed, or (since round 7's sin⁴ softening) a
// boosted held pivot, which crosses carrying a few u/s — and it dumps the
// run to this epsilon
// rather than carrying the magnitude (round 5's carry mirrored the lateral
// drift, which is the jerk that failed its playtest; and crossing sideways
// spending the run IS the round-6 model). So a crossing is never faster
// than a crawl, whichever path reached it.
const PIVOT_FLIP_MIN_SPEED = 1;
// The landing grip window (turning round 8, director directive 2026-07-23:
// "I feel like there's not enough slippage when I land… I should slide
// forward a bit before going perfectly diagonal"). Grounded travel eases
// onto the ski axis at this rate (rad/s) instead of snapping — so a landing
// keeps sliding along the flight direction while the skis bite into the new
// line, and a bigger landing angle slides visibly longer for free (rate-
// based, no timer). The value is deliberately above the fastest possible
// steer (TURN_RATE × BOOST_TURN_MULTIPLIER = 2.52 rad/s), so gripped
// grounded play can never fall behind the skis: rounds 5–7 physics are
// bit-for-bit unchanged outside a landing. The worst legal landing slip is
// π/2 (the landing stance rule picks the sign that keeps travel within a
// quarter turn of the skis), which grips in ~0.45s; the director's repro
// (~1.44 rad off) takes ~0.41s. Tuning knob: lower = longer, driftier
// slides.
const GRIP_RATE = 3.5;
// W means "faster, in the stance you're in" (turning round 7, director call
// 2026-07-23: "I want to be able to turn around and continue down the slope
// backwards" — riding switch is a first-class way down the hill, not just
// the aftermath of a pivot). On top of its speed-up meaning, holding W
// straightens the skis onto the fall line *in the current stance*: forward
// it eases the heading toward straight-downhill (turning round 4's seek,
// unchanged); riding switch it eases toward straight-backwards instead, so
// W backwards means "line up and go faster backwards" — never the surprise
// 180 that round 4's always-seek-forward fired (that whip through the skid
// zone was a chunk of round 6's "abrupt" verdict, and it inverted this
// round's director bar). Note this deliberately re-calls round 4's bar
// ("return from switch on W alone"): coming back forward is now a held
// steer carve through sideways — which pays the round-6 skid toll, exactly
// like turning into switch does. With a steer key held too, the target is
// the carve diagonal to that side in the same stance (mirrored while
// switch, so each key keeps pulling toward its own screen side). Dead
// backwards is switch's stable point now, not a tie to break.
const SEEK_DIAGONAL = Math.PI / 4;
// The air spin's rotation rate (turning round 9 — "faster spin than on
// ground turn"). A body trick, not an edge carve, so it runs at full rate
// regardless of speed (no authority scaling) and takes over from the held
// steer / W-seek while it lasts — one rotation channel at a time. Sized
// against real airtime: a tap jump (~0.78s) fits a 180 with room to spare
// (π/6.5 ≈ 0.48s), and a full-charge jump (~1.22s) fits a 360 with ~0.25s
// of margin after the re-press (you release Space to launch, so the spin
// needs a fresh press). Ground turn is 1.8 (2.52 boosted) — this is ~2.6×
// the boosted rate, unmistakably a trick. Tuning knob: higher = snappier
// spins but touchier release timing on a clean 180/360 (the landing
// collapse and the round-8 grip window both forgive the overshoot).
const AIR_SPIN_RATE = 6.5;
// Half the skiable width. Widened 4 → 12 (director directive, 2026-07-22:
// open up the skiable area — carving, hockey stops, and switch riding all
// want room). The edge stays a hard clamp (director call, same day).
// Since Slope 1's rock gate (see laneHalfWidth) this is the *maximum* /
// default half-width: the lane never opens wider than this (widening would
// push travel into the treeline the visuals scatter just past this edge), it
// only pinches narrower at the gate. Exported for save.ts (restoring clamps
// lateral to this max) and the renderer (the visual lane and decor scatter
// key off it).
export const LATERAL_LIMIT = 12;
// The rock gate (Slope 1 "The Overlook", beat 5 — slope-mech, 2026-07-23):
// slate spires pinch the lane briefly before the finish, "tension and framing
// before the end" (DESIGN.md). Mechanically it's a distance-varying lateral
// clamp — no new crash, just less room to maneuver — narrowing from the full
// LATERAL_LIMIT down to ROCK_GATE_HALF_WIDTH at the gate center, smoothly over
// ROCK_GATE_RAMP units each side (a raised cosine, so no wall snaps in). The
// pinch only ever narrows, never widens (see LATERAL_LIMIT).
//
// SEAM NOTE (slope-mech → slope-vis): the *visual* lane + the spire art live
// in skiScene.ts (slope-vis territory) and today read the constant
// LATERAL_LIMIT, so the pinch is currently an invisible narrowing — the snow
// and treeline don't follow it yet. laneHalfWidth is exported so slope-vis can
// make the visual lane and the rock-gate spires track the real clamp. Parked
// for them in IDEAS.md (slope-vis).
const ROCK_GATE_DISTANCE = 560;
const ROCK_GATE_HALF_WIDTH = 6;
const ROCK_GATE_RAMP = 40;

// The playable half-width at a given distance down the slope. LATERAL_LIMIT
// everywhere except the rock-gate pinch. Exported for save.ts, the tests, and
// slope-vis (the visual lane should follow this — see the seam note above).
export function laneHalfWidth(distance: number): number {
  const offset = Math.abs(distance - ROCK_GATE_DISTANCE);
  if (offset >= ROCK_GATE_RAMP) {
    return LATERAL_LIMIT;
  }
  // 1 at the gate center, 0 at the ramp edges — a smooth raised cosine.
  const pinch = 0.5 * (1 + Math.cos((offset / ROCK_GATE_RAMP) * Math.PI));
  return LATERAL_LIMIT - (LATERAL_LIMIT - ROCK_GATE_HALF_WIDTH) * pinch;
}
// Hold-to-charge jumping (director call, 2026-07-22): a tap gives the
// minimum jump — exactly the old fixed jump, so quick reactions still clear
// chasms — and holding loads a deeper crouch that launches on release, up
// to the max at a full charge. Exported for the renderer (crouch depth
// reads the charge) and audio (takeoff whoosh scales with launch speed).
export const MIN_JUMP_VELOCITY = 7;
export const MAX_JUMP_VELOCITY = 11;
export const JUMP_CHARGE_TIME = 0.6;
// The landing lockout (director directive 2026-07-23: "after landing from a
// jump, the player should not be able to immediately jump"). Touching down
// starts this timer, and until it runs out the jump key does nothing — no
// load, no launch. A key held through a landing waits out the lockout and
// *then* starts its fresh load, so the soonest possible re-jump is lockout +
// tap. Sized as a beat, not a penalty: about a third of a tap jump's airtime
// (~0.78s), long enough to kill the instant pogo bounce, short enough that
// deliberate hop-hop-hop rhythm play still flows. Exported for the tests
// (they wait it out) and for the renderer/audio if the landing absorb ever
// wants to read it. Tuning knob: higher = heavier, more committal landings.
export const LANDING_RECOVERY = 0.3;
// The tired hop (director directive 2026-07-23, riding the lockout's
// acceptance): a locked-out jump press gets a visual response — "a small hop
// that looks like a tired attempt" — instead of nothing. This is a *pure
// presentation cue*, deliberately not a real sim hop: a real hop would make
// the skier airborne (opening the air spin mid-lockout), restart the lockout
// on its own touchdown (chained lockouts), and hand the eaten input the very
// gameplay effect the lockout exists to deny. So the sim just starts this
// clock when a press lands during the lockout, and the renderer shapes the
// weak knee-dip and feeble lift from it — the skis never actually leave the
// snow. Sized *longer* than LANDING_RECOVERY so the cue visibly outlives the
// lockout; a real launch under a leftover cue cancels it — the legs evidently
// recovered. Retuned twice on 2026-07-23: the original 0.3s read as a stutter,
// so it went to 0.8s "slow and deep" — but that overshot ("it's not fast
// enough now. by deep i meant an actual small hop"), so it's back down to
// 0.5s: a quick spent-legs attempt that pops a real little hop (the renderer's
// TIRED_LIFT does the popping) and lands going nowhere, not a long grounded
// buckle. The one-attempt-per-lockout guarantee only needs duration ≥
// LANDING_RECOVERY (a second press finds the cue still running and does
// nothing) — there's a test pinning that ordering, and 0.5 ≥ 0.3 keeps it.
// Exported for the renderer (it normalizes the clock into animation progress).
export const TIRED_HOP_DURATION = 0.5;
const GRAVITY = -18;
const CHASM_CLEAR_HEIGHT = 0.4;
export const STARTING_LIVES = 9;
export const RESPAWN_DELAY = 1.5;
// The finish (Slope 1 skeleton — slope-mech, 2026-07-23). The slope is finite
// now: crossing FINISH_DISTANCE wins the run. Recommended ~800 units ≈ 75–90 s
// at cruise (DESIGN.md) — the spine the whole track hangs on; tune freely.
export const FINISH_DISTANCE = 800;
// The coast-out after the line (director call, 2026-07-23: "coast, then
// auto-return"). On finishing, input stops driving the run and the skier
// glides to a stop; this long holds the moment — enough to coast down from a
// boosted crossing (~4 s at COAST_DRAG) and read the banner — then main.ts
// sends you back to the lobby. Tuning knob: shorter = snappier return.
export const FINISH_LINGER = 4;

// The heading a spin lands on: the nearest downhill-equivalent angle, in
// (-π, π]. A completed 360 collapses back to ~0 and lands clean; a half
// spin collapses to ~±π — landed tails-first, riding switch. Exported for
// save.ts (healing a mid-spin heading) and the renderer (stance-relative
// carve angles).
export function downhillHeading(heading: number): number {
  return heading - 2 * Math.PI * Math.round(heading / (2 * Math.PI));
}

export function createInitialSkiState(): SkiState {
  return {
    distance: 0,
    lateral: 0,
    heading: 0,
    flightHeading: 0,
    height: 0,
    verticalVelocity: 0,
    // Runs start from a standstill — the push-off to cruise speed is part
    // of the run, not something that happens before it.
    speed: 0,
    jumpCharge: 0,
    landingRecovery: 0,
    tiredHop: 0,
    prevJumpHeld: false,
    status: "skiing",
    lives: STARTING_LIVES,
    respawnTimer: 0,
    lastCheckpoint: 0,
    // Slope 1 "The Overlook" laid out to the beat sheet (DESIGN.md) — the
    // endless sandbox retired for a finite track (slope-mech, 2026-07-23).
    // One checkpoint sits just before each chasm, so a crash only ever
    // replays the hazard that killed you: warm-up (cp 0), chasm-2 (cp 150),
    // the signature cliff jump (cp 285), chasm-4 (cp 420), and chasm-5 past
    // the rock gate (cp 620). The stretch after cp 620 is a clean glide to
    // the finish at 800 — no hazard, so no checkpoint needed there.
    checkpoints: [0, 150, 285, 420, 620],
    // The Overlook is one segment ("main") that ends at the finish — `next`
    // is implicitly null (no registry entry for "main"), so it never
    // transitions and the finish logic below reduces to the pre-segment
    // behavior exactly.
    segmentId: "main",
    divertTo: null,
    chasms: [
      // Beat 2 — the warm-up: one easy chasm to learn the jump.
      { id: "chasm-1", start: 120, width: 3 },
      // A modest gap on the run-in to the vista (an "extra" — director call,
      // 2026-07-23: sprinkle a few so the long track isn't dead air).
      { id: "chasm-2", start: 250, width: 3.5 },
      // Beat 4 — THE signature cliff jump: a wide glacial crevasse, the run's
      // payoff. Deliberately wider than the rest (5.5): a timed cruise tap
      // only just fails it, so clearing it wants a charged jump or a boost.
      { id: "chasm-3", start: 380, width: 5.5 },
      // Two more back-half gaps escalating toward the finish (the "extras").
      { id: "chasm-4", start: 500, width: 3.5 },
      { id: "chasm-5", start: 660, width: 4 },
    ],
    finishDistance: FINISH_DISTANCE,
    finishTimer: 0,
  };
}

// A fresh run on the branching map (SLOPE_BRANCHING.md — "the actual map"),
// starting at the summit segment. Reuses every transient/physics default from
// the Overlook's initial state (a run is a run — same body, same feel) and only
// swaps in the route skeleton: which segment you're on, that segment's end and
// hazards, and no pending fork. Dev-only for now (see main.ts's entry flag);
// the grayblock de-risk of the fork handoff, not a shipped slope.
export function createBranchingSkiState(): SkiState {
  const seg = BRANCH_SEGMENTS[BRANCH_START]!;
  return {
    ...createInitialSkiState(),
    distance: 0,
    lateral: 0,
    lastCheckpoint: 0,
    checkpoints: seg.checkpoints,
    chasms: seg.chasms,
    segmentId: seg.id,
    divertTo: null,
    finishDistance: seg.length,
  };
}

function fellIntoAChasm(
  chasms: readonly Chasm[],
  distance: number,
  height: number,
): boolean {
  if (height >= CHASM_CLEAR_HEIGHT) {
    return false;
  }
  return chasms.some(
    (chasm) => distance >= chasm.start && distance <= chasm.start + chasm.width,
  );
}

function respawnAtCheckpoint(state: SkiState): SkiState {
  return {
    ...state,
    distance: state.lastCheckpoint,
    lateral: 0,
    // Respawn pointing straight downhill — whatever turn you crashed
    // carrying doesn't follow you back to the checkpoint.
    heading: 0,
    flightHeading: 0,
    height: 0,
    verticalVelocity: 0,
    // A crash scrubs all your speed — you push off again from the
    // checkpoint, so momentum lost is part of the crash's cost.
    speed: 0,
    jumpCharge: 0,
    landingRecovery: 0,
    tiredHop: 0,
    // Start the key "up" — a jump held through the crash shouldn't count as a
    // fresh press on the respawn frame (same edge logic as the tired hop).
    prevJumpHeld: false,
    // Respawn stays in the current segment (a crash inside a detour restarts at
    // that detour's entrance — SLOPE_BRANCHING.md §6), but any fork you'd
    // triggered on the fatal approach is cleared: you get to choose again.
    // segmentId is preserved by the spread above.
    divertTo: null,
    status: "skiing",
    respawnTimer: 0,
  };
}

export function stepSkiing(state: SkiState, input: SkiInput, dt: number): SkiState {
  if (state.status === "forfeited") {
    return state;
  }

  if (state.status === "finished") {
    // The coast-out (director call, 2026-07-23): the line is crossed, input no
    // longer drives the run. Speed eases to a stop through drag and the skier
    // glides past the banner; when finishTimer expires the client returns to
    // the lobby (main.ts). No steering, no jumping, no crashing past the line.
    const finishTimer = Math.max(0, state.finishTimer - dt);
    const speed =
      state.speed > 0
        ? Math.max(0, state.speed - COAST_DRAG * dt)
        : Math.min(0, state.speed + COAST_DRAG * dt);
    const travelSpeed = Math.abs(speed);
    const distance = state.distance + travelSpeed * Math.cos(state.flightHeading) * dt;
    const halfWidth = laneHalfWidth(distance);
    const lateral = Math.max(
      -halfWidth,
      Math.min(
        halfWidth,
        state.lateral + travelSpeed * Math.sin(state.flightHeading) * dt,
      ),
    );
    // Settle any airborne crossing back onto the snow — a jump can carry you
    // over the line, and the coast shouldn't strand the skier mid-air.
    const verticalVelocity = state.verticalVelocity + GRAVITY * dt;
    const height = Math.max(0, state.height + verticalVelocity * dt);
    return {
      ...state,
      finishTimer,
      speed,
      distance,
      lateral,
      height,
      verticalVelocity: height <= 0 ? 0 : verticalVelocity,
      prevJumpHeld: input.jump,
    };
  }

  if (state.status === "crashed") {
    const respawnTimer = state.respawnTimer - dt;
    if (respawnTimer > 0) {
      return { ...state, respawnTimer };
    }
    return state.lives > 0
      ? respawnAtCheckpoint(state)
      : { ...state, status: "forfeited", respawnTimer: 0 };
  }

  const grounded = state.height <= 0;

  // The inputs pick a target *magnitude*; the heading decides how much of
  // it the hill actually gives you (below); momentum decides how fast you
  // get there.
  const targetMagnitude = input.boost
    ? BOOST_SPEED
    : Math.max(
        MIN_SPEED,
        Math.min(
          MAX_SPEED,
          BASE_SPEED + (input.up ? LEAN_SHIFT : 0) - (input.down ? LEAN_SHIFT : 0),
        ),
      );

  // Steering rotates the skis and the heading stays where you put it —
  // steering back is on you. One turn rate everywhere (turning round 3);
  // authority builds with speed but floors at the standstill pivot.
  const steerAuthority = Math.max(
    STANDSTILL_AUTHORITY,
    Math.min(1, Math.abs(state.speed) / MIN_SPEED),
  );
  let heading = state.heading;
  if (grounded && Math.abs(heading) > Math.PI) {
    // On the snow the heading lives in [-π, π] — whole turns only ever
    // accumulate mid-air. Guarded so an exact ±π (the held-steer
    // saturation point, turning round 10 — see the clamp below) keeps its
    // sign: downhillHeading's rounding maps +π to −π, and that flip would
    // hand a saturated right-hold a fresh 2π of rotation — the serpentine
    // this round removed, reopened through the back door.
    heading = downhillHeading(heading);
  }
  // Where the skis pointed before this frame's steering — the stance flip
  // below compares against it to spot a sideways crossing.
  const headingBefore = heading;
  const maxTurn =
    TURN_RATE *
    (input.boost ? BOOST_TURN_MULTIPLIER : 1) *
    steerAuthority *
    dt;
  if (!grounded && input.spin !== 0) {
    // The air spin (turning round 9): holding the jump key airborne whips
    // the body around at the trick rate, toward the steered side. It owns
    // the rotation while it lasts — held steer and the W-seek wait — and
    // the heading accumulates whole turns up here, so holding it long
    // enough is a 360 (or more). The landing collapse below sorts out
    // whatever angle you come down at; flight stays ballistic throughout.
    heading += AIR_SPIN_RATE * input.spin * dt;
  } else if (input.up) {
    // W seeks the fall line in the current stance (turning round 7 — see
    // SEEK_DIAGONAL): forward stances ease toward straight-downhill,
    // switch stances toward straight-backwards, each with its own carve
    // diagonals a steer key away. The stance test is which alignment the
    // skis are nearer (the flip and the scrub keep travel and heading in
    // step through crossings, and it stays well-defined at a standstill,
    // where the speed sign wouldn't be). Easing the nearest-equivalent
    // offset takes the shortest way around; since the target is always in
    // the heading's own half, the seek never carries the skis across
    // sideways — and no target is ever a half-turn away, which retires
    // round 4's exactly-backwards tie-break.
    const forwardTarget =
      (input.right ? SEEK_DIAGONAL : 0) - (input.left ? SEEK_DIAGONAL : 0);
    const ridingSwitch = Math.abs(downhillHeading(heading)) > Math.PI / 2;
    const target = ridingSwitch ? Math.PI + forwardTarget : forwardTarget;
    const delta = downhillHeading(target - heading);
    heading += Math.max(-maxTurn, Math.min(maxTurn, delta));
  } else {
    if (input.left) heading -= maxTurn;
    if (input.right) heading += maxTurn;
    if (grounded) {
      // The turnaround saturation (turning round 10, director directive
      // 2026-07-23: "remove auto straightening — I can hold one turn and
      // create a semi circle of constantly trying to turn around"). A held
      // key used to rotate through backwards forever: every half turn the
      // run died at sideways, gravity rebuilt it in the new stance, and
      // the trail re-straightened downhill — an endless S of turnarounds.
      // Grounded steer now stops at straight-backwards: carve to sideways,
      // keep holding to pivot into switch, and settle riding backwards
      // down the fall line — the turnaround happens once. The wall only
      // holds against the key that built the turn; the opposite key carves
      // back through sideways (paying the round-6 skid toll, same as
      // ever). Ground 360s die here, deliberately — full spins are the
      // air trick (round 9). Airborne held steer stays unclamped.
      heading = Math.max(-Math.PI, Math.min(Math.PI, heading));
    }
  }

  // Speed is signed along the ski axis; the target is the input magnitude
  // projected onto the downhill direction. Pointed downhill that's the full
  // target; sideways it's ~0 — turning IS braking, all the way down to a
  // hockey stop; pointed uphill it's negative — gravity pulls you
  // tails-first into riding switch. The cosine makes the whole range
  // continuous: no mirror seam at sideways, speed just eases through zero —
  // and the skid scrub (round 6) makes the easing *rate* ramp toward a hard
  // skid as the skis leave the fall line, so the approach to sideways
  // dumps the momentum, not just the target. Speed only changes on the
  // snow — airborne there's nothing to push against or brake with, so you
  // land carrying your takeoff speed.
  let speed = state.speed;
  let flightHeading = state.flightHeading;
  if (grounded) {
    // The stance flip (turning round 5, backstop since round 6): this
    // frame's steering carried the skis across sideways with residual
    // speed — the stance flips so travel never turns uphill, and the run
    // dumps to the epsilon (crossing sideways spends the momentum). See
    // PIVOT_FLIP_MIN_SPEED.
    if (
      Math.abs(speed) >= PIVOT_FLIP_MIN_SPEED &&
      Math.cos(headingBefore) * Math.cos(heading) < 0
    ) {
      speed = -Math.sign(speed) * PIVOT_FLIP_MIN_SPEED;
    }
    const target = targetMagnitude * Math.cos(heading);
    const stepUp = target > speed;
    // Pick the easing rate by what this step does to the speed *magnitude*:
    // growing = something pulling you along (gravity down the axis, or the
    // boost); shrinking = drag, the brake, or the skid — whichever bites
    // hardest. The skid scrub ramps from plain drag on the fall line to a
    // hard hockey-stop skid at full sideways (see SKID_SCRUB).
    const gainingMagnitude = (stepUp ? speed : -speed) >= 0;
    // The scrub angle is the *worse* of two misalignments: the skis off
    // the fall line (rounds 6–7 — turning is braking), and the skis off
    // the travel direction (round 8 — the landing slip: skis sideways to
    // your motion plow, so a hard diagonal landing bleeds while it slides,
    // which is what makes the grip read as the skis biting in). Gripped,
    // the second term is zero in either stance (sin is π-symmetric under
    // the fourth power), so grounded-only play is rounds 6–7 exactly.
    const misalignment = Math.max(
      Math.sin(heading) ** 4,
      Math.sin(heading - flightHeading) ** 4,
    );
    const skidScrub = COAST_DRAG + (SKID_SCRUB - COAST_DRAG) * misalignment;
    const rate = gainingMagnitude
      ? input.boost
        ? BOOST_ACCEL
        : SKI_ACCEL
      : Math.max(input.down ? BRAKE_DECEL : COAST_DRAG, skidScrub);
    speed = stepUp
      ? Math.min(target, speed + rate * dt)
      : Math.max(target, speed - rate * dt);
    // The grip (turning round 8): grounded travel eases onto the ski axis
    // at GRIP_RATE instead of snapping to it. Steering can't outrun the
    // grip (see GRIP_RATE), so this is a hard lock in ordinary play and a
    // slide only where a real angle gap exists — a landing. A stance
    // change (the backstop flip, or speed easing through zero) snaps
    // instead: the travel direction of ~zero speed is meaningless, and
    // easing across the half-turn jump would swing the slide through
    // angles nobody traveled.
    const motionDirection = downhillHeading(
      heading + (speed < 0 ? Math.PI : 0),
    );
    if (Math.sign(speed) !== Math.sign(state.speed)) {
      flightHeading = motionDirection;
    } else {
      const gap = downhillHeading(motionDirection - flightHeading);
      const step = GRIP_RATE * dt;
      flightHeading = downhillHeading(
        flightHeading + Math.max(-step, Math.min(step, gap)),
      );
    }
  }

  // Movement: |speed| along the travel direction, everywhere — grounded
  // that's the gripped (or still-sliding) direction, airborne the frozen
  // takeoff direction; flightHeading is both. Spinning mid-air turns the
  // body, not the path.
  const travelSpeed = Math.abs(speed);
  const distance = state.distance + travelSpeed * Math.cos(flightHeading) * dt;
  // The lane can pinch with distance now (the rock gate — see laneHalfWidth),
  // so the clamp is per-position. Clamping against the *new* distance means
  // entering the pinch gently shepherds an edge-hugging skier inward over the
  // ramp rather than snapping them.
  const halfWidth = laneHalfWidth(distance);
  let lateral = state.lateral + travelSpeed * Math.sin(flightHeading) * dt;
  lateral = Math.max(-halfWidth, Math.min(halfWidth, lateral));

  // Hold-to-charge: holding jump on the snow loads the crouch (charge only
  // ever accrues grounded — pressing mid-air does nothing, and a key still
  // held through a landing waits out the landing lockout and then starts a
  // fresh load). Releasing launches, scaled by how full the load got; a
  // quick tap launches at essentially the minimum — the old fixed jump.
  let jumpCharge = state.jumpCharge;
  let landingRecovery = state.landingRecovery;
  // The tired-hop cue winds down on its own — it's an animation clock, and
  // the bob should finish even if the lockout ends under it.
  let tiredHop = Math.max(0, state.tiredHop - dt);
  let verticalVelocity = state.verticalVelocity + GRAVITY * dt;
  if (grounded) {
    if (landingRecovery > 0) {
      // The landing lockout (see LANDING_RECOVERY): fresh off a touchdown,
      // the legs are absorbing the hit — the jump key neither loads nor
      // launches until the timer runs out, so there's no instant pogo
      // re-jump. The press isn't *silent*, though: it starts the tired-hop
      // cue (see TIRED_HOP_DURATION), so the renderer can show the spent
      // legs trying and failing. At most one attempt per lockout — a
      // second press finds the cue still running.
      //
      // The trigger is a rising edge (up→down), not just "key down": a jump
      // key held through an air spin and carried into the touchdown is a
      // leftover from the jump you already took, not a fresh attempt, so it
      // must not fire the cue (bug, 2026-07-23). A held-through key instead
      // waits out the lockout and starts a fresh charge below, exactly as the
      // charge comment promises. A genuine press *during* the lockout still
      // counts.
      landingRecovery = Math.max(0, landingRecovery - dt);
      if (input.jump && !state.prevJumpHeld && tiredHop === 0) {
        tiredHop = TIRED_HOP_DURATION;
      }
    } else if (input.jump) {
      jumpCharge = Math.min(JUMP_CHARGE_TIME, jumpCharge + dt);
    } else if (jumpCharge > 0) {
      verticalVelocity =
        MIN_JUMP_VELOCITY +
        (MAX_JUMP_VELOCITY - MIN_JUMP_VELOCITY) * (jumpCharge / JUMP_CHARGE_TIME);
      jumpCharge = 0;
      // A real launch cancels a leftover tired-hop cue (a press late in the
      // lockout outlives it) — the legs evidently recovered, and the
      // takeoff pose owns the body now.
      tiredHop = 0;
    }
  }
  const height = Math.max(0, state.height + verticalVelocity * dt);

  // The landing frame: the accumulated spin collapses to where the skis
  // actually point, and the flight direction picks the stance — tips
  // roughly along the travel is a regular landing; tips against it means
  // you touched down tails-first, riding switch. Any landing angle is
  // legal (turning round 3 — this retired the over-rotation crash).
  if (!grounded && height <= 0) {
    heading = downhillHeading(heading);
    const magnitude = Math.abs(speed);
    speed =
      magnitude > 0 && Math.cos(heading - flightHeading) < 0
        ? -magnitude
        : magnitude;
    // Touchdown starts the landing lockout — see LANDING_RECOVERY.
    landingRecovery = LANDING_RECOVERY;
  }

  let lastCheckpoint = state.lastCheckpoint;
  for (const checkpoint of state.checkpoints) {
    if (distance >= checkpoint && checkpoint > lastCheckpoint) {
      lastCheckpoint = checkpoint;
    }
  }

  // Chasms are the game's only crash now (turning round 3). Read against the
  // CURRENT segment's chasms (state.chasms), so a run only ever crashes into
  // the hazards of the segment it's actually skiing.
  const crashed = fellIntoAChasm(state.chasms, distance, height);

  // The branching map's routing (SLOPE_BRANCHING.md — see route.ts). All of
  // this is inert for the Overlook: its "main" segment has no registry entry
  // (`seg` undefined) and no `next`, so nothing below fires except the finish,
  // which reduces to the old `distance >= finishDistance` check exactly.
  const seg: Segment | undefined = BRANCH_SEGMENTS[state.segmentId];

  // Type A trigger: while inside a segment's trigger volume (down-distance
  // window AND lateral window — you skied into the great tree), arm the fork.
  // Set once and it sticks to the segment boundary; a crash/respawn clears it.
  let divertTo = state.divertTo;
  if (seg?.trigger && divertTo === null && !crashed) {
    const t = seg.trigger;
    if (
      distance >= t.at - t.halfWidth &&
      distance <= t.at + t.halfWidth &&
      lateral >= t.lateralMin &&
      lateral <= t.lateralMax
    ) {
      divertTo = t.into;
    }
  }

  // Reaching the current segment's end: either flow into the next segment
  // (branching map) or, when this segment is terminal, win the run. The armed
  // fork (divertTo) overrides the road (`seg.next`); the leftover overflow
  // distance carries into the new segment so no travel is lost at the seam.
  let segmentId = state.segmentId;
  let distanceOut = distance;
  let chasms = state.chasms;
  let checkpoints = state.checkpoints;
  let finishDistance = state.finishDistance;
  let finished = false;
  if (!crashed && distance >= finishDistance) {
    const nextId = divertTo ?? seg?.next ?? null;
    const nextSeg = nextId ? BRANCH_SEGMENTS[nextId] : undefined;
    if (nextSeg) {
      segmentId = nextSeg.id;
      distanceOut = distance - finishDistance;
      finishDistance = nextSeg.length;
      chasms = nextSeg.chasms;
      checkpoints = nextSeg.checkpoints;
      // The new segment's entrance is its own respawn point (§6): a crash in
      // the fresh segment restarts here, never back up the previous one.
      lastCheckpoint = 0;
      divertTo = null;
    } else {
      // No successor — this is the flag. Crossing it wins the run (a crash on
      // the final frame takes precedence). Next frame the "finished" branch at
      // the top coasts you out.
      finished = true;
    }
  }

  return {
    distance: distanceOut,
    lateral,
    heading,
    flightHeading,
    height,
    verticalVelocity: height <= 0 ? 0 : verticalVelocity,
    speed,
    // A crash drops the load — the charge doesn't survive into the respawn.
    jumpCharge: crashed ? 0 : jumpCharge,
    landingRecovery: crashed ? 0 : landingRecovery,
    // The tip-over owns the body during a crash — no tired bob under it.
    tiredHop: crashed ? 0 : tiredHop,
    // Remember this frame's raw jump input so next frame can tell a fresh
    // press from a held-through key (the tired-hop rising edge above). Track
    // it even through a crash — the respawn resets it, but the intervening
    // crashed frames shouldn't misremember a release as a press.
    prevJumpHeld: input.jump,
    status: crashed ? "crashed" : finished ? "finished" : "skiing",
    lives: crashed ? state.lives - 1 : state.lives,
    respawnTimer: crashed ? RESPAWN_DELAY : 0,
    lastCheckpoint,
    checkpoints,
    chasms,
    segmentId,
    // A crash keeps whatever fork was armed only long enough for the respawn to
    // clear it; otherwise carry the (possibly just-consumed → null) fork.
    divertTo: crashed ? state.divertTo : divertTo,
    finishDistance,
    // The coast-out clock starts the frame the line is crossed.
    finishTimer: finished ? FINISH_LINGER : 0,
  };
}
