import type { Appearance } from "@toebeans/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCatRig, type CatRig } from "./catModel";
import {
  clampPlayerCount,
  lobbyLayout,
  type LobbySlot,
} from "./lobbyLayout";
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

/** The cat's seat while it isn't strolling: at the local player's right heel,
 * angled a touch outward so both faces read from the camera. Relative to
 * wherever "you" are standing, so it follows the local player across every
 * lobby size. */
const CAT_SEAT = new THREE.Vector3(0.35, 0, 0.25);
const CAT_SEAT_FACING = 0.35;

// Glowing orbs (lobby feature, 2026-07-24): a pool of light on the snow under
// every player, with a small wisp hovering at their feet. "You" get the warm
// birch-amber accent (same cozy color as the Play button); the others get a
// cooler ice glow, so the front-and-warmest character always reads as you.
const ORB_LOCAL = 0xe9a960; // birch amber — the "you" accent
const ORB_OTHER = 0x9fd0f0; // soft ice glow — cooler than you
const ORB_PULSE_FREQ = 0.35; // Hz — a slow breathing shimmer

/** Guests' default looks — a spread of characters/skins/hair so a populated
 * lobby reads as different people, not clones. Real multiplayer will replace
 * these with each friend's saved appearance; until then they give the extra
 * slots something believable to show. */
const GUEST_APPEARANCES: readonly Appearance[] = [
  { character: 1, skin: 0, hair: 5 },
  { character: 9, skin: 4, hair: 2 },
  { character: 4, skin: 6, hair: 7 },
];

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

/** One glowing orb: a flat pool of light on the snow plus a hovering wisp. */
interface Orb {
  readonly group: THREE.Group;
  readonly glow: THREE.Mesh; // the ground pool
  readonly core: THREE.Mesh; // the hovering wisp
  readonly phase: number; // pulse offset, so a full lobby shimmers unevenly
}

/** A character standing in the lobby, with the orb glowing under them. */
interface LobbyPlayer {
  readonly rig: SkierRig;
  readonly orb: Orb;
}

export interface LobbySceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The local player's rig — appearance is pushed here from main.ts. */
  readonly player: SkierRig;
  readonly cat: CatRig;
  /** Presentation clocks — the camera sway and the cat's stroll cycle. */
  readonly idle: { time: number };
  /** You, and the guest slots standing with you (a pool of up to 3, hidden
   * when the lobby is smaller). */
  readonly local: LobbyPlayer;
  readonly guests: LobbyPlayer[];
  /** How many players the lobby is currently showing (1..4). */
  count: number;
  /** Where "you" are standing — the point the cat seats beside and orbits. */
  readonly localPos: THREE.Vector3;
}

