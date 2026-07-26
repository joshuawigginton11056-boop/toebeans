export * from "./skiing";
export * from "./route";
export * from "./save";
export * from "./appearance";

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Cat {
  readonly id: string;
  readonly position: Vector3;
  readonly velocity: Vector3;
}

export interface GameState {
  readonly tick: number;
  readonly cats: readonly Cat[];
}

export function createInitialState(): GameState {
  return {
    tick: 0,
    cats: [
      {
        id: "cat-1",
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    ],
  };
}

function addVectors(a: Vector3, b: Vector3, scale: number): Vector3 {
  return {
    x: a.x + b.x * scale,
    y: a.y + b.y * scale,
    z: a.z + b.z * scale,
  };
}

export function step(state: GameState, dt: number): GameState {
  return {
    tick: state.tick + 1,
    cats: state.cats.map((cat) => ({
      ...cat,
      position: addVectors(cat.position, cat.velocity, dt),
    })),
  };
}

export function setCatVelocity(
  state: GameState,
  catId: string,
  velocity: Vector3,
): GameState {
  return {
    ...state,
    cats: state.cats.map((cat) =>
      cat.id === catId ? { ...cat, velocity } : cat,
    ),
  };
}
