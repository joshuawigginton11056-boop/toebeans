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

// Direction from the scene toward the sun: nearly straight down-lane (you
// ski into the light, which is what makes the haze glow) and low enough
// (~26°) that shadows stretch long across the snow. The azimuth is cheated
// only slightly left — shadow fix, 2026-07-23: at the old 22°-left azimuth
// the giant colonnade's 100m shadows raked *across* the lane and kept it in
// near-continuous shade; near head-on they rake uphill along the flanks
// instead, and the lane keeps its sun (director ask: light must get
// through).
const SUN_DIRECTION = new THREE.Vector3(-0.15, 0.5, -1).normalize();

// The shadow camera's screen axes, in world space — same basis lookAt()
// builds (z toward the sun, x = up×z, y = z×x). syncEnvironment snaps the
// camera's travel to whole shadow-map texels along these two axes; the
// leftover slides along the light direction, which a directional shadow
// can't see. Without the snap the map resampled every silhouette each
// frame as it tracked the skier, and every shadow edge crawled (the other
// half of the "shadows move" bug, 2026-07-23).
const SHADOW_RIGHT = new THREE.Vector3()
  .crossVectors(THREE.Object3D.DEFAULT_UP, SUN_DIRECTION)
  .normalize();
const SHADOW_UP = new THREE.Vector3().crossVectors(SUN_DIRECTION, SHADOW_RIGHT);
const shadowAnchor = new THREE.Vector3();

// Where the *visible* sun disc hangs: same azimuth as the light, but cheated
// down to just above the horizon so it's actually in frame — the camera looks
// downhill, so the real 25° sun sits above the top edge of the screen. A
// horizon sun with long shadows still reads as one coherent dawn.
const SUN_BILLBOARD_DIRECTION = new THREE.Vector3(
  -0.15,
  0.075,
  -1,
).normalize();

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
  // Depth range must swallow every caster inside the ±55 light-space box —
  // the giants sit up to ~125m downhill of the anchor while still in the
  // box, and their ~100m shadows reach the skier. With the old 70-unit sun
  // distance and far=160 those trees fell behind the near plane and their
  // shadows *popped in* on approach (part of the "shadows move" bug,
  // 2026-07-23). Sun distance 120 (see syncEnvironment) + far=200 keeps
  // them all in the map.
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
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

  // Loose snow: the rooster-tail spray off the skis and the ambient
  // screen flurries (see the VISUAL EFFECTS section below).
  createSnowEffects(scene);

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
  // Texel-snap the sun's tracking (see SHADOW_RIGHT above): quantize the
  // anchor's light-space x/y to the shadow map's texel grid so the ortho
  // camera only ever moves in whole-texel steps and shadows hold still.
  const shadow = environment.sun.shadow;
  const texel =
    (shadow.camera.right - shadow.camera.left) / shadow.mapSize.x;
  shadowAnchor.copy(anchor);
  for (const axis of [SHADOW_RIGHT, SHADOW_UP]) {
    const along = shadowAnchor.dot(axis);
    shadowAnchor.addScaledVector(
      axis,
      Math.round(along / texel) * texel - along,
    );
  }
  environment.sun.target.position.copy(shadowAnchor);
  // 120 units back (was 70): far enough that casters ~125m downhill still
  // sit past the near plane — see the depth-range note in createEnvironment.
  environment.sun.position
    .copy(shadowAnchor)
    .addScaledVector(SUN_DIRECTION, 120);
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
  // The decor scatter is a recycling window that follows the run — see
  // updateSlopeDecor below.
  updateSlopeDecor(anchor.z);
  environment.skyDome.position.copy(camera.position);
  environment.sunBillboard.position
    .copy(camera.position)
    .addScaledVector(SUN_BILLBOARD_DIRECTION, 150);
  // Loose snow — spray kicked off the skis, flurries drifting past the
  // lens. Reads the skier's speed straight off the anchor's motion (no new
  // seam field) and its own frame clock; see updateSnowEffects.
  updateSnowEffects(anchor, camera, trailInput);
}

