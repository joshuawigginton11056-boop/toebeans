import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCatRig, type CatRig } from "./catModel";
import { createSkierRig, type SkierRig } from "./skierModel";

// The lobby (director call, 2026-07-22): the walkable bedroom is gone, and
// the game now opens on a menu-style lobby — a live outdoor vignette of your
// character and the cat, with the DOM menu (lobbyUi.ts) laid over it. This
// file owns only the 3D half: no game state exists for the lobby at all, so
// unlike the other scenes there's nothing to sync — just a diorama idling.

// Art Style Bible palette entries the vignette uses. Duplicated from
// skiRender.ts on purpose: that file is the slope session's territory
// (PARALLEL.md), and these are bible constants, not slope code — if they
// ever change, DESIGN.md's table is the source of truth for both.
const PALETTE = {
  sunlitSnow: 0xf8f5ef,
  snowShadow: 0xd3dff0,
  skyBlue: 0xbfdcf5,
  dawnPink: 0xf6d7ce,
  sunGlow: 0xfff4da,
} as const;

/** Same world, same dawn: the slope's sun vector (duplicated for the same
 * territorial reason as PALETTE), so the lobby's light agrees with the
 * light you ski under. */
const SUN_DIRECTION = new THREE.Vector3(-0.4, 0.5, -1).normalize();

/** Where the character stands. Slightly camera-left, so the menu buttons
 * (bottom-center) and the title never sit right on their face. */
const CHARACTER_POS = new THREE.Vector3(-0.35, 0, 0);

/** The cat's seat while it isn't strolling: at the character's right heel,
 * angled a touch outward so both faces read from the camera. */
const CAT_SEAT = new THREE.Vector3(0.35, 0, 0.25);
const CAT_SEAT_FACING = 0.35;

// The cat's little life cycle: mostly sitting beside the character, but
// every so often it gets up and pads a slow half-circle behind them to
// resettle on the same spot — a menu screen shouldn't be a wax museum.
// All presentation: the lobby has no shared state to keep this in.
const STROLL_PERIOD = 26; // seconds per full sit-stroll-sit cycle
const STROLL_DURATION = 7; // of which this many are walking
const STROLL_RADIUS = 0.75; // half-circle radius around the character

/** Camera: a gentle idle drift (a slow figure-of-nothing sway) so the
 * vignette breathes even when nothing else moves. */
const CAMERA_BASE = new THREE.Vector3(0, 1.35, 3.4);
const CAMERA_LOOK = new THREE.Vector3(0, 0.85, 0);
const CAMERA_SWAY = 0.16; // world units of lateral drift
const CAMERA_SWAY_FREQ = 0.11; // Hz — a ~9-second breath

/** Background trees flanking the vignette (slope scenery, read-only reuse
 * of assets/slope — no slope *code* involved). Positions frame the
 * character; scales are in world units of final tree height. */
const TREES: ReadonlyArray<{
  file: string;
  x: number;
  z: number;
  height: number;
  turn: number;
}> = [
  { file: "PineTree_Snow_1.glb", x: -3.4, z: -3.2, height: 4.2, turn: 0.4 },
  { file: "BirchTree_Snow_2.glb", x: 3.1, z: -4.0, height: 3.6, turn: 1.9 },
  { file: "PineTree_Snow_4.glb", x: -5.6, z: -7.5, height: 5.2, turn: 2.7 },
  { file: "BirchTree_Dead_Snow_1.glb", x: 5.2, z: -7.0, height: 4.4, turn: 0.9 },
  { file: "PineTree_Snow_2.glb", x: 1.6, z: -9.0, height: 5.6, turn: 4.1 },
  { file: "Rock_Snow_3.glb", x: -1.9, z: -2.6, height: 0.5, turn: 1.2 },
  { file: "Bush_Snow_1.glb", x: 2.2, z: -2.2, height: 0.45, turn: 2.3 },
];

export interface LobbySceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: SkierRig;
  readonly cat: CatRig;
  /** Presentation clocks — the camera sway and the cat's stroll cycle. */
  readonly idle: { time: number };
}

export function createLobbyScene(container: HTMLElement): LobbySceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyBlue);
  // The slope's haze, pulled in close: the vignette is small, so the trees
  // melt toward dawn pink fast — depth on a diorama budget.
  scene.fog = new THREE.Fog(PALETTE.dawnPink, 6, 16);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.copy(CAMERA_BASE);
  camera.lookAt(CAMERA_LOOK);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // The palette-derived two-light rig (same derivation as both other
  // scenes): ambient alone renders flat snow as snow-shadow blue, ambient
  // plus sun renders it as sunlit snow — shadows land on palette #2 by
  // construction.
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
  const sun = new THREE.DirectionalLight(sunColor, Math.PI);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // Snow underfoot.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: PALETTE.sunlitSnow }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addBackdrop(scene);
  addSunGlow(scene);
  void loadTrees(scene);

  // Your character, front and center — the same rig both scenes use, so the
  // lobby doubles as the character-select mirror: cycling appearance is
  // instantly visible right here.
  const player = createSkierRig();
  player.setPose("idle");
  player.setFacing(0.15); // near-camera-on, a touch of three-quarter
  player.group.position.copy(CHARACTER_POS);
  scene.add(player.group);

  const cat = createCatRig();
  cat.setPose("sitting");
  cat.group.position.copy(CHARACTER_POS).add(CAT_SEAT);
  cat.group.rotation.y = CAT_SEAT_FACING;
  scene.add(cat.group);

  return { renderer, scene, camera, player, cat, idle: { time: 0 } };
}