/** A soft radial glow, painted once into a canvas texture. */
function radialOrbTexture(color: THREE.Color): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();
  const rgb = `${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)}`;
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, `rgba(${rgb},0.95)`);
  gradient.addColorStop(0.35, `rgba(${rgb},0.5)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** Build one orb (ground pool + hovering wisp), unlit and additive so it
 * brightens the snow like light rather than painting a flat decal on it. */
function createOrb(hex: number, phase: number): Orb {
  const color = new THREE.Color(hex);
  const group = new THREE.Group();

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({
      map: radialOrbTexture(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2; // lay it flat on the snow
  glow.position.y = 0.02; // just above the ground, to dodge z-fighting

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  core.position.y = 0.2; // hovers at the feet

  group.add(glow, core);
  return { group, glow, core, phase };
}

/** Breathe an orb: the pool brightens and the wisp swells and lifts a touch. */
function animateOrb(orb: Orb, t: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * ORB_PULSE_FREQ * t + orb.phase);
  (orb.glow.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * pulse;
  (orb.core.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * pulse;
  orb.core.scale.setScalar(1 + 0.08 * pulse);
  orb.core.position.y = 0.2 + 0.04 * pulse;
}

function setPlayerVisible(entry: LobbyPlayer, visible: boolean): void {
  entry.rig.group.visible = visible;
  entry.orb.group.visible = visible;
}

/** Stand a player (and their orb) in a slot, facing as the layout asks. */
function placePlayer(entry: LobbyPlayer, slot: LobbySlot): void {
  entry.rig.group.position.set(slot.x, 0, slot.z);
  entry.rig.setFacing(slot.facing);
  entry.orb.group.position.set(slot.x, 0, slot.z);
  setPlayerVisible(entry, true);
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

  // Your character — the same rig both scenes use, so the lobby doubles as the
  // character-select mirror: cycling appearance is instantly visible right
  // here. It gets the warm orb; up to three cooler-orbed guests can join it
  // (see setLobbyPlayerCount). Facing/position are set by the layout below.
  const local: LobbyPlayer = {
    rig: createSkierRig(),
    orb: createOrb(ORB_LOCAL, 0),
  };
  local.rig.setPose("idle");
  scene.add(local.rig.group, local.orb.group);

  const cat = createCatRig();
  cat.setPose("sitting");
  scene.add(cat.group);

  const handle: LobbySceneHandle = {
    renderer,
    scene,
    camera,
    player: local.rig,
    cat,
    idle: { time: 0 },
    local,
    guests: [],
    count: 1,
    localPos: new THREE.Vector3(),
  };
  // Start as a solo lobby; main.ts can grow it to up to four players.
  applyLobbyLayout(handle, 1);
  return handle;
}

/** Grow the guest pool so at least `need` (0..3) guest slots exist. Each new
 * guest loads a distinct default look and gets its own cool orb. */
function ensureGuests(handle: LobbySceneHandle, need: number): void {
  while (handle.guests.length < need) {
    const i = handle.guests.length;
    const rig = createSkierRig();
    rig.setAppearance(GUEST_APPEARANCES[i % GUEST_APPEARANCES.length]!);
    rig.setPose("idle");
    // Stagger the pulse so a full lobby shimmers instead of strobing in unison.
    const orb = createOrb(ORB_OTHER, (i + 1) * 1.7);
    handle.scene.add(rig.group, orb.group);
    handle.guests.push({ rig, orb });
  }
}

/** Seat the cat at the local player's heel, facing the camera. */
function seatCat(handle: LobbySceneHandle): void {
  handle.cat.setPose("sitting");
  handle.cat.group.position.copy(handle.localPos).add(CAT_SEAT);
  handle.cat.group.rotation.y = CAT_SEAT_FACING;
}

/** Lay the lobby out for `count` (1..4) players: you take your slot (left,
 * middle, or the solo spot per lobbyLayout), the guests fill the rest, and
 * everyone's orb follows. Unused guests are parked out of sight. */
function applyLobbyLayout(handle: LobbySceneHandle, count: number): void {
  const n = clampPlayerCount(count);
  handle.count = n;
  const slots = lobbyLayout(n);

  ensureGuests(handle, n - 1);

  let guestCursor = 0;
  for (const slot of slots) {
    const entry = slot.isLocal ? handle.local : handle.guests[guestCursor++]!;
    placePlayer(entry, slot);
    if (slot.isLocal) handle.localPos.set(slot.x, 0, slot.z);
  }

  // Park any guests this lobby size doesn't use.
  for (let i = n - 1; i < handle.guests.length; i++) {
    setPlayerVisible(handle.guests[i]!, false);
  }

  seatCat(handle);
}

/**
 * Set how many players (1..4) the lobby shows. The local player is always a
 * step in front of the rest; on the left for a two- or four-player lobby, in
 * the middle for a three-player one (the exact rules live in lobbyLayout.ts).
 * Currently driven by the `?players=` preview hook in main.ts — real
 * multiplayer will call this with the live party size.
 */
export function setLobbyPlayerCount(
  handle: LobbySceneHandle,
  count: number,
): void {
  applyLobbyLayout(handle, count);
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

  // The cat's stroll: a half-circle from its seat, around behind the local
  // player, and back — eased at both ends so it doesn't lurch.
  const phase = t % STROLL_PERIOD;
  if (phase < STROLL_DURATION) {
    const raw = phase / STROLL_DURATION; // 0..1 through the stroll
    const eased = raw * raw * (3 - 2 * raw); // smoothstep
    // Out and back along the same arc: 0 → π → 0.
    const arc = Math.sin(eased * Math.PI) * Math.PI;
    const angle = CAT_SEAT_FACING + arc; // swing around behind the character
    const seatRadius = Math.hypot(CAT_SEAT.x, CAT_SEAT.z);
    const radius = seatRadius + (STROLL_RADIUS - seatRadius) * Math.sin(eased * Math.PI);
    const x = handle.localPos.x + Math.sin(angle + 0.6) * radius;
    const z = handle.localPos.z + Math.cos(angle + 0.6) * radius;
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
    handle.cat.group.position.copy(handle.localPos).add(CAT_SEAT);
    handle.cat.group.rotation.y = CAT_SEAT_FACING;
  }

  // Advance every on-screen player and breathe their orb. Guests parked out of
  // this lobby size stay frozen and dark.
  animateOrb(handle.local.orb, t);
  handle.local.rig.update(dt);
  for (const guest of handle.guests) {
    if (!guest.rig.group.visible) continue;
    animateOrb(guest.orb, t);
    guest.rig.update(dt);
  }
  handle.cat.update(dt);
}

export function renderLobby(handle: LobbySceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}