// The snow is displaced geometry now, and these flat markers used to sit
// 1–2 cm above y=0 — lane relief would poke through them. The lift is baked
// into the geometry (mechanics code owns .position and sets its own small
// y), sized to clear the lane's dune amplitude.
// Raised 0.06 → 0.12 with the lane lump amplitude (refinement round,
// 2026-07-23 follow-up): lane relief maxes at dune 0.04 + lump 0.06.
const MARKER_LIFT = 0.12;

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
// Along the window: ~2.7 cm per texel, matching the width so diagonal
// grooves (turns) sample as cleanly as straight ones — at half this, carved
// turns showed a bilinear staircase (director callout, 2026-07-23).
const CARVE_TEX_HEIGHT = 8192;
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
// Mid-scale lumps — the "random lumpiness" between dune and grain
// (director ask, 2026-07-23): the same smooth dune canvas re-sampled at a
// small tile, in the real geometry, so the lumps sit in silhouettes and
// self-shadow. Kept subtle in the lane (groomed piste, and the lane
// surface must stay under the markers' 6 cm lift).
const LUMP_TILE = 4.3;
// Refinement round (2026-07-23 follow-up): the original 0.05/0.16 sat
// below the visibility floor — the crank test (0.3/0.6) proved the
// mechanism reads, so these settle at roughly double the originals: lane
// lumps the trail visibly dips through, flank lumps that hold their own
// against the ±40 cm dunes. MARKER_LIFT rose with the lane amplitude.
const LUMP_AMP_LANE = 0.12;
const LUMP_AMP_FLANK = 0.32;
const GRAIN_TILE = 8; // world units per grain-texture tile
const GRAIN_AMP = 0.05; // fine crust height — feeds normals, not geometry
// A second, chunkier grain octave (same director ask) — shading-only
// lumpiness at the half-meter scale.
const GRAIN2_TILE = 2.6;
// Same refinement round: 0.07 of shading-only relief was invisible under
// this scene's near-white ambient (round 1's bump-map lesson repeating) —
// the crank test's 0.3 read as dense crusty mottling, so it lands here.
const GRAIN2_AMP = 0.2;
// Vertex grid spacing: fine inside the carve strip and around the skier,
// coarse elsewhere. SNOW_Z_STEP doubles as the window's recenter snap (see
// syncEnvironment). ~305k vertices — all static; only the shader moves
// them. If a weak GPU ever chokes, these two are the dial. Z sits near the
// X spacing on purpose: with z at 0.2 the vertex grid staircased the
// carved grooves whenever they ran diagonally (turns).
const SNOW_X_STEP = 0.09;
const SNOW_Z_STEP = 0.12;

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
float snowLump(vec2 w) {
  float amp = mix(${LUMP_AMP_LANE.toFixed(3)}, ${LUMP_AMP_FLANK.toFixed(3)},
    smoothstep(${LANE_EDGE.toFixed(1)}, 22.0, abs(w.x)));
  return (texture2D(duneMap, w / ${LUMP_TILE.toFixed(1)}).r - 0.5) * amp;
}
float snowHeight(vec2 w) {
  return snowDune(w) + snowLump(w) + snowProfile(snowCarve(w));
}
// The height the GEOMETRY is displaced by: same field, but the groove
// profile is band-limited to the vertex grid first. The shoulder ridge and
// core wall are ~one grid cell wide — a diagonal groove crossing the grid
// raw gets alternately caught and missed by vertices, a moiré sawtooth
// whose period stretches to 20-30 cm at shallow angles (the director's
// "weird wavy/jagged when turning": isotropic spacing alone couldn't fix a
// sub-grid feature). A 3x3 tent filter spanning one cell keeps frequencies
// the grid can't represent out of the mesh — silhouettes and the shadow
// pass go smooth, while fragment normals / carve color / AO keep reading
// the sharp field, so the carved look the verdict approved is untouched.
float snowHeightGeom(vec2 w) {
  vec2 e = vec2(${SNOW_X_STEP.toFixed(3)}, ${SNOW_Z_STEP.toFixed(3)});
  float p = snowProfile(snowCarve(w)) * 4.0;
  p += snowProfile(snowCarve(w + vec2(e.x, 0.0))) * 2.0;
  p += snowProfile(snowCarve(w - vec2(e.x, 0.0))) * 2.0;
  p += snowProfile(snowCarve(w + vec2(0.0, e.y))) * 2.0;
  p += snowProfile(snowCarve(w - vec2(0.0, e.y))) * 2.0;
  p += snowProfile(snowCarve(w + e)) * 1.0;
  p += snowProfile(snowCarve(w - e)) * 1.0;
  p += snowProfile(snowCarve(w + vec2(e.x, -e.y))) * 1.0;
  p += snowProfile(snowCarve(w - vec2(e.x, -e.y))) * 1.0;
  return snowDune(w) + snowLump(w) + p / 16.0;
}
`;

// Fragment-only: the full-detail height (adds crust grain) and its
// finite-difference normal. The epsilon matches the carve map's texel
// size, so groove walls resolve as crisply as the data allows.
const SNOW_NORMAL_GLSL = `
float snowHeightFine(vec2 w) {
  return snowHeight(w)
    + (texture2D(grainMap, w / ${GRAIN_TILE.toFixed(1)}).r - 0.5) * ${GRAIN_AMP.toFixed(3)}
    + (texture2D(grainMap, w / ${GRAIN2_TILE.toFixed(1)}).r - 0.5) * ${GRAIN2_AMP.toFixed(3)};
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
float snowH = snowHeightGeom(snowW.xz);
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
  float hollow = clamp(-(snowDune(vSnowWorld.xz) + snowLump(vSnowWorld.xz)) * 2.2, 0.0, 1.0);
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
// VISUAL EFFECTS — loose snow (slope-vis, 2026-07-23). Two particle systems,
// both DESIGN.md "speed is visible" / "snow remembers" callouts and the
// carve-spray idea parked in IDEAS.md:
//
//   1. SPRAY — the rooster tail kicked off the skis. Emits from the two ski
//      contacts while grounded and moving, more the faster you go and the
//      harder you carve; particles fly up-and-back, fall under gravity, and
//      fade. The carved groove is the snow that *stays*; this is the snow
//      that *flies*.
//   2. FLURRIES — loose flakes drifting past the camera. Gusty (long calm
//      stretches, the occasional swelling patch) and stronger when zoomed in
//      — a flake right by the lens sells "you're down in it". Recycled in a
//      world-axis box that rides the camera, drifting relative to it so they
//      streak past as the run picks up speed.
//
// Both stay inside slope-visuals territory: no seam change. The skier's
// speed is read from the anchor's frame-to-frame motion (mechanics already
// moves it), and dt comes from an internal clock — nothing new crosses from
// skiRender.ts. All procedural: one soft-dot canvas, no image files.

// Spray tuning — a fine billowing powder plume (director reference, 2026-07-23:
// snowboard/ski powder sprays). The look is a *cloud*, so the numbers are
// "many, tiny, faint, slow": thousands of small low-alpha grains that expand
// and hang like real powder rather than a few ballistic blobs. Speeds are
// world units/sec; the sim cruises ~8, boosts ~16 (BASE_SPEED / BOOST_SPEED).
const SPRAY_MAX = 2800; // big pool — a hard fast carve fills most of it
const SPRAY_MIN_SPEED = 2.5; // below this the skis just glide — no kick-up
const SPRAY_FULL_SPEED = 14; // spray saturates around here
const SPRAY_BASE_RATE = 1600; // grains/sec at full spray, both skis
const SPRAY_LIFE = 0.7; // seconds — powder hangs before it settles
const SPRAY_LIFE_VAR = 0.3;
// Powder is light: weak gravity, strong air drag, so the plume decelerates
// into a floating billow instead of arcing like thrown sand.
const SPRAY_GRAVITY = 2.6;
const SPRAY_DRAG = 2.2; // per-second velocity damping (air resistance)
const SPRAY_TURB = 2.0; // random roil that keeps the cloud from looking rigid
const SPRAY_GROW = 2.4; // each grain expands to ~this× as it billows out
const SPRAY_PEAK_ALPHA = 0.38; // faint per grain — density builds the body
// A respawn teleports the anchor a whole run in one frame — that reads as an
// absurd speed. Anything past this is a jump, not skiing: emit nothing.
const SPRAY_TELEPORT_SPEED = 40;

// Flurry tuning. The recycle box is world-axis-aligned and centered on the
// camera, so flakes surround it no matter which way the look points.
const FLURRY_MAX = 300;
const FLURRY_HALF_X = 9;
const FLURRY_HALF_Z = 9;
const FLURRY_UP = 5;
const FLURRY_DOWN = 4;
const FLURRY_FALL = 0.7; // world units/sec of gentle settling
const FLURRY_WIND_X = 0.5;

// Both systems draw as soft round sprites through this one shader. Point size
// is world-radius attenuated to pixels; a near-camera fade keeps a flake from
// ever splatting full-screen across the lens (only flurries get that close —
// spray always sits out at the skier). Fog is applied manually (a plain
// ShaderMaterial gets none of three's auto-fog): spray melts into the haze at
// a far zoom, flurries never do (they live right at the camera).
const PARTICLE_VERT = `
attribute float aSize;
attribute float aAlpha;
uniform float sizeScale;
uniform float fogNear;
uniform float fogFar;
varying float vAlpha;
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.001);
  gl_PointSize = clamp(aSize * sizeScale / dist, 1.0, 140.0);
  gl_Position = projectionMatrix * mv;
  // Fade points hugging the lens (< ~1.3 units) so a flake never flashes the
  // whole screen white; spray is always farther out, so it's untouched.
  vAlpha = aAlpha * smoothstep(0.15, 1.3, dist);
  vFog = 1.0 - smoothstep(fogNear, fogFar, dist);
}
`;
const PARTICLE_FRAG = `
uniform sampler2D map;
uniform vec3 color;
uniform float globalAlpha;
varying float vAlpha;
varying float vFog;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vAlpha * vFog * globalAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color, a);
}
`;

let particleDot: THREE.CanvasTexture | null = null;

// The soft dot both systems sprite: white, full-ish core feathering to zero.
// Only its alpha is used, so colorspace is irrelevant here.
function getParticleDot(): THREE.CanvasTexture {
  if (particleDot) return particleDot;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2,
  );
  // A soft wispy falloff with NO flat core — a hard core read as an "orb"
  // (director callout). Each grain is faint; the powder plume's body comes
  // from thousands of them overlapping, the way real spray builds volume.
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(0.55, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  particleDot = new THREE.CanvasTexture(canvas);
  return particleDot;
}

// World-radius → pixels: half the viewport height over tan(halfFov). The
// camera's fov is the renderer default 50°; recomputed on resize below.
function particleSizeScale(): number {
  return (0.5 * window.innerHeight) / Math.tan((50 * Math.PI) / 180 / 2);
}

function createSnowParticleMaterial(opts: {
  fogNear: number;
  fogFar: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: getParticleDot() },
      // Sunlit snow #F8F5EF as straight sRGB components: a plain ShaderMaterial
      // writes gl_FragColor verbatim to the sRGB framebuffer (three appends no
      // output-encoding to custom shaders), so these land as the palette color.
      color: { value: new THREE.Vector3(0xf8 / 255, 0xf5 / 255, 0xef / 255) },
      sizeScale: { value: particleSizeScale() },
      fogNear: { value: opts.fogNear },
      fogFar: { value: opts.fogFar },
      globalAlpha: { value: 1 },
    },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false, // soft snow blends over the scene; depth-test still on
  });
}

