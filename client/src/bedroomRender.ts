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
   *
   * `facing` is what's rendered; `target` is where the movement says it
   * should point. The two differ because turning is eased: 8-way input
   * snaps the target between eight fixed angles, and easing is what stops
   * the character popping between them (director playtest, 2026-07-21).
   */
  readonly walk: { lastX: number; lastZ: number; facing: number; target: number };
  /**
   * The orbit camera: where it is and where it's heading. Like `walk`,
   * this is pure presentation — spinning the room and zooming change what
   * you see, never what's simulated — so it lives here, not in /shared,
   * and deliberately isn't saved.
   *
   * `azimuth` is the camera's angle around the room center (0 = the
   * classic view from the +z side); `elevation` is how far it's tilted up
   * from the floor toward overhead; `radius` is its distance from the
   * center. Each has a `target` twin because all three are eased, same
   * reason as `walk.facing`: held keys, drags, and wheel notches snap the
   * target, and easing is what makes the room feel like it's being swung
   * round rather than teleported.
   */
  readonly orbit: {
    azimuth: number;
    elevation: number;
    radius: number;
    targetAzimuth: number;
    targetElevation: number;
    targetRadius: number;
  };
}

/** Per-frame camera controls, read from input by main.ts and passed in:
 * `rotate` and `tilt` are held directions (-1, 0, or 1) from the Q/E and
 * R/F keys; `zoomSteps` is how many wheel notches arrived since last frame
 * (fractional on trackpads); `dragX`/`dragY` are how many pixels the
 * pointer dragged across the canvas since last frame. */
export interface BedroomCameraInput {
  readonly rotate: number;
  readonly tilt: number;
  readonly zoomSteps: number;
  readonly dragX: number;
  readonly dragY: number;
}

const WALL_HEIGHT = 1.2;
const WALL_THICKNESS = 0.3;

// The orbit's default tilt and its zoom range. The default elevation and
// radius are derived from the old fixed camera (position (0,11,8.5)
// looking at the floor), so the game opens on exactly the view it always
// had — rotation, tilt, and zoom are additions, not a reframing.
const ORBIT_ELEVATION_DEFAULT = Math.atan2(11, 9);
const ORBIT_RADIUS_DEFAULT = Math.hypot(11, 9);
const ORBIT_RADIUS_MIN = 6;
const ORBIT_RADIUS_MAX = 20;

// The tilt's range. The floor stops just above where the room's low walls
// (1.2 units, sized to be seen over from a *high* camera) would block the
// view in; the ceiling stops just short of straight overhead, where
// lookAt's up-vector flips.
const ORBIT_ELEVATION_MIN = THREE.MathUtils.degToRad(15);
const ORBIT_ELEVATION_MAX = THREE.MathUtils.degToRad(85);

/** How fast holding Q/E swings the target angle (radians per second). */
const ORBIT_ROTATE_SPEED = 2.0;

/** How fast holding R/F tilts the target elevation (radians per second).
 * Slower than Q/E because the whole tilt range is ~1.2 radians — this
 * sweeps floor-to-ceiling in about a second. */
const ORBIT_TILT_SPEED = 1.0;

/** How many radians one dragged pixel moves the orbit targets. Sized so a
 * drag across a ~900px window swings the room about a half-turn — big
 * gestures do big things without a full-turn ever needing a re-grip. */
const ORBIT_DRAG_SENSITIVITY = 0.0035;

/** How much one wheel notch multiplies the target distance. Multiplicative
 * so zooming feels even: every notch changes the view by the same
 * proportion whether close in or far out. */
const ORBIT_ZOOM_STEP = 1.13;

/** How fast the camera eases toward its targets (per second) — snappier
 * than the character's TURN_RATE below; a camera that lags feels seasick. */
