import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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

// ---- Interior lighting ----------------------------------------------------
//
// The Art Style Bible palette entries the room uses. Duplicated from
// skiRender.ts on purpose: that file is the slope session's territory
// (PARALLEL.md), and these are bible constants, not slope code — if they
// ever change, DESIGN.md's table is the source of truth for both.
const PALETTE = {
  sunlitSnow: 0xf8f5ef,
  snowShadow: 0xd3dff0, // every unlit surface renders this — soft blue, never gray
  skyBlue: 0xbfdcf5,
  dawnPink: 0xf6d7ce,
  sunGlow: 0xfff4da, // lamp bulbs — the brightest value in the room
  birchBark: 0xe3dccd, // wooden floor, window frame, lamp shades
} as const;

/** Same world, same dawn: this is the slope's sun vector (direction from
 * the scene toward the sun — north-west and ~25° up), so the light through
 * the bedroom window agrees with the light you ski under. Duplicated from
 * skiRender.ts for the same territorial reason as PALETTE. */
const SUN_DIRECTION = new THREE.Vector3(-0.4, 0.5, -1).normalize();

// The window lives in the north wall (z = -roomDepth/2) — the wall the
// opening camera faces, in the clear stretch between the bed and the
// dresser. The sun sits north of the room, so this is the wall it can
// actually shine through.
const WINDOW_CENTER_X = -1.0;
const WINDOW_WIDTH = 2.2;
const WINDOW_SILL = 1.0;
const WINDOW_HEAD = 2.4;

/** Cross-section of the window frame bars, and how far the frame pokes
 * past the wall faces on both sides. */
const FRAME_BAR = 0.07;
const FRAME_DEPTH = WALL_THICKNESS + 0.06;

/** How far beyond the north wall the outside backdrop hangs — far enough
 * that its parallax through the window reads as "out there", close enough
 * that it always fills the opening from any camera angle in the room. */
const BACKDROP_DISTANCE = 2.6;

// ---- The follow camera ----------------------------------------------------

/** Where the boom looks at and pivots around: chest height on the 1.6-unit
 * character, so close-ups frame the upper body rather than the feet. It's
 * also the boom's origin, which keeps the camera line above every
 * furniture top (tallest: the chair back at 1.07) — see maxBoomInside. */
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

// ---- Real furniture -------------------------------------------------------
//
// assets/bedroom/ models (Quaternius, CC0, palette-recolored by
// tools/obj2glb_bedroom.py — see assets/CREDITS.md), keyed by obstacle id.
// Scale and rotation put each model's measured footprint exactly on its
// obstacle box in /shared — collision follows the visuals. Models load in
// the background (skiRender's pattern); a gray placeholder box stands in
// until each one arrives, so the room is never furnitureless.
interface FurniturePiece {
  readonly file: string;
  readonly scale: number;
  readonly rotationY: number;
  /** World height at this scale — sizes the placeholder box, and documents
   * that every piece tops out below the camera boom's 1.1 LOOK_HEIGHT
   * (the chair back, 1.07, is the tallest — see maxBoomInside). */
  readonly height: number;
}
const FURNITURE: Record<string, FurniturePiece> = {
  bed: { file: "Bed_King.glb", scale: 0.8, rotationY: 0, height: 0.97 },
  nightstand: { file: "NightStand_1.glb", scale: 0.7, rotationY: 0, height: 0.57 },
  dresser: { file: "Drawer_1.glb", scale: 0.65, rotationY: 0, height: 0.88 },
  // The desk is authored long-in-x with its drawers facing +z; rotated to
  // sit against the east wall, drawers toward the sitter.
  desk: { file: "Desk.glb", scale: 1, rotationY: -Math.PI / 2, height: 0.92 },
  // The chair faces +z natively; turned to face +x, tucked at the desk.
  chair: { file: "Chair.glb", scale: 1, rotationY: Math.PI / 2, height: 1.07 },
};