interface SpraySystem {
  readonly points: THREE.Points;
  readonly positions: Float32Array;
  readonly sizes: Float32Array; // the DISPLAYED size (grows over life)
  readonly spawnSize: Float32Array; // the size at birth, before billowing
  readonly alphas: Float32Array;
  readonly vel: Float32Array; // 3 per particle
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  cursor: number;
  emitAccum: number; // fractional particles carried between frames
}

interface FlurrySystem {
  readonly points: THREE.Points;
  readonly positions: Float32Array;
  readonly offset: Float32Array; // 3 per flake, camera-relative, world axes
  readonly material: THREE.ShaderMaterial;
}

let spray: SpraySystem | null = null;
let flurry: FlurrySystem | null = null;

// Per-frame skier/camera memory (module-level, like decorState/snowTextures).
const effectsClock = new THREE.Clock();
const prevAnchor = new THREE.Vector3();
let haveAnchor = false;
const prevCamPos = new THREE.Vector3();
let haveCam = false;
let flurryTime = 0;

function createSnowEffects(scene: THREE.Scene): void {
  // --- Spray: an empty pool, filled as the skis carve ---
  const sPos = new Float32Array(SPRAY_MAX * 3);
  const sSize = new Float32Array(SPRAY_MAX);
  const sAlpha = new Float32Array(SPRAY_MAX); // starts all-0 = nothing drawn
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage),
  );
  sGeo.setAttribute(
    "aSize",
    new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage),
  );
  sGeo.setAttribute(
    "aAlpha",
    new THREE.BufferAttribute(sAlpha, 1).setUsage(THREE.DynamicDrawUsage),
  );
  const sMat = createSnowParticleMaterial({ fogNear: 45, fogFar: 150 });
  const sPoints = new THREE.Points(sGeo, sMat);
  sPoints.frustumCulled = false; // the shader places points; bounds are stale
  sPoints.renderOrder = 3;
  scene.add(sPoints);
  spray = {
    points: sPoints,
    positions: sPos,
    sizes: sSize,
    spawnSize: new Float32Array(SPRAY_MAX),
    alphas: sAlpha,
    vel: new Float32Array(SPRAY_MAX * 3),
    life: new Float32Array(SPRAY_MAX),
    maxLife: new Float32Array(SPRAY_MAX),
    cursor: 0,
    emitAccum: 0,
  };

  // --- Flurries: pre-scattered in the recycle box (seeded, though they drift
  // immediately, so the seed only fixes the very first frame) ---
  const random = makeRandom(20260723);
  const fPos = new Float32Array(FLURRY_MAX * 3);
  const fSize = new Float32Array(FLURRY_MAX);
  const fAlpha = new Float32Array(FLURRY_MAX);
  const fOff = new Float32Array(FLURRY_MAX * 3);
  for (let i = 0; i < FLURRY_MAX; i++) {
    fOff[i * 3] = (random() * 2 - 1) * FLURRY_HALF_X;
    fOff[i * 3 + 1] = -FLURRY_DOWN + random() * (FLURRY_UP + FLURRY_DOWN);
    fOff[i * 3 + 2] = (random() * 2 - 1) * FLURRY_HALF_Z;
    fSize[i] = 0.02 + random() * 0.05;
    fAlpha[i] = 0.4 + random() * 0.6; // per-flake base, scaled by the gust
  }
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(fPos, 3).setUsage(THREE.DynamicDrawUsage),
  );
  fGeo.setAttribute("aSize", new THREE.BufferAttribute(fSize, 1));
  fGeo.setAttribute("aAlpha", new THREE.BufferAttribute(fAlpha, 1));
  // Fog off (near/far far past anything): flurries live at the lens.
  const fMat = createSnowParticleMaterial({ fogNear: 9000, fogFar: 10000 });
  fMat.uniforms.globalAlpha!.value = 0; // the gust brings them in
  const fPoints = new THREE.Points(fGeo, fMat);
  fPoints.frustumCulled = false;
  fPoints.renderOrder = 4;
  scene.add(fPoints);
  flurry = { points: fPoints, positions: fPos, offset: fOff, material: fMat };

  window.addEventListener("resize", () => {
    const s = particleSizeScale();
    sMat.uniforms.sizeScale!.value = s;
    fMat.uniforms.sizeScale!.value = s;
  });
}

