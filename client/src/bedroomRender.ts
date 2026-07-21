import * as THREE from "three";
import { type BedroomState } from "@toebeans/shared";
import { createCatRig, type CatRig } from "./catModel";
import { createSkierRig, type SkierRig } from "./skierModel";

export interface BedroomSceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: SkierRig;
  readonly cat: CatRig;
  /**
   * Which way the player is facing and where they were last frame.
   *
   * BedroomState deliberately has no player facing — the cat has one because
   * its brain needs it, but the player's is pure presentation, derived here
   * from how the position moved between two frames. That keeps a rendering
   * concern out of the shared game state.
   */
  readonly walk: { lastX: number; lastZ: number; facing: number };
}

const WALL_HEIGHT = 1.2;
const WALL_THICKNESS = 0.3;

// Placeholder furniture heights, keyed by obstacle id. Height is a
// rendering-only detail — collision in /shared is 2D and doesn't need it.
const OBSTACLE_HEIGHTS: Record<string, number> = {
  bed: 0.6,
  dresser: 0.9,
  desk: 0.75,
};

export function createBedroomScene(
  container: HTMLElement,
  state: BedroomState,
): BedroomSceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8e4da);

  // Sims-style bird's-eye view: fixed high angle looking down into the
  // room. Rotation comes with the real bedroom in M2; the gray-box camera
  // stays put.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.set(0, 11, 8.5);
  camera.lookAt(0, 0, -0.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(4, 10, 6);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x909090));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(state.roomWidth, state.roomDepth),
    new THREE.MeshStandardMaterial({ color: 0xd8d3c8 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Four low walls just outside the walkable area, short enough that the
  // bird's-eye camera always sees over them.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9a9a });
  const walls: Array<[number, number, number, number]> = [
    // [centerX, centerZ, sizeX, sizeZ]
    [0, -(state.roomDepth + WALL_THICKNESS) / 2, state.roomWidth + 2 * WALL_THICKNESS, WALL_THICKNESS],
    [0, (state.roomDepth + WALL_THICKNESS) / 2, state.roomWidth + 2 * WALL_THICKNESS, WALL_THICKNESS],
    [-(state.roomWidth + WALL_THICKNESS) / 2, 0, WALL_THICKNESS, state.roomDepth],
    [(state.roomWidth + WALL_THICKNESS) / 2, 0, WALL_THICKNESS, state.roomDepth],
  ];
  for (const [x, z, sizeX, sizeZ] of walls) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(sizeX, WALL_HEIGHT, sizeZ),
      wallMaterial,
    );
    wall.position.set(x, WALL_HEIGHT / 2, z);
    scene.add(wall);
  }

  for (const obstacle of state.obstacles) {
    const height = OBSTACLE_HEIGHTS[obstacle.id] ?? 0.8;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.width, height, obstacle.depth),
      new THREE.MeshStandardMaterial({ color: 0xaaa49a }),
    );
    mesh.position.set(obstacle.x, height / 2, obstacle.z);
    scene.add(mesh);
  }

  // The same skier rig that goes down the slope, so "you" are recognizably
  // one person in both scenes — same model, same appearance colors.
  const player = createSkierRig();
  scene.add(player.group);

  // The real cat model — the same rig that rides along on the slope, so
  // it's recognizably one animal in both scenes.
  const cat = createCatRig();
  scene.add(cat.group);

  return {
    renderer,
    scene,
    camera,
    player,
    cat,
    walk: { lastX: state.player.x, lastZ: state.player.z, facing: 0 },
  };
}

/** Below this much movement in one frame, treat the player as standing still. */
const WALK_EPSILON = 1e-4;

// Only reads BedroomState to place the player and cat meshes — never
// writes state.
export function syncBedroomSceneToState(
  handle: BedroomSceneHandle,
  state: BedroomState,
  dt: number,
): void {
  // Walking or standing, and which way — read off the movement since last
  // frame rather than from state (see the `walk` note on the handle).
  const dx = state.player.x - handle.walk.lastX;
  const dz = state.player.z - handle.walk.lastZ;
  handle.walk.lastX = state.player.x;
  handle.walk.lastZ = state.player.z;
  const moving = Math.hypot(dx, dz) > WALK_EPSILON;
  if (moving) {
    // Keep the last heading when standing still, so stopping doesn't snap
    // the player back to facing the camera.
    handle.walk.facing = Math.atan2(dx, dz);
  }

  handle.player.setPose(moving ? "walking" : "idle");
  handle.player.update(dt);
  handle.player.group.position.set(state.player.x, 0, state.player.z);
  handle.player.setFacing(handle.walk.facing);

  // The cat's two moods map straight onto two animation clips — no more
  // squash-and-stretch box tricks to tell sitting from walking.
  handle.cat.setPose(state.cat.mood === "sitting" ? "sitting" : "walking");
  handle.cat.update(dt);
  handle.cat.group.position.set(state.cat.x, 0, state.cat.z);
  handle.cat.group.rotation.y = state.cat.facing;
}

export function renderBedroom(handle: BedroomSceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}
