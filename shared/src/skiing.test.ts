import { describe, expect, it } from "vitest";
import {
  BASE_SPEED,
  BOOST_SPEED,
  createBranchingSkiState,
  createInitialSkiState,
  downhillHeading,
  FINISH_DISTANCE,
  FINISH_LINGER,
  JUMP_CHARGE_TIME,
  laneHalfWidth,
  LANDING_RECOVERY,
  LATERAL_LIMIT,
  MAX_JUMP_VELOCITY,
  MAX_SPEED,
  MIN_JUMP_VELOCITY,
  MIN_SPEED,
  RESPAWN_DELAY,
  STARTING_LIVES,
  stepSkiing,
  TIRED_HOP_DURATION,
  type SkiInput,
  type SkiState,
} from "./skiing";
import {
  BRANCH_SEGMENTS,
  BRANCH_START,
  roadSegmentIds,
  routeDistanceOf,
  TOTAL_ROUTE_LENGTH,
} from "./route";

const noInput: SkiInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  boost: false,
  spin: 0,
};

// Positioned just short of a chasm so crash tests need only a couple dozen
// small steps instead of simulating all the way from the top of the slope.
const nearChasm: SkiState = {
  distance: 19,
  lateral: 0,
  heading: 0,
  flightHeading: 0,
  height: 0,
  verticalVelocity: 0,
  speed: 8,
  jumpCharge: 0,
  landingRecovery: 0,
  tiredHop: 0,
  prevJumpHeld: false,
  status: "skiing",
  lives: STARTING_LIVES,
  respawnTimer: 0,
  lastCheckpoint: 0,
  checkpoints: [0, 26],
  chasms: [{ id: "c1", start: 20, width: 3 }],
  // Single-segment ("main") run, like the Overlook — no registry entry, no
  // successor, so the segment routing is inert and these fixtures behave
  // exactly as they did before segments existed.
  segmentId: "main",
  divertTo: null,
  // Far past anything these low-distance fixtures reach, so a test never
  // finishes by accident. Finish-specific tests set their own.
  finishDistance: 1000,
  finishTimer: 0,
};

function skiUntilCrash(start: SkiState): SkiState {
  let state = start;
  for (let i = 0; i < 60 && state.status === "skiing"; i++) {
    state = stepSkiing(state, noInput, 0.02);
  }
  expect(state.status).toBe("crashed");
  return state;
}

// Mid-run cruising state (at the momentum model's no-input equilibrium),
// with no hazards in reach — for tests about steering and speed changes.
const cruising: SkiState = {
  ...nearChasm,
  distance: 0,
  speed: BASE_SPEED,
  chasms: [],
};

