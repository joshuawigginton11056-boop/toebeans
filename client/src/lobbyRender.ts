import {
  createDefaultAppearance,
  resolveCharacter,
  type Appearance,
} from "@toebeans/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCatRig, type CatRig } from "./catModel";
import {
  backdropContrast,
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

/** The local player's cat seat while it isn't strolling: at their right heel,
 * angled a touch outward so both faces read from the camera. Relative to
 * wherever "you" are standing, so it follows the local player across every
 * lobby size. */
const CAT_SEAT = new THREE.Vector3(0.35, 0, 0.25);
const CAT_SEAT_FACING = 0.35;

/** Guests' cats sit beside them too (DESIGN.md: "visiting cats socialize").
 * Unlike your strolling cat they stay put — four wanderers would clutter the
 * small vignette — seated a little to the player's *outer* side (away from the
 * center of the line) and a touch forward, so every pet stays in clear view
 * for its nameplate. Sign of the offset is chosen per-slot from which side of
 * center the player stands on. */
const GUEST_PET_SIDE = 0.52; // outward offset from the player, world units
const GUEST_PET_FORWARD = 0.3; // toward the camera, so the pet isn't hidden
const GUEST_PET_TURN = 0.3; // radians, angled back toward the camera/center

// Glowing orbs (lobby feature, 2026-07-24): a pool of light on the snow under
// every player, with a small wisp hovering at their feet. "You" get the warm
// birch-amber accent (same cozy color as the Play button); the others get a
// cooler ice glow, so the front-and-warmest character always reads as you.
//
// Contrast (2026-07-24): the pool no longer just *adds* light — against bright
// snow an additive glow washes out. It's a normal-blended, darkened wash of
// the orb's hue instead, so it reads as a saturated shadow-pool that stands
// out; the small hovering wisp keeps the additive glow for life. How dark the
// pool goes is derived from the live backdrop color (see tintOrbPool), so the
// orbs keep their contrast if a future slope re-tints the sky.
const ORB_LOCAL = 0xe9a960; // birch amber — the "you" accent
const ORB_OTHER = 0x9fd0f0; // soft ice glow — cooler than you
const ORB_PULSE_FREQ = 0.35; // Hz — a slow breathing shimmer
const ORB_INK = new THREE.Color(0x101826); // deep blue-black (bible bans pure)
const ORB_MAX_DARKEN = 0.62; // how far toward ink a full-bright backdrop pulls

// Nameplates (lobby feature, 2026-07-24): a small floating label per player and
// per pet, so a populated lobby reads as *people with pets*, not just models.
// Character name sits on the orb at the player's feet; the pet's name floats
// above it and — being parented to the cat — trails it wherever it pads.
const NAME_FEET_Y = 0.16; // character label height, just above the orb pool
const NAME_HEIGHT = 0.2; // character label world height
const PET_NAME_HEIGHT = 0.15; // pet label world height (a touch smaller)
const PET_NAME_Y = 0.62; // pet label height, clear above the cat's head
const PLATE_TEXT = "#f6f1e7"; // warm off-white — legible, bible-friendly
const PLATE_BG = "rgba(18,24,36,0.72)"; // dark pill, so names read on snow
const PET_PLATE_ACCENT = 0xf1e3c6; // soft cream border for pet labels

/** Guests' default looks — a spread of characters/skins/hair so a populated
 * lobby reads as different people, not clones. Real multiplayer will replace
 * these with each friend's saved appearance; until then they give the extra
 * slots something believable to show. */
const GUEST_APPEARANCES: readonly Appearance[] = [
  { character: 1, skin: 0, hair: 5 },
  { character: 9, skin: 4, hair: 2 },
  { character: 4, skin: 6, hair: 7 },
];

/** Placeholder pet names — scaffolding, exactly like GUEST_APPEARANCES: enough
 * for the nameplates to read as real companions until multiplayer feeds each
 * friend's actual cat name. The local player's cat name is the first; the rest
 * belong to the guests, in slot order. */
const LOCAL_PET_NAME = "Mochi";
const GUEST_PET_NAMES: readonly string[] = ["Biscuit", "Pumpkin", "Sesame"];

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

/** A billboard text label (character or pet name). Always faces the camera
 * (it's a sprite) and can be re-lettered in place when the name changes. */
interface Nameplate {
  readonly sprite: THREE.Sprite;
  setText(text: string): void;
}

/** One glowing orb: a flat pool of light on the snow plus a hovering wisp. */
interface Orb {
  readonly group: THREE.Group;
  readonly glow: THREE.Mesh; // the ground pool
  readonly core: THREE.Mesh; // the hovering wisp
  readonly phase: number; // pulse offset, so a full lobby shimmers unevenly
  readonly hue: THREE.Color; // the orb's identity color, before contrast
}

/** A character standing in the lobby: their rig, the orb glowing under them,
 * their pet sitting beside them, and the two floating name labels. */
interface LobbyPlayer {
  readonly rig: SkierRig;
  readonly orb: Orb;
  readonly pet: CatRig;
  readonly nameplate: Nameplate; // character name, on the orb at the feet
  readonly petPlate: Nameplate; // pet name, floating above the pet
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
  /** The backdrop color the orbs contrast against. Drives how dark each pool
   * goes; a future slope can re-tint it via setLobbyBackdropColor. */
  readonly backdropColor: THREE.Color;
}

/** A soft white radial falloff — alpha only, so a single texture can be tinted
 * to any orb color by its material. Built once and shared by every pool. */
let orbFalloffTexture: THREE.Texture | null = null;
function radialFalloffTexture(): THREE.Texture {
  if (orbFalloffTexture) return orbFalloffTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.5)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  orbFalloffTexture = new THREE.CanvasTexture(canvas);
  return orbFalloffTexture;
}

