import { describe, expect, it } from "vitest";
import {
  createTutorialSkiState,
  tutorialSunPhase,
  TUTORIAL_CREEK_START,
  TUTORIAL_CREEK_WIDTH,
  TUTORIAL_FINISH,
  TUTORIAL_SUNRISE_START,
} from "./tutorial";
import {
  MIN_JUMP_VELOCITY,
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
  spin: 0,
};

const DT = 1 / 60;

describe("the tutorial run", () => {
  it("starts fresh with full lives, at the top of its own flat segment", () => {
    const s = createTutorialSkiState();
    expect(s.lives).toBe(STARTING_LIVES);
    expect(s.distance).toBe(0);
    expect(s.status).toBe("skiing");
    expect(s.segmentId).toBe("tutorial");
    // The one hazard is the creek; a checkpoint sits on its run-in so a death
    // replays only the creek.
    expect(s.chasms.map((c) => c.id)).toEqual(["creek"]);
    expect(s.checkpoints).toContain(0);
    expect(s.finishDistance).toBe(TUTORIAL_FINISH);
  });

  it("carries a new player to the creek at roughly 30 seconds", () => {
    // A brand-new player who touches nothing: the sim eases up to the gentle
    // cruise on its own and just carries them downhill. The creek should arrive
    // around the half-minute mark (the design ask). This walks the real sim.
    let s = createTutorialSkiState();
    let elapsed = 0;
    while (s.distance < TUTORIAL_CREEK_START && elapsed < 120) {
      s = stepSkiing(s, noInput, DT);
      elapsed += DT;
    }
    expect(s.distance).toBeGreaterThanOrEqual(TUTORIAL_CREEK_START);
    expect(elapsed).toBeGreaterThan(26);
    expect(elapsed).toBeLessThan(34);
  });

  it("kills a player who skis straight into the creek", () => {
    // Grounded, cruising, right on the creek's edge — no jump. This is the
    // lesson's failure case: you lose a life.
    const s: SkiState = {
      ...createTutorialSkiState(),
      distance: TUTORIAL_CREEK_START - 2,
      speed: 8,
      lastCheckpoint: 0,
    };
    let cur = s;
    let crashed = false;
    for (let i = 0; i < 120 && !crashed; i++) {
      cur = stepSkiing(cur, noInput, DT);
      if (cur.status === "crashed") crashed = true;
    }
    expect(crashed).toBe(true);
    expect(cur.lives).toBe(STARTING_LIVES - 1);
  });

  it("lets a player who jumps clear the creek unharmed", () => {
    // Launched into a real jump arc just before the creek (a genuine takeoff
    // velocity), the skier sails over it above the clear height and lands past
    // the far bank — no crash. Same rule as any chasm; this pins it for the
    // creek, the tutorial's one lesson.
    let cur: SkiState = {
      ...createTutorialSkiState(),
      distance: TUTORIAL_CREEK_START - 1.5,
      speed: 8,
      height: 0.3,
      verticalVelocity: MIN_JUMP_VELOCITY,
      lastCheckpoint: 0,
    };
    let crashed = false;
    for (let i = 0; i < 60; i++) {
      cur = stepSkiing(cur, noInput, DT);
      if (cur.status === "crashed") crashed = true;
      if (cur.distance > TUTORIAL_CREEK_START + TUTORIAL_CREEK_WIDTH + 2) break;
    }
    expect(crashed).toBe(false);
    expect(cur.distance).toBeGreaterThan(TUTORIAL_CREEK_START + TUTORIAL_CREEK_WIDTH);
  });

  it("finishes when the player reaches the line past the creek", () => {
    let cur: SkiState = {
      ...createTutorialSkiState(),
      distance: TUTORIAL_FINISH - 5,
      speed: 8,
    };
    let finished = false;
    for (let i = 0; i < 120 && !finished; i++) {
      cur = stepSkiing(cur, noInput, DT);
      if (cur.status === "finished") finished = true;
    }
    expect(finished).toBe(true);
  });
});

describe("the tutorial sunrise", () => {
  it("starts dim and brightens to full daybreak by the finish", () => {
    // timeOfDay: 0 = bright dawn, 1 = night. The sunrise runs the phase DOWN
    // from the dim start to 0 as you descend — so it decreases monotonically.
    const atStart = tutorialSunPhase(0, TUTORIAL_FINISH);
    const atFinish = tutorialSunPhase(TUTORIAL_FINISH, TUTORIAL_FINISH);
    expect(atStart).toBeCloseTo(TUTORIAL_SUNRISE_START);
    expect(atFinish).toBeCloseTo(0);

    let prev = atStart;
    for (let d = 0; d <= TUTORIAL_FINISH; d += 20) {
      const t = tutorialSunPhase(d, TUTORIAL_FINISH);
      expect(t).toBeLessThanOrEqual(prev + 1e-9);
      prev = t;
    }
  });

  it("clamps past the finish so a coast-out stays at full daylight", () => {
    expect(tutorialSunPhase(TUTORIAL_FINISH * 2, TUTORIAL_FINISH)).toBe(0);
    expect(tutorialSunPhase(-50, TUTORIAL_FINISH)).toBeLessThanOrEqual(
      TUTORIAL_SUNRISE_START,
    );
  });
});