export function createBedroomScene(
  container: HTMLElement,
  state: BedroomState,
): BedroomSceneHandle {
  const scene = new THREE.Scene();
  // One red-channel step off the palette's sky blue: visually identical if
  // it ever peeks through a seam, but pixel-distinguishable from every real
  // scene color — which is how verification proves the room is sealed.
  scene.background = new THREE.Color(0xbedcf5);

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
  // Sunlight only enters the room where the walls don't block it — which
  // is what shadow mapping computes. Soft edges the same way the slope
  // does it (PCF + the sun's shadow.radius; PCFSoft was retired upstream).
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // The interior lighting design (this session): the slope's palette-
  // derived two-light rig, adapted to a room. The walls' albedo is the
  // bible's sunlit snow (a warm off-white paint), and the ambient is
  // derived so that any surface the sun can't reach renders *exactly*
  // snow-shadow blue — the bible's "shadows are soft blue, never black",
  // by construction. The sun color then follows from requiring that
  // ambient + sun on a flat surface renders the albedo at full value.
  // Same math as skiRender.ts, same reasoning, same result: a warm sun
  // and a cool bright ambient. The physical-lights ×π convention fixes
  // the "room renders ~45% too dark" gap the old rig had.
  const albedo = new THREE.Color(PALETTE.sunlitSnow);
  const shadowTarget = new THREE.Color(PALETTE.snowShadow);
  const ambientColor = new THREE.Color(
    Math.min(1, shadowTarget.r / albedo.r),
    Math.min(1, shadowTarget.g / albedo.g),
    Math.min(1, shadowTarget.b / albedo.b),
  );
  const groundNdotL = SUN_DIRECTION.y;
  const sunColor = new THREE.Color(
    Math.max(0, (1 - ambientColor.r) / groundNdotL),
    Math.max(0, (1 - ambientColor.g) / groundNdotL),
    Math.max(0, (1 - ambientColor.b) / groundNdotL),
  );

  // Math.PI because three.js physical lights fold 1/π into the material.
  scene.add(new THREE.AmbientLight(ambientColor, Math.PI));

  // The dawn sun, shining through the window: the walls and ceiling cast
  // shadows, so the only sunlight that reaches the room is the patch the
  // window lets through — frame shadows and all. The shadow camera is
  // sized to the room once; nothing here moves.
  const sun = new THREE.DirectionalLight(sunColor, Math.PI);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 45;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // A pale wooden floor (birch bark — the bible's "pale wooden props"
  // color). Where the sun patch lands it renders at full albedo; under
  // ambient alone it cools toward the blue shadow tint, which is exactly
  // how morning light on a wood floor behaves.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(state.roomWidth, state.roomDepth),
    new THREE.MeshStandardMaterial({ color: PALETTE.birchBark }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Walls painted the albedo the lighting math is derived against. The
  // north wall (where the window lives) is built from segments around the
  // opening; the other three are solid boxes. Everything casts — that's
  // what keeps the sun outside — and receives, so the sun patch can climb
  // onto a wall at dawn angles.
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.sunlitSnow,
  });
  const walls: Array<[number, number, number, number]> = [
    // [centerX, centerZ, sizeX, sizeZ] — south, west, east
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
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }
  addNorthWallWithWindow(scene, state, wallMaterial);

  // A ceiling slab on top, closing the box. A box rather than a plane
  // because it must cast shadow (a downward-facing plane is backface-
  // culled from the sun's point of view, and the sun would shine straight
  // through the roof). Its underside only ever sees ambient, so it renders
  // the soft blue by construction.
  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(
      state.roomWidth + 2 * WALL_THICKNESS,
      0.2,
      state.roomDepth + 2 * WALL_THICKNESS,
    ),
    wallMaterial,
  );
  ceiling.position.y = WALL_HEIGHT + 0.1;
  ceiling.castShadow = true;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  addOutsideBackdrop(scene, state);
  addLamps(scene, state);

  const loader = new GLTFLoader();
  for (const obstacle of state.obstacles) {
    const piece = FURNITURE[obstacle.id];
    const height = piece?.height ?? 0.8;
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.width, height, obstacle.depth),
      new THREE.MeshStandardMaterial({ color: 0xaaa49a }),
    );
    placeholder.position.set(obstacle.x, height / 2, obstacle.z);
    placeholder.castShadow = true;
    placeholder.receiveShadow = true;
    scene.add(placeholder);
    if (!piece) continue;

    loader
      .loadAsync(`${import.meta.env.BASE_URL}bedroom/${piece.file}`)
      .then((gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(piece.scale);
        model.rotation.y = piece.rotationY;
        // Converted models are origin-at-base and centered on x/z, so the
        // obstacle's center is the model's position.
        model.position.set(obstacle.x, 0, obstacle.z);
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.remove(placeholder);
        placeholder.geometry.dispose();
        scene.add(model);
      })
      // A failed load just keeps the placeholder — same graceful shape as
      // the slope's background decor loading.
      .catch(() => undefined);
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
 * The north wall, built from four segments around the window opening: a
 * solid stretch either side, a spandrel below the sill and a strip above
 * the head. Same material and footprint as the other walls, so the only
 * place sunlight can get in is the hole — plus a birch-bark frame with a
 * cross mullion, whose shadow is what sells the sun patch as *window*
 * light rather than a stage spotlight.
 */