describe("stepSkiing", () => {
  it("starts from a standstill and pushes off up to cruise speed", () => {
    expect(createInitialSkiState().speed).toBe(0);

    // Same start, hazards out of the way — this is about the speed curve.
    let state: SkiState = { ...createInitialSkiState(), chasms: [] };

    state = stepSkiing(state, noInput, 0.5);
    const early = state.speed;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(BASE_SPEED);

    for (let i = 0; i < 300; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }
    expect(state.speed).toBe(BASE_SPEED);
    expect(state.status).toBe("skiing");
  });

  it("steers laterally within the slope limits", () => {
    // Half a second of steering — enough to drift, short of carving past
    // sideways (which would flip the stance and reverse the drift; the
    // turning-round-5 tests below cover that crossing on purpose).
    const state = stepSkiing(cruising, { ...noInput, right: true }, 0.5);

    expect(state.lateral).toBeGreaterThan(0);
    expect(state.lateral).toBeLessThanOrEqual(LATERAL_LIMIT);
  });

  it("pivots slower at a standstill than carving at speed", () => {
    // Authority builds with speed but floors above zero — a stopped skier
    // can still pivot their skis (without the floor, a hockey stop would
    // softlock: no speed, no steering, no way to point downhill again).
    const still = stepSkiing(
      { ...cruising, speed: 0 },
      { ...noInput, right: true },
      0.1,
    );
    const atSpeed = stepSkiing(cruising, { ...noInput, right: true }, 0.1);

    expect(still.heading).toBeGreaterThan(0);
    expect(still.heading).toBeLessThan(atSpeed.heading);
  });

  it("builds boost speed over time rather than snapping to it", () => {
    const halfway = stepSkiing(cruising, { ...noInput, boost: true }, 0.5);
    expect(halfway.speed).toBeGreaterThan(BASE_SPEED);
    expect(halfway.speed).toBeLessThan(BOOST_SPEED);

    let state = cruising;
    for (let i = 0; i < 100; i++) {
      state = stepSkiing(state, { ...noInput, boost: true }, 0.02);
    }
    expect(state.speed).toBe(BOOST_SPEED);
  });

  it("coasts back down gradually when boost is released", () => {
    const boosted: SkiState = { ...cruising, speed: BOOST_SPEED };

    const state = stepSkiing(boosted, noInput, 0.5);

    expect(state.speed).toBeGreaterThan(BASE_SPEED);
    expect(state.speed).toBeLessThan(BOOST_SPEED);
  });

  it("brakes harder than it coasts", () => {
    const fast: SkiState = { ...cruising, speed: BOOST_SPEED };

    const braked = stepSkiing(fast, { ...noInput, down: true }, 0.5);
    const coasted = stepSkiing(fast, noInput, 0.5);

    expect(braked.speed).toBeLessThan(coasted.speed);
    expect(braked.speed).toBeGreaterThanOrEqual(MIN_SPEED);
  });

  it("holds its speed while airborne", () => {
    const airborne: SkiState = {
      ...cruising,
      height: 1,
      verticalVelocity: 2,
    };

    const braking = stepSkiing(airborne, { ...noInput, down: true }, 0.1);
    const boosting = stepSkiing(airborne, { ...noInput, boost: true }, 0.1);

    expect(braking.speed).toBe(BASE_SPEED);
    expect(boosting.speed).toBe(BASE_SPEED);
  });

  it("jumps on release and comes back down under gravity", () => {
    // Hold-to-charge: the press loads, the release launches.
    const pressed = stepSkiing(createInitialSkiState(), { ...noInput, jump: true }, 0.1);
    expect(pressed.height).toBe(0);

    const jumped = stepSkiing(pressed, noInput, 0.1);
    expect(jumped.height).toBeGreaterThan(0);
  });

  it("charges while held — the load deepens on the snow, capped at full", () => {
    let state = stepSkiing(cruising, { ...noInput, jump: true }, 0.2);
    expect(state.jumpCharge).toBeCloseTo(0.2, 5);
    expect(state.height).toBe(0); // loading, not leaving the ground

    for (let i = 0; i < 60; i++) {
      state = stepSkiing(state, { ...noInput, jump: true }, 0.05);
    }
    expect(state.jumpCharge).toBe(JUMP_CHARGE_TIME);
    expect(state.height).toBe(0);
  });

  it("launches on release scaled by the charge — tap low, full charge high", () => {
    // Tap: one press frame, then release — essentially the minimum jump.
    let tap = stepSkiing(cruising, { ...noInput, jump: true }, 0.02);
    tap = stepSkiing(tap, noInput, 0.02);
    expect(tap.height).toBeGreaterThan(0);
    expect(tap.verticalVelocity).toBeGreaterThanOrEqual(MIN_JUMP_VELOCITY);
    expect(tap.verticalVelocity).toBeLessThan(MIN_JUMP_VELOCITY + 0.5);

    // Full charge: hold well past the cap, then release.
    let charged = cruising;
    for (let i = 0; i < 50; i++) {
      charged = stepSkiing(charged, { ...noInput, jump: true }, 0.02);
    }
    charged = stepSkiing(charged, noInput, 0.02);
    expect(charged.height).toBeGreaterThan(0);
    expect(charged.verticalVelocity).toBeCloseTo(MAX_JUMP_VELOCITY, 5);
    expect(charged.jumpCharge).toBe(0);
  });

  it("accrues no charge mid-air — holding through a landing starts fresh", () => {
    let state: SkiState = { ...cruising, height: 1.5, verticalVelocity: 0 };
    for (let i = 0; i < 5; i++) {
      state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
      expect(state.jumpCharge).toBe(0);
    }

    // Ride it down with the key still held: no instant bounce on touchdown —
    // the landing lockout runs first, and only then does the still-held key
    // start its fresh load.
    while (state.height > 0) {
      state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    }
    expect(state.jumpCharge).toBe(0);
    let lockedFrames = 0;
    while (state.jumpCharge === 0 && lockedFrames < 60) {
      state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
      lockedFrames++;
      expect(state.height).toBe(0);
    }
    expect(state.jumpCharge).toBeCloseTo(0.02, 5);
    // The lockout held the key off for about LANDING_RECOVERY first.
    expect(lockedFrames * 0.02).toBeGreaterThanOrEqual(LANDING_RECOVERY);
    expect(lockedFrames * 0.02).toBeLessThan(LANDING_RECOVERY + 0.06);
  });

  it("locks out the jump for a beat after landing — no instant re-jump", () => {
    // Tap jump and ride the flight down to the landing frame.
    let state = stepSkiing(cruising, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, noInput, 0.02);
    expect(state.height).toBeGreaterThan(0);
    while (state.height > 0) {
      state = stepSkiing(state, noInput, 0.02);
    }

    // Tap again right on touchdown: the press loads nothing, so the release
    // launches nothing — the skis stay on the snow.
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    expect(state.jumpCharge).toBe(0);
    state = stepSkiing(state, noInput, 0.02);
    expect(state.height).toBe(0);

    // Wait out the recovery, and the very same tap flies again.
    for (let i = 0; i * 0.02 <= LANDING_RECOVERY; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, noInput, 0.02);
    expect(state.height).toBeGreaterThan(0);
  });

  it("answers a locked-out press with the tired-hop cue — presentation only", () => {
    // Tap jump and ride the flight down to the landing frame.
    let state = stepSkiing(cruising, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, noInput, 0.02);
    while (state.height > 0) {
      state = stepSkiing(state, noInput, 0.02);
    }
    expect(state.tiredHop).toBe(0);

    // Press into the lockout: the cue starts at full, and while it winds
    // down the skis never leave the snow and no charge loads — the hop
    // belongs to the renderer, not the physics.
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    expect(state.tiredHop).toBe(TIRED_HOP_DURATION);
    while (state.tiredHop > 0) {
      state = stepSkiing(state, noInput, 0.02);
      expect(state.height).toBe(0);
      expect(state.jumpCharge).toBe(0);
    }
  });

  it("ignores a jump key held through the landing — no cue without a fresh press", () => {
    // The air-spin hold (round 9): the player holds Space to spin, and can
    // still be holding it on touchdown. That held key is a leftover from the
    // jump they already took, not a fresh attempt, so it must NOT fire the
    // tired hop (bug, 2026-07-23 — the trigger used to be level-, not
    // edge-triggered).

    // Charge a frame and release to launch.
    let state = stepSkiing(cruising, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, noInput, 0.02);
    expect(state.height).toBeGreaterThan(0);

    // Mid-air, press Space and HOLD it every frame straight through the
    // touchdown (main.ts maps the held key to the spin input; input.jump
    // stays true the whole way down).
    const holdJump = { ...noInput, jump: true };
    while (state.height > 0) {
      state = stepSkiing(state, holdJump, 0.02);
    }

    // We land into the lockout — but the held-through key raises no cue,
    // this frame or the next several deep inside it.
    expect(state.landingRecovery).toBeGreaterThan(0);
    expect(state.tiredHop).toBe(0);
    for (let i = 0; i < 3; i++) {
      state = stepSkiing(state, holdJump, 0.02);
      expect(state.landingRecovery).toBeGreaterThan(0);
      expect(state.tiredHop).toBe(0);
    }

    // A genuine fresh press *during* the same lockout still answers — the fix
    // sharpens the trigger to a rising edge, it doesn't kill the feedback.
    state = stepSkiing(state, noInput, 0.02);
    expect(state.landingRecovery).toBeGreaterThan(0);
    state = stepSkiing(state, holdJump, 0.02);
    expect(state.tiredHop).toBe(TIRED_HOP_DURATION);
  });

  it("fits one tired attempt per lockout — a second press can't restart it", () => {
    let state = stepSkiing(cruising, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, noInput, 0.02);
    while (state.height > 0) {
      state = stepSkiing(state, noInput, 0.02);
    }

    // First press starts the cue; release and press again mid-lockout —
    // the clock keeps falling, it never snaps back to full.
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    const started = state.tiredHop;
    state = stepSkiing(state, noInput, 0.02);
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    expect(state.tiredHop).toBeCloseTo(started - 0.04, 5);
  });

  it("keeps the tired-hop cue at least as long as the lockout", () => {
    // The one-attempt-per-lockout guarantee above only holds while the cue
    // outlasts the lockout (a shorter cue would hand a masher a second
    // attempt inside one landing). Pinned so a future retune of either
    // constant can't silently break it — the 2026-07-23 slow-and-deep
    // retune (0.3 → 0.8s) leaned on exactly this ordering.
    expect(TIRED_HOP_DURATION).toBeGreaterThanOrEqual(LANDING_RECOVERY);
  });

  it("plays no tired hop outside the lockout — a free press just charges", () => {
    const state = stepSkiing(cruising, { ...noInput, jump: true }, 0.02);
    expect(state.jumpCharge).toBeCloseTo(0.02, 5);
    expect(state.tiredHop).toBe(0);
  });

  it("cancels a leftover cue on a real launch — takeoff owns the body", () => {
    let state = stepSkiing(cruising, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, noInput, 0.02);
    while (state.height > 0) {
      state = stepSkiing(state, noInput, 0.02);
    }
    // Let most of the lockout pass, then press: this cue outlives the
    // lockout's tail.
    for (let i = 0; i * 0.02 < LANDING_RECOVERY - 0.04; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    expect(state.tiredHop).toBeGreaterThan(0);

    // Wait out the lockout remainder, then tap-and-release a real jump
    // while the cue is still winding down: the launch flies and clears it.
    while (state.landingRecovery > 0) {
      state = stepSkiing(state, noInput, 0.02);
    }
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    expect(state.tiredHop).toBeGreaterThan(0);
    state = stepSkiing(state, noInput, 0.02);
    expect(state.height).toBeGreaterThan(0);
    expect(state.tiredHop).toBe(0);
  });

  it("drops the tired-hop cue on a crash — the tip-over owns the body", () => {
    const state = skiUntilCrash({
      ...nearChasm,
      landingRecovery: 0.25,
      tiredHop: 0.25,
    });
    expect(state.tiredHop).toBe(0);
  });

  it("drops the charge on a crash — it doesn't survive to the respawn", () => {
    // Holding jump doesn't jump, so charging straight into the chasm skis
    // into it — and the crash zeroes the load.
    let state = nearChasm;
    for (let i = 0; i < 60 && state.status === "skiing"; i++) {
      state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    }
    expect(state.status).toBe("crashed");
    expect(state.jumpCharge).toBe(0);

    const respawned = stepSkiing(state, noInput, RESPAWN_DELAY + 0.01);
    expect(respawned.jumpCharge).toBe(0);
  });

  it("clears a chasm when jumping over it", () => {
    let state = nearChasm;
    for (let i = 0; i < 30; i++) {
      // Press on frame 0; frame 1's release launches the tap jump.
      state = stepSkiing(state, { ...noInput, jump: i === 0 }, 0.02);
    }

    expect(state.distance).toBeGreaterThan(23);
    expect(state.status).toBe("skiing");
    expect(state.lives).toBe(STARTING_LIVES);
  });

  it("never mutates the input state", () => {
    const initial = createInitialSkiState();
    const snapshot = JSON.parse(JSON.stringify(initial));

    stepSkiing(initial, { ...noInput, jump: true, right: true }, 1);

    expect(initial).toEqual(snapshot);
  });

  it("keeps turning while the key is held", () => {
    let state = cruising;
    for (let i = 0; i < 25; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }
    const halfTurn = state.heading;
    expect(halfTurn).toBeGreaterThan(0);

    for (let i = 0; i < 25; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }
    // No stop at sideways: the turn keeps accumulating as long as you hold
    // it — all the way to the round-10 saturation at straight-backwards
    // (pinned in its own tests below).
    expect(state.heading).toBeGreaterThan(halfTurn);
  });

  it("holds its heading when the steering key is released", () => {
    let state = cruising;
    for (let i = 0; i < 25; i++) {
      state = stepSkiing(state, { ...noInput, left: true }, 0.02);
    }
    const turned = state.heading;
    expect(turned).toBeLessThan(0);

    const lateralBefore = state.lateral;
    for (let i = 0; i < 25; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }
    // Like real skiing: nobody straightens the skis for you, and movement
    // keeps following the direction they point.
    expect(state.heading).toBe(turned);
    expect(state.lateral).toBeLessThan(lateralBefore);
  });

  it("turns at the same rate in the air as on the snow", () => {
    // One turn rate everywhere (turning round 3, director redirect) — the
    // 9 rad/s trick rate and the held/fresh key split are gone. Jumps
    // re-aim; they don't whip into accidental 360s.
    const airborne: SkiState = { ...cruising, height: 1, verticalVelocity: 2 };

    const spun = stepSkiing(airborne, { ...noInput, right: true }, 0.1);
    const carved = stepSkiing(cruising, { ...noInput, right: true }, 0.1);

    expect(spun.heading).toBeCloseTo(carved.heading, 12);
  });

  it("re-aims mid-air even from a standstill hop", () => {
    // The standstill authority floor applies in the air too — slow, but
    // never dead.
    const hopping: SkiState = {
      ...cruising,
      speed: 0,
      height: 0.5,
      verticalVelocity: 1,
    };

    const state = stepSkiing(hopping, { ...noInput, left: true }, 0.1);

    expect(state.heading).toBeLessThan(0);
  });

  it("jumping while steering lands a modest line adjustment, never a spin", () => {
    // The accidental-360 case from the turning-round-2 playtest: carve
    // right, jump, keep holding right through the whole jump. At the one
    // uniform turn rate a full jump of held steer is ~1.4 rad — a re-aim.
    let state = cruising;
    for (let i = 0; i < 5; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }
    state = stepSkiing(state, { ...noInput, right: true, jump: true }, 0.02);
    state = stepSkiing(state, { ...noInput, right: true }, 0.02); // release launches
    expect(state.height).toBeGreaterThan(0);
    const atTakeoff = state.heading;

    while (state.height > 0) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }
    state = stepSkiing(state, noInput, 0.02); // first grounded frame

    expect(state.heading - atTakeoff).toBeGreaterThan(0);
    expect(state.heading - atTakeoff).toBeLessThan(Math.PI);
    expect(state.status).toBe("skiing");
    expect(state.lives).toBe(STARTING_LIVES);
  });

  it("flies ballistic — spinning mid-air turns the body, not the path", () => {
    // Airborne movement follows the direction frozen at takeoff
    // (flightHeading), however far the skis have rotated since.
    const spinning: SkiState = {
      ...cruising,
      heading: 2,
      flightHeading: 0,
      height: 1,
      verticalVelocity: 2,
    };

    const state = stepSkiing(spinning, noInput, 0.1);

    expect(state.distance - cruising.distance).toBeCloseTo(BASE_SPEED * 0.1, 10);
    expect(state.lateral).toBeCloseTo(0, 10);
  });

  it("freezes the travel direction on the takeoff frame", () => {
    // flightHeading matches the heading: a gripped grounded state (round 8
    // gave flightHeading a grounded meaning — hand-built fixtures set it).
    let state: SkiState = { ...cruising, heading: 0.5, flightHeading: 0.5 };
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, noInput, 0.02); // release launches
    expect(state.height).toBeGreaterThan(0);
    const frozen = state.flightHeading;
    expect(frozen).toBeCloseTo(0.5, 5);

    for (let i = 0; i < 5; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }

    expect(state.flightHeading).toBe(frozen);
    expect(state.heading).toBeGreaterThan(0.5);
  });

  it("lands a completed spin clean, collapsed to its downhill-equivalent", () => {
    // Nearly a full 360 accumulated in the air, about to touch down.
    const landing: SkiState = {
      ...cruising,
      heading: 2 * Math.PI - 0.3,
      flightHeading: 0,
      height: 0.05,
      verticalVelocity: -5,
    };

    const state = stepSkiing(landing, noInput, 0.05); // touches down

    expect(state.status).toBe("skiing");
    // The whole turns collapse away — the skis point where they point —
    // and tips roughly along the flight means a regular landing.
    expect(state.heading).toBeCloseTo(-0.3, 10);
    expect(state.speed).toBe(BASE_SPEED);
  });

  it("lands a half spin riding switch — backwards is a stance, not a crash", () => {
    const landing: SkiState = {
      ...cruising,
      heading: 3.0,
      flightHeading: 0,
      height: 0.05,
      verticalVelocity: -5,
    };

    const state = stepSkiing(landing, noInput, 0.05); // touches down

    expect(state.status).toBe("skiing");
    expect(state.lives).toBe(STARTING_LIVES);
    // Tips against the flight direction: touched down tails-first.
    expect(state.speed).toBe(-BASE_SPEED);
    expect(state.heading).toBeCloseTo(3.0, 10);

    // …and the next grounded frame keeps descending the hill.
    const next = stepSkiing(state, noInput, 0.05);
    expect(next.distance).toBeGreaterThan(state.distance);
  });

  it("slides through a diagonal landing instead of snapping onto the skis", () => {
    // The round-8 bar (director, 2026-07-23): "I jump and hold A or D, and
    // the skis go perfectly in that direction. I should slide forward a
    // bit before going perfectly diagonal." The exact repro: cruise, tap
    // jump, hold right through the flight (~1.4 rad of re-aim), touch
    // down — round 7's hard lock redirected the momentum in one frame
    // (lateral velocity 0.29 → 7.96 measured); the grip window keeps the
    // first grounded frames traveling the way you were flying.
    let state = cruising;
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    state = stepSkiing(state, { ...noInput, right: true }, 0.02); // launch
    expect(state.height).toBeGreaterThan(0);
    while (state.height > 0) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }
    expect(state.heading).toBeGreaterThan(1); // landed well off the flight line

    const prev = state;
    state = stepSkiing(state, noInput, 0.02);
    const firstLateralVelocity = (state.lateral - prev.lateral) / 0.02;
    expect(Math.abs(firstLateralVelocity)).toBeLessThan(2);
  });

  it("grips a landing on at a rate — bleeding as the skis bite, never uphill", () => {
    // A hand-built hard landing: skis 1.3 rad off the flight direction.
    const landing: SkiState = {
      ...cruising,
      heading: 1.3,
      flightHeading: 0,
      height: 0.05,
      verticalVelocity: -5,
    };
    let state = stepSkiing(landing, noInput, 0.05); // touches down forward
    expect(state.speed).toBe(BASE_SPEED);

    let prevLateralVelocity = 0; // touched down traveling the fall line
    let maxJump = 0;
    let minDistanceStep = Infinity;
    for (let i = 0; i < 50; i++) {
      const next = stepSkiing(state, noInput, 0.02);
      const lateralVelocity = (next.lateral - state.lateral) / 0.02;
      maxJump = Math.max(maxJump, Math.abs(lateralVelocity - prevLateralVelocity));
      minDistanceStep = Math.min(minDistanceStep, next.distance - state.distance);
      prevLateralVelocity = lateralVelocity;
      state = next;
    }

    // Rate-limited redirect: no single frame teleports the momentum (the
    // hard lock measured ~7.7 u/s in one frame on this angle).
    expect(maxJump).toBeLessThan(1);
    // Both ends of the ease face downhill — the slide never climbs.
    expect(minDistanceStep).toBeGreaterThanOrEqual(0);
    // The skis biting in sheds speed: a hard diagonal landing slides AND
    // bleeds — it doesn't carry cruise speed onto the new line.
    expect(Math.abs(state.speed)).toBeLessThan(3);
    // And the grip completes: travel is back under the skis.
    expect(Math.abs(downhillHeading(state.heading - state.flightHeading))).toBeLessThan(1e-9);
  });

  it("spins on the held jump key in the air — faster than any ground turn", () => {
    // Turning round 9 (director redirect, 2026-07-23): hold Space airborne
    // to spin, at a trick rate well past what the skis can carve.
    const airborne: SkiState = { ...cruising, height: 1, verticalVelocity: 2 };

    const right = stepSkiing(airborne, { ...noInput, jump: true, spin: 1 }, 0.1);
    const left = stepSkiing(airborne, { ...noInput, jump: true, spin: -1 }, 0.1);
    expect(right.heading).toBeGreaterThan(0.4);
    expect(left.heading).toBeCloseTo(-right.heading, 10);
    // Unmistakably a trick: at least twice the fastest (boosted) carve.
    const carved = stepSkiing(
      cruising,
      { ...noInput, right: true, boost: true },
      0.1,
    );
    expect(right.heading).toBeGreaterThan(2 * carved.heading);
    // The flight path doesn't bend — the spin turns the body, not the travel.
    expect(right.lateral).toBeCloseTo(0, 10);

    // Grounded, a held Space is the jump charge and only that — no spin.
    const grounded = stepSkiing(cruising, { ...noInput, jump: true, spin: 1 }, 0.1);
    expect(grounded.heading).toBe(0);
    expect(grounded.jumpCharge).toBeCloseTo(0.1, 5);
  });

  it("fits a full 360 inside a full-charge jump, with air to spare", () => {
    // Charge fully, launch, re-press and hold the spin: the whole turn
    // accumulates before touchdown (the rate is sized for exactly this),
    // and releasing near clean lands forward at full speed.
    let state = cruising;
    for (let i = 0; i < 50; i++) {
      state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
    }
    state = stepSkiing(state, noInput, 0.02); // release launches
    expect(state.height).toBeGreaterThan(0);

    let frames = 0;
    while (state.heading < 2 * Math.PI && state.height > 0 && frames++ < 200) {
      state = stepSkiing(state, { ...noInput, jump: true, spin: 1 }, 0.02);
    }
    expect(state.heading).toBeGreaterThanOrEqual(2 * Math.PI); // the 360 fits…
    expect(state.height).toBeGreaterThan(0); // …before the snow arrives

    while (state.height > 0) {
      state = stepSkiing(state, noInput, 0.02);
    }
    // The full turn collapses away — landed near clean, forward, full speed.
    expect(Math.abs(state.heading)).toBeLessThan(0.5);
    expect(state.speed).toBe(BASE_SPEED);
  });

  it("lands a half spin riding switch, still sliding downhill", () => {
    // Spin to backwards, let go, touch down: tips against the travel is
    // round 3's stance rule, and the trick itself costs no speed.
    let state: SkiState = { ...cruising, height: 1.2, verticalVelocity: 3 };
    while (state.heading < Math.PI && state.height > 0) {
      state = stepSkiing(state, { ...noInput, jump: true, spin: 1 }, 0.02);
    }
    expect(state.heading).toBeGreaterThanOrEqual(Math.PI);

    while (state.height > 0) {
      state = stepSkiing(state, noInput, 0.02);
    }
    expect(state.speed).toBe(-BASE_SPEED); // tails-first, nothing lost

    const next = stepSkiing(state, noInput, 0.1);
    expect(next.distance).toBeGreaterThan(state.distance);
  });

  it("riding switch descends the hill tails-first", () => {
    const ridingSwitch: SkiState = {
      ...cruising,
      heading: Math.PI,
      speed: -BASE_SPEED,
    };

    const state = stepSkiing(ridingSwitch, noInput, 0.1);

    expect(state.distance).toBeGreaterThan(cruising.distance);
    expect(state.speed).toBeLessThan(0);
    expect(state.status).toBe("skiing");
  });

  it("keeps screen-left screen-left while riding switch", () => {
    // The classic switch-riding control question answers itself in the
    // signed-speed math: both the speed sign and the geometry flip, so the
    // left key drifts you toward the slope's left edge in either stance.
    const ridingSwitch: SkiState = {
      ...cruising,
      heading: Math.PI,
      speed: -BASE_SPEED,
    };

    const regular = stepSkiing(cruising, { ...noInput, left: true }, 0.1);
    const inSwitch = stepSkiing(ridingSwitch, { ...noInput, left: true }, 0.1);

    expect(regular.lateral).toBeLessThan(0);
    expect(inSwitch.lateral).toBeLessThan(0);
  });

  it("carves past sideways into riding switch instead of falling over", () => {
    // Hold the turn forever: descent dies toward sideways, then gravity
    // takes the tails and you're riding switch — no fall, no lost life
    // (turning round 3 removed the fall-over crash).
    let state = cruising;
    let sawSwitch = false;
    for (let i = 0; i < 400 && !sawSwitch; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
      expect(state.status).toBe("skiing");
      if (state.speed < -1) sawSwitch = true;
    }

    expect(sawSwitch).toBe(true);
    expect(state.lives).toBe(STARTING_LIVES);
    expect(Math.abs(state.heading)).toBeGreaterThan(Math.PI / 2);
  });

  it("saturates a held turn at straight-backwards — one turnaround, no serpentine", () => {
    // Turning round 10 (director directive, 2026-07-23): "remove auto
    // straightening — I can hold one turn and create a semi circle of
    // constantly trying to turn around." Before, a held key rotated
    // through backwards forever: every half turn the run died at
    // sideways, gravity rebuilt it, and the trail re-straightened
    // downhill — an endless S. Now the rotation stops at ±π: carve to
    // sideways, keep holding to pivot into switch, settle riding
    // backwards down the fall line.
    let state = cruising;
    for (let i = 0; i < 400; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
      // A right-hold's heading never leaves [0, π]. The serpentine was
      // exactly the wrap past π: re-entering from the far side handed the
      // hold a fresh half-turn to straighten and cross again.
      expect(state.heading).toBeGreaterThanOrEqual(0);
      expect(state.heading).toBeLessThanOrEqual(Math.PI);
    }
    expect(state.heading).toBe(Math.PI);
    expect(state.speed).toBe(-BASE_SPEED); // settled riding switch at cruise
  });

  it("saturates the left turnaround at −π — the sign remembers the way round", () => {
    let state = cruising;
    for (let i = 0; i < 400; i++) {
      state = stepSkiing(state, { ...noInput, left: true }, 0.02);
    }
    expect(state.heading).toBe(-Math.PI);
    expect(state.speed).toBe(-BASE_SPEED);
  });

  it("carves back out of a saturated turnaround with the opposite key", () => {
    // The wall only holds against the key that built the turn: from
    // straight-backwards the other key carves back through sideways
    // (paying the round-6 skid toll) to forward running.
    let state: SkiState = {
      ...cruising,
      heading: Math.PI,
      flightHeading: Math.PI,
      speed: -BASE_SPEED,
    };
    for (let i = 0; i < 150; i++) {
      state = stepSkiing(state, { ...noInput, left: true }, 0.02);
    }

    expect(state.heading).toBeLessThan(Math.PI / 2);
    expect(state.speed).toBeGreaterThan(0); // forward stance again
  });

  it("keeps air rotation unclamped — spins accumulate past backwards", () => {
    // The saturation is a grounded rule. Airborne, held steer (like the
    // air spin) still accumulates whole turns; the landing collapse and
    // the round-8 grip window sort out whatever angle comes down.
    const airborne: SkiState = {
      ...cruising,
      heading: 3.0,
      flightHeading: 0,
      height: 1,
      verticalVelocity: 2,
    };

    const state = stepSkiing(airborne, { ...noInput, right: true }, 0.2);

    expect(state.heading).toBeGreaterThan(Math.PI);
  });

  it("never travels uphill through a boosted turnaround — the round-5 bar", () => {
    // The boost × turnaround bug: turn backward while holding Shift and
    // the old model whipped the momentum through 180° — 3.5s of tips-first
    // uphill travel at boost speed. The round-5 bar still holds (never
    // uphill), and round 6 raised it: the pivot passes through a spent
    // moment at sideways — the scrub dumps the run — then boost rebuilds
    // it riding switch.
    let state: SkiState = { ...cruising, speed: BOOST_SPEED };
    let sawSwitch = false;
    let speedAtCrossing = Infinity;
    let speedAfterCrossing = Infinity;
    for (let i = 0; i < 200; i++) {
      // Steer hard until pointing backwards-ish, then just hold boost.
      const steering = Math.abs(downhillHeading(state.heading)) < 2.8;
      const next = stepSkiing(
        state,
        { ...noInput, right: steering, boost: true },
        0.02,
      );
      // The whole journey descends — no frame ever moves back up the hill.
      expect(next.distance).toBeGreaterThanOrEqual(state.distance - 1e-12);
      expect(next.status).toBe("skiing");
      if (
        Math.cos(state.heading) > 0 &&
        Math.cos(next.heading) <= 0 &&
        speedAtCrossing === Infinity
      ) {
        speedAtCrossing = Math.abs(state.speed);
        speedAfterCrossing = Math.abs(next.speed);
      }
      if (next.speed < 0) sawSwitch = true;
      state = next;
    }

    expect(sawSwitch).toBe(true);
    expect(Math.abs(downhillHeading(state.heading))).toBeGreaterThan(Math.PI / 2);
    // The scrub drains the approach — but round 7's sin⁴ softening lets
    // the boosted worst case outrun it and reach the crossing carrying a
    // few u/s (~3.7 measured; sin² spent it to ~0.1) — far below the ~13
    // that round 5 mirrored, and the backstop flip dumps it at the
    // crossing, so the run is spent within a frame either way.
    expect(speedAtCrossing).toBeLessThan(5);
    expect(speedAfterCrossing).toBeLessThanOrEqual(1);
    // ...and boost then rebuilds it riding switch at boost speed.
    expect(state.speed).toBeLessThan(-MAX_SPEED);
  });

  it("skids speed off harder the further the skis turn off the fall line", () => {
    // The round-6 model: turning IS braking in *rate*, not just target —
    // held fully sideways sheds boost speed in well under a second, while
    // the same shedding pointed down the fall line is a gentle coast.
    const fast = { ...cruising, speed: BOOST_SPEED };

    let sideways: SkiState = { ...fast, heading: Math.PI / 2 };
    let aligned: SkiState = fast;
    for (let i = 0; i < 25; i++) {
      sideways = stepSkiing(sideways, noInput, 0.02);
      aligned = stepSkiing(aligned, noInput, 0.02);
    }

    // 0.5s sideways: a hockey stop — dead, not just slower.
    expect(Math.abs(sideways.speed)).toBeLessThan(0.001);
    // 0.5s aligned: still carrying most of the boost — plain coast drag
    // (4 u/s²) is all that bites on the fall line.
    expect(aligned.speed).toBeGreaterThan(BOOST_SPEED - 2 - 0.01);
  });

  it("keeps held pivots smooth — the jerk bound, per stance-change path", () => {
    // Round 5 died on a ~13 u/s one-frame lateral mirror at the crossing.
    // Round 6's sin² scrub made every held pivot arrive spent (max jump
    // ~0.9); round 7's sin⁴ softening keeps that for plain pivots but lets
    // the boosted worst case reach the crossing with a few u/s for the
    // backstop dump to eat — a bounded bite (~4.4 measured), well under
    // half of round 5's rejected jerk. Both bounds pinned here so a future
    // scrub retune can't silently reopen the snap.
    const maxLateralJump = (boost: boolean): number => {
      let state: SkiState = { ...cruising, speed: boost ? BOOST_SPEED : BASE_SPEED };
      let prevLateralVelocity: number | null = null;
      let maxJump = 0;
      for (let i = 0; i < 200; i++) {
        const steering = Math.abs(downhillHeading(state.heading)) < 2.8;
        state = stepSkiing(state, { ...noInput, right: steering, boost }, 0.02);
        const lateralVelocity = state.speed * Math.sin(state.heading);
        if (prevLateralVelocity !== null) {
          maxJump = Math.max(maxJump, Math.abs(lateralVelocity - prevLateralVelocity));
        }
        prevLateralVelocity = lateralVelocity;
      }
      return maxJump;
    };

    expect(maxLateralJump(false)).toBeLessThan(2);
    expect(maxLateralJump(true)).toBeLessThan(6);
  });

  it("spends the run at a crossing the scrub never saw — the backstop flip dumps", () => {
    // A held pivot can't reach the crossing fast (the scrub drains the
    // approach), but landing a jump pointed near sideways at speed skips
    // the approach entirely. Crossing then flips the stance — travel never
    // turns uphill — and dumps the run to the flip epsilon instead of
    // carrying the magnitude (round 5 carried it, mirroring ~10 u/s of
    // lateral drift in one frame — the jerk that failed its playtest).
    const landedSideways: SkiState = { ...cruising, heading: Math.PI / 2 - 0.01, speed: 10 };

    const state = stepSkiing(landedSideways, { ...noInput, right: true }, 0.02);

    expect(Math.abs(downhillHeading(state.heading))).toBeGreaterThan(Math.PI / 2);
    // Riding switch no faster than the flip epsilon — spent, not reversed
    // (the same frame's easing then pulls it onto the tiny downhill target).
    expect(state.speed).toBeLessThan(0);
    expect(state.speed).toBeGreaterThanOrEqual(-1);
  });

  it("converges through zero at a crawl crossing — never mirrors", () => {
    // Below the flip epsilon there's no stance flip: a crawl across
    // sideways just eases onto the tiny downhill pull (the scrub makes
    // that convergence quick, but it's continuous — a mirror would land
    // near -0.5).
    const crawling: SkiState = { ...cruising, heading: Math.PI / 2 - 0.01, speed: 0.5 };

    const state = stepSkiing(crawling, { ...noInput, right: true }, 0.02);

    expect(Math.abs(downhillHeading(state.heading))).toBeGreaterThan(Math.PI / 2);
    expect(state.speed).toBeLessThan(0.5);
    expect(state.speed).toBeGreaterThan(-0.1);
  });

  it("turns faster while boosting", () => {
    // Shift commits harder into direction changes (round 5's second half):
    // the same held steer covers 1.4× the angle with boost held.
    const plain = stepSkiing(cruising, { ...noInput, right: true }, 0.1);
    const boosted = stepSkiing(
      cruising,
      { ...noInput, right: true, boost: true },
      0.1,
    );

    expect(boosted.heading / plain.heading).toBeCloseTo(1.4, 5);
  });

  it("boosts the W-seek too — one steering system, one multiplier", () => {
    // Riding switch, the seek's target is π (round 7) — boost eases toward
    // it 1.4× faster, same multiplier as manual steering.
    const ridingSwitch: SkiState = { ...cruising, heading: 3.0, speed: -BASE_SPEED };

    // dt small enough that neither seek saturates onto π (at 0.1 even the
    // plain turn covers the whole 0.14 rad to home, hiding the ratio).
    const plain = stepSkiing(ridingSwitch, { ...noInput, up: true }, 0.02);
    const boosted = stepSkiing(
      ridingSwitch,
      { ...noInput, up: true, boost: true },
      0.02,
    );

    expect(boosted.heading).toBeGreaterThan(plain.heading);
    expect((boosted.heading - 3.0) / (plain.heading - 3.0)).toBeCloseTo(1.4, 5);
  });

  it("bleeds to a stop held fully sideways — braking-by-turning is a hockey stop", () => {
    let state: SkiState = { ...cruising, heading: Math.PI / 2 };
    for (let i = 0; i < 150; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }

    expect(state.status).toBe("skiing");
    expect(Math.abs(state.speed)).toBeLessThan(0.001);
  });

  it("pivots out of a hockey stop and gets going again", () => {
    // Stopped dead, skis sideways: steer back downhill (floor authority),
    // and gravity takes over again.
    let state: SkiState = { ...cruising, heading: Math.PI / 2, speed: 0 };
    for (let i = 0; i < 200 && state.heading > 0.2; i++) {
      state = stepSkiing(state, { ...noInput, left: true }, 0.02);
    }
    expect(state.heading).toBeLessThanOrEqual(0.2);

    for (let i = 0; i < 100; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }
    expect(state.speed).toBeGreaterThan(MIN_SPEED);
  });

  it("stays riding switch on W — straightens backwards and speeds up", () => {
    // The director's bar for turning round 7 ("I want to be able to turn
    // around and continue down the slope backwards… when I go backwards I
    // can only go base speed, and if I press W I flip forwards again"),
    // which deliberately inverts round 4's return-on-W-alone bar: W in
    // switch straightens the skis onto the backwards fall line and applies
    // its speed lean there — full lean speed, tails-first, no flip.
    let state: SkiState = { ...cruising, heading: 3.0, speed: -BASE_SPEED };
    for (let i = 0; i < 400; i++) {
      state = stepSkiing(state, { ...noInput, up: true }, 0.02);
      expect(state.status).toBe("skiing");
      // Never leaves switch: the seek pulls toward ±π, not through it.
      expect(Math.abs(downhillHeading(state.heading))).toBeGreaterThan(Math.PI / 2);
    }

    expect(Math.abs(Math.abs(state.heading) - Math.PI)).toBeLessThan(0.01);
    expect(state.speed).toBe(-MAX_SPEED);
    expect(state.lives).toBe(STARTING_LIVES);
  });

  it("boosts backwards too — switch is first-class at every speed", () => {
    // The re-check the round-7 sketch asked for, pinned: Shift riding
    // switch rebuilds to full boost speed tails-first.
    let state: SkiState = { ...cruising, heading: 3.0, speed: -BASE_SPEED };
    for (let i = 0; i < 400; i++) {
      state = stepSkiing(state, { ...noInput, up: true, boost: true }, 0.02);
    }

    expect(state.speed).toBe(-BOOST_SPEED);
  });

  it("keeps W a pure speed lean when already pointing downhill", () => {
    // Straight running, W held: nothing to seek — heading stays put and
    // the lean's speed-up meaning is unchanged.
    let state = cruising;
    for (let i = 0; i < 50; i++) {
      state = stepSkiing(state, { ...noInput, up: true }, 0.02);
    }

    expect(state.heading).toBe(0);
    expect(state.speed).toBeGreaterThan(BASE_SPEED);
  });

  it("keeps W a pure speed lean when already pointing dead backwards", () => {
    // The switch twin: exactly backwards is the stable point of the switch
    // seek (round 7 retired round 4's tie-break turn away from it) — the
    // heading holds and the lean speeds the descent tails-first.
    let state: SkiState = { ...cruising, heading: Math.PI, speed: -BASE_SPEED };
    for (let i = 0; i < 50; i++) {
      state = stepSkiing(state, { ...noInput, up: true }, 0.02);
    }

    // ±π are the same angle; the grounded normalization happens to settle
    // on the −π representation — the magnitude is what's pinned here.
    expect(Math.abs(state.heading)).toBe(Math.PI);
    expect(state.speed).toBeLessThan(-BASE_SPEED);
  });

  it("holds a stable diagonal on W plus a steer key, in either stance", () => {
    // W+right settles at the carve diagonal *of the stance you're in*
    // (round 7): forward stances grow out to π/4; switch stances settle at
    // the mirrored diagonal −3π/4 — the one that drifts the same screen
    // side as the right key does riding switch.
    let fromStraight = cruising;
    let fromSwitch: SkiState = { ...cruising, heading: 2.5, speed: -BASE_SPEED };
    for (let i = 0; i < 300; i++) {
      fromStraight = stepSkiing(fromStraight, { ...noInput, up: true, right: true }, 0.02);
      fromSwitch = stepSkiing(fromSwitch, { ...noInput, up: true, right: true }, 0.02);
    }

    expect(fromStraight.heading).toBeCloseTo(Math.PI / 4, 5);
    expect(fromSwitch.heading).toBeCloseTo((-3 * Math.PI) / 4, 5);
  });

  it("seeks the nearest fall-line alignment — never across sideways", () => {
    // Round 7's seek is stance-aware: a forward stance eases home to 0 as
    // ever, but riding switch W straightens *backwards* — heading 3.0
    // eases up toward π, its mirror eases down toward −π. W never carries
    // the skis across sideways; changing stance is a deliberate held steer.
    const forward: SkiState = { ...cruising, heading: 1.2 };
    const turnedRight: SkiState = { ...cruising, heading: 3.0, speed: -BASE_SPEED };
    const turnedLeft: SkiState = { ...cruising, heading: -3.0, speed: -BASE_SPEED };

    const home = stepSkiing(forward, { ...noInput, up: true }, 0.02);
    const toPi = stepSkiing(turnedRight, { ...noInput, up: true }, 0.02);
    const toNegPi = stepSkiing(turnedLeft, { ...noInput, up: true }, 0.02);

    expect(home.heading).toBeLessThan(1.2);
    expect(toPi.heading).toBeGreaterThan(3.0);
    expect(toNegPi.heading).toBeLessThan(-3.0);
  });

  it("re-aims toward the nearest alignment mid-air without bending the flight path", () => {
    // W's seek is the same steering system as left/right, so it works in
    // the air too — and stance-aware (round 7), it squares the body up for
    // the *nearest* landing: skis past sideways ease on toward backwards
    // (the least rotation left to land clean, riding switch), while the
    // flight stays ballistic along the frozen takeoff direction.
    const spinning: SkiState = {
      ...cruising,
      heading: 3.0,
      flightHeading: 0.5,
      height: 1,
      verticalVelocity: 2,
    };

    const state = stepSkiing(spinning, { ...noInput, up: true }, 0.1);

    expect(state.heading).toBeGreaterThan(3.0);
    expect(state.heading).toBeLessThanOrEqual(Math.PI);
    expect(state.flightHeading).toBe(0.5);
    expect(state.speed).toBe(BASE_SPEED);
    expect(state.lateral).toBeCloseTo(BASE_SPEED * Math.sin(0.5) * 0.1, 10);
  });

  it("slows the descent as the skis point across the hill", () => {
    const straight = stepSkiing(cruising, noInput, 0.1);
    // Gripped sideways stand: travel already on the ski axis (a landing
    // that PUT you sideways would still be sliding — that's the round-8
    // slip tests below).
    const sideways = stepSkiing(
      { ...cruising, heading: Math.PI / 2, flightHeading: Math.PI / 2 },
      noInput,
      0.1,
    );

    // Fully sideways, none of the speed is going down the hill.
    expect(sideways.distance - cruising.distance).toBeCloseTo(0, 5);
    expect(straight.distance).toBeGreaterThan(cruising.distance);
  });

  it("records the last checkpoint passed", () => {
    let state: SkiState = { ...nearChasm, distance: 24, height: 1 };
    for (let i = 0; i < 30; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }

    expect(state.distance).toBeGreaterThan(26);
    expect(state.lastCheckpoint).toBe(26);
  });
});

