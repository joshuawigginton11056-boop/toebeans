import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  BASE_SPEED,
  BOOST_SPEED,
  LATERAL_LIMIT,
  MIN_SPEED,
  RESPAWN_DELAY,
  downhillHeading,
  type SkiState,
} from "@toebeans/shared";
import { createCatRig, type CatRig } from "./catModel";
import { createSkierRig, type SkierRig } from "./skierModel";

// Art Style Bible palette (DESIGN.md) — every color in this scene comes
// from these 12 (or a value shift of one, which the bible allows).
const PALETTE = {
  sunlitSnow: 0xf8f5ef,
  snowShadow: 0xd3dff0, // every shadow cast on snow — soft blue, never black
  skyBlue: 0xbfdcf5,
  dawnPink: 0xf6d7ce, // horizon + the mandatory distance-haze tint
  sunGlow: 0xfff4da, // the sun disc and halo — brightest value in the scene
  glacialIce: 0x79b7d8,
  skierBlue: 0x4e72a8, // reserved: only the player wears this
  birchAmber: 0xe9a960,
  chasmDark: 0x2e3548, // slate rock, deep value shift — never pure black
} as const;

// Direction from the scene toward the sun: ahead of the skier (you ski into
// the light, which is what makes the haze glow) and off to the left, low
// enough (~25°) that shadows stretch long across the snow.
const SUN_DIRECTION = new THREE.Vector3(-0.4, 0.5, -1).normalize();

// Where the *visible* sun disc hangs: same azimuth as the light, but cheated
// down to just above the horizon so it's actually in frame — the camera looks
// downhill, so the real 25° sun sits above the top edge of the screen. A
// horizon sun with long shadows still reads as one coherent dawn.
const SUN_BILLBOARD_DIRECTION = new THREE.Vector3(-0.4, 0.075, -1).normalize();

export interface SkiSceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: THREE.Group;
  readonly skier: SkierRig;
  readonly cat: CatRig;
  readonly chasmMeshes: ReadonlyMap<string, THREE.Mesh>;
  readonly checkpointMeshes: ReadonlyMap<number, THREE.Mesh>;
  readonly slope: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly skyDome: THREE.Mesh;
  readonly sunBillboard: THREE.Sprite;
  /**
   * Last frame's status and speed, for the pole push-off's "actually
   * gaining" frame-diff — presentation-side memory; SkiState stays ignorant
   * of it. (The steer angle used to be frame-diffed from lateral too; now
   * the sim carries a real heading and the renderer just reads it.)
   */
  readonly steerMemory: { skiing: boolean; speed: number };
}

const SLOPE_LENGTH = 100;
// The visual lane derives from the sim's clamp — one extra unit each side,
// so the skier's body never visibly overlaps the treeline while pinned at
// the limit. (Was a separate hardcoded 10 when the limit was 4; deriving it
// keeps the visuals honest now that the area opened up.)
const SLOPE_WIDTH = LATERAL_LIMIT * 2 + 2;
// Where the decor scatter starts: just past the visual lane edge.
const LANE_EDGE = SLOPE_WIDTH / 2;
// How long the crash tip-over takes to hit the ground, inside the
// RESPAWN_DELAY pause — quick like a real balance loss, then it holds.
const TIP_DURATION = 0.35;