function smoothstep01(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Wrap v into [lo, hi) — the flurry recycle, so a flake leaving one face of
// the box re-enters the opposite one.
function wrapRange(v: number, lo: number, hi: number): number {
  const r = hi - lo;
  return lo + (((v - lo) % r) + r) % r;
}

// Called every frame from syncEnvironment. Derives the skier's world speed
// from the anchor's motion (no seam field needed), then drives both systems.
function updateSnowEffects(
  anchor: THREE.Vector3,
  camera: THREE.Camera,
  trailInput?: SnowTrailInput,
): void {
  const dt = Math.min(0.05, effectsClock.getDelta()); // clamp tab-refocus jumps
  if (dt <= 0) return;

  let speed = 0;
  let velX = 0;
  let velZ = 0;
  if (haveAnchor) {
    velX = (anchor.x - prevAnchor.x) / dt;
    velZ = (anchor.z - prevAnchor.z) / dt;
    speed = Math.hypot(velX, velZ);
    if (speed > SPRAY_TELEPORT_SPEED) {
      speed = 0; // a respawn/teleport, not a run — don't spray a burst
      velX = 0;
      velZ = 0;
    }
  }
  prevAnchor.copy(anchor);
  haveAnchor = true;

  if (spray) updateSpray(dt, anchor, speed, velX, velZ, trailInput);
  if (flurry) updateFlurries(dt, camera, anchor);
}

function updateSpray(
  dt: number,
  anchor: THREE.Vector3,
  speed: number,
  velX: number,
  velZ: number,
  trailInput?: SnowTrailInput,
): void {
  const s = spray!;
  const grounded = trailInput?.grounded ?? false;
  const heading = trailInput?.heading ?? 0;

  if (grounded && speed > SPRAY_MIN_SPEED) {
    const speedF = Math.min(
      1,
      (speed - SPRAY_MIN_SPEED) / (SPRAY_FULL_SPEED - SPRAY_MIN_SPEED),
    );
    // How sideways the motion is: a hard carve throws its velocity across the
    // fall line, which both fans the spray wider and kicks up more of it.
    const sideF = speed > 0.01 ? Math.min(1, Math.abs(velX) / speed) : 0;
    const inv = 1 / Math.max(speed, 0.001);
    const tx = velX * inv; // travel direction (unit, xz)
    const tz = velZ * inv;
    const px = -tz; // across the travel direction
    const pz = tx;
    // The two ski contacts, offset perpendicular to the heading like the
    // trail pens do.
    const perpX = Math.cos(heading);
    const perpZ = Math.sin(heading);

    // The ski axis (which way the skis point) — spray kicks off the edge
    // *along the ski*, so grains are spread down the ski toward the tail, not
    // bunched at a point under the boots.
    const skiFwdX = Math.sin(heading);
    const skiFwdZ = -Math.cos(heading);

    s.emitAccum += SPRAY_BASE_RATE * speedF * (1 + 1.4 * sideF) * dt;
    let n = Math.floor(s.emitAccum);
    s.emitAccum -= n;
    while (n-- > 0) {
      const ski = Math.random() < 0.5 ? -1 : 1;
      emitSprayParticle(
        anchor, ski, perpX, perpZ, skiFwdX, skiFwdZ, tx, tz, px, pz, speedF, sideF,
      );
    }
  }

  // Integrate the live grains and write their attributes. Powder physics:
  // weak gravity, strong air drag, and a little turbulence, so each grain
  // decelerates and floats — the plume billows and hangs. Each grain also
  // expands (SPRAY_GROW) and thins (alpha → 0) as it ages, so the cloud
  // swells and dissipates like real spray instead of vanishing as dots.
  const { positions, vel, life, maxLife, sizes, spawnSize, alphas } = s;
  const drag = Math.max(0, 1 - SPRAY_DRAG * dt);
  for (let i = 0; i < SPRAY_MAX; i++) {
    if (life[i]! <= 0) {
      if (alphas[i] !== 0) alphas[i] = 0;
      continue;
    }
    life[i]! -= dt;
    if (life[i]! <= 0) {
      alphas[i] = 0;
      continue;
    }
    vel[i * 3]! = vel[i * 3]! * drag + (Math.random() - 0.5) * SPRAY_TURB * dt;
    vel[i * 3 + 1]! = vel[i * 3 + 1]! * drag - SPRAY_GRAVITY * dt;
    vel[i * 3 + 2]! =
      vel[i * 3 + 2]! * drag + (Math.random() - 0.5) * SPRAY_TURB * dt;
    positions[i * 3]! += vel[i * 3]! * dt;
    positions[i * 3 + 1]! += vel[i * 3 + 1]! * dt;
    positions[i * 3 + 2]! += vel[i * 3 + 2]! * dt;
    const t = life[i]! / maxLife[i]!; // 1 at birth → 0 at death
    // Billow out: small at birth, expanding toward SPRAY_GROW× as it ages.
    sizes[i] = spawnSize[i]! * (1 + SPRAY_GROW * (1 - t));
    // Densest just off the edge, thinning as it drifts and spreads.
    alphas[i] = SPRAY_PEAK_ALPHA * Math.min(1, t * 1.5);
  }
  s.points.geometry.attributes.position!.needsUpdate = true;
  s.points.geometry.attributes.aSize!.needsUpdate = true;
  s.points.geometry.attributes.aAlpha!.needsUpdate = true;
}

function emitSprayParticle(
  anchor: THREE.Vector3,
  ski: number,
  perpX: number, // across the stance (ski-to-ski)
  perpZ: number,
  skiFwdX: number, // along the ski (nose direction)
  skiFwdZ: number,
  tx: number, // travel direction (unit)
  tz: number,
  px: number, // across the travel direction
  pz: number,
  speedF: number,
  sideF: number,
): void {
  const s = spray!;
  const i = s.cursor;
  s.cursor = (s.cursor + 1) % SPRAY_MAX;
  const r = Math.random;
  // ORIGIN: the ski edge, on the snow. Start at the ski's stance offset, then
  // slide down the ski toward the tail (where it carves and throws snow) and
  // a touch onto its outer edge — so the plume rises off the skis, not the
  // boots (director callout).
  const alongTail = 0.05 + r() * 0.75; // metres back down the ski
  const outEdge = r() * 0.12; // onto the outer edge
  const px0 =
    anchor.x + perpX * ski * (SKI_STANCE + outEdge) - skiFwdX * alongTail;
  const pz0 =
    anchor.z + perpZ * ski * (SKI_STANCE + outEdge) - skiFwdZ * alongTail;
  s.positions[i * 3] = px0 + (r() - 0.5) * 0.05;
  s.positions[i * 3 + 1] = 0.0 + r() * 0.03; // at the snow, not boot height
  s.positions[i * 3 + 2] = pz0 + (r() - 0.5) * 0.05;
  // VELOCITY: a fountain off the edge — up and back (against travel), fanned
  // across it. Modest launch speeds; drag turns them into a hanging billow.
  const back = (0.8 + 1.4 * r()) * (0.4 + 0.6 * speedF);
  const up = 1.6 + 2.2 * r();
  const fan = (0.4 + 2.0 * sideF) * r() * (r() < 0.5 ? 1 : -1);
  s.vel[i * 3] = -tx * back + px * fan + (r() - 0.5) * 0.8;
  s.vel[i * 3 + 1] = up;
  s.vel[i * 3 + 2] = -tz * back + pz * fan + (r() - 0.5) * 0.8;
  const ml = SPRAY_LIFE + (r() - 0.5) * SPRAY_LIFE_VAR;
  s.life[i] = ml;
  s.maxLife[i] = ml;
  // Fine grains — the mist comes from thousands overlapping, not from size.
  s.spawnSize[i] = 0.025 + r() * 0.035 + speedF * 0.02;
  s.sizes[i] = s.spawnSize[i]!;
  s.alphas[i] = SPRAY_PEAK_ALPHA;
}

function updateFlurries(
  dt: number,
  camera: THREE.Camera,
  anchor: THREE.Vector3,
): void {
  const f = flurry!;
  flurryTime += dt;
  // Gust: two slow, out-of-phase sines; the negative half is dead calm, the
  // positive half squared into an occasional swelling patch.
  const raw =
    0.6 * Math.sin(flurryTime * 0.19) +
    0.4 * Math.sin(flurryTime * 0.41 + 1.7);
  const gust = Math.pow(Math.max(0, raw), 2);
  const camPos = camera.position;
  // Zoom read: the camera orbits the skier, so its distance to the anchor IS
  // the zoom radius. Close = zoomed in = flurries lean in hard.
  const dist = camPos.distanceTo(anchor);
  const closeness = 1 - smoothstep01(8, 30, dist);
  const globalAlpha = (0.06 + 0.94 * gust) * (0.3 + 0.7 * closeness);
  f.material.uniforms.globalAlpha!.value = globalAlpha;

  // Camera velocity, so flakes drift *relative* to it and streak past as the
  // run speeds up. Clamp out the respawn/first-frame teleport.
  let cvx = 0;
  let cvy = 0;
  let cvz = 0;
  if (haveCam) {
    cvx = (camPos.x - prevCamPos.x) / dt;
    cvy = (camPos.y - prevCamPos.y) / dt;
    cvz = (camPos.z - prevCamPos.z) / dt;
    if (Math.hypot(cvx, cvy, cvz) > 60) {
      cvx = 0;
      cvy = 0;
      cvz = 0;
    }
  }
  prevCamPos.copy(camPos);
  haveCam = true;

  // Snow's own drift (gentle fall + wind) minus the camera's motion.
  const rvx = (FLURRY_WIND_X - cvx) * dt;
  const rvy = (-FLURRY_FALL - cvy) * dt;
  const rvz = -cvz * dt;
  const { offset, positions } = f;
  for (let i = 0; i < FLURRY_MAX; i++) {
    const ox = wrapRange(offset[i * 3]! + rvx, -FLURRY_HALF_X, FLURRY_HALF_X);
    const oy = wrapRange(offset[i * 3 + 1]! + rvy, -FLURRY_DOWN, FLURRY_UP);
    const oz = wrapRange(offset[i * 3 + 2]! + rvz, -FLURRY_HALF_Z, FLURRY_HALF_Z);
    offset[i * 3] = ox;
    offset[i * 3 + 1] = oy;
    offset[i * 3 + 2] = oz;
    positions[i * 3] = camPos.x + ox;
    positions[i * 3 + 1] = camPos.y + oy;
    positions[i * 3 + 2] = camPos.z + oz;
  }
  f.points.geometry.attributes.position!.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Slope decor: real .glb assets (see assets/CREDITS.md) scattered along the
// flanks of the skiable lane. Pure scenery — nothing here collides, so no
// /shared state is involved. Placement is seeded, so every run and every
// machine sees the identical slope.

const DECOR_MODELS = {
  // The mystical pines (director ask + sequoia-grove reference, 2026-07-23,
  // recolored frosted-green): MegaKit stylized pines are the slope's tree,
  // scattered at three scales — giant trunks by the lane, mid fill, far
  // silhouettes — so the canopy lives above the camera and the haze eats the
  // treetops, like the reference.
  pines: [
    "StylizedPine_1",
    "StylizedPine_2",
    "StylizedPine_3",
    "StylizedPine_4",
    "StylizedPine_5",
  ],
  // The old Ultimate Nature Pack trees (amber-canopy PineTree_Snow, birches,
  // dead birches) are retired from the scatter per the bible — the lingering
  // birch/dead-birch rolls were removed 2026-07-23. Their .glb files stay in
  // assets/slope/. Pines, rocks, and small ground props remain.
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
        // Painted detail rollout (approved 2026-07-22, landed 2026-07-23):
        // patch the template once — every scattered clone() shares the
        // patched materials, so the whole slope pays for one material set.
        applyPaintedDetail(gltf.scene);
        templates.set(name, gltf.scene);
      }),
    );
  } catch (error) {
    // Decor is cosmetic — a failed load leaves the run playable.
    console.error("slope decor failed to load", error);
    return;
  }

  decorState = { scene, templates, placed: new Map() };
}