describe("crashing and the cat's nine lives", () => {
  it("costs a life and pauses when falling into a chasm", () => {
    const crashed = skiUntilCrash(nearChasm);

    expect(crashed.lives).toBe(STARTING_LIVES - 1);
    expect(crashed.respawnTimer).toBeCloseTo(RESPAWN_DELAY, 5);
  });

  it("ignores input and holds position during the crash pause", () => {
    const crashed = skiUntilCrash(nearChasm);

    const during = stepSkiing(crashed, { ...noInput, jump: true, boost: true }, 0.1);

    expect(during.status).toBe("crashed");
    expect(during.distance).toBe(crashed.distance);
    expect(during.respawnTimer).toBeCloseTo(crashed.respawnTimer - 0.1, 5);
  });

  it("respawns at the last checkpoint after the pause", () => {
    const crashed = skiUntilCrash({ ...nearChasm, lastCheckpoint: 10 });

    const respawned = stepSkiing(crashed, noInput, RESPAWN_DELAY + 0.01);

    expect(respawned.status).toBe("skiing");
    expect(respawned.distance).toBe(10);
    expect(respawned.lateral).toBe(0);
    expect(respawned.height).toBe(0);
    // Respawn pointing straight downhill, regular stance — whatever turn
    // you crashed carrying doesn't follow you back to the checkpoint.
    expect(respawned.heading).toBe(0);
    // Momentum: the crash scrubbed your speed — you push off again.
    expect(respawned.speed).toBe(0);
    expect(respawned.lives).toBe(STARTING_LIVES - 1);
  });

  it("can retry the same chasm after respawning", () => {
    const crashed = skiUntilCrash(nearChasm);
    const respawned = stepSkiing(crashed, noInput, RESPAWN_DELAY + 0.01);

    let state = respawned;
    for (let i = 0; i < 300; i++) {
      // Hold-to-charge: load through the approach, release just before the
      // chasm's lip and the release launches.
      const jump = state.distance > 18 && state.distance < 19;
      state = stepSkiing(state, { ...noInput, jump }, 0.02);
    }

    expect(state.distance).toBeGreaterThan(23);
    expect(state.status).toBe("skiing");
  });

  it("forfeits the run when the last life is lost", () => {
    const crashed = skiUntilCrash({ ...nearChasm, lives: 1 });
    expect(crashed.lives).toBe(0);

    const after = stepSkiing(crashed, noInput, RESPAWN_DELAY + 0.01);

    expect(after.status).toBe("forfeited");
  });

  it("stays forfeited no matter the input", () => {
    const crashed = skiUntilCrash({ ...nearChasm, lives: 1 });
    const forfeited = stepSkiing(crashed, noInput, RESPAWN_DELAY + 0.01);

    const next = stepSkiing(forfeited, { ...noInput, up: true, jump: true }, 1);

    expect(next).toEqual(forfeited);
  });
});

