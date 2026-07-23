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
// the snowfield. Adds everything to the scene and returns the pieces that
// follow the run downhill (see syncEnvironment). The renderer comes along
// because the ski trails are carved on the GPU — a height render-target the
// snow shader displaces by (see the realism snow section below).
export function createEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): SlopeEnvironment {
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
  // and the decor lives on the flanks beyond it. The mesh quietly follows
  // the skier's z (see syncEnvironment) — the snow never ends, and its far
  // edge always sits past where the haze fully takes over.
  //
  // REALISM SNOW ROUND 2 (2026-07-23): the snow is *real displaced
  // geometry* now — round 1's bump-map relief read flat under this scene's
  // bright ambient, and its canvas-painted trails read as pixels (see the
  // realism snow section below for the whole design). The mesh is a
  // graded-density grid (fine where the skis carve, coarse on the flanks),
  // vertex-displaced in the shader by a world-pinned height field: dune
  // relief plus the trail depth carved into a GPU render-target. It also
  // CASTS shadows through a displacement-aware depth material, so dunes
  // shade their own hollows — depth the sun draws, not a painted-on hint.
  const trail = createSnowTrail(renderer);
  const slope = new THREE.Mesh(
    createSnowfieldGeometry(),
    createSnowMaterial(trail.target.texture),
  );
  slope.position.z = -SNOWFIELD_LEAD;
  slope.receiveShadow = true;
  slope.castShadow = true;
  slope.customDepthMaterial = createSnowDepthMaterial(trail.target.texture);
  scene.add(slope);

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
  // The window recenters in steps of the vertex grid's fine z spacing, so
  // every vertex always lands on the same world-z lattice — the displaced
  // surface re-samples the height field at identical points and never
  // shimmers as the mesh slides. (The height field itself is sampled by
  // world position in the shader, so nothing else needs pinning.)
  const centerZ =
    Math.round((anchor.z - SNOWFIELD_LEAD) / SNOW_Z_STEP) * SNOW_Z_STEP;
  environment.slope.position.z = centerZ;
  // The sparkle roughness map still rides mesh UVs — pin it to the world as
  // the mesh recenters under it, same trick as round 1.
  const sparkle = getSnowTextures().sparkle;
  sparkle.offset.y = -sparkle.repeat.y * (0.5 + centerZ / SNOWFIELD_LENGTH);
  if (trailInput) updateSnowTrail(environment.trail, anchor, trailInput);
  environment.skyDome.position.copy(camera.position);
  environment.sunBillboard.position
    .copy(camera.position)
    .addScaledVector(SUN_BILLBOARD_DIRECTION, 150);
}

// The snow is displaced geometry now, and these flat markers used to sit
// 1–2 cm above y=0 — lane relief would poke through them. The lift is baked
// into the geometry (mechanics code owns .position and sets its own small
// y), sized to clear the lane's dune amplitude.
const MARKER_LIFT = 0.06;

// The look of a checkpoint: a glacial-ice stripe lying on the snow.
// Mechanics code positions it at the checkpoint's distance.
export function createCheckpointMarker(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(SLOPE_WIDTH, 0.5);
  geometry.translate(0, 0, MARKER_LIFT); // pre-rotation: local +z = world +y
  const marker = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: PALETTE.glacialIce }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.receiveShadow = true;
  return marker;
}