export function createSkiScene(container: HTMLElement): SkiSceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyBlue);

  // The mandatory haze: distance fog tinted dawn pink. Doubles as gameplay —
  // how pink something is tells you how far away it is.
  scene.fog = new THREE.Fog(PALETTE.dawnPink, 35, 150);

  // Three-quarter front perspective: looking downhill and slightly to the
  // side, matching the 2.5D isometric side-scroller camera described in
  // DESIGN.md's skiing section.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Soft shadow edges per the bible. Three.js retired PCFSoftShadowMap
  // (r185 falls back to PCF with a console warning), so softness comes from
  // the default PCF type plus the sun's shadow.radius below.
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // The bible's two snow colors define the lighting exactly: ambient
  // skylight alone must render flat snow as snow-shadow blue, and ambient
  // plus sun must render it as sunlit snow. Solving those two constraints
  // gives the light colors below — shadows land on palette #2 by
  // construction, not by tuning. (The blue channel wants slightly more than
  // the sun can subtract, hence the clamp; the sun comes out warm because
  // it carries all the red/yellow the blue ambient lacks.)
  const albedo = new THREE.Color(PALETTE.sunlitSnow);
  const shadowTarget = new THREE.Color(PALETTE.snowShadow);
  const ambientColor = new THREE.Color(
    Math.min(1, shadowTarget.r / albedo.r),
    Math.min(1, shadowTarget.g / albedo.g),
    Math.min(1, shadowTarget.b / albedo.b),
  );
  const groundNdotL = SUN_DIRECTION.y; // how squarely the sun hits flat snow
  const sunColor = new THREE.Color(
    Math.max(0, (1 - ambientColor.r) / groundNdotL),
    Math.max(0, (1 - ambientColor.g) / groundNdotL),
    Math.max(0, (1 - ambientColor.b) / groundNdotL),
  );

  // Math.PI because three.js physical lights fold 1/π into the material.
  scene.add(new THREE.AmbientLight(ambientColor, Math.PI));

  const sun = new THREE.DirectionalLight(sunColor, Math.PI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // ±55 covers the widened lane (±12 of skier travel) plus both treelines;
  // tuned against the old 8-unit lane at ±45.
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2; // soft penumbra, but shadows keep a solid core
  scene.add(sun, sun.target); // both follow the skier — see the sync function

  const skyDome = createSkyDome();
  scene.add(skyDome);

  const sunBillboard = createSunBillboard();
  scene.add(sunBillboard);

  // One wide snowfield; the skiable lane (SLOPE_WIDTH) sits in the middle
  // and the decor lives on the flanks beyond it. The plane is featureless,
  // so it quietly follows the skier's z (see sync) — the snow never ends,
  // and its far edge always sits past where the haze fully takes over.
  const slope = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 220),
    new THREE.MeshStandardMaterial({ color: PALETTE.sunlitSnow }),
  );
  slope.rotation.x = -Math.PI / 2;
  slope.position.z = -50;
  slope.receiveShadow = true;
  scene.add(slope);

  const player = new THREE.Group();

  // A real person on the skis now, not a blue box. The rig owns the model's
  // quirks (scale, which clip is which, the forward ski lean) and takes its
  // colors from the character palette — see skierModel.ts.
  const skier = createSkierRig();
  skier.setPose("skiing");
  skier.setFacing(Math.PI); // both bases are authored facing +z; downhill is -z
  player.add(skier.group);

  // The cat rides on your back (DESIGN.md's core fantasy) — and it *hugs*
  // now, rather than perching upright like a shelf ornament (director's
  // playtest call). The skier rig's mount is a live back-anchor glued to
  // the spine bones (+y up the spine, +z the character's forward, the back
  // surface toward -z), so the cat folds with the crouch, swings through
  // every carve, and tips over in a crash without any slope code here.
  // Laid belly-to-the-back: rotated so its paws press against the back
  // (like a cat clinging to a wall), body up along the spine, head craned
  // over the right shoulder by the clinging pose in catModel.ts.
  const cat = createCatRig();
  cat.setPose("clinging");
  cat.group.position.set(0.06, -0.05, -0.06);
  cat.group.rotation.set(-Math.PI / 2, 0, 0);
  skier.mount.add(cat.group);
  // The hair spring pushes away from a sphere at the cat's head, so hair
  // rests against the cat instead of swallowing it. The center is the cat
  // head's measured mount-space position under the placement above (it
  // holds constant brake↔tuck, because the mount IS the back frame).
  skier.setHairRepulsor({ x: 0.06, y: 0.06, z: -0.3, radius: 0.26 });

  scene.add(player);

  // Real slope-side assets load in the background; the run is playable
  // before they arrive.
  void loadSlopeDecor(scene);

  return {
    renderer,
    scene,
    camera,
    player,
    skier,
    cat,
    chasmMeshes: new Map(),
    checkpointMeshes: new Map(),
    slope,
    sun,
    skyDome,
    sunBillboard,
    steerMemory: { skiing: true, speed: 0 },
  };
}