/** Set a pool's color from its hue and the backdrop it must contrast: pull the
 * hue toward ink in proportion to how bright the backdrop is (a snowy sky wants
 * a dark, saturated pool; a dark sky leaves it luminous). This is the whole
 * "contrast follows the backdrop" rule — call it again to re-tint on a change. */
function tintOrbPool(orb: Orb, backdrop: THREE.Color): void {
  const contrast = backdropContrast(backdrop.r, backdrop.g, backdrop.b);
  const pool = orb.hue.clone().lerp(ORB_INK, ORB_MAX_DARKEN * contrast);
  (orb.glow.material as THREE.MeshBasicMaterial).color.copy(pool);
}

/** Build one orb (ground pool + hovering wisp). The pool is normal-blended and
 * darkened to contrast the snow (see tintOrbPool); the wisp stays additive so
 * it reads as a small point of light hovering at the feet. */
function createOrb(hex: number, phase: number, backdrop: THREE.Color): Orb {
  const hue = new THREE.Color(hex);
  const group = new THREE.Group();

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({
      map: radialFalloffTexture(),
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2; // lay it flat on the snow
  glow.position.y = 0.02; // just above the ground, to dodge z-fighting

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 16),
    new THREE.MeshBasicMaterial({
      color: hue,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  core.position.y = 0.2; // hovers at the feet

  group.add(glow, core);
  const orb: Orb = { group, glow, core, phase, hue };
  tintOrbPool(orb, backdrop);
  return orb;
}

/** Breathe an orb: the pool deepens and the wisp swells and lifts a touch. */
function animateOrb(orb: Orb, t: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * ORB_PULSE_FREQ * t + orb.phase);
  // Normal-blended pool: opacity kept high so the darkened wash stays present.
  (orb.glow.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.22 * pulse;
  (orb.core.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * pulse;
  orb.core.scale.setScalar(1 + 0.08 * pulse);
  orb.core.position.y = 0.2 + 0.04 * pulse;
}

/** Paint a name into a rounded "pill" and hand back a camera-facing sprite plus
 * a way to re-letter it. Dark pill + light text so the label reads on snow; a
 * thin accent border ties it to the orb (players) or gives pets a warm frame.
 * depthTest is off so a name is never hidden behind a body — every player can
 * always see who everyone is. */
function createNameplate(
  text: string,
  accentHex: number,
  worldHeight: number,
): Nameplate {
  const accent = new THREE.Color(accentHex);
  const accentCss = `rgb(${Math.round(accent.r * 255)},${Math.round(
    accent.g * 255,
  )},${Math.round(accent.b * 255)})`;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10; // draw over the scene, alongside the other plates

  function paint(next: string): void {
    if (!ctx) return;
    const fontPx = 64;
    const font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`;
    ctx.font = font;
    const padX = 40;
    const padY = 24;
    const border = 6;
    const textWidth = ctx.measureText(next).width;
    const w = Math.ceil(textWidth + padX * 2);
    const h = fontPx + padY * 2;
    canvas.width = w;
    canvas.height = h;

    // Re-set after a resize — sizing the canvas clears its context state.
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.clearRect(0, 0, w, h);

    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(border / 2, border / 2, w - border, h - border, r);
    ctx.fillStyle = PLATE_BG;
    ctx.fill();
    ctx.lineWidth = border;
    ctx.strokeStyle = accentCss;
    ctx.stroke();

    ctx.fillStyle = PLATE_TEXT;
    ctx.fillText(next, w / 2, h / 2 + 2);

    texture.needsUpdate = true;
    // Keep letters undistorted: width tracks the pill's aspect, height fixed.
    sprite.scale.set(worldHeight * (w / h), worldHeight, 1);
  }

  paint(text);
  return { sprite, setText: paint };
}

function setPlayerVisible(entry: LobbyPlayer, visible: boolean): void {
  entry.rig.group.visible = visible;
  entry.orb.group.visible = visible; // the character nameplate rides this group
  entry.pet.group.visible = visible; // the pet nameplate rides the pet's group
}

/** Stand a player (and their orb) in a slot, facing as the layout asks. The
 * character nameplate is parented to the orb, so it follows for free. */
function placePlayer(entry: LobbyPlayer, slot: LobbySlot): void {
  entry.rig.group.position.set(slot.x, 0, slot.z);
  entry.rig.setFacing(slot.facing);
  entry.orb.group.position.set(slot.x, 0, slot.z);
  setPlayerVisible(entry, true);
}

/** Sit a guest's cat beside them: on their outer side (away from the center of
 * the line) and a touch forward, angled back toward the camera so it and its
 * floating name stay in clear view. The pet's nameplate is parented to the
 * cat, so seating the cat carries the name with it. */
function seatGuestPet(entry: LobbyPlayer, slot: LobbySlot): void {
  const side = slot.x >= 0 ? 1 : -1; // +1 on the right of center, −1 on the left
  entry.pet.setPose("sitting");
  entry.pet.group.position.set(
    slot.x + side * GUEST_PET_SIDE,
    0,
    slot.z + GUEST_PET_FORWARD,
  );
  entry.pet.group.rotation.y = -side * GUEST_PET_TURN;
}

/** Build a lobby character: rig, orb, a seated cat, and the two name labels.
 * The character label rides the orb (feet), the pet label rides the cat, so
 * both track their owner wherever the layout or the cat's stroll puts them. */
function buildPlayer(
  scene: THREE.Scene,
  backdrop: THREE.Color,
  opts: {
    orbHex: number;
    phase: number;
    characterName: string;
    petName: string;
    appearance?: Appearance;
  },
): LobbyPlayer {
  const rig = createSkierRig();
  if (opts.appearance) rig.setAppearance(opts.appearance);
  rig.setPose("idle");

  const orb = createOrb(opts.orbHex, opts.phase, backdrop);

  const pet = createCatRig();
  pet.setPose("sitting");

  const nameplate = createNameplate(opts.characterName, opts.orbHex, NAME_HEIGHT);
  nameplate.sprite.position.set(0, NAME_FEET_Y, 0);
  orb.group.add(nameplate.sprite);

  const petPlate = createNameplate(
    opts.petName,
    PET_PLATE_ACCENT,
    PET_NAME_HEIGHT,
  );
  petPlate.sprite.position.set(0, PET_NAME_Y, 0);
  pet.group.add(petPlate.sprite);

  scene.add(rig.group, orb.group, pet.group);
  return { rig, orb, pet, nameplate, petPlate };
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

  // The backdrop the orbs contrast against — the scene's sky today, but held on
  // the handle so a future slope can re-tint it (setLobbyBackdropColor) and the
  // orbs re-darken to match.
  const backdropColor = (scene.background as THREE.Color).clone();

  // Your character — the same rig both scenes use, so the lobby doubles as the
  // character-select mirror: cycling appearance is instantly visible right
  // here. It gets the warm orb and your cat; up to three cooler-orbed guests
  // (each with their own cat) can join it (see setLobbyPlayerCount). The local
  // character label starts on the default look and is corrected the moment
  // main.ts pushes the real appearance in (setLobbyLocalName). Facing and
  // position come from the layout below.
  const local = buildPlayer(scene, backdropColor, {
    orbHex: ORB_LOCAL,
    phase: 0,
    characterName: resolveCharacter(createDefaultAppearance()).label,
    petName: LOCAL_PET_NAME,
  });

  const handle: LobbySceneHandle = {
    renderer,
    scene,
    camera,
    player: local.rig,
    // Your cat is the local player's pet — the one that gets up and strolls.
    cat: local.pet,
    idle: { time: 0 },
    local,
    guests: [],
    count: 1,
    localPos: new THREE.Vector3(),
    backdropColor,
  };
  // Start as a solo lobby; main.ts can grow it to up to four players.
  applyLobbyLayout(handle, 1);
  return handle;
}

/** Grow the guest pool so at least `need` (0..3) guest slots exist. Each new
 * guest gets a distinct default look, its own cool orb, a seated cat, and both
 * name labels. */
function ensureGuests(handle: LobbySceneHandle, need: number): void {
  while (handle.guests.length < need) {
    const i = handle.guests.length;
    const appearance = GUEST_APPEARANCES[i % GUEST_APPEARANCES.length]!;
    const guest = buildPlayer(handle.scene, handle.backdropColor, {
      orbHex: ORB_OTHER,
      // Stagger the pulse so a full lobby shimmers instead of strobing in unison.
      phase: (i + 1) * 1.7,
      characterName: resolveCharacter(appearance).label,
      petName: GUEST_PET_NAMES[i % GUEST_PET_NAMES.length]!,
      appearance,
    });
    handle.guests.push(guest);
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
    if (slot.isLocal) {
      placePlayer(handle.local, slot);
      handle.localPos.set(slot.x, 0, slot.z);
    } else {
      const guest = handle.guests[guestCursor++]!;
      placePlayer(guest, slot);
      seatGuestPet(guest, slot); // the guest's cat sits beside them
    }
  }

  // Park any guests this lobby size doesn't use.
  for (let i = n - 1; i < handle.guests.length; i++) {
    setPlayerVisible(handle.guests[i]!, false);
  }

  seatCat(handle); // your cat re-seats at your (possibly moved) heel
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

/**
 * Re-letter the local player's character nameplate. main.ts calls this whenever
 * the appearance changes (cycling characters in the lobby), so the name on your
 * orb always matches the character you're wearing.
 */
export function setLobbyLocalName(
  handle: LobbySceneHandle,
  name: string,
): void {
  handle.local.nameplate.setText(name);
}

/**
 * Re-tint every orb to contrast a new backdrop color. The orbs darken more
 * against a bright sky and stay luminous against a dark one (see tintOrbPool);
 * this is the hook for when a future slope theme changes the lobby's backdrop.
 * It updates only the orbs' contrast — not the scene's own background/fog.
 */
export function setLobbyBackdropColor(
  handle: LobbySceneHandle,
  color: THREE.Color,
): void {
  handle.backdropColor.copy(color);
  tintOrbPool(handle.local.orb, handle.backdropColor);
  for (const guest of handle.guests) {
    tintOrbPool(guest.orb, handle.backdropColor);
  }
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
  // this lobby size stay frozen and dark. The local cat is driven by the stroll
  // above; each guest's cat just breathes its seated idle.
  animateOrb(handle.local.orb, t);
  handle.local.rig.update(dt);
  for (const guest of handle.guests) {
    if (!guest.rig.group.visible) continue;
    animateOrb(guest.orb, t);
    guest.rig.update(dt);
    guest.pet.update(dt);
  }
  handle.cat.update(dt);
}

export function renderLobby(handle: LobbySceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}
