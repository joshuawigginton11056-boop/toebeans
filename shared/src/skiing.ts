export interface SkiInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly jump: boolean;
  readonly boost: boolean;
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
  // redirect): carve past sideways and the downhill pull goes negative —
  // you pivot into riding switch, tails-first down the hill, instead of
  // falling over. On the snow the heading lives in (-π, π]; mid-air it can
  // accumulate whole spins, and landing collapses it (see downhillHeading).
  readonly heading: number;
  // The direction of travel while airborne, frozen on the takeoff frame —
  // flight is ballistic (nothing to carve against), so spinning mid-air
  // turns the body, not the path. While grounded it just tracks the current
  // travel direction, which is what makes the takeoff freeze automatic.
  // Transient air state, deliberately not saved: a restore re-derives it
  // from heading + stance the way the next grounded frame would.
  readonly flightHeading: number;
  readonly height: number;
  readonly verticalVelocity: number;
  // Signed speed along the ski axis: positive = traveling toward the ski
  // tips, negative = tails-first, riding switch (turning round 3 — landing
  // backwards is a stance, not a crash). Magnitude is how fast; sign is
  // which end of the skis leads.
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
// Steering is a real turn (M2 heading session): holding left/right keeps
// rotating the skis, up to fully sideways and beyond — there's no built-in
// stop, and no fall either (turning round 3): past sideways you pivot into
// riding switch. TURN_RATE is how fast the skis rotate at full authority —
// ONE rate everywhere, grounded or airborne (director call, 2026-07-22:
// the 9 rad/s air-trick rate and the held/fresh key split are gone).
const TURN_RATE = 1.8;
// Steering authority builds with speed (carving comes from the skis
// biting), but never drops to zero: a stopped skier can still pivot their
// skis in place. Without the floor, braking-by-turning down to a full
// sideways stop would leave you unable to steer back — a softlock.
const STANDSTILL_AUTHORITY = 0.4;
// W means "downhill" (turning round 4, director call 2026-07-22). On top of
// its speed-up meaning, holding W steers the skis home: the heading eases
// toward straight-downhill at the normal turn rate, so you can carve into
// switch and come back to forward running without ever releasing W. With a
// steer key held too, the target is a carve diagonal to that side instead —
// W+left/right holds a stable diagonal rather than fighting the steer to a
// draw. Left/right alone still steer additively, exactly as before.
const SEEK_DIAGONAL = Math.PI / 4;
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
  if (grounded) {
    // On the snow the heading lives in (-π, π] — whole turns only ever
    // accumulate mid-air.
    heading = downhillHeading(heading);
  }
  const maxTurn = TURN_RATE * steerAuthority * dt;
  if (input.up) {
    // W seeks the fall line: ease toward pointing downhill (or a carve
    // diagonal, with a steer key). Easing the nearest-equivalent offset
    // takes the shortest way around — which is also the side you're
    // already drifting toward; from exactly backwards, where both ways
    // are equidistant, the tie breaks to a right turn.
    const target =
      (input.right ? SEEK_DIAGONAL : 0) - (input.left ? SEEK_DIAGONAL : 0);
    let delta = downhillHeading(target - heading);
    if (delta === -Math.PI) delta = Math.PI;
    heading += Math.max(-maxTurn, Math.min(maxTurn, delta));
  } else {
    if (input.left) heading -= maxTurn;
    if (input.right) heading += maxTurn;
  }

  // Speed is signed along the ski axis; the target is the input magnitude
  // projected onto the downhill direction. Pointed downhill that's the full
  // target; sideways it's ~0 — turning IS braking, all the way down to a
  // hockey stop; pointed uphill it's negative — gravity pulls you
  // tails-first into riding switch. The cosine makes the whole range
  // continuous: no mirror seam at sideways, speed just eases through zero.
  // Speed only changes on the snow — airborne there's nothing to push
  // against or brake with, so you land carrying your takeoff speed.
  let speed = state.speed;
  let flightHeading = state.flightHeading;
  if (grounded) {
    const target = targetMagnitude * Math.cos(heading);
    const stepUp = target > speed;
    // Pick the easing rate by what this step does to the speed *magnitude*:
    // growing = something pulling you along (gravity down the axis, or the
    // boost); shrinking = drag or the brake scrubbing it off.
    const gainingMagnitude = (stepUp ? speed : -speed) >= 0;
    const rate = gainingMagnitude
      ? input.boost
        ? BOOST_ACCEL
        : SKI_ACCEL
      : input.down
        ? BRAKE_DECEL
        : COAST_DRAG;
    speed = stepUp
      ? Math.min(target, speed + rate * dt)
      : Math.max(target, speed - rate * dt);
    // Track the travel direction while grounded, so the takeoff frame
    // freezes exactly the direction you left the snow moving in.
    flightHeading = downhillHeading(heading + (speed < 0 ? Math.PI : 0));
  }

  // Movement: on the snow it follows the skis (the signed speed makes
  // switch come out right); in the air it's ballistic along the frozen
  // takeoff direction — spinning turns the body, not the path.
  const travelHeading = grounded ? heading : flightHeading;
  const travelSpeed = grounded ? speed : Math.abs(speed);
  const distance = state.distance + travelSpeed * Math.cos(travelHeading) * dt;
  let lateral = state.lateral + travelSpeed * Math.sin(travelHeading) * dt;
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