// The scatter is a recycling window, like the snowfield (found 2026-07-23:
// runs persist distance and the slope is endless, so the old static
// 0..-130m scatter sat entirely uphill of any saved run — an invisible
// treeline). World z is divided into fixed-size cells per band; each cell
// seeds its own PRNG from (band, side, cell index), so a given stretch of
// mountain always grows the identical trees — a place, not a reshuffle —
// and cells spawn/despawn as the window follows the skier. Driven from
// syncEnvironment, which already knows the anchor; no new seam API.

// Trees read slightly larger than before (director ask, 2026-07-23).
const TREE_SCALE = 1.15;

interface DecorBand {
  readonly key: string;
  /** One potential spawn per cell of this many meters of slope. */
  readonly cellSize: number;
  /** Chance the cell actually spawns (sparseness without bigger cells). */
  readonly density: number;
  readonly spawn: (
    random: () => number,
  ) => { models: readonly string[]; x: number; scale: number };
}

// The giants (sequoia-grove reference, 2026-07-23): a sparse colonnade of
// huge trunks hugging the lane, canopy far above the camera — the trees
// are the environment, not decoration on it. Source models are 7–10m, so
// 4.5–7× puts them at roughly 35–70m. Spacing stays wide: the reference
// reads as a grove of individuals, not a wall, and every trunk gap is a
// window into the hazy depth beyond.
const DECOR_BANDS: readonly DecorBand[] = [
  {
    key: "giant",
    cellSize: 19,
    density: 1,
    spawn: (random) => ({
      models: DECOR_MODELS.pines,
      x: LANE_EDGE + 2.5 + random() * 10,
      scale: 4.5 + random() * 2.5,
    }),
  },
  // Near flank: the treeline just past the lane edge — the visible cue for
  // where the skiable area ends (hard-clamp call, 2026-07-22). Pines lead;
  // rocks and filler props fill the gaps between them. The old birches and
  // dead birches that used to thin through this mix are retired (2026-07-23).
  {
    key: "near",
    cellSize: 4,
    density: 1,
    spawn: (random) => {
      const roll = random();
      const isTree = roll < 0.55;
      const models =
        roll < 0.55
          ? DECOR_MODELS.pines
          : roll < 0.8
            ? DECOR_MODELS.rocks
            : DECOR_MODELS.filler;
      return {
        models,
        x: LANE_EDGE + 0.8 + random() * 9,
        scale: (0.85 + random() * 0.5) * (isTree ? TREE_SCALE : 1),
      };
    },
  },
  // Far flank: sparse oversized silhouettes for depth — the lonely-vast
  // target wants these thin; resist filling them in. Giants out here
  // layer trunk behind trunk into the haze. Pines only now (the dead
  // birches that shared this band are retired).
  {
    key: "far",
    cellSize: 11,
    density: 0.8,
    spawn: (random) => ({
      models: DECOR_MODELS.pines,
      x: LANE_EDGE + 11 + random() * 16,
      scale: (2.2 + random() * 1.6) * TREE_SCALE,
    }),
  },
];