describe("Slope 1: the finite track", () => {
  // Cruising a hair short of the finish, no hazards in the way.
  const nearFinish: SkiState = {
    ...cruising,
    distance: FINISH_DISTANCE - 1,
    finishDistance: FINISH_DISTANCE,
    speed: BASE_SPEED,
  };

  it("lays Slope 1 out as a finite track to the beat sheet", () => {
    const s = createInitialSkiState();
    expect(s.finishDistance).toBe(FINISH_DISTANCE);
    expect(s.finishTimer).toBe(0);
    expect(s.status).toBe("skiing");
    // The signature cliff jump is the single widest gap, at beat 4.
    const widest = Math.max(...s.chasms.map((c) => c.width));
    const cliff = s.chasms.find((c) => c.width === widest);
    expect(cliff?.start).toBe(380);
    // Checkpoints start at the top and only ever ascend.
    expect(s.checkpoints[0]).toBe(0);
    const ascending = s.checkpoints.every(
      (c, i) => i === 0 || c > (s.checkpoints[i - 1] ?? 0),
    );
    expect(ascending).toBe(true);
    // Every chasm sits ahead of a checkpoint, so a crash only ever replays the
    // hazard that killed you — never the whole slope.
    for (const chasm of s.chasms) {
      const priors = s.checkpoints.filter((c) => c < chasm.start);
      expect(priors.length).toBeGreaterThan(0);
    }
  });

  it("finishes the run when the finish distance is crossed", () => {
    const after = stepSkiing(nearFinish, noInput, 0.5);
    expect(after.distance).toBeGreaterThanOrEqual(FINISH_DISTANCE);
    expect(after.status).toBe("finished");
    expect(after.finishTimer).toBeCloseTo(FINISH_LINGER);
    // Winning keeps every life — it's not a crash.
    expect(after.lives).toBe(STARTING_LIVES);
  });

  it("coasts to a stop and ignores all input after finishing", () => {
    let state = stepSkiing(nearFinish, noInput, 0.5);
    expect(state.status).toBe("finished");
    const speedAtFinish = state.speed;
    // Hammer every control — none of it drives the run once it's won.
    for (let i = 0; i < 60; i++) {
      state = stepSkiing(
        state,
        { ...noInput, up: true, left: true, boost: true, jump: true },
        0.05,
      );
    }
    expect(state.status).toBe("finished");
    // Speed bled to a stop rather than holding cruise or boosting away.
    expect(state.speed).toBeLessThan(speedAtFinish);
    expect(state.speed).toBeCloseTo(0);
    // Steering did nothing — the heading never left straight downhill.
    expect(state.heading).toBe(nearFinish.heading);
  });

  it("runs the coast timer down to zero and holds there", () => {
    let state = stepSkiing(nearFinish, noInput, 0.5);
    for (let i = 0; i < 300 && state.finishTimer > 0; i++) {
      state = stepSkiing(state, noInput, 0.05);
    }
    expect(state.finishTimer).toBe(0);
    expect(state.status).toBe("finished");
  });

  it("the last chasm ends well before the finish — they never overlap", () => {
    const s = createInitialSkiState();
    const lastChasmEnd = Math.max(...s.chasms.map((c) => c.start + c.width));
    expect(lastChasmEnd).toBeLessThan(s.finishDistance);
  });
});

