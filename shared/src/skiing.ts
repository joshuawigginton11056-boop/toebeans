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
export type RunStatus = "skiing" | "crashed" | "forfeited";

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
  readonly status: RunStatus;
  readonly lives: number;
  readonly respawnTimer: number;
  readonly lastCheckpoint: number;
  readonly checkpoints: readonly number[];
  readonly chasms: readonly Chasm[];
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
// Exported for save.ts (restoring a save clamps lateral into range) and the
// renderer (the visual lane and decor scatter key off it).
export const LATERAL_LIMIT = 12;
// Hold-to-charge jumping (director call, 2026-07-22): a tap gives the
// minimum jump — exactly the old fixed jump, so quick reactions still clear
// chasms — and holding loads a deeper crouch that launches on release, up
// to the max at a full charge. Exported for the renderer (crouch depth
// reads the charge) and audio (takeoff whoosh scales with launch speed).
export const MIN_JUMP_VELOCITY = 7;
export const MAX_JUMP_VELOCITY = 11;
export const JUMP_CHARGE_TIME = 0.6;
const GRAVITY = -18;
const CHASM_CLEAR_HEIGHT = 0.4;
export const STARTING_LIVES = 9;
export const RESPAWN_DELAY = 1.5;

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
    status: "skiing",
    lives: STARTING_LIVES,
    respawnTimer: 0,
    lastCheckpoint: 0,
    // One checkpoint after each chasm you survive, so a crash only ever
    // replays the hazard that killed you, not the whole slope.
    checkpoints: [0, 26, 52],
    chasms: [
      { id: "chasm-1", start: 20, width: 3 },
      { id: "chasm-2", start: 45, width: 3.5 },
      { id: "chasm-3", start: 70, width: 4 },
    ],
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
    status: "skiing",
    respawnTimer: 0,
  };
}

export function stepSkiing(state: SkiState, input: SkiInput, dt: number): SkiState {
  if (state.status === "forfeited") {
    return state;
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
  let lateral = state.lateral + travelSpeed * Math.sin(flightHeading) * dt;
  lateral = Math.max(-LATERAL_LIMIT, Math.min(LATERAL_LIMIT, lateral));

  // Hold-to-charge: holding jump on the snow loads the crouch (charge only
  // ever accrues grounded — pressing mid-air does nothing, and a key still
  // held through a landing starts a fresh load). Releasing launches, scaled
  // by how full the load got; a quick tap launches at essentially the
  // minimum — the old fixed jump.
  let jumpCharge = state.jumpCharge;
  let verticalVelocity = state.verticalVelocity + GRAVITY * dt;
  if (grounded) {
    if (input.jump) {
      jumpCharge = Math.min(JUMP_CHARGE_TIME, jumpCharge + dt);
    } else if (jumpCharge > 0) {
      verticalVelocity =
        MIN_JUMP_VELOCITY +
        (MAX_JUMP_VELOCITY - MIN_JUMP_VELOCITY) * (jumpCharge / JUMP_CHARGE_TIME);
      jumpCharge = 0;
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
  }

  let lastCheckpoint = state.lastCheckpoint;
  for (const checkpoint of state.checkpoints) {
    if (distance >= checkpoint && checkpoint > lastCheckpoint) {
      lastCheckpoint = checkpoint;
    }
  }

  // Chasms are the game's only crash now (turning round 3).
  const crashed = fellIntoAChasm(state.chasms, distance, height);

  return {
    distance,
    lateral,
    heading,
    flightHeading,
    height,
    verticalVelocity: height <= 0 ? 0 : verticalVelocity,
    speed,
    // A crash drops the load — the charge doesn't survive into the respawn.
    jumpCharge: crashed ? 0 : jumpCharge,
    status: crashed ? "crashed" : "skiing",
    lives: crashed ? state.lives - 1 : state.lives,
    respawnTimer: crashed ? RESPAWN_DELAY : 0,
    lastCheckpoint,
    checkpoints: state.checkpoints,
    chasms: state.chasms,
  };
}
