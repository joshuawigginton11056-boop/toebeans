import * as THREE from "three";
import { CAT_RADIUS, PLAYER_RADIUS, type BedroomState } from "@toebeans/shared";

export interface BedroomSceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: THREE.Mesh;
  readonly cat: THREE.Mesh;
}

// The walking cat is a low box, longer than it is wide so facing reads.
const CAT_BODY_HEIGHT = 0.4;
const CAT_BODY_LENGTH = 0.6;

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

  // Same blue as the skier so it reads as "you" in both scenes.
  const player = new THREE.Mesh(
    new THREE.BoxGeometry(PLAYER_RADIUS * 2, 1.6, PLAYER_RADIUS * 2),
    // Palette skier blue — the same "you" color as the ski scene.
    new THREE.MeshStandardMaterial({ color: 0x4e72a8 }),
  );
  player.position.y = 0.8;
  scene.add(player);

  // Same orange as the cat riding along in the ski scene.
  const cat = new THREE.Mesh(
    new THREE.BoxGeometry(CAT_RADIUS * 2, CAT_BODY_HEIGHT, CAT_BODY_LENGTH),
    // Palette birch amber — the same cat color as the ski scene.
    new THREE.MeshStandardMaterial({ color: 0xe9a960 }),
  );
  scene.add(cat);

  return { renderer, scene, camera, player, cat };
}

// Only reads BedroomState to place the player and cat meshes — never
// writes state.
export function syncBedroomSceneToState(
  handle: BedroomSceneHandle,
  state: BedroomState,
): void {
  handle.player.position.set(state.player.x, 0.8, state.player.z);

  // Sitting: the same box stood up taller and shorter front-to-back, so
  // "sitting up" vs "walking" reads at a glance from the bird's-eye view.
  const sitting = state.cat.mood === "sitting";
  handle.cat.scale.set(1, sitting ? 1.4 : 1, sitting ? 0.65 : 1);
  handle.cat.position.set(
    state.cat.x,
    (CAT_BODY_HEIGHT / 2) * handle.cat.scale.y,
    state.cat.z,
  );
  handle.cat.rotation.y = state.cat.facing;
}

export function renderBedroom(handle: BedroomSceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}
