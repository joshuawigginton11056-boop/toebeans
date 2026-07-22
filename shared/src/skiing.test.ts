import { describe, expect, it } from "vitest";
import {
  BASE_SPEED,
  BOOST_SPEED,
  createInitialSkiState,
  FALL_HEADING,
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

  it("has almost no steering authority at a standstill", () => {
    const still = stepSkiing(createInitialSkiState(), { ...noInput, right: true }, 0.01);
    const atSpeed = stepSkiing(cruising, { ...noInput, right: true }, 0.01);

    // The first push-off frame grants a sliver of authority (speed updates
    // before steering) — call it under 2% of full-speed steering.
    expect(still.lateral).toBeLessThan(atSpeed.lateral * 0.02);
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

  it("spins faster in the air than the skis can carve on the snow", () => {
    const airborne: SkiState = {
      ...cruising,
      heading: 0.5,
      height: 1,
      verticalVelocity: 2,
    };

    const spun = stepSkiing(airborne, { ...noInput, right: true }, 0.1);
    const carved = stepSkiing(cruising, { ...noInput, right: true }, 0.1);

    // Air has no ski-bite resistance — a jump is where you spin.
    expect(spun.heading - 0.5).toBeGreaterThan(carved.heading * 2);
  });

  it("spins in the air even from a standstill hop", () => {
    // Ground steering authority scales with speed, but air spinning is
    // free rotation — no snow for the skis to bite.
    const hopping: SkiState = {
      ...cruising,
      speed: 0,
      height: 0.5,
      verticalVelocity: 1,
    };

    const state = stepSkiing(hopping, { ...noInput, left: true }, 0.1);

    expect(state.heading).toBeLessThan(0);
  });

  it("lands a completed spin clean, collapsed to its downhill-equivalent", () => {
    // Nearly a full 360 accumulated in the air, about to touch down.
    const landing: SkiState = {
      ...cruising,
      heading: 2 * Math.PI - 0.3,
      height: 0.05,
      verticalVelocity: -5,
    };

    let state = stepSkiing(landing, noInput, 0.05); // touches down
    state = stepSkiing(state, noInput, 0.05); // first grounded frame

    expect(state.status).toBe("skiing");
    // The whole turns collapse away — the skis point where they point.
    expect(Math.abs(state.heading)).toBeLessThan(FALL_HEADING);
    expect(state.heading).toBeCloseTo(-0.3, 1);
  });

  it("crashes an over-rotated landing on the first grounded frame", () => {
    // A half spin: the skis land pointing backward — a botched landing is
    // a fall, checked the moment the snow is back under them.
    const landing: SkiState = {
      ...cruising,
      heading: 3.0,
      height: 0.05,
      verticalVelocity: -5,
    };

    let state = stepSkiing(landing, noInput, 0.05); // touches down, still legal
    expect(state.status).toBe("skiing");
    state = stepSkiing(state, noInput, 0.05); // grounded — the edge gives out

    expect(state.status).toBe("crashed");
    expect(state.lives).toBe(STARTING_LIVES - 1);
  });

  it("slows the descent as the skis point across the hill", () => {
    const straight = stepSkiing(cruising, noInput, 0.1);
    const sideways = stepSkiing(
      { ...cruising, heading: Math.PI / 2 },
      noInput,
      0.1,
    );

    // Fully sideways, all the speed goes across the hill, none of it down.
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

  it("falls over when turned too far past sideways, costing a life", () => {
    // Start already at the edge of standing — one more held-steer step tips
    // it past FALL_HEADING.
    let state: SkiState = { ...cruising, heading: FALL_HEADING };
    for (let i = 0; i < 5 && state.status === "skiing"; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }

    expect(state.status).toBe("crashed");
    expect(state.lives).toBe(STARTING_LIVES - 1);
    expect(state.respawnTimer).toBeCloseTo(RESPAWN_DELAY, 5);
  });

  it("respawns from a fall-over pointing straight downhill", () => {
    let state: SkiState = { ...cruising, heading: FALL_HEADING, lastCheckpoint: 10 };
    for (let i = 0; i < 5 && state.status === "skiing"; i++) {
      state = stepSkiing(state, { ...noInput, right: true }, 0.02);
    }
    expect(state.status).toBe("crashed");

    const respawned = stepSkiing(state, noInput, RESPAWN_DELAY + 0.01);

    expect(respawned.status).toBe("skiing");
    expect(respawned.heading).toBe(0);
    expect(respawned.distance).toBe(10);
    expect(respawned.speed).toBe(0);
  });

  it("never falls over from a turn held only up to sideways", () => {
    // Ride at exactly sideways (inside the fall threshold) for two seconds
    // with no further steering — legal, just not descending.
    let state: SkiState = { ...cruising, heading: Math.PI / 2 };
    for (let i = 0; i < 100; i++) {
      state = stepSkiing(state, noInput, 0.02);
    }

    expect(state.status).toBe("skiing");
    expect(state.lives).toBe(STARTING_LIVES);
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