const ORBIT_EASE = 8;

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

  // Sims-style bird's-eye view: a high angle looking down into the room,
  // orbiting the room center — Q/E spin it round, the wheel zooms. The
  // actual positioning happens every frame in syncBedroomSceneToState;
  // this just sets projection and the opening frame.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  placeOrbitCamera(camera, 0, ORBIT_ELEVATION_DEFAULT, ORBIT_RADIUS_DEFAULT);

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
    walk: { lastX: state.player.x, lastZ: state.player.z, facing: 0, target: 0 },
    orbit: {
      azimuth: 0,
      elevation: ORBIT_ELEVATION_DEFAULT,
      radius: ORBIT_RADIUS_DEFAULT,
      targetAzimuth: 0,
      targetElevation: ORBIT_ELEVATION_DEFAULT,
      targetRadius: ORBIT_RADIUS_DEFAULT,
    },
  };
}

/** Put the camera on its orbit: `azimuth` radians around the room center,
 * tilted `elevation` radians up from the floor, `radius` away from the
 * center, always looking at the middle of the room. */
function placeOrbitCamera(
  camera: THREE.PerspectiveCamera,
  azimuth: number,
  elevation: number,
  radius: number,
): void {
  const flat = radius * Math.cos(elevation);
  camera.position.set(
    flat * Math.sin(azimuth),
    radius * Math.sin(elevation),
    flat * Math.cos(azimuth),
  );
  camera.lookAt(0, 0, 0);
}

/** Below this much movement in one frame, treat the player as standing still. */
const WALK_EPSILON = 1e-4;

/** How fast the rendered facing eases toward the movement direction
 * (per second). High enough to feel responsive, low enough that 8-way
 * input reads as turning rather than snapping. */
const TURN_RATE = 10;

// Only reads BedroomState to place the player and cat meshes — never
// writes state.
export function syncBedroomSceneToState(
  handle: BedroomSceneHandle,
  state: BedroomState,
  dt: number,
  cameraInput: BedroomCameraInput,
): void {
  // Camera first: move the targets by this frame's input, then ease the
  // real angle/tilt/distance toward them. Keys and drags feed the same
  // targets, so the two control styles feel identical — only how the
  // target moves differs (keys by hold time, drags by pixels traveled).
  //
  // Drag signs follow the grab-the-world convention (and three.js's own
  // OrbitControls): drag right pulls the room round to the right, drag
  // down tips the camera up toward overhead.
  const orbit = handle.orbit;
  orbit.targetAzimuth +=
    cameraInput.rotate * ORBIT_ROTATE_SPEED * dt -
    cameraInput.dragX * ORBIT_DRAG_SENSITIVITY;
  orbit.targetElevation = THREE.MathUtils.clamp(
    orbit.targetElevation +
      cameraInput.tilt * ORBIT_TILT_SPEED * dt +
      cameraInput.dragY * ORBIT_DRAG_SENSITIVITY,
    ORBIT_ELEVATION_MIN,
    ORBIT_ELEVATION_MAX,
  );
  orbit.targetRadius = THREE.MathUtils.clamp(
    orbit.targetRadius * Math.pow(ORBIT_ZOOM_STEP, cameraInput.zoomSteps),
    ORBIT_RADIUS_MIN,
    ORBIT_RADIUS_MAX,
  );
  const ease = 1 - Math.exp(-ORBIT_EASE * dt);
  orbit.azimuth += (orbit.targetAzimuth - orbit.azimuth) * ease;
  orbit.elevation += (orbit.targetElevation - orbit.elevation) * ease;
  orbit.radius += (orbit.targetRadius - orbit.radius) * ease;
  placeOrbitCamera(handle.camera, orbit.azimuth, orbit.elevation, orbit.radius);

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
    handle.walk.target = Math.atan2(dx, dz);
  }
  // Ease toward the target the shortest way round (the atan2 keeps the
  // difference in [-π, π], so a 350° turn becomes a 10° one) — 8-way input
  // now reads as the character *turning*, not popping between headings.
  const diff = Math.atan2(
    Math.sin(handle.walk.target - handle.walk.facing),
    Math.cos(handle.walk.target - handle.walk.facing),
  );
  handle.walk.facing += diff * (1 - Math.exp(-TURN_RATE * dt));

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
