import { describe, expect, it } from "vitest";
import {
  BASE_SPEED,
  BOOST_SPEED,
  createInitialSkiState,
  MIN_SPEED,
  RESPAWN_DELAY,
  STARTING_LIVES,
  stepSkiing,
  type SkiInput,
  type SkiState,
} from "./skiing";

const noInput: SkiInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  boost: false,
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
  status: "skiing",
  lives: STARTING_LIVES,
  respawnTimer: 0,
  lastCheckpoint: 0,
  checkpoints: [0, 26],
  chasms: [{ id: "c1", start: 20, width: 3 }],
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
    const state = stepSkiing(cruising, { ...noInput, right: true }, 1);

    expect(state.lateral).toBeGreaterThan(0);
    expect(state.lateral).toBeLessThanOrEqual(4);
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

  it("jumps and comes back down under gravity", () => {
    const jumped = stepSkiing(createInitialSkiState(), { ...noInput, jump: true }, 0.1);

    expect(jumped.height).toBeGreaterThan(0);
  });

  it("clears a chasm when jumping over it", () => {
    let state = nearChasm;
    for (let i = 0; i < 30; i++) {
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
    // No built-in stop: the turn keeps accumulating as long as you hold it.
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
    let state: SkiState = { ...cruising, heading: 0.5 };
    state = stepSkiing(state, { ...noInput, jump: true }, 0.02);
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

  it("returns from switch to forward running on W alone — never released", () => {
    // The director's bar for turning round 4: turn backwards and come back
    // forward without ever letting off W. Start riding switch; hold W.
    let state: SkiState = { ...cruising, heading: Math.PI, speed: -BASE_SPEED };
    for (let i = 0; i < 400; i++) {
      state = stepSkiing(state, { ...noInput, up: true }, 0.02);
      expect(state.status).toBe("skiing");
    }

    expect(Math.abs(state.heading)).toBeLessThan(0.01);
    expect(state.speed).toBeGreaterThan(MIN_SPEED);
    expect(state.lives).toBe(STARTING_LIVES);
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

  it("holds a stable diagonal on W plus a steer key", () => {
    // W+right settles at the carve diagonal — from straight running it
    // grows out to it, and from way past it W pulls back to the same
    // angle. One target, approached from both sides.
    let fromStraight = cruising;
    let fromSwitch: SkiState = { ...cruising, heading: 2.5 };
    for (let i = 0; i < 300; i++) {
      fromStraight = stepSkiing(fromStraight, { ...noInput, up: true, right: true }, 0.02);
      fromSwitch = stepSkiing(fromSwitch, { ...noInput, up: true, right: true }, 0.02);
    }

    expect(fromStraight.heading).toBeCloseTo(Math.PI / 4, 5);
    expect(fromSwitch.heading).toBeCloseTo(Math.PI / 4, 5);
  });

  it("seeks the fall line the shortest way around", () => {
    // Riding switch turned right (heading just short of π): home is
    // shorter backing out the way you came in — a left turn — and the
    // mirror image turns right.
    const turnedRight: SkiState = { ...cruising, heading: 3.0, speed: -BASE_SPEED };
    const turnedLeft: SkiState = { ...cruising, heading: -3.0, speed: -BASE_SPEED };

    const leftward = stepSkiing(turnedRight, { ...noInput, up: true }, 0.02);
    const rightward = stepSkiing(turnedLeft, { ...noInput, up: true }, 0.02);

    expect(leftward.heading).toBeLessThan(3.0);
    expect(rightward.heading).toBeGreaterThan(-3.0);
  });

  it("breaks the exactly-backwards tie with a right turn", () => {
    // Dead backwards, both ways home are equidistant — pick right, and
    // keep picking it (no dithering across the boundary).
    let state: SkiState = { ...cruising, heading: Math.PI, speed: -BASE_SPEED };

    state = stepSkiing(state, { ...noInput, up: true }, 0.02);
    const first = state.heading;
    expect(first).toBeGreaterThan(-Math.PI);
    expect(first).toBeLessThan(-3);

    state = stepSkiing(state, { ...noInput, up: true }, 0.02);
    expect(state.heading).toBeGreaterThan(first);
  });

  it("re-aims toward the fall line mid-air without bending the flight path", () => {
    // W's seek is the same steering system as left/right, so it works in
    // the air too — the body comes around for the landing while the
    // flight stays ballistic along the frozen takeoff direction.
    const spinning: SkiState = {
      ...cruising,
      heading: 3.0,
      flightHeading: 0.5,
      height: 1,
      verticalVelocity: 2,
    };

    const state = stepSkiing(spinning, { ...noInput, up: true }, 0.1);

    expect(state.heading).toBeLessThan(3.0);
    expect(state.flightHeading).toBe(0.5);
    expect(state.speed).toBe(BASE_SPEED);
    expect(state.lateral).toBeCloseTo(BASE_SPEED * Math.sin(0.5) * 0.1, 10);
  });

  it("slows the descent as the skis point across the hill", () => {
    const straight = stepSkiing(cruising, noInput, 0.1);
    const sideways = stepSkiing(
      { ...cruising, heading: Math.PI / 2 },
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
      state = stepSkiing(state, { ...noInput, jump: state.distance > 18 }, 0.02);
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
