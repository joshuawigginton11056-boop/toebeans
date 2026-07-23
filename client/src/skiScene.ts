import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LATERAL_LIMIT } from "@toebeans/shared";
import { SKI_STANCE } from "./skierModel";

// Everything about how the slope LOOKS lives in this file — palette,
// lighting, sky, snow surface, decor, and the hazard/checkpoint mesh
// styles. skiRender.ts (slope-mechanics territory) decides what exists and
// where it goes each frame; this file (slope-visuals territory) decides
// what it looks like. See PARALLEL.md for the ownership split.

// Art Style Bible palette (DESIGN.md) — every color in this scene comes
// from these 12 (or a value shift of one, which the bible allows).
export const PALETTE = {
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

export const SLOPE_LENGTH = 100;
// The snowfield plane: one moving window of snow that follows the skier
// (see syncEnvironment). The trail ring buffer below shares these numbers —
// they define the world↔texture mapping, so they live here, named.
const SNOWFIELD_WIDTH = 120;
const SNOWFIELD_LENGTH = 220;
// The window's center sits this far downhill of the skier: most of the
// snow lies ahead, where the camera looks.
const SNOWFIELD_LEAD = 50;
// The visual lane derives from the sim's clamp — one extra unit each side,
// so the skier's body never visibly overlaps the treeline while pinned at
// the limit. (Was a separate hardcoded 10 when the limit was 4; deriving it
// keeps the visuals honest now that the area opened up.)
export const SLOPE_WIDTH = LATERAL_LIMIT * 2 + 2;
// Where the decor scatter starts: just past the visual lane edge.
export const LANE_EDGE = SLOPE_WIDTH / 2;

export interface SlopeEnvironment {
  readonly sun: THREE.DirectionalLight;
  readonly skyDome: THREE.Mesh;
  readonly sunBillboard: THREE.Sprite;
  readonly slope: THREE.Mesh;
  readonly trail: SnowTrail;
}

// What the snow needs from the sim each frame to carve ski trails —
// mechanics code passes this through syncEnvironment. See the seam note in
// PARALLEL.md; the shape is deliberately two plain numbers-worth of state.
export interface SnowTrailInput {
  /** Ski direction on the snow, radians, 0 = straight downhill. */
  readonly heading: number;
  /** False in the air or during a crash — lifts the pen, breaking the grooves. */
  readonly grounded: boolean;
}

// Builds the slope's weather and ground: fog, lights, sky, sun disc, and
// the snowfield plane. Adds everything to the scene and returns the pieces
// that follow the run downhill (see syncEnvironment).
export function createEnvironment(scene: THREE.Scene): SlopeEnvironment {
  scene.background = new THREE.Color(PALETTE.skyBlue);

  // The mandatory haze: distance fog tinted dawn pink. Doubles as gameplay —
  // how pink something is tells you how far away it is.
  scene.fog = new THREE.Fog(PALETTE.dawnPink, 35, 150);

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
  scene.add(sun, sun.target); // both follow the skier — see syncEnvironment

  const skyDome = createSkyDome();
  scene.add(skyDome);

  const sunBillboard = createSunBillboard();
  scene.add(sunBillboard);

  // One wide snowfield; the skiable lane (SLOPE_WIDTH) sits in the middle
  // and the decor lives on the flanks beyond it. The plane quietly follows
  // the skier's z (see syncEnvironment) — the snow never ends, and its far
  // edge always sits past where the haze fully takes over.
  //
  // REALISM SNOW TEST (2026-07-23, split verdict follow-up): the surface
  // itself is no longer featureless — soft procedural relief, sparkle-fleck
  // roughness, and a view-dependent glitter pass (see the realism snow
  // section below). The albedo stays flat sunlit snow: the verdict rejected
  // painted *dapple* for snow, so all the realism rides on lighting
  // response, not color blotches. Textures are pinned to the world in
  // syncEnvironment as the plane recenters, so the snow never swims.
  const snow = getSnowTextures();
  const slope = new THREE.Mesh(
    new THREE.PlaneGeometry(SNOWFIELD_WIDTH, SNOWFIELD_LENGTH),
    new THREE.MeshStandardMaterial({
      color: PALETTE.sunlitSnow,
      bumpMap: snow.relief,
      bumpScale: 0.35,
      roughnessMap: snow.sparkle,
      roughness: 1, // the map carries the value; 1 = don't scale it down
    }),
  );
  addSnowGlitter(slope.material as THREE.MeshStandardMaterial);
  slope.rotation.x = -Math.PI / 2;
  slope.position.z = -SNOWFIELD_LEAD;
  slope.receiveShadow = true;
  scene.add(slope);

  // The ski trails: a transparent overlay riding the same window as the
  // snowfield, carved into by updateSnowTrail each frame.
  const trail = createSnowTrail();
  scene.add(trail.mesh);

  return { sun, skyDome, sunBillboard, slope, trail };
}

// Atmosphere follows the run downhill. The sun light (and its shadow
// camera) track the skier so shadows stay crisp anywhere on the slope; the
// sky dome and sun disc ride with the camera like a real horizon. The
// anchor is the skier's ground position; mechanics code calls this every
// frame and never needs to know the offsets.
export function syncEnvironment(
  environment: SlopeEnvironment,
  anchor: THREE.Vector3,
  camera: THREE.Camera,
  trailInput?: SnowTrailInput,
): void {
  environment.sun.target.position.copy(anchor);
  environment.sun.position.copy(anchor).addScaledVector(SUN_DIRECTION, 70);
  const centerZ = anchor.z - SNOWFIELD_LEAD;
  environment.slope.position.z = centerZ;
  // Pin the snow's surface textures to the world as the plane recenters
  // under them: a texel at world z samples at (repeat.y × -z/length)
  // regardless of where the plane sits, so the relief never swims. The
  // trail overlay uses the same trick with repeat 1 — that's what makes the
  // ring-buffer canvas line up with the world (see trailCanvasY).
  const snow = getSnowTextures();
  for (const texture of [snow.relief, snow.sparkle]) {
    texture.offset.y = -texture.repeat.y * (0.5 + centerZ / SNOWFIELD_LENGTH);
  }
  environment.trail.mesh.position.z = centerZ;
  environment.trail.texture.offset.y = -(0.5 + centerZ / SNOWFIELD_LENGTH);
  if (trailInput) updateSnowTrail(environment.trail, anchor, trailInput);
  environment.skyDome.position.copy(camera.position);
  environment.sunBillboard.position
    .copy(camera.position)
    .addScaledVector(SUN_BILLBOARD_DIRECTION, 150);
}

// The look of a checkpoint: a glacial-ice stripe lying on the snow.
// Mechanics code positions it at the checkpoint's distance.
export function createCheckpointMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(SLOPE_WIDTH, 0.5),
    new THREE.MeshStandardMaterial({ color: PALETTE.glacialIce }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.receiveShadow = true;
  return marker;
}

// The look of a chasm: a deep-slate slab spanning the lane (the bible bans
// pure black). Mechanics code sizes the gap and positions it.
export function createChasmMesh(width: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(SLOPE_WIDTH, width),
    new THREE.MeshStandardMaterial({ color: PALETTE.chasmDark }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
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
// REALISM SNOW TEST (2026-07-23) — the snow half of the split verdict (see
// the Art Style Bible's status note in DESIGN.md): snow should read as real
// snow — fine sparkle, soft relief, believable sunlit white — while keeping
// the two snow palette colors as its family. This is the *procedural*
// candidate: everything below is generated in code (no image files, no
// CREDITS rows), built to compare against a paid photo-texture pack before
// spending on one. Three pieces:
//
//   1. Surface relief + sparkle flecks: tileable canvases driving the
//      snowfield's bump and roughness maps. Color stays flat sunlit snow —
//      the verdict rejected painted dapple, so realism rides on lighting
//      response only.
//   2. Glitter: a shader pass that gives random micro-cells of the snow a
//      mirror facet — the ones aligned between the sun and the camera flash
//      as you move. That view-dependent twinkle is the thing bump maps
//      can't fake and the biggest single "real snow" tell.
//   3. Ski trails: the director's explicit ask ("the snow had no depth — no
//      footprints, no ski trails carved into it"). A ring-buffer canvas
//      overlay rides the snowfield window; every grounded frame stamps two
//      groove segments at the rig's exact ski positions (SKI_STANCE). Core
//      is carved snow (#3), flanked by a snow-shadow spill and a sunlit lip
//      highlight on the sun side, so the grooves read as depth under the
//      fixed dawn light. Airborne frames lift the pen — jump gaps carve
//      themselves, which is itself the speed cue the references show.

interface SnowTextures {
  readonly relief: THREE.CanvasTexture; // bump height — dunes + fine grain
  readonly sparkle: THREE.CanvasTexture; // roughness — matte with shiny flecks
}

let snowTextures: SnowTextures | null = null;

function getSnowTextures(): SnowTextures {
  if (snowTextures) return snowTextures;

  const random = makeRandom(20260723);
  const makeTexture = (
    size: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): THREE.CanvasTexture => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    draw(ctx);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  };
  // Soft radial-gradient stamp, drawn through a 3×3 wrap so the canvas
  // tiles seamlessly. Gradients, not hard blobs: hard edges read as paint
  // (the rejected direction); gradients read as wind-settled snow.
  const softBlob = (
    ctx: CanvasRenderingContext2D,
    size: number,
    x: number,
    y: number,
    r: number,
    value: number,
    alpha: number,
  ): void => {
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const px = x + dx;
        const py = y + dy;
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, r);
        gradient.addColorStop(0, `rgba(${value},${value},${value},${alpha})`);
        gradient.addColorStop(1, `rgba(${value},${value},${value},0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
  };

  // Height field around neutral 128: three scales of soft dune, then fine
  // surface grain. The repeat below puts one tile across ~8 world units, so
  // the large dunes land around 2–3 m — gentle rolling relief, and the long
  // dawn light does the rest.
  const relief = makeTexture(512, (ctx) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 14; i++) {
      softBlob(
        ctx, 512, random() * 512, random() * 512,
        90 + random() * 70, random() < 0.5 ? 102 : 154, 0.5,
      );
    }
    for (let i = 0; i < 44; i++) {
      softBlob(
        ctx, 512, random() * 512, random() * 512,
        24 + random() * 36, random() < 0.5 ? 98 : 158, 0.45,
      );
    }
    for (let i = 0; i < 130; i++) {
      softBlob(
        ctx, 512, random() * 512, random() * 512,
        6 + random() * 10, random() < 0.5 ? 93 : 163, 0.5,
      );
    }
    // Fine grain: the granular top crust.
    for (let i = 0; i < 900; i++) {
      const v = 108 + random() * 40;
      ctx.fillStyle = `rgba(${v},${v},${v},0.6)`;
      ctx.fillRect(random() * 512, random() * 512, 1 + random(), 1 + random());
    }
  });

  // Roughness: matte base (~0.66) with patchy sheen and sparse near-mirror
  // flecks — the flecks catch the sun's specular as secondary sparkle on
  // top of the shader glitter.
  const sparkle = makeTexture(256, (ctx) => {
    ctx.fillStyle = "#a8a8a8";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) {
      softBlob(
        ctx, 256, random() * 256, random() * 256,
        18 + random() * 30, random() < 0.5 ? 140 : 190, 0.4,
      );
    }
    for (let i = 0; i < 380; i++) {
      const v = 30 + random() * 55; // low roughness = shiny fleck
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(random() * 256, random() * 256, 1, 1);
    }
  });

  // One relief tile per ~8 units, sparkle flecks at ~2 cm.
  relief.repeat.set(SNOWFIELD_WIDTH / 8, SNOWFIELD_LENGTH / 8);
  sparkle.repeat.set(SNOWFIELD_WIDTH / 5, SNOWFIELD_LENGTH / 5);

  snowTextures = { relief, sparkle };
  return snowTextures;
}

// The glitter pass: every ~3.5 cm cell of snow owns one random micro-facet;
// a cell flashes sun-glow white when its facet mirrors the sun into the
// camera, so the field twinkles as the run moves — the view-dependent
// sparkle real snow has. Fades out by ~45 units (distant cells go
// sub-pixel and would alias) where the haze owns the look anyway. Known
// simplification: glitter ignores cast shadows (a tree's shadow still
// twinkles faintly) — parked in IDEAS.md.
function addSnowGlitter(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sunDir = { value: SUN_DIRECTION.clone() };
    shader.vertexShader =
      "varying vec3 vSnowWorld;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvSnowWorld = (modelMatrix * vec4(position, 1.0)).xyz;",
      );
    shader.fragmentShader =
      "varying vec3 vSnowWorld;\nuniform vec3 sunDir;\n" +
      shader.fragmentShader.replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
{
  vec2 cell = floor(vSnowWorld.xz * 28.0);
  vec3 cellHash = fract(sin(vec3(
    dot(cell, vec2(127.1, 311.7)),
    dot(cell, vec2(269.5, 183.3)),
    dot(cell, vec2(419.2, 371.9)))) * 43758.5453);
  vec3 facet = normalize(vec3(cellHash.x - 0.5, 0.65, cellHash.y - 0.5));
  vec3 toCamera = normalize(cameraPosition - vSnowWorld);
  float flash = pow(max(dot(facet, normalize(toCamera + sunDir)), 0.0), 64.0);
  float gate = step(0.78, cellHash.z);
  float fade = 1.0 - smoothstep(16.0, 45.0, length(cameraPosition - vSnowWorld));
  // Sun-glow tinted (#FFF4DA) — the bible's brightest value.
  reflectedLight.directSpecular += vec3(1.0, 0.957, 0.855) * (flash * gate * fade * 1.6);
}`,
      );
  };
}

// ---------------------------------------------------------------------------
// The ski trails. World↔canvas mapping: the overlay plane spans the lane
// (SLOPE_WIDTH) by the snowfield window length, and its texture is offset
// in syncEnvironment so texture row = -z/SNOWFIELD_LENGTH regardless of
// where the window sits. That turns the canvas into a ring buffer along z:
// grooves persist in place as the window slides past, and rows are
// reclaimed (cleared) as they re-enter at the leading edge — which sits
// ~160 units downhill of the skier, fully swallowed by the haze, so the
// reclaim is never visible.

const TRAIL_TEX_WIDTH = 512; // across the lane: ~20 px per unit
const TRAIL_TEX_HEIGHT = 2048; // along the window: ~9 px per unit

// Groove colors, all in the snow family: carved snow (#3) core, a spill of
// displaced snow between #1 and #2, and a near-#1 sunlit lip. Opaque
// strokes on purpose — translucent ones double-darken where segments join.
const TRAIL_CORE = "#afc2de";
const TRAIL_SPILL = "#e6eaf0";
const TRAIL_LIP = "#fffdf8";
// The lip highlight sits on the groove edge facing the sun: the sun's xz
// direction (-0.4, -1) mapped into canvas axes, ~1.6 px out from the core.
const TRAIL_LIP_OFFSET = { x: -0.6, y: -1.5 } as const;

// Per-ski pen: current tip and the point before it (the previous segment
// gets its lip re-stroked so the next segment's spill can't eat it).
interface TrailPen {
  prev: THREE.Vector2 | null;
  curr: THREE.Vector2 | null;
}

export interface SnowTrail {
  readonly mesh: THREE.Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly pens: [TrailPen, TrailPen];
  /** Furthest-downhill z whose canvas rows have been reclaimed so far. */
  leadingZ: number | null;
}

function createSnowTrail(): SnowTrail {
  const canvas = document.createElement("canvas");
  canvas.width = TRAIL_TEX_WIDTH;
  canvas.height = TRAIL_TEX_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapT = THREE.RepeatWrapping; // the ring dimension
  texture.colorSpace = THREE.SRGBColorSpace;
  // The canvas re-uploads every stamped frame — skip mipmap regeneration
  // (distant trail lives in the haze anyway) and let anisotropy keep the
  // grooves crisp at the camera's grazing angle.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(SLOPE_WIDTH, SNOWFIELD_LENGTH),
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false, // composite over the snow; never fight its depth
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  // Above the snowfield, below the chasm slabs (0.01) and checkpoint
  // stripes (0.02) — a groove never overdraws a hole in the ground.
  mesh.position.set(0, 0.005, -SNOWFIELD_LEAD);
  mesh.receiveShadow = true;
  return { mesh, ctx, texture, pens: [{ prev: null, curr: null }, { prev: null, curr: null }], leadingZ: null };
}

const fract = (v: number): number => v - Math.floor(v);
// World z → canvas row. flipY is on (three's canvas default), so texture
// row -z/length lands at canvas y = (1 - fract(-z/length)) * height.
const trailCanvasY = (z: number): number =>
  (1 - fract(-z / SNOWFIELD_LENGTH)) * TRAIL_TEX_HEIGHT;
const trailCanvasX = (x: number): number =>
  ((x + SLOPE_WIDTH / 2) / SLOPE_WIDTH) * TRAIL_TEX_WIDTH;

// Called every frame from syncEnvironment. Reclaims ring rows entering the
// window, then stamps one groove segment per ski while the skis are down.
function updateSnowTrail(
  trail: SnowTrail,
  anchor: THREE.Vector3,
  input: SnowTrailInput,
): void {
  const { ctx } = trail;
  let drew = false;

  // Reclaim: rows newly entering at the leading (downhill, haze-hidden)
  // edge still hold grooves from one ring-wrap ago — wipe them. When the
  // window recedes instead (a respawn), leadingZ stays put: the rows
  // re-entering uphill hold the *previous pass's* real grooves, which is
  // exactly what should still be on the snow there.
  const lead = anchor.z - SNOWFIELD_LEAD - SNOWFIELD_LENGTH / 2;
  if (trail.leadingZ === null || trail.leadingZ - lead > SNOWFIELD_LENGTH) {
    ctx.clearRect(0, 0, TRAIL_TEX_WIDTH, TRAIL_TEX_HEIGHT); // fresh window
    trail.leadingZ = lead;
    drew = true;
  } else if (lead < trail.leadingZ) {
    const rowWorld = SNOWFIELD_LENGTH / TRAIL_TEX_HEIGHT;
    for (let z = trail.leadingZ; z >= lead - rowWorld; z -= rowWorld) {
      ctx.clearRect(0, trailCanvasY(z) - 2, TRAIL_TEX_WIDTH, 4);
    }
    trail.leadingZ = lead;
    drew = true;
  }

  if (!input.grounded) {
    // Pen up: airborne or crashed. The groove break is the jump, visibly.
    for (const pen of trail.pens) {
      pen.prev = null;
      pen.curr = null;
    }
  } else {
    // Ski positions: the stance offset perpendicular to the heading. With
    // travel = (sin h, -cos h) in xz (the sim's convention), perpendicular
    // is (cos h, sin h).
    const perpX = Math.cos(input.heading);
    const perpZ = Math.sin(input.heading);
    for (const [i, side] of [-1, 1].entries()) {
      const pen = trail.pens[i]!;
      const pos = new THREE.Vector2(
        anchor.x + perpX * side * SKI_STANCE,
        anchor.z + perpZ * side * SKI_STANCE,
      );
      if (pen.curr === null) {
        pen.curr = pos; // touchdown — next frame starts the groove
      } else if (pen.curr.distanceTo(pos) > 4) {
        pen.prev = null; // teleport (respawn safety net) — restart the line
        pen.curr = pos;
      } else if (pen.curr.distanceTo(pos) > 0.015) {
        drawGroove(ctx, pen.prev, pen.curr, pos);
        pen.prev = pen.curr;
        pen.curr = pos;
        drew = true;
      } // else: standing still — don't pile up round caps
    }
  }

  if (drew) trail.texture.needsUpdate = true;
}

// One groove step: spill under core under lip, round caps so joints and
// jump landings stay clean. The lip is re-stroked over the previous segment
// too — the fresh segment's spill overlaps the last joint, and without the
// re-stroke it would erase the lip there, leaving dashes.
function drawGroove(
  ctx: CanvasRenderingContext2D,
  prev: THREE.Vector2 | null,
  from: THREE.Vector2,
  to: THREE.Vector2,
): void {
  const H = TRAIL_TEX_HEIGHT;
  const ax = trailCanvasX(from.x);
  const ay = trailCanvasY(from.y);
  // Unwrap the other points' rows to from's neighborhood so segments that
  // cross the ring seam draw as one straight stroke (the ±H copies below
  // paint whichever half lands back on the canvas).
  const unwrapY = (z: number): number => {
    let y = trailCanvasY(z);
    if (y - ay > H / 2) y -= H;
    if (ay - y > H / 2) y += H;
    return y;
  };
  const bx = trailCanvasX(to.x);
  const by = unwrapY(to.y);
  const line = (
    x1: number, y1: number, x2: number, y2: number,
    width: number, style: string, dx = 0, dy = 0,
  ): void => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    for (const off of [-H, 0, H]) {
      ctx.beginPath();
      ctx.moveTo(x1 + dx, y1 + dy + off);
      ctx.lineTo(x2 + dx, y2 + dy + off);
      ctx.stroke();
    }
  };
  ctx.lineCap = "round";
  line(ax, ay, bx, by, 4.5, TRAIL_SPILL);
  line(ax, ay, bx, by, 2.4, TRAIL_CORE);
  const { x: lx, y: ly } = TRAIL_LIP_OFFSET;
  if (prev) {
    line(trailCanvasX(prev.x), unwrapY(prev.y), ax, ay, 1.1, TRAIL_LIP, lx, ly);
  }
  line(ax, ay, bx, by, 1.1, TRAIL_LIP, lx, ly);
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

export async function loadSlopeDecor(scene: THREE.Scene): Promise<void> {
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

  // TEXTURE TEST pairs: the same model at the same distance, mirrored
  // across the lane — LEFT stays the flat original, RIGHT gets the painted
  // detail. Identical rotation and scale so the only difference is the
  // surface. Hugging the lane edge, just proud of the treeline.
  const pairs: ReadonlyArray<readonly [string, number]> = [
    ["BirchTree_Snow_1", -9],
    ["PineTree_Snow_1", -14],
    ["Rock_Snow_1", -18],
  ];
  for (const [name, z] of pairs) {
    const template = templates.get(name)!;
    for (const side of [-1, 1]) {
      const copy = template.clone();
      copy.position.set(side * (LANE_EDGE + 0.4), 0, z);
      copy.scale.setScalar(1.15);
      if (side === 1) applyPaintedDetail(copy);
      scene.add(copy);
    }
  }
}

// ---------------------------------------------------------------------------
// TEXTURE TEST (2026-07-22, direction session) — the 2026-07-22 verdict
// split: painted detail on trees/rocks/props is APPROVED (rollout across
// all 24 slope models is its own upcoming chunk); the painted *snow* patch
// was rejected in favor of realism (now the REALISM SNOW section above),
// and its canvases are gone from here. Everything below is generated in
// code — no image files, no license rows.
//
// The converted GLBs carry NO UV coordinates (the OBJ→GLB palette tool
// dropped them), so the trees can't wear an image texture the normal way.
// Instead the painted canvases are sampled *triplanar* — by object-space
// position, blended across the three axes by the surface normal — which
// needs no UVs and keeps the paint glued to each tree.

interface PaintedTextures {
  readonly bark: THREE.CanvasTexture;
  readonly dapple: THREE.CanvasTexture;
  readonly grain: THREE.CanvasTexture;
}

let paintedTextures: PaintedTextures | null = null;

function getPaintedTextures(): PaintedTextures {
  if (paintedTextures) return paintedTextures;

  // Everything is stamped through a 3×3 wrap so the canvases tile
  // seamlessly, and placement comes from the seeded PRNG so every load
  // paints the identical snow.
  const makeTexture = (
    size: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
    color: boolean,
  ): THREE.CanvasTexture => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    draw(ctx);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const tiled = (
    ctx: CanvasRenderingContext2D,
    size: number,
    x: number,
    y: number,
    stamp: (x: number, y: number) => void,
  ): void => {
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) stamp(x + dx, y + dy);
  };
  const blob = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    squish: number,
  ): void => {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * squish, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const random = makeRandom(20260722);

  // The triplanar canvases are value-MODULATION maps, painted around
  // neutral gray (128 ≈ ×1.0 in the shader) — strokes darker and lighter
  // than neutral become paint-stroke value variation on whatever palette
  // color the material already has.
  const bark = makeTexture(
    128,
    (ctx) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 42; i++) {
        const x = random() * 128;
        const y = random() * 128;
        const w = 1 + random() * 3;
        const h = 18 + random() * 60;
        const v = random() < 0.55 ? 102 + random() * 14 : 140 + random() * 14;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.globalAlpha = 0.65;
        tiled(ctx, 128, x, y, (px, py) => ctx.fillRect(px, py - h / 2, w, h));
      }
      // Birch lenticels: short dark horizontal dashes.
      for (let i = 0; i < 16; i++) {
        const x = random() * 128;
        const y = random() * 128;
        ctx.fillStyle = "rgb(88,88,88)";
        ctx.globalAlpha = 0.8;
        tiled(ctx, 128, x, y, (px, py) =>
          ctx.fillRect(px, py, 4 + random() * 6, 1.5),
        );
      }
      ctx.globalAlpha = 1;
    },
    false,
  );
  const dapple = makeTexture(
    128,
    (ctx) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 128, 128);
      // Posterized foliage dapple: hard-edged blobs at a few fixed values
      // reads as paint strokes, not noise.
      const values = [100, 114, 142, 156];
      for (let i = 0; i < 48; i++) {
        const x = random() * 128;
        const y = random() * 128;
        const r = 5 + random() * 12;
        const v = values[Math.floor(random() * values.length)]!;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        tiled(ctx, 128, x, y, (px, py) =>
          blob(ctx, px, py, r, 0.6 + random() * 0.4),
        );
      }
    },
    false,
  );
  const grain = makeTexture(
    128,
    (ctx) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 340; i++) {
        const x = random() * 128;
        const y = random() * 128;
        const v = 108 + random() * 40;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 1 + random(), 1 + random());
      }
      for (let i = 0; i < 26; i++) {
        const x = random() * 128;
        const y = random() * 128;
        ctx.fillStyle = "rgb(150,150,150)";
        blob(ctx, x, y, 2 + random() * 3, 0.7);
      }
    },
    false,
  );

  paintedTextures = { bark, dapple, grain };
  return paintedTextures;
}