function addNorthWallWithWindow(
  scene: THREE.Scene,
  state: BedroomState,
  wallMaterial: THREE.MeshStandardMaterial,
): void {
  const wallZ = -(state.roomDepth + WALL_THICKNESS) / 2;
  const halfSpan = state.roomWidth / 2 + WALL_THICKNESS;
  const winLeft = WINDOW_CENTER_X - WINDOW_WIDTH / 2;
  const winRight = WINDOW_CENTER_X + WINDOW_WIDTH / 2;

  const segments: Array<[number, number, number, number]> = [
    // [centerX, centerY, sizeX, sizeY]
    [(-halfSpan + winLeft) / 2, WALL_HEIGHT / 2, winLeft + halfSpan, WALL_HEIGHT],
    [(winRight + halfSpan) / 2, WALL_HEIGHT / 2, halfSpan - winRight, WALL_HEIGHT],
    [WINDOW_CENTER_X, WINDOW_SILL / 2, WINDOW_WIDTH, WINDOW_SILL],
    [
      WINDOW_CENTER_X,
      (WINDOW_HEAD + WALL_HEIGHT) / 2,
      WINDOW_WIDTH,
      WALL_HEIGHT - WINDOW_HEAD,
    ],
  ];
  for (const [x, y, sizeX, sizeY] of segments) {
    const segment = new THREE.Mesh(
      new THREE.BoxGeometry(sizeX, sizeY, WALL_THICKNESS),
      wallMaterial,
    );
    segment.position.set(x, y, wallZ);
    segment.castShadow = true;
    segment.receiveShadow = true;
    scene.add(segment);
  }

  // The frame: bars centered on the opening's edges, poking slightly past
  // both wall faces, plus a thinner cross mullion splitting the opening
  // into four panes. All cast, so the floor patch carries the cross.
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.birchBark,
  });
  const midY = (WINDOW_SILL + WINDOW_HEAD) / 2;
  const bars: Array<[number, number, number, number]> = [
    // [centerX, centerY, sizeX, sizeY]
    [WINDOW_CENTER_X, WINDOW_SILL, WINDOW_WIDTH + 2 * FRAME_BAR, FRAME_BAR],
    [WINDOW_CENTER_X, WINDOW_HEAD, WINDOW_WIDTH + 2 * FRAME_BAR, FRAME_BAR],
    [winLeft, midY, FRAME_BAR, WINDOW_HEAD - WINDOW_SILL + 2 * FRAME_BAR],
    [winRight, midY, FRAME_BAR, WINDOW_HEAD - WINDOW_SILL + 2 * FRAME_BAR],
    [WINDOW_CENTER_X, midY, 0.05, WINDOW_HEAD - WINDOW_SILL],
    [WINDOW_CENTER_X, midY, WINDOW_WIDTH, 0.05],
  ];
  for (const [x, y, sizeX, sizeY] of bars) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(sizeX, sizeY, FRAME_DEPTH),
      frameMaterial,
    );
    bar.position.set(x, y, wallZ);
    bar.castShadow = true;
    bar.receiveShadow = true;
    scene.add(bar);
  }
}

/**
 * What you see through the window: the slope's world. An unlit
 * vertex-colored plane hung beyond the north wall — snow up to a dawn-pink
 * horizon melting into sky blue, the same three palette colors the ski
 * scene's fog and dome are built from. Unlit (MeshBasicMaterial) because
 * it *is* the light out there; it must not cast shadows, or it would sit
 * between the sun and the window and block the very light it depicts.
 */
function addOutsideBackdrop(scene: THREE.Scene, state: BedroomState): void {
  const z = -(state.roomDepth / 2 + WALL_THICKNESS + BACKDROP_DISTANCE);
  // Rows of the gradient, bottom to top: snow, horizon pink, blended-out
  // sky, top of sky. Sized to fill the window frustum from every camera
  // position the room allows, with room to spare.
  const rows: Array<[number, number]> = [
    [-1, PALETTE.sunlitSnow],
    [1.5, PALETTE.dawnPink],
    [4.5, PALETTE.skyBlue],
    [13, PALETTE.skyBlue],
  ];
  const halfWidth = 13;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const [y, hex] of rows) {
    const color = new THREE.Color(hex);
    positions.push(WINDOW_CENTER_X - halfWidth, y, z);
    positions.push(WINDOW_CENTER_X + halfWidth, y, z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  const indices: number[] = [];
  for (let row = 0; row < rows.length - 1; row++) {
    const bl = row * 2;
    const br = bl + 1;
    const tl = bl + 2;
    const tr = bl + 3;
    indices.push(bl, br, tr, bl, tr, tl);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const backdrop = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true }),
  );
  scene.add(backdrop);
}

/** The pendant fixture's native height is 0.48; at this scale it hangs
 * 0.216 down from the ceiling, keeping its lowest point (2.584) above the
 * camera's ceiling clamp (WALL_HEIGHT − CAMERA_MARGIN = 2.55) — the boom
 * can slide along the ceiling right through the room's center, and a
 * fixture clipping the near plane there would flash the frame. */