describe("Slope 1: the rock-gate pinch", () => {
  it("is full width away from the gate and narrower at its center", () => {
    expect(laneHalfWidth(0)).toBe(LATERAL_LIMIT);
    expect(laneHalfWidth(FINISH_DISTANCE)).toBe(LATERAL_LIMIT);
    const atGate = laneHalfWidth(560);
    expect(atGate).toBeLessThan(LATERAL_LIMIT);
    expect(atGate).toBeGreaterThan(0);
  });

  it("never opens wider than the maximum lane", () => {
    for (let d = 0; d <= FINISH_DISTANCE; d += 5) {
      expect(laneHalfWidth(d)).toBeLessThanOrEqual(LATERAL_LIMIT);
    }
  });

  it("shepherds an edge-hugging skier inward through the pinch", () => {
    // At the gate center, a skier pinned to the full-width edge is pulled in.
    const atGate: SkiState = {
      ...cruising,
      distance: 560,
      lateral: LATERAL_LIMIT,
      speed: BASE_SPEED,
    };
    const after = stepSkiing(atGate, noInput, 0.02);
    expect(after.lateral).toBeLessThan(LATERAL_LIMIT);
    expect(after.lateral).toBeLessThanOrEqual(laneHalfWidth(after.distance) + 1e-9);

    // Outside the pinch the full edge is still reachable.
    const open: SkiState = { ...atGate, distance: 100 };
    const afterOpen = stepSkiing(open, noInput, 0.02);
    expect(afterOpen.lateral).toBeCloseTo(LATERAL_LIMIT);
  });
});