// Which painted canvas each palette material wears, how big the strokes
// are (repeats per unit), and how hard they press (0..1).
const DETAIL_BY_MATERIAL: Record<
  string,
  { map: keyof PaintedTextures; scale: number; strength: number }
> = {
  White: { map: "bark", scale: 1.6, strength: 0.85 }, // birch trunk
  Black: { map: "bark", scale: 1.6, strength: 0.85 }, // birch trunk bands
  Wood: { map: "bark", scale: 1.6, strength: 0.85 }, // pine trunk
  Green: { map: "dapple", scale: 1.1, strength: 0.85 }, // foliage (amber)
  DarkGreen: { map: "dapple", scale: 1.1, strength: 0.85 },
  Snow: { map: "grain", scale: 1.4, strength: 0.7 },
  Rock: { map: "grain", scale: 1.2, strength: 0.9 },
};

// Clones a model's materials and injects triplanar painted detail into
// each — object-space position + normal come along as varyings, and the
// modulation texture multiplies the material's palette color in the
// fragment shader. No UVs involved anywhere.
function applyPaintedDetail(object: THREE.Object3D): void {
  const textures = getPaintedTextures();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    const patched = materials.map((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return material;
      const detail = DETAIL_BY_MATERIAL[material.name] ?? {
        map: "grain" as const,
        scale: 1.2,
        strength: 0.5,
      };
      const clone = material.clone(); // templates share materials — never mutate
      clone.onBeforeCompile = (shader) => {
        shader.uniforms.detailMap = { value: textures[detail.map] };
        shader.uniforms.detailScale = { value: detail.scale };
        shader.uniforms.detailStrength = { value: detail.strength };
        shader.vertexShader =
          "varying vec3 vObjPos;\nvarying vec3 vObjNormal;\n" +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;",
          );
        shader.fragmentShader =
          "varying vec3 vObjPos;\nvarying vec3 vObjNormal;\nuniform sampler2D detailMap;\nuniform float detailScale;\nuniform float detailStrength;\n" +
          shader.fragmentShader.replace(
            "#include <color_fragment>",
            `#include <color_fragment>
{
  vec3 w = abs(normalize(vObjNormal));
  w = pow(w, vec3(3.0));
  w /= (w.x + w.y + w.z);
  vec3 p = vObjPos * detailScale;
  vec3 tx = texture2D(detailMap, p.zy).rgb;
  vec3 ty = texture2D(detailMap, p.xz).rgb;
  vec3 tz = texture2D(detailMap, p.xy).rgb;
  vec3 detailMod = (tx * w.x + ty * w.y + tz * w.z) * 2.0;
  diffuseColor.rgb *= mix(vec3(1.0), detailMod, detailStrength);
}`,
          );
      };
      // All patched materials share one shader source; let them share the
      // compiled program too instead of falling back to per-material keys.
      clone.customProgramCacheKey = () => "painted-detail";
      return clone;
    });
    child.material = Array.isArray(child.material) ? patched : patched[0]!;
  });
}
