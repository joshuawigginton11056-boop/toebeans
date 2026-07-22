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
   * The follow camera: a chase boom hung behind the character (director
   * call, 2026-07-22 — this replaced the rejected bird's-eye orbit). Like
   * `walk`, this is pure presentation, so it lives here, not in /shared,
   * and deliberately isn't saved — reopening the game always starts from
   * the same over-the-shoulder framing (see resetBedroomView).
   *
   * `yaw` is the boom's angle around the character (the direction from
   * the character *to* the camera; 0 = camera on the +z side looking -z,
   * which is what the walk-input remap in main.ts expects). `pitch` tilts
   * the boom up from level; `boom` is its length. Each has a `target`
   * twin because all three are eased — held keys, drags, and wheel
   * notches move the target, and easing is what makes the view swing
   * round rather than teleport. `manualTimer` counts down after the last
   * manual orbit input; while it's running, the auto-follow keeps its
   * hands off the camera so a deliberate look-around isn't fought.
   */
  readonly follow: {
    yaw: number;
    pitch: number;
    boom: number;
    targetYaw: number;
    targetPitch: number;
    targetBoom: number;
    manualTimer: number;
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

// The room is a real interior now: full-height walls and a ceiling. The
// old 1.2-unit walls existed only so the bird's-eye camera could see over
// them; with the camera *inside* the room, they'd read as a fence. 2.8
// units is a believable ceiling for a 1.6-unit character.
const WALL_HEIGHT = 2.8;
const WALL_THICKNESS = 0.3;

// ---- The follow camera ----------------------------------------------------

/** Where the boom looks at and pivots around: chest height on the 1.6-unit
 * character, so close-ups frame the upper body rather than the feet. It's
 * also the boom's origin, which keeps the camera line above every gray-box
 * furniture top (0.6–0.9) — see maxBoomInside. */
const LOOK_HEIGHT = 1.1;

// The opening framing, also what resetBedroomView returns to: slightly
// above level, a few units back — enough to see the character, the cat,
// and a good slice of room.
const FOLLOW_PITCH_DEFAULT = THREE.MathUtils.degToRad(16);
const FOLLOW_BOOM_DEFAULT = 3.6;

/** Tilt range: never below level (the camera skimming the floor fights the
 * furniture) and never fully overhead (lookAt's up-vector flips there —
 * and straight-down was the view the director just rejected). */
const FOLLOW_PITCH_MIN = THREE.MathUtils.degToRad(3);
const FOLLOW_PITCH_MAX = THREE.MathUtils.degToRad(60);

/** Scroll-zoom range for the boom's *target* length. The floor stops the
 * near plane clipping through the character's back; the ceiling is about
 * as far as the room ever allows anyway (walls clamp the rendered boom
 * before an 6.5-unit target does). */
const FOLLOW_BOOM_MIN = 1.2;
const FOLLOW_BOOM_MAX = 6.5;

/** How far the camera keeps from walls and ceiling — comfortably more
 * than the 0.1 near plane, so geometry never slices the frame. */
const CAMERA_MARGIN = 0.25;

/** The rendered boom can be squeezed well below FOLLOW_BOOM_MIN when the
 * character backs toward a wall with the camera behind them — better an
 * extreme close-up than a camera outside the room. This is the absolute
 * floor; below it the view is inside the character's head. */
const BOOM_FLOOR = 0.3;

/** How fast holding Q/E swings the boom around the character (radians per
 * second), and R/F tilts it. Tilt is slower because its whole range is
 * ~1 radian. Both carried over from the orbit camera, where they felt
 * right at playtest. */
const FOLLOW_ROTATE_SPEED = 2.0;
const FOLLOW_TILT_SPEED = 1.0;

/** How many radians one dragged pixel moves the boom targets — the orbit
 * camera's sensitivity, carried over: a drag across a ~900px window
 * swings the view about a half-turn. */
const DRAG_SENSITIVITY = 0.0035;

/** How much one wheel notch multiplies the boom target. Multiplicative so
 * zooming feels even: every notch changes the view by the same proportion
 * whether close in or far out. */
const ZOOM_STEP = 1.13;

/** How fast the camera eases toward its targets (per second) — snappier
 * than the character's TURN_RATE below; a camera that lags feels seasick. */
const CAMERA_EASE = 8;

/** How fast the boom swings itself around behind the walk direction (per
 * second, at full strength). Deliberately gentler than CAMERA_EASE: the
 * auto-follow should feel like the camera drifting into place behind you,
 * not snapping there. */
const AUTO_FOLLOW_RATE = 1.8;

/** How long after the last manual orbit input (drag or Q/E/R/F) the
 * auto-follow stays out of the way, so looking at the character's face
 * mid-walk isn't immediately undone. */
const MANUAL_ORBIT_COOLDOWN = 1.5;

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

  // A follow camera inside the room. A touch wider than the slope's 50°
  // FOV — interiors feel cramped through a narrow lens. All positioning
  // happens in syncBedroomSceneToState / resetBedroomView.
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // Gray-box interior lighting: unchanged from the doll-house room. With a
  // ceiling this reads as a dim room lit from nowhere in particular — the
  // real interior lighting design (window, lamps) is its own queued
  // session; see IDEAS.md.
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

  // Four full-height walls just outside the walkable area…
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

  // …and a ceiling on top, closing the box. Slightly lighter than the
  // walls so the two read as different surfaces under the flat ambient.
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(
      state.roomWidth + 2 * WALL_THICKNESS,
      state.roomDepth + 2 * WALL_THICKNESS,
    ),
    new THREE.MeshStandardMaterial({ color: 0xb0aba1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_HEIGHT;
  scene.add(ceiling);

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

  const handle: BedroomSceneHandle = {
    renderer,
    scene,
    camera,
    player,
    cat,
    walk: { lastX: state.player.x, lastZ: state.player.z, facing: 0, target: 0 },
    follow: {
      yaw: 0,
      pitch: FOLLOW_PITCH_DEFAULT,
      boom: FOLLOW_BOOM_DEFAULT,
      targetYaw: 0,
      targetPitch: FOLLOW_PITCH_DEFAULT,
      targetBoom: FOLLOW_BOOM_DEFAULT,
      manualTimer: 0,
    },
  };
  resetBedroomView(handle, state);
  return handle;
}

/**
 * Put the camera and character in the deterministic opening framing: the
 * character faces into the room (toward its center), the camera sits on
 * its default boom directly behind them, squeezed inside the walls if the
 * character stands near one. Called on scene creation and every time the
 * player comes home from the slope — the camera is deliberately not saved,
 * and "behind the character, facing into the room" can never open inside
 * a wall (the boom clamp guarantees it).
 */
export function resetBedroomView(
  handle: BedroomSceneHandle,
  state: BedroomState,
): void {
  const { x, z } = state.player;
  // atan2(0, 0) is 0 (facing +z, toward the camera's side) — if the
  // character ever stands dead center, face them at the bed instead.
  const facing = x === 0 && z === 0 ? Math.PI : Math.atan2(-x, -z);
  handle.walk.facing = facing;
  handle.walk.target = facing;
  handle.walk.lastX = x;
  handle.walk.lastZ = z;

  const follow = handle.follow;
  follow.yaw = facing + Math.PI;
  follow.targetYaw = follow.yaw;
  follow.pitch = FOLLOW_PITCH_DEFAULT;
  follow.targetPitch = FOLLOW_PITCH_DEFAULT;
  follow.targetBoom = FOLLOW_BOOM_DEFAULT;
  follow.boom = Math.min(
    FOLLOW_BOOM_DEFAULT,
    maxBoomInside(state, x, z, follow.yaw, follow.pitch),
  );
  follow.manualTimer = 0;
  placeFollowCamera(
    handle.camera,
    state,
    x,
    z,
    follow.yaw,
    follow.pitch,
    follow.boom,
  );
}

/** Hang the camera off the boom: `yaw` radians around the character at
 * (px, pz), tilted `pitch` up from level, `boom` away, looking at the
 * character's chest. The position is hard-clamped inside the room as a
 * last resort — the boom clamp already keeps the camera in bounds except
 * when BOOM_FLOOR wins against a character pressed into a wall, and even
 * then a slightly off-boom camera beats a wall slicing the frame. */
function placeFollowCamera(
  camera: THREE.PerspectiveCamera,
  state: BedroomState,
  px: number,
  pz: number,
  yaw: number,
  pitch: number,
  boom: number,
): void {
  const flat = boom * Math.cos(pitch);
  const boundX = state.roomWidth / 2 - CAMERA_MARGIN;
  const boundZ = state.roomDepth / 2 - CAMERA_MARGIN;
  camera.position.set(
    THREE.MathUtils.clamp(px + flat * Math.sin(yaw), -boundX, boundX),
    Math.min(LOOK_HEIGHT + boom * Math.sin(pitch), WALL_HEIGHT - CAMERA_MARGIN),
    THREE.MathUtils.clamp(pz + flat * Math.cos(yaw), -boundZ, boundZ),
  );
  camera.lookAt(px, LOOK_HEIGHT, pz);
}

/**
 * The longest the boom can be before the camera pokes through a wall or
 * the ceiling: walk the boom's ray from the look-at point and take the
 * nearest exit from the room box, inset by CAMERA_MARGIN. This is the
 * classic small-room camera problem, solved by pulling in (instantly) and
 * easing back out (the ease in syncBedroomSceneToState).
 *
 * Furniture deliberately isn't tested: the boom starts at LOOK_HEIGHT
 * (1.1) and only rises (pitch ≥ 3°), while every gray-box furniture top
 * sits at 0.6–0.9 — the camera line can't geometrically touch one. That
 * stops being true the day real furniture includes something tall (a
 * wardrobe, shelves); this is where its occlusion check goes.
 */
function maxBoomInside(
  state: BedroomState,
  px: number,
  pz: number,
  yaw: number,
  pitch: number,
): number {
  const dirX = Math.cos(pitch) * Math.sin(yaw);
  const dirY = Math.sin(pitch);
  const dirZ = Math.cos(pitch) * Math.cos(yaw);
  const boundX = state.roomWidth / 2 - CAMERA_MARGIN;
  const boundZ = state.roomDepth / 2 - CAMERA_MARGIN;
  const boundY = WALL_HEIGHT - CAMERA_MARGIN;

  let max = Infinity;
  if (Math.abs(dirX) > 1e-9) {
    max = Math.min(max, ((dirX > 0 ? boundX : -boundX) - px) / dirX);
  }
  if (Math.abs(dirZ) > 1e-9) {
    max = Math.min(max, ((dirZ > 0 ? boundZ : -boundZ) - pz) / dirZ);
  }
  if (dirY > 1e-9) {
    max = Math.min(max, (boundY - LOOK_HEIGHT) / dirY);
  }
  return Math.max(BOOM_FLOOR, max);
}

/** Wrap an angle difference into [-π, π], so easing always turns the
 * short way round. */
function shortestAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
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
  // Walking or standing, and which way — read off the movement since last
  // frame rather than from state (see the `walk` note on the handle). This
  // runs before the camera now, because the camera hangs off the facing.
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
  // Ease toward the target the shortest way round (a 350° turn becomes a
  // 10° one) — 8-way input reads as the character *turning*, not popping
  // between headings.
  handle.walk.facing +=
    shortestAngle(handle.walk.target - handle.walk.facing) *
    (1 - Math.exp(-TURN_RATE * dt));

  // The follow camera. Manual input first: keys and drags feed the same
  // targets, so the two control styles feel identical — only how the
  // target moves differs (keys by hold time, drags by pixels traveled).
  // Drag signs keep the orbit camera's grab-the-world convention: drag
  // right swings the view round to the right, drag down tips it toward
  // overhead.
  const follow = handle.follow;
  const manual =
    cameraInput.rotate !== 0 ||
    cameraInput.tilt !== 0 ||
    cameraInput.dragX !== 0 ||
    cameraInput.dragY !== 0;
  follow.manualTimer = manual
    ? MANUAL_ORBIT_COOLDOWN
    : Math.max(0, follow.manualTimer - dt);

  follow.targetYaw +=
    cameraInput.rotate * FOLLOW_ROTATE_SPEED * dt -
    cameraInput.dragX * DRAG_SENSITIVITY;
  follow.targetPitch = THREE.MathUtils.clamp(
    follow.targetPitch +
      cameraInput.tilt * FOLLOW_TILT_SPEED * dt +
      cameraInput.dragY * DRAG_SENSITIVITY,
    FOLLOW_PITCH_MIN,
    FOLLOW_PITCH_MAX,
  );
  follow.targetBoom = THREE.MathUtils.clamp(
    follow.targetBoom * Math.pow(ZOOM_STEP, cameraInput.zoomSteps),
    FOLLOW_BOOM_MIN,
    FOLLOW_BOOM_MAX,
  );

  // Auto-follow: while the character walks, the boom drifts round to sit
  // behind the walk direction — that's what makes it a *follow* camera.
  // Two deliberate gates: it yields to recent manual input (the cooldown),
  // and it only pulls as hard as the walk is carrying the character *away*
  // from the camera. Walking across the view follows gently; walking
  // toward the camera doesn't follow at all — swinging 180° round would
  // flip the controls mid-step, the classic chase-camera death spiral.
  if (moving && follow.manualTimer <= 0) {
    const away = Math.cos(
      shortestAngle(handle.walk.facing - (follow.yaw + Math.PI)),
    );
    if (away > 0) {
      const behind = handle.walk.facing + Math.PI;
      follow.targetYaw +=
        shortestAngle(behind - follow.targetYaw) *
        (1 - Math.exp(-AUTO_FOLLOW_RATE * away * dt));
    }
  }

  // Ease the rendered boom toward its targets, then clamp it inside the
  // room: the pull-in is instant (a camera in a wall is never right for
  // even a frame), the recovery eases back out through the same targets.
  const ease = 1 - Math.exp(-CAMERA_EASE * dt);
  follow.yaw += (follow.targetYaw - follow.yaw) * ease;
  follow.pitch += (follow.targetPitch - follow.pitch) * ease;
  follow.boom += (follow.targetBoom - follow.boom) * ease;
  const maxBoom = maxBoomInside(
    state,
    state.player.x,
    state.player.z,
    follow.yaw,
    follow.pitch,
  );
  if (follow.boom > maxBoom) follow.boom = maxBoom;
  placeFollowCamera(
    handle.camera,
    state,
    state.player.x,
    state.player.z,
    follow.yaw,
    follow.pitch,
    follow.boom,
  );

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