// The signature cliff jump (beat 4) is meant to demand commitment — a wide
// crevasse a bare tap can't clear. Sweep launch timing so the check is about
// the jump's reach, not one lucky takeoff frame.
function bestCaseClears(width: number, holdFrames: number): boolean {
  for (let launchAt = 86; launchAt <= 99.6; launchAt += 0.1) {
    let state: SkiState = {
      ...cruising,
      distance: 80,
      speed: BASE_SPEED,
      chasms: [{ id: "x", start: 100, width }],
    };
    let held = 0;
    let released = false;
    for (let i = 0; i < 800 && state.status === "skiing"; i++) {
      let jump = false;
      if (state.height <= 0 && !released) {
        if (state.distance >= launchAt && held < holdFrames) {
          jump = true;
          held++;
        } else if (held > 0) {
          released = true; // this frame's release launches the loaded charge
        }
      }
      state = stepSkiing(state, { ...noInput, jump }, 0.01);
      if (state.distance >= 100 + width + 3) break;
    }
    if (state.status === "skiing" && state.distance >= 100 + width) return true;
  }
  return false;
}

describe("Slope 1: the signature cliff jump demands commitment", () => {
  const cliffWidth = 5.5; // matches createInitialSkiState's chasm-3

  it("clears a warm-up-sized gap on a bare tap", () => {
    expect(bestCaseClears(3, 1)).toBe(true);
  });

  it("cannot clear the wide cliff crevasse on a bare tap", () => {
    expect(bestCaseClears(cliffWidth, 1)).toBe(false);
  });

  it("clears the cliff crevasse with a full charge", () => {
    expect(bestCaseClears(cliffWidth, Math.ceil(JUMP_CHARGE_TIME / 0.01))).toBe(
      true,
    );
  });
});