const PENDANT_SCALE = 0.45;
const PENDANT_NATIVE_HEIGHT = 0.48;

/** Table-lamp fixture scale (native height 0.57 → 0.34 on a surface). */
const TABLE_LAMP_SCALE = 0.6;

/**
 * The warm lamps (the vision's detail-touches want glowing lamps): a
 * pendant over the room's center plus table lamps on the dresser and desk.
 * The fixtures are real models now (Light_CeilingSingle + Light_Desk from
 * assets/bedroom/ — the lamp-shape restyle the director called at the
 * interior-lighting playtest); the *light* itself passed that playtest and
 * is untouched: same warm point lights pooling on top of the cool ambient,
 * cozy warmth against the blue rather than the thing keeping the room
 * visible. No lamp shadows: point-light shadow maps cost six faces each,
 * and a soft shadowless fill is exactly what lamp light should feel like.
 * Each model's "Light" material (the bulb faces) is swapped to unlit sun
 * glow so bulbs visibly glow, like the code-built spheres they replace.
 */
function addLamps(scene: THREE.Scene, state: BedroomState): void {
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.sunGlow });
  // Warmer than the bulbs' sun-glow surface: lamp light drops more blue
  // than a low sun does, which is what makes the pools read as *lamp*
  // against the sun patch.
  const lampLight = new THREE.Color(1.0, 0.84, 0.6);
  const loader = new GLTFLoader();

  const glowBulbs = (model: THREE.Object3D): void => {
    model.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        (child.material as THREE.Material).name === "Light"
      ) {
        child.material = bulbMaterial;
      }
    });
  };

  // The pendant, hung flush under the ceiling over the room's center.
  loader
    .loadAsync(`${import.meta.env.BASE_URL}bedroom/Light_CeilingSingle.glb`)
    .then((gltf) => {
      const pendant = gltf.scene;
      pendant.scale.setScalar(PENDANT_SCALE);
      pendant.position.set(
        0,
        WALL_HEIGHT - PENDANT_NATIVE_HEIGHT * PENDANT_SCALE,
        0,
      );
      glowBulbs(pendant);
      scene.add(pendant);
    })
    .catch(() => undefined);
  const pendantLight = new THREE.PointLight(lampLight, 7);
  pendantLight.position.set(0, 2.5, 0);
  scene.add(pendantLight);

  // On the furniture: the dresser lamp sits in the opening view next to
  // the window; the desk lamp warms the room's south-east end, the far
  // corner from the sun. Heights are the real models' surfaces: the
  // dresser's top (0.88) and the desk's desktop plane (0.53 — its bounding
  // top, 0.92, is the hutch shelf along the wall side).
  const dresser = state.obstacles.find((o) => o.id === "dresser");
  const desk = state.obstacles.find((o) => o.id === "desk");
  const spots: Array<{ x: number; y: number; z: number; turn: number }> = [];
  if (dresser) spots.push({ x: dresser.x, y: 0.88, z: dresser.z, turn: 0 });
  // On the desk's south end, turned to lean over the desktop.
  if (desk) spots.push({ x: desk.x - 0.12, y: 0.53, z: desk.z + 0.6, turn: Math.PI });
  loader
    .loadAsync(`${import.meta.env.BASE_URL}bedroom/Light_Desk.glb`)
    .then((gltf) => {
      for (const spot of spots) {
        const lamp = gltf.scene.clone(true);
        lamp.scale.setScalar(TABLE_LAMP_SCALE);
        lamp.rotation.y = spot.turn;
        lamp.position.set(spot.x, spot.y, spot.z);
        scene.add(lamp);
      }
    })
    .catch(() => undefined);
  for (const spot of spots) {
    // Unlike the pendant, Light_Desk has no "Light" bulb material (its
    // head is plain White), so each table lamp keeps a small unlit bulb
    // tucked under the head — the glow the code-built lamps had. The head
    // leans toward the model's +z, rotated by the lamp's turn.
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 12, 8),
      bulbMaterial,
    );
    bulb.position.set(
      spot.x + 0.1 * Math.sin(spot.turn),
      spot.y + 0.26,
      spot.z + 0.1 * Math.cos(spot.turn),
    );
    const light = new THREE.PointLight(lampLight, 2);
    light.position.set(spot.x, spot.y + 0.27, spot.z);
    scene.add(bulb, light);
  }
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
 * (1.1) and only rises (pitch ≥ 3°), while every furniture piece tops out
 * below that (the chair back, 1.07, is the tallest — see FURNITURE) — the
 * camera line can't geometrically touch one. That stops being true the
 * day the room gains something tall (a wardrobe, shelves, a floor lamp);
 * this is where its occlusion check goes.
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