// Pure with respect to SkiState: only reads state to sync mesh transforms
// and the camera, never writes back into it.
export function syncSkiSceneToState(
  handle: SkiSceneHandle,
  state: SkiState,
  dt: number,
): void {
  // The crouch depth reads straight off the speed magnitude, which fully
  // encodes the lean input (up = fast = tuck, down = slow = braking upright,
  // boost beyond MAX_SPEED = deepest tuck) — so the speed control is
  // legible on the body. Magnitude, not the raw value: speed is signed now
  // (negative = riding switch), and a fast switch run still tucks.
  // Airborne adds a bit of extra tuck for the jump.
  const pace = Math.abs(state.speed);
  const tuck = (pace - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED);

  // Steering: the sim carries a real heading now (0 = straight downhill,
  // out to fully sideways and past it), so the body just turns to it — no
  // more frame-diffing lateral, which topped out at 45° of visible turn and
  // couldn't tell "skiing sideways" from "drifting". The model eases toward
  // it internally, so a respawn's snap back to 0 rolls out smoothly.
  const skiing = state.status === "skiing";
  // The steer follows the heading through the crash pause too — the state
  // holds the fatal heading until respawn, and zeroing it here made the
  // body unwind while tipping over (turning round 2, playtest item 2).
  // On respawn the heading snaps to 0 and the model's easing rolls it out.
  const steer = state.heading;
  // The carve angle drives the bank/angulation and is *stance-relative*:
  // riding switch, the body leans off how far the skis are turned from
  // straight-backwards, not from straight-downhill — otherwise a clean
  // switch run would hold a maxed-out bank forever. Scaled down toward a
  // standstill (banking comes from carving at speed; a stopped pivot
  // stands upright — which also smooths the stance flip at the sideways
  // pivot, where speed passes through zero), and zeroed in the air: no
  // edge to lean against, and mid-spin the stance sign isn't settled yet.
  const airborne = state.height > 0;
  const stance = state.speed < 0 ? Math.PI : 0;
  const carve = airborne
    ? 0
    : downhillHeading(state.heading - stance) * Math.min(1, pace / MIN_SPEED);
  // Riding switch, the head and torso twist to look over a shoulder at
  // where you're actually going. The small deadband keeps the sideways
  // pivot (speed jittering around zero) from nodding the head back and
  // forth.
  const switchLook = state.speed < -0.5 ? 1 : 0;
  // The pole push-off: poles drive while the run is on the snow, below
  // cruise speed, and actually gaining — detected the same frame-diff way
  // as the steer above, so braking down to MIN_SPEED (speed falling or
  // parked at its floor) never pumps the arms. Fades out as the push-off
  // approaches cruise, where gravity has taken over from the poles.
  // All magnitudes: a switch push-off pumps the arms the same way.
  const grounded = state.height <= 0;
  const gaining =
    skiing && handle.steerMemory.skiing && pace > handle.steerMemory.speed;
  const push =
    grounded && gaining
      ? Math.max(0, Math.min(1, 1 - pace / (0.85 * BASE_SPEED)))
      : 0;
  handle.steerMemory.skiing = skiing;
  handle.steerMemory.speed = pace;

  handle.skier.setSkiMotion({
    tuck: tuck + (state.height > 0 ? 0.2 : 0),
    steer,
    carve,
    switchLook,
    airborne,
    push,
  });

  handle.cat.update(dt);
  handle.skier.update(dt);
  handle.player.position.set(state.lateral, state.height, -state.distance);
  // The crash tip-over: chasms are the game's only crash now (turning
  // round 3 removed the fall-over), and a chasm always reads as a forward
  // drop — downhill, the way you were traveling, whatever the stance.
  // Animated over the start of the crash pause — the respawn timer doubles
  // as the clock (forfeit holds it at 0 = fully tipped) — and accelerating
  // like a real topple, not a linear hinge.
  if (state.status === "skiing") {
    handle.player.rotation.set(0, 0, 0);
  } else {
    const progress = Math.min(
      1,
      (RESPAWN_DELAY - state.respawnTimer) / TIP_DURATION,
    );
    const tip = (Math.PI / 2) * progress * progress;
    handle.player.rotation.set(-tip, 0, 0);
  }

  const checkpointMeshes = handle.checkpointMeshes as Map<number, THREE.Mesh>;
  for (const checkpoint of state.checkpoints) {
    if (checkpoint === 0 || checkpointMeshes.has(checkpoint)) continue;
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(SLOPE_WIDTH, 0.5),
      new THREE.MeshStandardMaterial({ color: PALETTE.glacialIce }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(0, 0.02, -checkpoint);
    marker.receiveShadow = true;
    handle.scene.add(marker);
    checkpointMeshes.set(checkpoint, marker);
  }

  const meshes = handle.chasmMeshes as Map<string, THREE.Mesh>;
  for (const chasm of state.chasms) {
    let mesh = meshes.get(chasm.id);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(SLOPE_WIDTH, chasm.width),
        new THREE.MeshStandardMaterial({ color: PALETTE.chasmDark }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      handle.scene.add(mesh);
      meshes.set(chasm.id, mesh);
    }
    mesh.position.set(0, 0.01, -(chasm.start + chasm.width / 2));
  }

  handle.camera.position.set(state.lateral, state.height + 4, -state.distance + 8);
  handle.camera.lookAt(state.lateral, state.height, -state.distance - 4);

  // Atmosphere follows the run downhill. The sun light (and its shadow
  // camera) track the skier so shadows stay crisp anywhere on the slope;
  // the sky dome and sun disc ride with the camera like a real horizon.
  const anchor = new THREE.Vector3(state.lateral, 0, -state.distance);
  handle.sun.target.position.copy(anchor);
  handle.sun.position.copy(anchor).addScaledVector(SUN_DIRECTION, 70);
  handle.slope.position.z = -state.distance - 50;
  handle.skyDome.position.copy(handle.camera.position);
  handle.sunBillboard.position
    .copy(handle.camera.position)
    .addScaledVector(SUN_BILLBOARD_DIRECTION, 150);
}

export function render(handle: SkiSceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}

// ---------------------------------------------------------------------------
// Sky: an inward-facing dome, dawn pink at the horizon blending up to sky
// blue overhead, so the ground fog (also dawn pink) melts into the horizon
// instead of hitting a flat-colored wall.

function createSkyDome(): THREE.Mesh {
  const radius = 170;
  const geometry = new THREE.SphereGeometry(radius, 32, 16);
  const positions = geometry.attributes.position!;
  const colors = new Float32Array(positions.count * 3);
  const horizon = new THREE.Color(PALETTE.dawnPink);
  const zenith = new THREE.Color(PALETTE.skyBlue);
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const height = positions.getY(i) / radius; // -1 (below) … 1 (overhead)
    // Blend fully to sky blue within ~15° of elevation — the downhill camera
    // only ever sees a low band of sky, and the blue should reach into it.
    const t = Math.min(1, Math.max(0, (height - 0.02) / 0.25));
    color.lerpColors(horizon, zenith, t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  dome.renderOrder = -1; // paint the sky first; everything else draws over it
  return dome;
}

// The visible sun: a solid sun-glow disc with a soft radial halo, drawn on
// one always-camera-facing sprite. The bible wants a glow, not lens flare.
function createSunBillboard(): THREE.Sprite {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,244,218,1)"); // sun glow, solid core
  gradient.addColorStop(0.28, "rgba(255,244,218,1)");
  gradient.addColorStop(0.34, "rgba(255,244,218,0.55)");
  gradient.addColorStop(1, "rgba(255,244,218,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  sprite.scale.setScalar(34);
  return sprite;
}

// ---------------------------------------------------------------------------
// Slope decor: real .glb assets (see assets/CREDITS.md) scattered along the
// flanks of the skiable lane. Pure scenery — nothing here collides, so no
// /shared state is involved. Placement is seeded, so every run and every
// machine sees the identical slope.

const DECOR_MODELS = {
  pines: ["PineTree_Snow_1", "PineTree_Snow_2", "PineTree_Snow_4", "PineTree_Snow_5"],
  birches: ["BirchTree_Snow_1", "BirchTree_Snow_2", "BirchTree_Snow_3", "BirchTree_Snow_5"],
  deadBirches: [
    "BirchTree_Dead_Snow_1",
    "BirchTree_Dead_Snow_2",
    "BirchTree_Dead_Snow_3",
    "BirchTree_Dead_Snow_4",
    "BirchTree_Dead_Snow_5",
  ],
  rocks: [
    "Rock_Snow_1",
    "Rock_Snow_2",
    "Rock_Snow_3",
    "Rock_Snow_4",
    "Rock_Snow_5",
    "Rock_Snow_6",
    "Rock_Snow_7",
  ],
  filler: ["Bush_Snow_1", "Bush_Snow_2", "TreeStump_Snow", "WoodLog_Snow"],
} as const;

// Small deterministic PRNG (mulberry32) so the scatter never shifts between
// loads — the slope should feel like a place, not a reshuffle.
function makeRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadSlopeDecor(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const names = Object.values(DECOR_MODELS).flat();
  const templates = new Map<string, THREE.Group>();
  try {
    await Promise.all(
      names.map(async (name) => {
        const gltf = await loader.loadAsync(
          `${import.meta.env.BASE_URL}slope/${name}.glb`,
        );
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true; // clone() carries these flags along
            object.receiveShadow = true;
          }
        });
        templates.set(name, gltf.scene);
      }),
    );
  } catch (error) {
    // Decor is cosmetic — a failed load leaves the run playable.
    console.error("slope decor failed to load", error);
    return;
  }

  const random = makeRandom(20260721);
  const pick = (list: readonly string[]): THREE.Group =>
    templates.get(list[Math.floor(random() * list.length)]!)!;

  const place = (
    template: THREE.Group,
    x: number,
    z: number,
    scale: number,
  ): void => {
    const copy = template.clone();
    copy.position.set(x, 0, z);
    copy.rotation.y = random() * Math.PI * 2;
    copy.scale.setScalar(scale);
    scene.add(copy);
  };

  // Near flanks: a mixed treeline on both sides of the skiable lane,
  // starting just past its edge (LANE_EDGE) so the lane stays clear. With
  // the edge kept as a hard clamp (director call, 2026-07-22), this
  // treeline is the visible cue for where the skiable area ends.
  for (const side of [-1, 1]) {
    for (let z = -4; z > -(SLOPE_LENGTH + 30); z -= 2.5 + random() * 3) {
      const roll = random();
      const model =
        roll < 0.3
          ? pick(DECOR_MODELS.pines)
          : roll < 0.6
            ? pick(DECOR_MODELS.birches)
            : roll < 0.75
              ? pick(DECOR_MODELS.deadBirches)
              : roll < 0.87
                ? pick(DECOR_MODELS.rocks)
                : pick(DECOR_MODELS.filler);
      const x = side * (LANE_EDGE + 0.8 + random() * 9);
      place(model, x, z, 0.85 + random() * 0.5);
    }
  }

  // Far flanks: sparse oversized trees for silhouettes and depth. The
  // lonely-vast target wants these thin — resist filling them in.
  for (const side of [-1, 1]) {
    for (let z = -10; z > -(SLOPE_LENGTH + 30); z -= 8 + random() * 6) {
      const model =
        random() < 0.5
          ? pick(DECOR_MODELS.pines)
          : pick(DECOR_MODELS.deadBirches);
      const x = side * (LANE_EDGE + 11 + random() * 16);
      place(model, x, z, 1.2 + random() * 0.6);
    }
  }
}