/** The dawn horizon behind everything: a big vertex-colored gradient plane
 * (snow → dawn pink → sky blue), unlit because it *is* the light out there.
 * Past the fog's far distance, so the fog fades into it seamlessly. */
function addBackdrop(scene: THREE.Scene): void {
  const z = -18;
  const rows: Array<[number, number]> = [
    [-1, PALETTE.sunlitSnow],
    [1.6, PALETTE.dawnPink],
    [6, PALETTE.skyBlue],
    [20, PALETTE.skyBlue],
  ];
  const halfWidth = 30;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const [y, hex] of rows) {
    const color = new THREE.Color(hex);
    positions.push(-halfWidth, y, z, halfWidth, y, z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  const indices: number[] = [];
  for (let row = 0; row < rows.length - 1; row++) {
    const bl = row * 2;
    indices.push(bl, bl + 1, bl + 3, bl, bl + 3, bl + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const backdrop = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
  );
  scene.add(backdrop);
}

/** The visible sun, hanging low over the horizon behind the character —
 * you ski toward the light, and now you start the game looking at it too.
 * A sprite with a soft radial gradient, in front of the backdrop plane. */
function addSunGlow(scene: THREE.Scene): void {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const glow = new THREE.Color(PALETTE.sunGlow);
  const rgb = `${Math.round(glow.r * 255)},${Math.round(glow.g * 255)},${Math.round(glow.b * 255)}`;
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, `rgba(${rgb},1)`);
  gradient.addColorStop(0.25, `rgba(${rgb},0.95)`);
  gradient.addColorStop(0.5, `rgba(${rgb},0.35)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  // Same azimuth as the light, cheated down to just above the horizon so
  // it's in frame (the slope's own trick).
  sprite.position.set(-4.5, 2.6, -17);
  sprite.scale.setScalar(7);
  scene.add(sprite);
}

/** Slope scenery framing the vignette. Loads in the background — the menu
 * works before any tree arrives, same graceful pattern as everywhere else.
 * Each model is normalized to its target height (converted GLBs are
 * origin-at-base, but their native sizes vary per species). */
async function loadTrees(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    TREES.map(async (tree) => {
      try {
        const gltf = await loader.loadAsync(
          `${import.meta.env.BASE_URL}slope/${tree.file}`,
        );
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        if (size.y > 0) model.scale.setScalar(tree.height / size.y);
        model.rotation.y = tree.turn;
        model.position.set(tree.x, 0, tree.z);
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.add(model);
      } catch {
        // Scenery is optional — a failed load just leaves a gap.
      }
    }),
  );
}

/** Advance the diorama: rigs animate, the camera sways, the cat lives its
 * little cycle. No game state exists here — `idle.time` is the only clock. */
export function syncLobbyScene(handle: LobbySceneHandle, dt: number): void {
  handle.idle.time += dt;
  const t = handle.idle.time;

  // Camera sway: lateral drift plus a much slighter vertical one at an
  // incommensurate frequency, so the motion never visibly loops.
  const sway = Math.sin(2 * Math.PI * CAMERA_SWAY_FREQ * t) * CAMERA_SWAY;
  const bob = Math.sin(2 * Math.PI * CAMERA_SWAY_FREQ * 0.63 * t + 1.3) * 0.05;
  handle.camera.position.set(
    CAMERA_BASE.x + sway,
    CAMERA_BASE.y + bob,
    CAMERA_BASE.z,
  );
  handle.camera.lookAt(CAMERA_LOOK);

  // The cat's stroll: a half-circle from its seat, around behind the
  // character, and back — eased at both ends so it doesn't lurch.
  const phase = t % STROLL_PERIOD;
  if (phase < STROLL_DURATION) {
    const raw = phase / STROLL_DURATION; // 0..1 through the stroll
    const eased = raw * raw * (3 - 2 * raw); // smoothstep
    // Out and back along the same arc: 0 → π → 0.
    const arc = Math.sin(eased * Math.PI) * Math.PI;
    const angle = CAT_SEAT_FACING + arc; // swing around behind the character
    const seatRadius = Math.hypot(CAT_SEAT.x, CAT_SEAT.z);
    const radius = seatRadius + (STROLL_RADIUS - seatRadius) * Math.sin(eased * Math.PI);
    const x = CHARACTER_POS.x + Math.sin(angle + 0.6) * radius;
    const z = CHARACTER_POS.z + Math.cos(angle + 0.6) * radius;
    // Face the way it's moving (derived from the frame's own motion).
    const dx = x - handle.cat.group.position.x;
    const dz = z - handle.cat.group.position.z;
    if (Math.hypot(dx, dz) > 1e-5) {
      handle.cat.group.rotation.y = Math.atan2(dx, dz);
      handle.cat.setPose("walking");
    }
    handle.cat.group.position.set(x, 0, z);
  } else {
    handle.cat.setPose("sitting");
    // Settle exactly back on the seat, facing the camera again.
    handle.cat.group.position.copy(CHARACTER_POS).add(CAT_SEAT);
    handle.cat.group.rotation.y = CAT_SEAT_FACING;
  }

  handle.player.update(dt);
  handle.cat.update(dt);
}

export function renderLobby(handle: LobbySceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}