// The look of a chasm: a deep-slate slab spanning the lane (the bible bans
// pure black). Mechanics code sizes the gap and positions it.
export function createChasmMesh(width: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(SLOPE_WIDTH, width);
  geometry.translate(0, 0, MARKER_LIFT); // pre-rotation: local +z = world +y
  const mesh = new THREE.Mesh(
    geometry,
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
// REALISM SNOW — ROUND 2 (2026-07-23): displaced geometry. Round 1 (bump
// map + canvas-painted trails) failed the director's eye — "the snow is
// flat, the trails are too pixelated, there's no depth" — because this
// scene's lighting deliberately pushes ambient close to sunlit white, so a
// bump map's few percent of brightness shift can't read as relief, and a
// 2D color canvas shows raw texels at camera distance. The look to match
// is the director's linked reference, the paid BruteForce Snow & Ice
// shader (Unity asset 221389) — "interactive snow": displaced snow that
// objects carve real deformation trails into via a height map. This is the
// same technique built free and procedural (no image files, no CREDITS
// rows):
//
//   1. The snowfield is a graded-density vertex grid — ~9 cm columns where
//      the skis carve, coarse on the flanks — displaced in the vertex
//      shader by a world-pinned height field: soft dunes (deep drifts on
//      the flanks, groomed nearly flat inside the skiable lane) plus the
//      carved trail depth below.
//   2. Ski trails are carved as REAL depth: every grounded frame stamps a
//      soft capsule brush per ski into a ring-buffer height render-target,
//      MAX-blended so overlapping strokes merge instead of double-carving.
//      The snow shader maps brush coverage onto a groove profile — core
//      sunk CARVE_DEPTH, displaced-snow shoulders pushed up beside it — so
//      grooves have real walls the sun shades: bright on the sun side,
//      snow-shadow blue on the far side. Airborne lifts the pen — jump
//      gaps carve themselves, the speed cue the references show.
//   3. Normals come from finite differences of the full height field
//      (dunes + grooves + fine crust grain) in the fragment shader — far
//      finer than the vertex grid, so shading stays crisp even where the
//      geometry is coarse.
//   4. The snowfield casts shadows through a displacement-aware depth
//      material: dunes shade their own hollows under the long dawn light —
//      depth the sun draws, not a painted-on hint. Hollows and groove
//      interiors also get an occlusion tint toward snow-shadow blue (#2),
//      and trail cores wear carved snow (#3) — the bible's assignment for
//      the inside of ski trails.
//   5. The glitter pass survives from round 1 (it drew no complaint):
//      view-dependent micro-facet sparkle, damped where a groove has
//      broken the crust.

// The carve height map covers the lane plus a margin — skis physically
// can't reach past LATERAL_LIMIT, so the flanks need no trail resolution.
const CARVE_HALF_WIDTH = LANE_EDGE + 1;
const CARVE_TEX_WIDTH = 1024; // across the carve strip: ~2.7 cm per texel
const CARVE_TEX_HEIGHT = 4096; // along the window: ~5.4 cm per texel
// Brush: full carve inside BRUSH_IN of the ski line, feathered to nothing
// at BRUSH_OUT. With the skis 2×SKI_STANCE apart, the feathered skirts
// meet between the grooves as a low pushed-up ridge — like real tracks.
const BRUSH_IN = 0.02;
const BRUSH_OUT = 0.19;
// The groove profile the shader maps brush coverage onto.
const CARVE_DEPTH = 0.13; // the core sinks this far
const CARVE_SHOULDER = 0.045; // pushed-up snow beside the groove
// Dune relief amplitude. The skiable lane reads as a groomed piste
// (small — the skis, markers, and shadows-as-height-cues all want nearly
// flat snow underfoot), the flanks as wind-drifted powder (deep).
const DUNE_AMP_LANE = 0.08;
const DUNE_AMP_FLANK = 0.8;
const DUNE_TILE = 13; // world units per dune-texture tile (~3–6 m dunes)
const GRAIN_TILE = 8; // world units per grain-texture tile
const GRAIN_AMP = 0.05; // fine crust height — feeds normals, not geometry
// Vertex grid spacing: fine inside the carve strip and around the skier,
// coarse elsewhere. SNOW_Z_STEP doubles as the window's recenter snap (see
// syncEnvironment). ~205k vertices — all static; only the shader moves
// them. If a weak GPU ever chokes, these two are the dial.
const SNOW_X_STEP = 0.09;
const SNOW_Z_STEP = 0.2;

// One axis of vertex coordinates from (from, to, step) spans — each span
// subdivides evenly at the nearest count to its requested step, landing
// exactly on the span ends so neighboring spans share a vertex.
function gradedAxis(
  spans: ReadonlyArray<readonly [number, number, number]>,
): number[] {
  const coords: number[] = [spans[0]![0]];
  for (const [from, to, step] of spans) {
    const count = Math.max(1, Math.round((to - from) / step));
    for (let i = 1; i <= count; i++) {
      coords.push(from + ((to - from) * i) / count);
    }
  }
  return coords;
}

// The snowfield grid: flat, +y up (no mesh rotation — keeps the shader's
// local↔world math trivial), UVs matching what the old plane gave so the
// sparkle roughness map pins to the world the same way as before.
function createSnowfieldGeometry(): THREE.BufferGeometry {
  const halfW = SNOWFIELD_WIDTH / 2;
  const halfL = SNOWFIELD_LENGTH / 2;
  const xs = gradedAxis([
    [-halfW, -CARVE_HALF_WIDTH - 3, 1.6],
    [-CARVE_HALF_WIDTH - 3, -CARVE_HALF_WIDTH, 0.5],
    [-CARVE_HALF_WIDTH, CARVE_HALF_WIDTH, SNOW_X_STEP],
    [CARVE_HALF_WIDTH, CARVE_HALF_WIDTH + 3, 0.5],
    [CARVE_HALF_WIDTH + 3, halfW, 1.6],
  ]);
  // Dense z band: ±40 units around the skier, who rides at local
  // +SNOWFIELD_LEAD (the window leads downhill, so that's fixed in mesh
  // space). Grooves further off live in the haze, where the fragment
  // normals carry them fine on coarse geometry.
  const zs = gradedAxis([
    [-halfL, SNOWFIELD_LEAD - 40, 1.0],
    [SNOWFIELD_LEAD - 40, SNOWFIELD_LEAD + 40, SNOW_Z_STEP],
    [SNOWFIELD_LEAD + 40, halfL, 1.0],
  ]);
  const cols = xs.length;
  const rows = zs.length;
  const positions = new Float32Array(cols * rows * 3);
  const normals = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      positions[i * 3] = xs[c]!;
      positions[i * 3 + 2] = zs[r]!;
      normals[i * 3 + 1] = 1;
      uvs[i * 2] = xs[c]! / SNOWFIELD_WIDTH + 0.5;
      uvs[i * 2 + 1] = 0.5 - zs[r]! / SNOWFIELD_LENGTH;
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index[k++] = a;
      index[k++] = d;
      index[k++] = b;
      index[k++] = b;
      index[k++] = d;
      index[k++] = e;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

interface SnowTextures {
  readonly dune: THREE.CanvasTexture; // smooth displacement height, no grain
  readonly grain: THREE.CanvasTexture; // fine multi-scale crust, normals only
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

  // Dune height around neutral 128 — ONLY smooth large shapes, because the
  // displacement scales this up to ±0.4 units on the flanks and any fine
  // speckle would spike. Fine detail lives in `grain` below, which only
  // ever drives normals.
  const dune = makeTexture(256, (ctx) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) {
      softBlob(
        ctx, 256, random() * 256, random() * 256,
        60 + random() * 70, random() < 0.5 ? 62 : 194, 0.6,
      );
    }
    for (let i = 0; i < 22; i++) {
      softBlob(
        ctx, 256, random() * 256, random() * 256,
        24 + random() * 40, random() < 0.5 ? 74 : 182, 0.5,
      );
    }
    for (let i = 0; i < 40; i++) {
      softBlob(
        ctx, 256, random() * 256, random() * 256,
        9 + random() * 18, random() < 0.5 ? 86 : 170, 0.45,
      );
    }
  });

  // Crust grain: round 1's multi-scale relief canvas, now feeding the
  // fragment normals only — soft lumps down to granular top crust.
  const grain = makeTexture(512, (ctx) => {
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

  // Dune and grain are sampled by world position in the shader; only the
  // sparkle roughness map rides mesh UVs and needs a repeat.
  sparkle.repeat.set(SNOWFIELD_WIDTH / 5, SNOWFIELD_LENGTH / 5);

  snowTextures = { dune, grain, sparkle };
  return snowTextures;
}

// The height field, shared by the surface material and its shadow-casting
// depth material. Everything samples by world position, so the field is
// pinned to the mountain no matter where the mesh window sits.
const SNOW_HEIGHT_GLSL = `
uniform sampler2D duneMap;
uniform sampler2D grainMap;
uniform sampler2D carveMap;
float snowDune(vec2 w) {
  float amp = mix(${DUNE_AMP_LANE.toFixed(3)}, ${DUNE_AMP_FLANK.toFixed(3)},
    smoothstep(${LANE_EDGE.toFixed(1)}, 22.0, abs(w.x)));
  return (texture2D(duneMap, w / ${DUNE_TILE.toFixed(1)}).r - 0.5) * amp;
}
float snowCarve(vec2 w) {
  vec2 uv = vec2(
    (w.x + ${CARVE_HALF_WIDTH.toFixed(1)}) / ${(CARVE_HALF_WIDTH * 2).toFixed(1)},
    -w.y / ${SNOWFIELD_LENGTH.toFixed(1)});
  return texture2D(carveMap, uv).r * step(abs(w.x), ${CARVE_HALF_WIDTH.toFixed(1)});
}
float snowCarveCore(float c) { return smoothstep(0.35, 0.95, c); }
float snowProfile(float c) {
  float shoulder = smoothstep(0.03, 0.30, c) - smoothstep(0.30, 0.70, c);
  return shoulder * ${CARVE_SHOULDER.toFixed(3)} - snowCarveCore(c) * ${CARVE_DEPTH.toFixed(3)};
}
float snowHeight(vec2 w) { return snowDune(w) + snowProfile(snowCarve(w)); }
`;

// Fragment-only: the full-detail height (adds crust grain) and its
// finite-difference normal. The epsilon matches the carve map's texel
// size, so groove walls resolve as crisply as the data allows.
const SNOW_NORMAL_GLSL = `
float snowHeightFine(vec2 w) {
  return snowHeight(w)
    + (texture2D(grainMap, w / ${GRAIN_TILE.toFixed(1)}).r - 0.5) * ${GRAIN_AMP.toFixed(3)};
}
vec3 snowNormal(vec2 w) {
  float e = 0.05;
  float x0 = snowHeightFine(w - vec2(e, 0.0));
  float x1 = snowHeightFine(w + vec2(e, 0.0));
  float z0 = snowHeightFine(w - vec2(0.0, e));
  float z1 = snowHeightFine(w + vec2(0.0, e));
  return normalize(vec3(x0 - x1, 2.0 * e, z0 - z1));
}
`;

// Vertex-shader displacement, shared verbatim by the surface material and
// the shadow depth material. The mesh's modelMatrix is a pure translation,
// so a world-space height offset is a local-space one too.
const SNOW_DISPLACE_GLSL = `
vec4 snowW = modelMatrix * vec4(position, 1.0);
float snowH = snowHeight(snowW.xz);
transformed.y += snowH;
`;

function createSnowMaterial(
  carveTexture: THREE.Texture,
): THREE.MeshStandardMaterial {
  const snow = getSnowTextures();
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.sunlitSnow,
    roughnessMap: snow.sparkle,
    roughness: 1, // the map carries the value; 1 = don't scale it down
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.duneMap = { value: snow.dune };
    shader.uniforms.grainMap = { value: snow.grain };
    shader.uniforms.carveMap = { value: carveTexture };
    shader.uniforms.sunDir = { value: SUN_DIRECTION.clone() };
    shader.vertexShader =
      SNOW_HEIGHT_GLSL +
      "varying vec3 vSnowWorld;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
${SNOW_DISPLACE_GLSL}
vSnowWorld = vec3(snowW.x, snowW.y + snowH, snowW.z);`,
      );
    shader.fragmentShader =
      SNOW_HEIGHT_GLSL +
      SNOW_NORMAL_GLSL +
      "varying vec3 vSnowWorld;\nuniform vec3 sunDir;\n" +
      shader.fragmentShader
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  float carve = snowCarve(vSnowWorld.xz);
  float core = snowCarveCore(carve);
  // The inside of a ski trail is carved snow (#3) — the bible's assignment.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.686, 0.761, 0.871), core * 0.7);
  // Occlusion: dune hollows and groove interiors tint toward snow-shadow
  // blue (#2) — multiplied under the lighting, so sun and shade still play
  // on top. This is the depth cue ambient-bright lighting alone can't draw.
  float hollow = clamp(-snowDune(vSnowWorld.xz) * 2.2, 0.0, 1.0);
  float ao = clamp(hollow * 0.45 + core * 0.4 + smoothstep(0.03, 0.35, carve) * 0.15, 0.0, 1.0);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.851, 0.912, 1.0), ao);
}`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(snowNormal(vSnowWorld.xz), 0.0)).xyz);`,
        )
        .replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
{
  // Glitter, kept from round 1 (it drew no complaint): every ~3.5 cm cell
  // owns one random mirror micro-facet; the ones aligned between sun and
  // camera flash sun-glow white, so the field twinkles as the run moves.
  // Fades by ~45 units (distant cells go sub-pixel), damped where a groove
  // has broken the sparkling crust. Known simplification: ignores cast
  // shadows (parked in IDEAS.md).
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
  float crust = 1.0 - 0.7 * snowCarveCore(snowCarve(vSnowWorld.xz));
  // Sun-glow tinted (#FFF4DA) — the bible's brightest value.
  reflectedLight.directSpecular += vec3(1.0, 0.957, 0.855) * (flash * gate * fade * crust * 1.6);
}`,
        );
  };
  // Every compile of this material is the same program — share it.
  material.customProgramCacheKey = () => "realism-snow";
  return material;
}