// The branching map (SLOPE_BRANCHING.md §4): the real summit → flag map, as
// grayblock on this same sim. Three full routes — Cave, Ice, Water — plus the
// forest Type A no-op, all obeying one law: SAME CLOCK, SAME FLAG. The riskiest
// system in the concept is the handoff (enter a detour, ski it, rejoin at the
// same place at the same time), and its correctness reduces to that law. These
// pin it at the sim level; the visual handoff continuity is the live
// grayblock's job.
describe("The branching map: same clock, same flag", () => {
  const dt = 0.02;

  // Ski straight to the flag, arming the given diverts at the right segments,
  // recording the segments visited and the step count (elapsed time / dt).
  // `diverts` maps a segment id → the detour to take when the run reaches it —
  // injected as state (not via the lateral trigger), so the motion stays a dead-
  // straight coast on every route and the step counts are comparable. Taps a
  // full jump to clear any gap in the current segment; jumps are time-neutral
  // (vertical only, forward speed held), so they never bias the comparison. The
  // jump is TIMED to the gap (not launched a fixed distance out), so the launch
  // phase is identical whatever the cruise speed — which now VARIES with the
  // grade (steepness → speed), so a fixed-distance launch would mis-time on the
  // mellow flats and drop the run into the gap.
  function runToFlag(diverts: Record<string, string> = {}): {
    steps: number;
    segments: string[];
    final: SkiState;
  } {
    let state = createBranchingSkiState();
    const segments = [state.segmentId];
    let steps = 0;
    // The branching map has NO finish line now (director 2026-07-24): the run
    // reaches the flag (route distance TOTAL) and would coast off down the open
    // runout. We stop AT the flag so the step counts across routes stay
    // comparable — "same clock, same flag" is still the law, just measured on
    // route distance rather than the (now removed) "finished" status.
    for (
      ;
      steps < 6000 &&
      state.status !== "forfeited" &&
      routeDistanceOf(state.segmentId, state.distance) < TOTAL_ROUTE_LENGTH;
      steps++
    ) {
      // Arm this segment's divert once, the frame we're on it.
      const into = diverts[state.segmentId];
      if (into && state.divertTo === null) {
        state = { ...state, divertTo: into };
      }
      // Charge a full jump timed to the gap: hold from ~1.0 s out (long enough to
      // top the 0.6 s charge) and release ~0.3 s before the edge, so the launch
      // phase is the same at any speed and the parabola straddles the width-3 gap.
      // Grounded-only so it doesn't recharge mid-air.
      const grounded = state.height <= 0;
      const speed = Math.max(1, Math.abs(state.speed));
      const approaching = state.chasms.some((c) => {
        const timeToGap = (c.start - state.distance) / speed;
        return timeToGap > 0.3 && timeToGap < 1.0;
      });
      state = stepSkiing(state, { ...noInput, jump: grounded && approaching }, dt);
      if (segments[segments.length - 1] !== state.segmentId) {
        segments.push(state.segmentId);
      }
    }
    // Reached the flag still skiing (no finish line) — never forfeited/timed out.
    expect(state.status).toBe("skiing");
    expect(
      routeDistanceOf(state.segmentId, state.distance),
    ).toBeGreaterThanOrEqual(TOTAL_ROUTE_LENGTH);
    return { steps, segments, final: state };
  }

  it("a fresh run starts at the summit segment with its skeleton", () => {
    const s = createBranchingSkiState();
    expect(s.segmentId).toBe("summit");
    expect(s.segmentId).toBe(BRANCH_START);
    expect(s.finishDistance).toBe(BRANCH_SEGMENTS.summit!.length);
    expect(s.chasms).toEqual(BRANCH_SEGMENTS.summit!.chasms);
    expect(s.divertTo).toBeNull();
  });

  it("every full route is the same total length (same clock, by construction)", () => {
    const len = (id: string): number => BRANCH_SEGMENTS[id]!.length;
    const cave = ["summit", "forest-road", "lake", "yeti", "cave", "cliff"];
    const ice = ["summit", "forest-road", "lake", "yeti", "ledge", "valley", "ice-castle"];
    const water = ["summit", "forest-road", "lake", "water", "cliff"];
    for (const route of [cave, ice, water]) {
      expect(route.reduce((sum, id) => sum + len(id), 0)).toBe(TOTAL_ROUTE_LENGTH);
    }
    // The forest Type A is a same-length no-op: the tree world equals the road.
    expect(len("forest-tree")).toBe(len("forest-road"));
  });

  it("shared reconvergences sit at the same clock whichever fork reached them", () => {
    // The cliff is shared by the Cave line (via yeti·cave) and the Water line
    // (via water). routeDistanceOf reports the same progress there both ways —
    // proof no line is a shortcut into the finale.
    expect(routeDistanceOf("cave", BRANCH_SEGMENTS.cave!.length)).toBe(
      routeDistanceOf("water", BRANCH_SEGMENTS.water!.length),
    );
    expect(routeDistanceOf("cliff", 0)).toBe(
      routeDistanceOf("cave", BRANCH_SEGMENTS.cave!.length),
    );
    // The forest fork shares an offset too (road and tree both at 120).
    expect(routeDistanceOf("forest-tree", 50)).toBe(
      routeDistanceOf("forest-road", 50),
    );
  });

  it("the Cave line runs summit → forest-road → lake → yeti → cave → cliff → flag", () => {
    const { segments, final } = runToFlag(); // all defaults
    expect(segments).toEqual([
      "summit",
      "forest-road",
      "lake",
      "yeti",
      "cave",
      "cliff",
    ]);
    expect(
      routeDistanceOf(final.segmentId, final.distance),
    ).toBeGreaterThanOrEqual(TOTAL_ROUTE_LENGTH);
  });

  it("the Ice line splits at the peak: … → yeti → ledge → valley → ice-castle → flag", () => {
    const { segments, final } = runToFlag({ yeti: "ledge" });
    expect(segments).toEqual([
      "summit",
      "forest-road",
      "lake",
      "yeti",
      "ledge",
      "valley",
      "ice-castle",
    ]);
    expect(
      routeDistanceOf(final.segmentId, final.distance),
    ).toBeGreaterThanOrEqual(TOTAL_ROUTE_LENGTH);
  });

  it("the Water line drops at the lake: … → lake → water → cliff → flag", () => {
    const { segments, final } = runToFlag({ lake: "water" });
    expect(segments).toEqual(["summit", "forest-road", "lake", "water", "cliff"]);
    expect(
      routeDistanceOf(final.segmentId, final.distance),
    ).toBeGreaterThanOrEqual(TOTAL_ROUTE_LENGTH);
  });

  it("all three routes (+ the tree no-op) reach the flag at the same clock (the law, behaviorally)", () => {
    // Identical dead-straight skiing — the ONLY difference is the fork — so all
    // finish at the same clock: 'no line is faster', proven end to end, not just
    // asserted on the data. The Water/tree lines cross the SAME gaps at the same
    // depths as the Cave line, so they match it to the step; the Ice line jumps
    // the valley (route ~520) where the Cave/Water lines jump the cliff (~590),
    // and because speed now varies with the grade, the brief airborne interval
    // there (which pauses speed adaptation) lands at a slightly different depth —
    // a sub-second timing artifact of WHERE the gap sits, not a shortcut. So the
    // step counts match to within a hair; the exact equal-length law is the
    // by-construction test above.
    const cave = runToFlag();
    const ice = runToFlag({ yeti: "ledge" });
    const water = runToFlag({ lake: "water" });
    const tree = runToFlag({ summit: "forest-tree" }); // Type A, then Cave line
    // Water and the tree no-op share the Cave line's gaps → identical to the step.
    expect(water.steps).toBe(cave.steps);
    expect(tree.steps).toBe(cave.steps);
    // The Ice line matches to within a handful of steps (the jump-depth artifact).
    for (const run of [ice, water, tree]) {
      expect(Math.abs(run.steps - cave.steps)).toBeLessThanOrEqual(10);
      // Every route finishes just past the flag, all within a unit of each other.
      const routeDist = routeDistanceOf(run.final.segmentId, run.final.distance);
      expect(routeDist).toBeGreaterThanOrEqual(TOTAL_ROUTE_LENGTH);
      expect(routeDist).toBeCloseTo(
        routeDistanceOf(cave.final.segmentId, cave.final.distance),
        0,
      );
    }
  });

  it("roadSegmentIds is the default line; the detour worlds are off it", () => {
    const road = roadSegmentIds();
    expect([...road]).toEqual(["summit", "forest-road", "lake", "yeti", "cave", "cliff"]);
    for (const detour of ["forest-tree", "water", "ledge", "valley", "ice-castle"]) {
      expect(road.has(detour)).toBe(false);
    }
  });

  it.each([
    ["summit", "forest-tree", 85], // the great tree
    ["lake", "water", 70], // the yeti's hole
    ["yeti", "ledge", 50], // the yeti's-son shove
  ])(
    "skiing into %s's trigger volume arms the %s fork",
    (segmentId, into, distance) => {
      const seg = BRANCH_SEGMENTS[segmentId]!;
      let state: SkiState = {
        ...createBranchingSkiState(),
        segmentId,
        finishDistance: seg.length,
        chasms: seg.chasms,
        checkpoints: seg.checkpoints,
        distance,
        lateral: 8, // inside every trigger's lateral window (4..12)
        speed: BASE_SPEED,
      };
      state = stepSkiing(state, noInput, dt);
      expect(state.divertTo).toBe(into);
    },
  );

  it("outside the trigger's lateral window it does NOT arm (you skied past it)", () => {
    let state: SkiState = {
      ...createBranchingSkiState(),
      distance: 85,
      lateral: 0, // straight down the road, well left of the great tree
      speed: BASE_SPEED,
    };
    state = stepSkiing(state, noInput, dt);
    expect(state.divertTo).toBeNull();
  });

  it("an armed fork routes into the detour at the boundary, not the road", () => {
    let state: SkiState = {
      ...createBranchingSkiState(),
      distance: BRANCH_SEGMENTS.summit!.length - 2,
      lateral: 8,
      speed: BASE_SPEED,
    };
    for (let i = 0; i < 60 && state.segmentId === "summit"; i++) {
      state = stepSkiing(state, noInput, dt);
    }
    expect(state.segmentId).toBe("forest-tree"); // the detour, not forest-road
    expect(state.divertTo).toBeNull(); // consumed at the boundary
  });

  it("crossing a boundary loads the next segment and resets the respawn to its entrance", () => {
    const yeti = BRANCH_SEGMENTS.yeti!;
    let state: SkiState = {
      ...createBranchingSkiState(),
      segmentId: "yeti",
      distance: yeti.length - 0.05,
      speed: BASE_SPEED,
      finishDistance: yeti.length,
      chasms: yeti.chasms,
      checkpoints: yeti.checkpoints,
      lastCheckpoint: 0,
    };
    state = stepSkiing(state, noInput, dt);
    expect(state.segmentId).toBe("cave"); // the default successor
    expect(state.finishDistance).toBe(BRANCH_SEGMENTS.cave!.length);
    expect(state.chasms).toEqual(BRANCH_SEGMENTS.cave!.chasms);
    expect(state.lastCheckpoint).toBe(0);
    expect(state.distance).toBeGreaterThanOrEqual(0);
    expect(state.distance).toBeLessThan(1);
  });

  it("crashing in a segment respawns within it and clears any fork (§6)", () => {
    const cliff = BRANCH_SEGMENTS.cliff!;
    let state: SkiState = {
      ...createBranchingSkiState(),
      segmentId: "cliff",
      distance: cliff.chasms[0]!.start - 1,
      speed: BASE_SPEED,
      finishDistance: cliff.length,
      chasms: cliff.chasms,
      checkpoints: cliff.checkpoints,
      lastCheckpoint: cliff.checkpoints[0]!, // 45, just before the gap
      divertTo: "water", // a stale fork that a respawn must clear
    };
    for (let i = 0; i < 60 && state.status === "skiing"; i++) {
      state = stepSkiing(state, noInput, dt);
    }
    expect(state.status).toBe("crashed");
    for (let i = 0; i < 120 && state.status !== "skiing"; i++) {
      state = stepSkiing(state, noInput, dt);
    }
    expect(state.segmentId).toBe("cliff");
    expect(state.distance).toBe(cliff.checkpoints[0]);
    expect(state.divertTo).toBeNull();
  });
});