// How far the window reaches from the anchor. Downhill covers past the fog
// far plane (150) so trees materialize invisibly inside the haze; uphill is
// short — the camera never looks back far.
const DECOR_AHEAD = 170;
const DECOR_BEHIND = 30;

interface DecorState {
  readonly scene: THREE.Scene;
  readonly templates: Map<string, THREE.Group>;
  readonly placed: Map<string, THREE.Object3D>;
}

let decorState: DecorState | null = null;

function updateSlopeDecor(anchorZ: number): void {
  if (!decorState) return;
  const { scene, templates, placed } = decorState;
  const minZ = anchorZ - DECOR_AHEAD;
  const maxZ = Math.min(anchorZ + DECOR_BEHIND, -4); // forest starts at -4
  const live = new Set<string>();
  for (let bandIndex = 0; bandIndex < DECOR_BANDS.length; bandIndex++) {
    const band = DECOR_BANDS[bandIndex]!;
    for (const side of [-1, 1]) {
      const first = Math.floor(-maxZ / band.cellSize);
      const last = Math.floor(-minZ / band.cellSize);
      for (let cell = first; cell <= last; cell++) {
        const key = `${band.key}:${side}:${cell}`;
        live.add(key);
        if (placed.has(key)) continue;
        // Every cell owns a deterministic PRNG — same stretch of mountain,
        // same trees, every run and every machine.
        const random = makeRandom(
          (20260721 ^ Math.imul(cell, 2654435761)) + bandIndex * 7919 + side,
        );
        if (random() > band.density) {
          placed.set(key, EMPTY_CELL);
          continue;
        }
        const { models, x, scale } = band.spawn(random);
        const template = templates.get(
          models[Math.floor(random() * models.length)]!,
        );
        if (!template) continue;
        const copy = template.clone();
        const jitter = random() * 0.8; // where in the cell the tree stands
        copy.position.set(side * x, 0, -(cell + 0.1 + jitter) * band.cellSize);
        copy.rotation.y = random() * Math.PI * 2;
        copy.scale.setScalar(scale);
        scene.add(copy);
        placed.set(key, copy);
      }
    }
  }
  for (const [key, object] of placed) {
    if (live.has(key)) continue;
    if (object !== EMPTY_CELL) scene.remove(object);
    placed.delete(key);
  }
}