// The shadow-casting side of the displacement: the sun's depth pass
// renders the snow through this material, so dunes and groove walls really
// occlude the light (self-shadowed hollows) instead of only drawing darker.
function createSnowDepthMaterial(
  carveTexture: THREE.Texture,
): THREE.MeshDepthMaterial {
  const snow = getSnowTextures();
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.duneMap = { value: snow.dune };
    shader.uniforms.grainMap = { value: snow.grain };
    shader.uniforms.carveMap = { value: carveTexture };
    shader.vertexShader =
      SNOW_HEIGHT_GLSL +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
${SNOW_DISPLACE_GLSL}`,
      );
  };
  material.customProgramCacheKey = () => "realism-snow-depth";
  return material;
}

// ---------------------------------------------------------------------------
// The trail carve map: a single-channel height render-target riding the
// snowfield window as a ring buffer along z (texture v = -z/length with
// wrap, so grooves persist in place as the window slides past). Rows are
// reclaimed (cleared) as they re-enter at the leading edge — ~160 units
// downhill of the skier, fully swallowed by the haze. Stamping happens on
// the GPU: one soft capsule brush per ski per grounded frame, MAX-blended
// so overlapping strokes merge instead of double-carving, drawn three
// times a window apart so strokes crossing the ring seam land on both
// ends. Round 1 painted colored strokes on a canvas and re-uploaded ~4 MB
// every frame; this writes a few uniforms and lets the snow shader read
// real depth back out.

interface TrailPen {
  /** Last stamped ski position in ring space (x, -z), or null = pen up. */
  curr: THREE.Vector2 | null;
}

interface TrailStamp {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
}

export interface SnowTrail {
  readonly renderer: THREE.WebGLRenderer;
  readonly target: THREE.WebGLRenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** One brush per ski, times three ring-seam copies. */
  readonly stamps: ReadonlyArray<
    readonly [TrailStamp, TrailStamp, TrailStamp]
  >;
  readonly pens: [TrailPen, TrailPen];
  /** Furthest-downhill z whose rows have been reclaimed so far. */
  leadingZ: number | null;
}

// The brush: a quad the vertex shader stretches along the stamped segment
// (endpoints arrive as uniforms — the geometry never changes), and a
// fragment writing soft capsule coverage: 1 on the ski line feathering to
// 0 at BRUSH_OUT. The snow shader maps that coverage onto the groove
// profile, so the brush only ever encodes "how carved", never a color.
const BRUSH_VERTEX = `
uniform vec2 segA;
uniform vec2 segB;
uniform float ringOffset;
varying vec2 vBrushPos;
void main() {
  vec2 seg = segB - segA;
  float len = length(seg);
  vec2 along = len > 1e-5 ? seg / len : vec2(0.0, 1.0);
  vec2 across = vec2(-along.y, along.x);
  vec2 p = (segA + segB) * 0.5
    + along * position.x * (len + ${(BRUSH_OUT * 2).toFixed(3)})
    + across * position.y * ${(BRUSH_OUT * 2).toFixed(3)};
  vBrushPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, p.y + ringOffset, 0.0, 1.0);
}
`;
const BRUSH_FRAGMENT = `
uniform vec2 segA;
uniform vec2 segB;
varying vec2 vBrushPos;
void main() {
  vec2 seg = segB - segA;
  vec2 toP = vBrushPos - segA;
  float t = clamp(dot(toP, seg) / max(dot(seg, seg), 1e-9), 0.0, 1.0);
  float d = distance(toP, seg * t);
  gl_FragColor = vec4(1.0 - smoothstep(${BRUSH_IN.toFixed(3)}, ${BRUSH_OUT.toFixed(3)}, d), 0.0, 0.0, 1.0);
}
`;

function createSnowTrail(renderer: THREE.WebGLRenderer): SnowTrail {
  const target = new THREE.WebGLRenderTarget(
    CARVE_TEX_WIDTH,
    CARVE_TEX_HEIGHT,
    {
      format: THREE.RedFormat, // height only — one byte per texel
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    },
  );
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.RepeatWrapping; // the ring dimension
  const scene = new THREE.Scene();
  // Ring space: x across the carve strip, y = -worldZ wrapped into one
  // window length — downhill grows y, matching the texture's v axis.
  const camera = new THREE.OrthographicCamera(
    -CARVE_HALF_WIDTH,
    CARVE_HALF_WIDTH,
    SNOWFIELD_LENGTH,
    0,
    -1,
    1,
  );
  const quad = new THREE.PlaneGeometry(1, 1);
  const makeStamp = (): TrailStamp => {
    const material = new THREE.ShaderMaterial({
      vertexShader: BRUSH_VERTEX,
      fragmentShader: BRUSH_FRAGMENT,
      uniforms: {
        segA: { value: new THREE.Vector2() },
        segB: { value: new THREE.Vector2() },
        ringOffset: { value: 0 },
      },
      // MAX blending: re-stamping carved snow keeps the deeper carve.
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new THREE.Mesh(quad, material);
    mesh.visible = false;
    mesh.frustumCulled = false; // the vertex shader places it, not .position
    scene.add(mesh);
    return { mesh, material };
  };
  const stamps = [
    [makeStamp(), makeStamp(), makeStamp()],
    [makeStamp(), makeStamp(), makeStamp()],
  ] as const;
  return {
    renderer,
    target,
    scene,
    camera,
    stamps,
    pens: [{ curr: null }, { curr: null }],
    leadingZ: null,
  };
}

const fract = (v: number): number => v - Math.floor(v);
// World z → ring row in carve-map pixels.
const ringRowPx = (z: number): number =>
  fract(-z / SNOWFIELD_LENGTH) * CARVE_TEX_HEIGHT;

const scratchClearColor = new THREE.Color();

// Called every frame from syncEnvironment. Reclaims ring rows entering the
// window, then stamps one brush segment per ski while the skis are down.
function updateSnowTrail(
  trail: SnowTrail,
  anchor: THREE.Vector3,
  input: SnowTrailInput,
): void {
  const { renderer, target } = trail;

  // Reclaim: rows newly entering at the leading (downhill, haze-hidden)
  // edge still hold grooves from one ring-wrap ago — wipe them. When the
  // window recedes a little (a respawn), leadingZ stays put: the rows
  // re-entering uphill hold the *previous pass's* real grooves, which is
  // exactly what should still be on the snow there. A jump bigger than the
  // whole window in EITHER direction gets a full clear — after e.g. a
  // fresh run from the top, the surviving rows would be one-wrap-stale
  // grooves at wrong world positions (a bug round 1 shipped with, fixed
  // here: it only cleared on downhill jumps).
  let fullClear = false;
  const scissors: Array<readonly [number, number]> = [];
  const lead = anchor.z - SNOWFIELD_LEAD - SNOWFIELD_LENGTH / 2;
  if (
    trail.leadingZ === null ||
    Math.abs(trail.leadingZ - lead) > SNOWFIELD_LENGTH
  ) {
    fullClear = true;
    trail.leadingZ = lead;
  } else if (lead < trail.leadingZ) {
    const spanPx = Math.min(
      CARVE_TEX_HEIGHT,
      Math.ceil(
        ((trail.leadingZ - lead) / SNOWFIELD_LENGTH) * CARVE_TEX_HEIGHT,
      ) + 2,
    );
    const startPx =
      (((Math.floor(ringRowPx(trail.leadingZ)) - 1) % CARVE_TEX_HEIGHT) +
        CARVE_TEX_HEIGHT) %
      CARVE_TEX_HEIGHT;
    if (startPx + spanPx <= CARVE_TEX_HEIGHT) {
      scissors.push([startPx, spanPx]);
    } else {
      scissors.push(
        [startPx, CARVE_TEX_HEIGHT - startPx],
        [0, spanPx - (CARVE_TEX_HEIGHT - startPx)],
      );
    }
    trail.leadingZ = lead;
  }

  // The pens: one per ski, at the stance offset perpendicular to the
  // heading. With travel = (sin h, -cos h) in xz (the sim's convention),
  // perpendicular is (cos h, sin h).
  let anyStamp = false;
  for (const copies of trail.stamps) {
    for (const stamp of copies) stamp.mesh.visible = false;
  }
  if (!input.grounded) {
    // Pen up: airborne or crashed. The groove break is the jump, visibly.
    for (const pen of trail.pens) pen.curr = null;
  } else {
    const perpX = Math.cos(input.heading);
    const perpZ = Math.sin(input.heading);
    for (const [i, side] of [-1, 1].entries()) {
      const pen = trail.pens[i]!;
      const pos = new THREE.Vector2(
        anchor.x + perpX * side * SKI_STANCE,
        -(anchor.z + perpZ * side * SKI_STANCE),
      );
      if (pen.curr === null || pen.curr.distanceTo(pos) > 4) {
        pen.curr = pos; // touchdown, or a teleport (respawn safety net)
      } else if (pen.curr.distanceTo(pos) > 0.012) {
        // Stamp the segment at its ring position and one window either
        // way, so a stroke crossing the seam paints both ends.
        const base = Math.floor(pos.y / SNOWFIELD_LENGTH) * SNOWFIELD_LENGTH;
        for (const [k, offset] of [
          -base,
          -base + SNOWFIELD_LENGTH,
          -base - SNOWFIELD_LENGTH,
        ].entries()) {
          const stamp = trail.stamps[i]![k]!;
          stamp.mesh.visible = true;
          (stamp.material.uniforms.segA!.value as THREE.Vector2).copy(
            pen.curr,
          );
          (stamp.material.uniforms.segB!.value as THREE.Vector2).copy(pos);
          stamp.material.uniforms.ringOffset!.value = offset;
        }
        pen.curr = pos;
        anyStamp = true;
      } // else: standing still — don't restamp in place
    }
  }

  if (!fullClear && scissors.length === 0 && !anyStamp) return;

  // The GPU pass: clears first, then the stamps — restoring renderer state
  // for the main render that follows this sync.
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.getClearColor(scratchClearColor);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  if (fullClear) renderer.clear(true, false, false);
  for (const [y, h] of scissors) {
    renderer.setScissor(0, y, CARVE_TEX_WIDTH, h);
    renderer.setScissorTest(true);
    renderer.clear(true, false, false);
  }
  renderer.setScissorTest(false);
  if (anyStamp) {
    renderer.autoClear = false;
    renderer.render(trail.scene, trail.camera);
    renderer.autoClear = prevAutoClear;
  }
  renderer.setClearColor(scratchClearColor, prevAlpha);
  renderer.setRenderTarget(prevTarget);
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