describe("steepness → speed (M2 grade coupling)", () => {
  // Cruise from a standstill with no input for 3 s and read the settled speed —
  // the natural pace the terrain's grade pulls you to.
  const cruise = (state: SkiState): number => {
    let s = state;
    for (let i = 0; i < 180; i++) s = stepSkiing(s, noInput, 1 / 60);
    return Math.abs(s.speed);
  };

  it("leaves the flat Overlook's cruise at BASE_SPEED (a no-op there)", () => {
    // "main" has no grade → factor 1 → the locked feel is untouched.
    const overlook = cruise({ ...createInitialSkiState(), chasms: [] });
    expect(overlook).toBeCloseTo(BASE_SPEED, 1);
  });

  it("cruises FASTER the steeper the segment, and the graded map out-paces the flat Overlook", () => {
    const steep = cruise({ ...createBranchingSkiState(), chasms: [] }); // summit, steep
    const mellow = cruise({
      ...createBranchingSkiState(),
      segmentId: "lake", // route dist 240 — the mellow forest/lake zone
      distance: 0,
      chasms: [],
      finishDistance: 1000,
    });
    const overlook = cruise({ ...createInitialSkiState(), chasms: [] });
    // The steepness law: steeper terrain skis faster.
    expect(steep).toBeGreaterThan(mellow);
    // "Increase speed on slopes" (director 2026-07-24): the whole graded mountain
    // is quick now — even its mellow zones out-pace the flat baseline Overlook.
    expect(mellow).toBeGreaterThan(overlook);
  });
});