// Marker for a cell that rolled "no tree" — remembered so the roll isn't
// retried every frame, and skipped on despawn.
const EMPTY_CELL = new THREE.Object3D();

// ---------------------------------------------------------------------------
// PAINTED DETAIL (test 2026-07-22, promoted 2026-07-23) — the 2026-07-22
// verdict split: painted detail on trees/rocks/props was APPROVED ("I like
// the trees") and is now rolled across all 24 slope models (every decor
// template gets it at load, in loadSlopeDecor above); the painted *snow*
// patch was rejected in favor of realism (now the REALISM SNOW section
// above), and its canvases are gone from here. Everything below is
// generated in code — no image files, no license rows.
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
  // The stylized pines (tools/glb_stylized_pine.py). Bark strokes are in
  // object space, so scaling a giant scales its strokes too — sequoia
  // fissures get sequoia-sized for free. Snow canopy takes the dapple
  // gently: it's snow-laden foliage, not painted leaves.
  PineBark: { map: "bark", scale: 1.2, strength: 0.85 },
  PineSnow: { map: "dapple", scale: 1.1, strength: 0.55 },
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
      // Strip Blender-style ".001" suffixes (Rock_Snow_2 has Rock.001 /
      // Snow.001) so every model hits its intended detail row.
      const detail = DETAIL_BY_MATERIAL[material.name.replace(/\.\d+$/, "")] ?? {
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
