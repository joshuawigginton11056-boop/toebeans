import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
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

// NIGHT (branching-map idea, director 2026-07-24: "the sun sets as we race,
// and it turns to night"). ⚠ This intentionally reaches past the Art Style
// Bible's "the whole game is bright — dark moods are out of scope" line — a
// director amendment, flagged for a look-pass and a bible note (see the
// ROADMAP entry). It stays inside the palette in spirit: every night color
// below is a cool, dark *value shift* of an existing palette entry (snow
// shadow #2, glacial ice #10, the chasm navy).
//
// DARKER NIGHT (director redirect, 2026-07-24 — first pass of the enchanted
// forest; see IDEAS.md). The first moonlit night was "too bright and too
// evenly lit." The new mood is an *extremely dark* forest lit by glowing
// assets, not a moon wash. Those glow props are their own (bigger) chunk
// still to land, so this pass does only the redirect's first bullet: crush
// the ambient/fill toward near-black so the open snow reads deep and dark,
// and you only really see form where the moon rakes. Until the glow assets
// arrive to carry lane readability, the directional moon stays on as a faint
// key so silhouettes and the lane don't vanish entirely — hence `snowLit`
// stays moderate while `snowShadow` (the ambient-only floor) drops hard.
const NIGHT = {
  // The two snow targets that drive the lighting solve at full night — same
  // trick as day (createEnvironment). `snowShadow` is the ambient-only floor:
  // crushed to a deep near-black cool blue (a dark value shift of the chasm
  // navy) so open snow away from the moon key sinks toward black. `snowLit`
  // is the moon-facing snow — kept as a dim silver-blue key (still a value
  // shift of snow-shadow #D3DFF0) so the lane the moon rakes stays readable
  // until the glow assets take over lane lighting.
  snowLit: 0x4e608a,
  snowShadow: 0x12182b,
  // Sky: a dim, deep navy at the horizon melting up to near-black overhead —
  // much darker than the first night. The fog rides the horizon color so
  // distance still fades into the sky.
  skyHorizon: 0x1e2740,
  skyZenith: 0x0b0f1c,
  // The moon: a pale cool disc, smaller and crisper than the hazy dawn sun,
  // hung a touch higher in the sky. In the darker sky it's the one bright
  // thing — the closest we have to a glow source until the enchanted props
  // land.
  moon: 0xdfe8f5,
} as const;

// Solve the two snow lights (ambient skylight + one directional) so flat snow
// renders exactly on target: ambient alone lands on `shadowTarget`, ambient +
// direct light lands on `litTarget`. This is the dawn trick from
// createEnvironment, generalized so night can reuse it (day passes
// litTarget = albedo). See the constraint derivation there.
function solveSnowLights(
  albedo: THREE.Color,
  litTarget: THREE.Color,
  shadowTarget: THREE.Color,
  ndotL: number,
): { ambient: THREE.Color; direct: THREE.Color } {
  const ambient = new THREE.Color(
    Math.min(1, shadowTarget.r / albedo.r),
    Math.min(1, shadowTarget.g / albedo.g),
    Math.min(1, shadowTarget.b / albedo.b),
  );
  const direct = new THREE.Color(
    Math.max(0, (litTarget.r - shadowTarget.r) / (albedo.r * ndotL)),
    Math.max(0, (litTarget.g - shadowTarget.g) / (albedo.g * ndotL)),
    Math.max(0, (litTarget.b - shadowTarget.b) / (albedo.b * ndotL)),
  );
  return { ambient, direct };
}

// Everything about the sky/light that changes between dawn and night. Two of
// these (the day and night endpoints) are built once; setTimeOfDay lerps
// between them and applies the result to the live scene objects.
interface Atmosphere {
  readonly ambient: THREE.Color;
  readonly direct: THREE.Color; // the sun/moon directional light color
  readonly fog: THREE.Color;
  readonly skyHorizon: THREE.Color;
  readonly skyZenith: THREE.Color;
  readonly disc: THREE.Color; // sun/moon billboard tint
  readonly discScale: number;
  readonly discOpacity: number;
  /** Billboard elevation cheat, azimuth-matched to the light. */
  readonly discDir: THREE.Vector3;
  readonly stars: number; // 0 (day, invisible) … 1 (full night)
}

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

// The moon hangs at the same azimuth but a little higher than the horizon sun
// — a night sky can afford to show it off, and lifting it clears the treeline
// silhouettes at the far end of the lane.
const MOON_BILLBOARD_DIRECTION = new THREE.Vector3(-0.15, 0.2, -1).normalize();

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
  readonly sun: THREE.DirectionalLight; // the sun by day, the moon at night
  readonly ambient: THREE.AmbientLight;
  readonly skyDome: THREE.Mesh;
  readonly sunBillboard: THREE.Sprite; // the sun disc by day, the moon at night
  readonly stars: THREE.Points; // fade in with night
  readonly slope: THREE.Mesh;
  readonly trail: SnowTrail;
  // Enchanted-night lighting (fades in with the night phase; see GLOW section).
  readonly glow: GlowField; // scattered glowing props + their snow pools
  readonly mist: MistField; // drifting cool haze banks along the treeline
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

// ---------------------------------------------------------------------------
// Time of day — dawn ⇄ night (branching-map idea, director 2026-07-24).
//
// The whole scene was one fixed dawn. Now the sky/light live on a single
// phase `timeOfDay` in [0,1]: 0 = the exact dawn from before this change,
// 1 = full moonlit night. setTimeOfDay lerps between two prebuilt endpoints
// and applies the result. It's called from a debug key today (N, wired in
// main.ts) so the director can eyeball the look; the "sun sets *as you race*"
// auto-transition (drive the phase from run progress) is the next chunk —
// deliberately left out until the night look is approved and the trigger
// (linear distance? which map branch?) is a director call. Presentation-only:
// nothing here touches the sim or the save.

// The active slope environment — there is only ever one, built once by
// createSkiScene and reused across runs, so a module singleton lets the debug
// key retint the scene without threading the handle through main.ts. Matches
// how the decor/texture singletons already live in this file.
let activeEnvironment: SlopeEnvironment | null = null;
let activeScene: THREE.Scene | null = null;
let dayAtmosphere: Atmosphere | null = null;
let nightAtmosphere: Atmosphere | null = null;
let timeOfDay = 0; // persists across runs; re-asserted when the env rebuilds
// The snow shader's glitter gain (slope-vis verdict #2): 1 by day, faded to
// NIGHT_SPARKLE_GAIN at full night so the twinkle stops fighting the dark.
// Held here because the uniform lives inside the material's compile closure.
let snowSparkleGain: { value: number } | null = null;
// How much of the daytime glitter survives at full night. Not zero — a faint
// moonlit shimmer keeps the snow from reading as dead matte.
const NIGHT_SPARKLE_GAIN = 0.12;
// How "on" the enchanted glow is (0 by day, 1 at full night). Ramps in only
// past dusk — glowing mushrooms at golden hour would look wrong — so glow is a
// gated remap of timeOfDay, not the phase itself. Read by the GLOW updates.
let glowFactor = 0;
// Enchanted ground mist — its own gated remap of timeOfDay (see the MIST
// section). Rolls in a touch before the glow (dusk fog ahead of the props).
let mistFactor = 0;
// The billboard placement direction for the current phase — syncEnvironment
// reads it each frame to hang the sun/moon. Lerped in applyTimeOfDay.
const currentDiscDir = SUN_BILLBOARD_DIRECTION.clone();

// --- Enchanted-night bloom (slope-vis 2026-07-24) --------------------------
// The emissive glow props read "lit" but not *glowing* without a halo bleeding
// off them — and the director wants that bloom pushed STRONG on the plants.
// Technique: a full-scene UnrealBloomPass with a luminance threshold. It looks
// like it would blow out the daytime snow, but it never runs by day — bloom
// strength rides glowFactor (0 until dusk), and renderSlope bypasses the
// composer entirely while strength is ~0, so the crisp high-key daylight is
// byte-identical to before. At night the scene is crushed near-black, so the
// only pixels above threshold are the emissive caps and their additive pools:
// the full-scene bloom is *naturally* selective to the glow, no per-object
// bloom layer needed. Held at module scope like the glow/mist singletons —
// there is only ever one slope environment.
let bloomComposer: EffectComposer | null = null;
let bloomPass: UnrealBloomPass | null = null;
// Peak strength at full night — deliberately strong per the director's call.
const BLOOM_STRENGTH = 1.5;
// Halo spread. Wide enough to feel like a glow, not a sharp ring.
const BLOOM_RADIUS = 0.7;
// Only clearly-bright (emissive > 1 in linear) pixels bloom; the near-black
// night snow/mist sit far below this, so they never smear.
const BLOOM_THRESHOLD = 0.55;

const lerpColor = (() => {
  const out = new THREE.Color();
  return (a: THREE.Color, b: THREE.Color, t: number) =>
    out.copy(a).lerp(b, t);
})();

// Lerp the whole atmosphere from day → night at `t` and push it onto the live
// scene objects. Cheap enough to call on demand (the debug key); the only
// non-trivial bit is repainting the sky dome's vertex colors, done here rather
// than per frame.
function applyTimeOfDay(t: number): void {
  timeOfDay = Math.min(1, Math.max(0, t));
  const env = activeEnvironment;
  if (!env || !dayAtmosphere || !nightAtmosphere) return;
  const d = dayAtmosphere;
  const n = nightAtmosphere;
  const k = timeOfDay;

  env.ambient.color.copy(lerpColor(d.ambient, n.ambient, k));
  env.sun.color.copy(lerpColor(d.direct, n.direct, k));
  if (activeScene?.fog) {
    activeScene.fog.color.copy(lerpColor(d.fog, n.fog, k));
  }
  if (activeScene?.background instanceof THREE.Color) {
    activeScene.background.copy(lerpColor(d.skyZenith, n.skyZenith, k));
  }

  repaintSkyDome(
    env.skyDome,
    lerpColor(d.skyHorizon, n.skyHorizon, k).clone(),
    lerpColor(d.skyZenith, n.skyZenith, k).clone(),
  );

  const disc = env.sunBillboard.material as THREE.SpriteMaterial;
  disc.color.copy(lerpColor(d.disc, n.disc, k));
  disc.opacity = d.discOpacity + (n.discOpacity - d.discOpacity) * k;
  env.sunBillboard.scale.setScalar(d.discScale + (n.discScale - d.discScale) * k);
  currentDiscDir.copy(d.discDir).lerp(n.discDir, k).normalize();

  const starMat = env.stars.material as THREE.PointsMaterial;
  starMat.opacity = d.stars + (n.stars - d.stars) * k;
  env.stars.visible = starMat.opacity > 0.001;

  // Snow glitter dims as the light goes (slope-vis verdict #2) — tracks the
  // whole dawn→night fade, not the dusk-gated glow, since it's the sun's
  // specular twinkle that's leaving.
  if (snowSparkleGain) snowSparkleGain.value = 1 - (1 - NIGHT_SPARKLE_GAIN) * k;

  // Enchanted glow ramps in only past dusk (GLOW_ONSET), full by night.
  glowFactor = Math.min(1, Math.max(0, (k - GLOW_ONSET) / (1 - GLOW_ONSET)));
  applyGlowPhase(env, glowFactor);

  // Ground mist leads the glow slightly (dusk fog rolling in before the props
  // light up), full by night.
  mistFactor = Math.min(1, Math.max(0, (k - MIST_ONSET) / (1 - MIST_ONSET)));
  applyMistPhase(env.mist, mistFactor);
}

/** Jump straight to a time of day (0 = dawn, 1 = full night). */
export function setTimeOfDay(t: number): void {
  applyTimeOfDay(t);
}

/**
 * Debug cycle for the director's look-pass: dawn → dusk → night → dawn.
 * Returns the new phase so the caller can surface it. Wired to the N key in
 * main.ts; retires when the auto-transition lands.
 */
export function cycleTimeOfDay(): number {
  const stops = [0, 0.5, 1];
  const i = stops.findIndex((s) => s > timeOfDay + 1e-3);
  applyTimeOfDay(i === -1 ? 0 : stops[i]!);
  return timeOfDay;
}

// Builds the slope's weather and ground: fog, lights, sky, sun disc, and
// the snowfield. Adds everything to the scene and returns the pieces that
// follow the run downhill (see syncEnvironment). The renderer comes along
// because the ski trails are carved on the GPU — a height render-target the
// snow shader displaces by (see the realism snow section below).
export function createEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  // (slope-vis seam addition, 2026-07-24) the camera comes along so the
  // night-bloom composer can build its RenderPass. renderSlope composites
  // through it at night; by day it's bypassed. See the bloom NOTE above.
  camera: THREE.Camera,
): SlopeEnvironment {
  scene.background = new THREE.Color(PALETTE.skyBlue);

  // The mandatory haze: distance fog tinted dawn pink. Doubles as gameplay —
  // how pink something is tells you how far away it is. (Color is re-tinted
  // by setTimeOfDay; near/far stay put so gameplay read is identical day or
  // night.)
  scene.fog = new THREE.Fog(PALETTE.dawnPink, 35, 150);

  // The bible's two snow colors define the lighting exactly: ambient
  // skylight alone must render flat snow as snow-shadow blue, and ambient
  // plus sun must render it as sunlit snow. Solving those two constraints
  // gives the light colors below — shadows land on palette #2 by
  // construction, not by tuning. (The blue channel wants slightly more than
  // the sun can subtract, hence the clamp; the sun comes out warm because
  // it carries all the red/yellow the blue ambient lacks.) The night
  // endpoint reuses the same solve with the cooler NIGHT targets.
  const albedo = new THREE.Color(PALETTE.sunlitSnow);
  const groundNdotL = SUN_DIRECTION.y; // how squarely the sun hits flat snow
  const day = solveSnowLights(
    albedo,
    albedo, // day: lit snow *is* the albedo (sunlit-snow #1)
    new THREE.Color(PALETTE.snowShadow),
    groundNdotL,
  );

  // Math.PI because three.js physical lights fold 1/π into the material.
  const ambient = new THREE.AmbientLight(day.ambient.clone(), Math.PI);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(day.direct.clone(), Math.PI);
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

  const stars = createStarfield();
  scene.add(stars);

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
  // The camera lens splash — a 2D overlay over the canvas (needs the renderer
  // to find its DOM parent and to mirror its visibility).
  createLensSplash(renderer);

  // Enchanted-night lighting: the glowing-prop field. Starts fully faded out
  // (day) — applyTimeOfDay/applyGlowPhase brings it in with the night phase.
  const glow = createGlowField();
  scene.add(glow.group);

  // Enchanted-night atmosphere: the drifting haze banks. Same story — off by
  // day, faded in with the night phase (a touch ahead of the glow).
  const mist = createMistField();
  scene.add(mist.group);

  const environment: SlopeEnvironment = {
    sun,
    ambient,
    skyDome,
    sunBillboard,
    stars,
    slope,
    trail,
    glow,
    mist,
  };

  // Day and night endpoints for the time-of-day lerp. Day mirrors exactly
  // what was hardcoded before this change (so t=0 is a no-op); night uses the
  // NIGHT targets and the same snow-light solve.
  const night = solveSnowLights(
    albedo,
    new THREE.Color(NIGHT.snowLit),
    new THREE.Color(NIGHT.snowShadow),
    groundNdotL,
  );
  dayAtmosphere = {
    ambient: day.ambient,
    direct: day.direct,
    fog: new THREE.Color(PALETTE.dawnPink),
    skyHorizon: new THREE.Color(PALETTE.dawnPink),
    skyZenith: new THREE.Color(PALETTE.skyBlue),
    disc: new THREE.Color(PALETTE.sunGlow),
    discScale: 34,
    discOpacity: 1,
    discDir: SUN_BILLBOARD_DIRECTION.clone(),
    stars: 0,
  };
  nightAtmosphere = {
    ambient: night.ambient,
    direct: night.direct,
    fog: new THREE.Color(NIGHT.skyHorizon),
    skyHorizon: new THREE.Color(NIGHT.skyHorizon),
    skyZenith: new THREE.Color(NIGHT.skyZenith),
    disc: new THREE.Color(NIGHT.moon),
    discScale: 22, // the moon reads smaller and crisper than the hazy sun
    discOpacity: 1,
    discDir: MOON_BILLBOARD_DIRECTION.clone(),
    stars: 1,
  };
  activeEnvironment = environment;
  activeScene = scene;

  // Night-bloom composer (see the bloom NOTE up top). RenderPass draws the
  // scene, UnrealBloomPass bleeds the emissive glow, OutputPass does the
  // tone-map + sRGB convert so the composited image matches a straight render.
  // Strength starts at 0 (day) and is driven each phase change by
  // applyGlowPhase; the composer is only ever used once strength climbs.
  bloomComposer = new EffectComposer(renderer);
  bloomComposer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  bloomComposer.addPass(bloomPass);
  bloomComposer.addPass(new OutputPass());
  // Keep the composer's render targets matched to the canvas. main.ts resizes
  // the renderer; this rides the same event for the composer's own buffers.
  window.addEventListener("resize", () => {
    bloomComposer?.setSize(window.innerWidth, window.innerHeight);
  });

  applyTimeOfDay(timeOfDay); // re-assert whatever phase persisted across runs

  return environment;
}

/**
 * Draw the slope. At night the enchanted glow needs a bloom halo (director:
 * push it strong), so we composite through the bloom pass; by day bloom
 * strength is 0 and we render straight — the crisp high-key daylight is
 * untouched, and the extra passes cost nothing until dusk. (slope-vis
 * render-seam add — see PARALLEL.md; the sole call site is skiRender.ts's
 * render(), which owns the per-frame draw.)
 */
export function renderSlope(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  if (bloomComposer && bloomPass && bloomPass.strength > 0.001) {
    bloomComposer.render();
  } else {
    renderer.render(scene, camera);
  }
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
  // Enchanted-night glow rides the same anchor: the glowing props recycle
  // along the run. No-ops cheaply when glowFactor is 0 (daytime), so this
  // stays free by day.
  updateGlowField(environment.glow, anchor.z);
  // The haze banks ride the same window and drift on their own clock. Also a
  // cheap no-op by day (mistFactor 0, nothing placed).
  updateMistField(environment.mist, anchor.z);
  environment.skyDome.position.copy(camera.position);
  environment.stars.position.copy(camera.position);
  // The disc direction is the current time-of-day's (lerped in applyTimeOfDay)
  // — the sun sits near the horizon, the moon a little higher.
  environment.sunBillboard.position
    .copy(camera.position)
    .addScaledVector(currentDiscDir, 150);
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

// Per-vertex horizon→zenith blend factor, cached once so the dome can be
// repainted for any time of day without re-running the smoothstep.
let skyHeightT: Float32Array | null = null;

function createSkyDome(): THREE.Mesh {
  const radius = 170;
  const geometry = new THREE.SphereGeometry(radius, 32, 16);
  const positions = geometry.attributes.position!;
  skyHeightT = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const height = positions.getY(i) / radius; // -1 (below) … 1 (overhead)
    // Blend fully to the zenith color within ~15° of elevation — the downhill
    // camera only ever sees a low band of sky, so the top color reaches into
    // it.
    skyHeightT[i] = Math.min(1, Math.max(0, (height - 0.02) / 0.25));
  }
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3),
  );
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
  repaintSkyDome(dome, new THREE.Color(PALETTE.dawnPink), new THREE.Color(PALETTE.skyBlue));
  return dome;
}

// Rewrite the dome's vertex colors for a horizon/zenith pair. Called on
// create and on every time-of-day change.
function repaintSkyDome(
  dome: THREE.Mesh,
  horizon: THREE.Color,
  zenith: THREE.Color,
): void {
  const attr = dome.geometry.attributes.color as THREE.BufferAttribute;
  const colors = attr.array as Float32Array;
  const heights = skyHeightT!;
  const color = new THREE.Color();
  for (let i = 0; i < heights.length; i++) {
    color.lerpColors(horizon, zenith, heights[i]!);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  attr.needsUpdate = true;
}

// A field of faint stars on a shell just inside the sky dome, upper hemisphere
// only. Invisible by day (material opacity lerps in with night). It rides with
// the camera like the dome, so the stars sit at infinity and never parallax.
function createStarfield(): THREE.Points {
  const count = 550;
  const radius = 165; // just inside the 170 dome
  const positions = new Float32Array(count * 3);
  // Deterministic scatter (a tiny LCG) so the sky is the same every run — no
  // Math.random, matching the seeded-decor convention elsewhere in this file.
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < count; i++) {
    // Cosine-free uniform-ish over the upper hemisphere; bias slightly up so
    // few stars sit right on the horizon haze.
    const theta = rand() * Math.PI * 2;
    const y = 0.06 + rand() * 0.94; // 0 = horizon, 1 = zenith
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xeaf1ff, // cool white, a hair off pure white per the bible
    size: 1.1,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.renderOrder = -1; // with the dome, behind everything
  stars.visible = false;
  return stars;
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
  // Neutral white disc + halo; the warm/cool tint comes from the sprite's
  // material.color (sun-glow by day, cool moon by night — set in
  // applyTimeOfDay), so one texture serves both.
  gradient.addColorStop(0, "rgba(255,255,255,1)"); // solid core
  gradient.addColorStop(0.28, "rgba(255,255,255,1)");
  gradient.addColorStop(0.34, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color: PALETTE.sunGlow, // day default; retinted by applyTimeOfDay
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
    // slope-vis (verdict #2, 2026-07-24): the glitter below is a light-
    // independent additive flash, so it stayed just as bright once the scene
    // went near-black — the director's "snow sparkle too bright at night".
    // A phase gain fades it out with the night; driven from applyTimeOfDay.
    const sparkleGain = { value: 1 };
    shader.uniforms.sparkleGain = sparkleGain;
    snowSparkleGain = sparkleGain;
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
      "varying vec3 vSnowWorld;\nuniform vec3 sunDir;\nuniform float sparkleGain;\n" +
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
  // sparkleGain fades the twinkle out at night (slope-vis verdict #2).
  reflectedLight.directSpecular += vec3(1.0, 0.957, 0.855) * (flash * gate * fade * crust * 1.6 * sparkleGain);
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
//
// VISIBILITY PASS (slope-vis, 2026-07-23 — director: "hard to see, especially
// in the sun"). White powder over sunlit-white snow has no contrast, and it
// only gets worse toward the sun glow (the brightest thing on screen). Two
// levers, per the parked look-pass note (push count + alpha before size):
// the plume was cooled toward snow-shadow blue and made denser (higher rate +
// peak alpha). Grain size is left alone — enlarging it read as "orbs" last pass.
// SHADOW PASS (2026-07-23 — director: the cool tint read in the sun but vanished
// in shadow, blue powder on blue snow). The single cool tint became a per-grain
// TWO-TONE mix of both snow values — see SPRAY_COLOR_SUN / SPRAY_COLOR_SHADOW.
const SPRAY_MAX = 4000; // big pool — headroom for the raised rate + carve boost
const SPRAY_MIN_SPEED = 2.5; // below this the skis just glide — no kick-up
const SPRAY_FULL_SPEED = 14; // spray saturates around here
const SPRAY_BASE_RATE = 2200; // grains/sec at full spray, both skis
const SPRAY_LIFE = 0.7; // seconds — powder hangs before it settles
const SPRAY_LIFE_VAR = 0.3;
// Powder is light: weak gravity, strong air drag, so the plume decelerates
// into a floating billow instead of arcing like thrown sand.
const SPRAY_GRAVITY = 2.6;
const SPRAY_DRAG = 2.2; // per-second velocity damping (air resistance)
const SPRAY_TURB = 2.0; // random roil that keeps the cloud from looking rigid
const SPRAY_GROW = 2.4; // each grain expands to ~this× as it billows out
const SPRAY_PEAK_ALPHA = 0.52; // faint per grain — density builds the body
// TWO-TONE PLUME (slope-vis, 2026-07-23 — director verdict: the old flat blue
// "looks good in the sun, hard to see in shadows"). A single flat tint is stuck
// between the two snow values and loses against whichever it matches: cool blue
// reads on sunlit-white snow but vanishes on shadow-blue snow (which renders as
// exactly this color by the bible's lighting). Fix: mix both snow values per
// grain — bright sunlit-white #F8F5EF (palette #1) and cool shadow-blue #D3DFF0
// (palette #2) — so the plume always carries a value that breaks against
// whichever snow it flies over. Both are palette colors; no new hue, no bible
// change. Flurries keep the material's white uniform (their aColor stays white).
const SPRAY_COLOR_SUN = new THREE.Vector3(0xf8 / 255, 0xf5 / 255, 0xef / 255);
const SPRAY_COLOR_SHADOW = new THREE.Vector3(0xd3 / 255, 0xdf / 255, 0xf0 / 255);
const SPRAY_SHADOW_FRAC = 0.5; // share of grains that take the cool shadow tone
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

// Lens splash tuning (slope-vis, 2026-07-23 — director: "there's no splash in
// the camera to make it feel immersive"). A 2D overlay canvas over the WebGL
// canvas: soft snow splats that hit the "lens" while you carve at speed, slide
// down, melt out, and fade — the you're-down-in-it read the 3D flurries can't
// give (they're always at least a near-plane away). Pure screen space, keyed
// off the same speed/carve signals as the spray, so no seam crosses. The
// overlay is pointer-events:none (camera clicks pass through) and mirrors the
// ski canvas's visibility so nothing lingers over the lobby.
const LENS_SPLAT_MAX = 130; // hard cap on live splats (bounds fill cost)
const LENS_SPLAT_RATE = 28; // splats/sec at full carve, before the closeness gate
// Most splats are now small detailed *flake* stickers; a `big` one is instead a
// soft round "direct hit" smear. The mix (many small flakes + a few soft hits)
// is the director's 2026-07-24 course-correct — smaller, detailed, sticky.
const LENS_BIG_CHANCE = 0.16; // fraction that are the bigger soft "direct hits"
const LENS_LIFE = 1.1; // seconds a splat clings before it's fully melted off
const LENS_LIFE_VAR = 0.7;
const LENS_SLIDE = 26; // px/sec a splat drips down the lens (low — it sticks)
const LENS_MELT = 22; // px/sec a splat spreads as it melts
// Cool-white, same snow-shadow family as the plume — a splat is that powder
// hitting glass. Kept subtly translucent so it never blocks the play read.
const LENS_TINT = "233, 240, 250";
const LENS_PEAK_ALPHA = 0.6; // per-splat opacity ceiling (2026-07-24 make-it-read pass)
// Under a hard sustained carve, snow cakes the *edges* of the lens — a soft
// white vignette that eases in with the splat intensity and lingers as it
// decays, reading as "buried in it" the way discrete blobs alone can't. Center
// stays clear so the play read is never blocked. (slope-vis 2026-07-24.)
const LENS_FROST_PEAK_ALPHA = 0.2; // corner opacity at full, sustained carve
const LENS_FROST_ATTACK = 5.5; // per-sec ease-up toward the current intensity
const LENS_FROST_DECAY = 2.2; // per-sec ease-down when the carve lets up

// Both systems draw as soft round sprites through this one shader. Point size
// is world-radius attenuated to pixels; a near-camera fade keeps a flake from
// ever splatting full-screen across the lens (only flurries get that close —
// spray always sits out at the skier). Fog is applied manually (a plain
// ShaderMaterial gets none of three's auto-fog): spray melts into the haze at
// a far zoom, flurries never do (they live right at the camera).
const PARTICLE_VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float sizeScale;
uniform float fogNear;
uniform float fogFar;
varying float vAlpha;
varying float vFog;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.001);
  gl_PointSize = clamp(aSize * sizeScale / dist, 1.0, 140.0);
  gl_Position = projectionMatrix * mv;
  // Fade points hugging the lens (< ~1.3 units) so a flake never flashes the
  // whole screen white; spray is always farther out, so it's untouched.
  vAlpha = aAlpha * smoothstep(0.15, 1.3, dist);
  vFog = 1.0 - smoothstep(fogNear, fogFar, dist);
  vColor = aColor;
}
`;
const PARTICLE_FRAG = `
uniform sampler2D map;
uniform vec3 color;
uniform float globalAlpha;
varying float vAlpha;
varying float vFog;
varying vec3 vColor;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vAlpha * vFog * globalAlpha;
  if (a < 0.01) discard;
  // Per-grain tint (vColor) times the material's global tint (color). Flurries
  // keep aColor = white and lean on the uniform; the spray plume carries its
  // two-tone (sun-white / shadow-blue) per grain so it reads on either snow.
  gl_FragColor = vec4(color * vColor, a);
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
  readonly colors: Float32Array; // 3 per particle — the two-tone plume grain
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

// One splat stuck to the lens: screen position (CSS px), current radius, how far
// through its melt it is, its drip velocity, and — for flakes — a fixed birth
// rotation and sprite variant so each clump sits at a natural random angle on
// the glass and no two read alike.
interface LensSplat {
  x: number;
  y: number;
  r: number;
  vy: number; // downward drip, px/sec
  grow: number; // melt spread, px/sec added to r
  life: number;
  maxLife: number;
  alpha0: number;
  rot: number; // birth rotation, radians (flakes only; blobs ignore it)
  sprite: number; // index into flakeSprites (flakes only; blobs ignore it)
  flake: boolean; // true = detailed snow-clump sprite, false = soft round direct hit
}

interface LensSplashSystem {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly splats: LensSplat[];
  readonly flakeSprites: HTMLCanvasElement[]; // pre-rendered snow-clump variants, drawn scaled+rotated
  emitAccum: number;
  frost: number; // 0..1 smoothed edge-cake level (eases with carve intensity)
  wasDrawn: boolean; // last frame left ink on the canvas (so we clear once)
}

let spray: SpraySystem | null = null;
let flurry: FlurrySystem | null = null;
let lensSplash: LensSplashSystem | null = null;

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
  const sColor = new Float32Array(SPRAY_MAX * 3); // per-grain two-tone
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
  sGeo.setAttribute(
    "aColor",
    new THREE.BufferAttribute(sColor, 3).setUsage(THREE.DynamicDrawUsage),
  );
  const sMat = createSnowParticleMaterial({ fogNear: 45, fogFar: 150 });
  // The plume's color is per-grain (two-tone sun-white / shadow-blue, set at
  // emit), so the material's global tint stays neutral white and just passes
  // the grain color through. See SPRAY_COLOR_SUN / SPRAY_COLOR_SHADOW.
  sMat.uniforms.color!.value.set(1, 1, 1);
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
    colors: sColor,
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
  const fColor = new Float32Array(FLURRY_MAX * 3); // all white — see below
  const fOff = new Float32Array(FLURRY_MAX * 3);
  for (let i = 0; i < FLURRY_MAX; i++) {
    fOff[i * 3] = (random() * 2 - 1) * FLURRY_HALF_X;
    fOff[i * 3 + 1] = -FLURRY_DOWN + random() * (FLURRY_UP + FLURRY_DOWN);
    fOff[i * 3 + 2] = (random() * 2 - 1) * FLURRY_HALF_Z;
    fSize[i] = 0.02 + random() * 0.05;
    fAlpha[i] = 0.4 + random() * 0.6; // per-flake base, scaled by the gust
    // Flurries carry no per-grain tint — aColor = white so the fragment shader
    // (color * vColor) falls through to the material's #F8F5EF sunlit-white.
    fColor[i * 3] = 1;
    fColor[i * 3 + 1] = 1;
    fColor[i * 3 + 2] = 1;
  }
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(fPos, 3).setUsage(THREE.DynamicDrawUsage),
  );
  fGeo.setAttribute("aSize", new THREE.BufferAttribute(fSize, 1));
  fGeo.setAttribute("aAlpha", new THREE.BufferAttribute(fAlpha, 1));
  fGeo.setAttribute("aColor", new THREE.BufferAttribute(fColor, 3));
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
  if (lensSplash) {
    // Same signals the spray uses: how fast, how hard the carve, and how close
    // the camera is (immersion is a close-camera thing — zoomed out, snow on
    // the lens makes no sense, so the far view barely splats). Grounded only.
    const grounded = trailInput?.grounded ?? false;
    let intensity = 0;
    let carveSide = 0;
    if (grounded && speed > SPRAY_MIN_SPEED) {
      const speedF = Math.min(
        1,
        (speed - SPRAY_MIN_SPEED) / (SPRAY_FULL_SPEED - SPRAY_MIN_SPEED),
      );
      const sideF = speed > 0.01 ? Math.min(1, Math.abs(velX) / speed) : 0;
      const dist = camera.position.distanceTo(anchor);
      const closeness = 1 - smoothstep01(10, 34, dist);
      intensity = speedF * (0.4 + 0.6 * sideF) * closeness;
      carveSide = velX >= 0 ? 1 : -1;
    }
    updateLensSplash(dt, intensity, carveSide);
  }
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
  s.points.geometry.attributes.aColor!.needsUpdate = true;
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
  // Two-tone: each grain is randomly one of the two snow values, so the plume
  // always carries a value that breaks against whichever snow it flies over.
  const tone = r() < SPRAY_SHADOW_FRAC ? SPRAY_COLOR_SHADOW : SPRAY_COLOR_SUN;
  s.colors[i * 3] = tone.x;
  s.colors[i * 3 + 1] = tone.y;
  s.colors[i * 3 + 2] = tone.z;
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

// The lens-splash overlay: a 2D canvas laid over the WebGL canvas (a sibling
// in the same container). pointer-events:none so camera clicks pass straight
// through; z-index left default so the body-level HUD still paints on top. A
// MutationObserver mirrors the ski canvas's `display` (main.ts toggles it on
// scene switch) so a mid-melt splat never freezes over the lobby.
function createLensSplash(renderer: THREE.WebGLRenderer): void {
  const gl = renderer.domElement;
  const parent = gl.parentElement;
  if (!parent) return; // no DOM to overlay (e.g. headless) — spray still works
  const canvas = document.createElement("canvas");
  const style = canvas.style;
  style.position = "absolute";
  style.left = "0";
  style.top = "0";
  style.width = "100%";
  style.height = "100%";
  style.pointerEvents = "none";
  style.display = gl.style.display; // start matched to the ski canvas
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  parent.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    parent.removeChild(canvas);
    return;
  }
  lensSplash = {
    canvas,
    ctx,
    splats: [],
    flakeSprites: makeSnowSprites(),
    emitAccum: 0,
    frost: 0,
    wasDrawn: false,
  };

  // Follow the ski canvas in and out (main.ts sets display:none in the lobby).
  // Clear on hide so no splat is frozen on-screen behind the lobby.
  const observer = new MutationObserver(() => {
    canvas.style.display = gl.style.display;
    if (gl.style.display === "none" && lensSplash) {
      lensSplash.splats.length = 0;
      lensSplash.frost = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lensSplash.wasDrawn = false;
    }
  });
  observer.observe(gl, { attributes: true, attributeFilter: ["style"] });

  window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}

// Pre-render a small set of naturalistic snow-clump sprites once at setup. Each
// small flake splat then `drawImage`s one (scaled + rotated), so the detail
// costs no per-frame pathing — just a blit. The director's 2026-07-24 verdict
// killed the six-arm crystal ("tacky … I wanted actual snow particles"): snow on
// glass is *irregular and asymmetric* — packed-powder clumps and scattered fine
// grains, no symmetry, no geometric star. Each variant is a handful of soft
// overlapping blobs at jittered offsets (the wet packed clump) plus a scatter of
// tiny grains around it (the fine powder), painted in the cool LENS_TINT
// snow-white so it stays bible-legal (the read is shape/edge + grain, not a new
// colour). 4 variants so a screenful doesn't read repetitive. Alpha lives in the
// sprite; per-splat fade rides globalAlpha at draw time.
const LENS_SPRITE_VARIANTS = 4;

function makeSnowSprites(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let v = 0; v < LENS_SPRITE_VARIANTS; v++) out.push(makeSnowClump());
  return out;
}

function makeSnowClump(): HTMLCanvasElement {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2;
  // The packed-powder core: 3–5 soft blobs at jittered offsets and sizes. The
  // overlap builds one asymmetric clump with a feathered, non-circular edge —
  // never a clean disc, never symmetric.
  const blobs = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < blobs; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * S * 0.17;
    const bx = cx + Math.cos(ang) * dist;
    const by = cy + Math.sin(ang) * dist;
    const br = S * (0.15 + Math.random() * 0.17);
    const a = 0.34 + Math.random() * 0.24;
    const rg = g.createRadialGradient(bx, by, 0, bx, by, br);
    rg.addColorStop(0, `rgba(${LENS_TINT}, ${a})`);
    rg.addColorStop(0.6, `rgba(${LENS_TINT}, ${a * 0.4})`);
    rg.addColorStop(1, `rgba(${LENS_TINT}, 0)`);
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
  }
  // Scattered fine grains around and over the clump — the flung-powder speckle.
  // Denser toward the center (pow bias), each a tiny soft dot at varied alpha.
  const grains = 12 + Math.floor(Math.random() * 10);
  for (let i = 0; i < grains; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.7) * S * 0.44;
    const gx = cx + Math.cos(ang) * dist;
    const gy = cy + Math.sin(ang) * dist;
    const gr = S * (0.014 + Math.random() * 0.04);
    const a = 0.35 + Math.random() * 0.5;
    const rg = g.createRadialGradient(gx, gy, 0, gx, gy, gr);
    rg.addColorStop(0, `rgba(${LENS_TINT}, ${a})`);
    rg.addColorStop(0.65, `rgba(${LENS_TINT}, ${a * 0.5})`);
    rg.addColorStop(1, `rgba(${LENS_TINT}, 0)`);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(gx, gy, gr, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// Drive the lens splash. `intensity` is 0..1 (how hard snow is flying at the
// lens right now — speed × carve × how close the camera is), `carveSide` biases
// where the splats land toward the direction the spray is thrown.
function updateLensSplash(
  dt: number,
  intensity: number,
  carveSide: number,
): void {
  const ls = lensSplash!;
  const { ctx, canvas, splats } = ls;
  const w = canvas.width;
  const h = canvas.height;
  const minDim = Math.min(w, h);

  // Ease the edge-frost toward the current carve intensity — quick to cake on,
  // slower to melt off — so a sustained hard carve grows a white rim on the lens.
  const frostTarget = Math.min(1, intensity);
  const frostRate = frostTarget > ls.frost ? LENS_FROST_ATTACK : LENS_FROST_DECAY;
  ls.frost += (frostTarget - ls.frost) * Math.min(1, frostRate * dt);
  if (ls.frost < 0.002) ls.frost = 0;

  // Emit — accumulate fractional splats so a low rate still lands them.
  if (intensity > 0.02 && splats.length < LENS_SPLAT_MAX) {
    ls.emitAccum += LENS_SPLAT_RATE * intensity * dt;
    let n = Math.floor(ls.emitAccum);
    ls.emitAccum -= n;
    while (n-- > 0 && splats.length < LENS_SPLAT_MAX) {
      // A `big` splat is a soft round "direct hit"; the rest are small detailed
      // flake stickers (the 2026-07-24 smaller/detailed/sticky direction).
      const big = Math.random() < LENS_BIG_CHANCE;
      // Triangular spread, center-weighted, nudged toward the carve side —
      // that's where the plume is thrown across the fall line.
      const tri = Math.random() + Math.random() - 1;
      const x = w * 0.5 + tri * w * 0.42 + carveSide * w * 0.1 * Math.random();
      // Spray erupts low and rises into frame: land splats across the lower
      // band, then let them drip further down as they melt.
      const y = h * (0.4 + Math.random() * 0.55);
      // Smaller than the make-it-read pass: each flake should read as a *flake*,
      // not a screen-covering blob — the "reads at speed" now comes from detail,
      // count, and how long they cling, not from size.
      const base = (0.013 + Math.random() * 0.026) * minDim;
      splats.push({
        x,
        y,
        r: big ? base * 2.2 : base,
        vy: LENS_SLIDE * (0.5 + Math.random()) * (big ? 1 : 0.7),
        // Flakes barely spread (they cling and melt in place); soft hits smear.
        grow: big ? LENS_MELT * (0.6 + Math.random()) * 1.4 : LENS_MELT * 0.25,
        life: (big ? LENS_LIFE * 1.4 : LENS_LIFE) +
          (Math.random() - 0.5) * LENS_LIFE_VAR,
        maxLife: 0, // set below
        alpha0: (big ? LENS_PEAK_ALPHA : LENS_PEAK_ALPHA * 0.9) *
          (0.6 + Math.random() * 0.4),
        rot: Math.random() * Math.PI * 2,
        sprite: (Math.random() * LENS_SPRITE_VARIANTS) | 0,
        flake: !big,
      });
      const s = splats[splats.length - 1]!;
      s.maxLife = s.life;
    }
  }

  // Integrate + reap.
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i]!;
    s.life -= dt;
    if (s.life <= 0) {
      splats.splice(i, 1);
      continue;
    }
    s.y += s.vy * dt;
    s.r += s.grow * dt;
  }

  // Draw. Skip the clear+repaint entirely when nothing's on screen and nothing
  // was last frame (idle glide costs zero fill — the frost also has to be gone).
  const drawFrost = ls.frost > 0.01;
  if (splats.length === 0 && !drawFrost) {
    if (ls.wasDrawn) {
      ctx.clearRect(0, 0, w, h);
      ls.wasDrawn = false;
    }
    return;
  }
  ctx.clearRect(0, 0, w, h);

  // Edge-frost vignette first (behind the blobs): a soft white rim that packs
  // the lens corners under heavy carve. Center stays fully clear so it never
  // blocks the play read; only the periphery caches snow.
  if (drawFrost) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const outer = Math.hypot(w, h) * 0.5;
    const a = ls.frost * LENS_FROST_PEAK_ALPHA;
    const fg = ctx.createRadialGradient(cx, cy, outer * 0.45, cx, cy, outer);
    fg.addColorStop(0, `rgba(${LENS_TINT}, 0)`);
    fg.addColorStop(0.75, `rgba(${LENS_TINT}, ${a * 0.35})`);
    fg.addColorStop(1, `rgba(${LENS_TINT}, ${a})`);
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, w, h);
  }

  for (const s of splats) {
    const t = s.life / s.maxLife; // 1 at birth → 0 at death
    const age = 1 - t; // 0 at birth → 1 at death
    // Gentle appear as it hits, then a slow melt — `pow(t, 0.5)` holds the flake
    // near-full for most of its (now longer) life and eases it off at the end,
    // the "sticks to the glass then melts slowly" read the director asked for.
    const alpha = s.alpha0 * Math.min(1, age * 12) * Math.sqrt(t);
    if (alpha <= 0.003) continue;
    if (s.flake) {
      // Naturalistic snow clump: blit its pre-rendered variant, rotated to its
      // birth angle and scaled to the current radius. Cheap (no per-frame
      // pathing) and it clings without drip-squash — a clump sits, it doesn't
      // run. A slight stretch along the local axis (rotated per-flake) gives each
      // one a faint directional smear, so it reads as snow flung at an angle onto
      // the glass rather than a centred dot.
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.scale(1.28, 0.82);
      const sprite = ls.flakeSprites[s.sprite] ?? ls.flakeSprites[0]!;
      ctx.drawImage(sprite, -s.r, -s.r, s.r * 2, s.r * 2);
      ctx.restore();
      continue;
    }
    // Soft round "direct hit": a melty smear. Slight vertical squash so it drips
    // rather than stays a clean disc.
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(1, 1.25);
    // Build the gradient in this SAME local space the arc is drawn in (center
    // at 0,0). Canvas gradients are transformed by the CTM at paint time, so an
    // absolute-coord gradient built before the translate landed its center off
    // the arc — every splat then sampled only the transparent tail and drew
    // nothing (the "still no screen splat" bug, 2026-07-23).
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
    g.addColorStop(0, `rgba(${LENS_TINT}, ${alpha})`);
    g.addColorStop(0.5, `rgba(${LENS_TINT}, ${alpha * 0.5})`);
    g.addColorStop(1, `rgba(${LENS_TINT}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ls.wasDrawn = true;
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
// ENCHANTED NIGHT — glowing props (slope-vis 2026-07-24)
//
// The night's lighting model (DESIGN.md Lighting amendment + the IDEAS.md
// night entry, director redirect 2026-07-24): the forest is extremely dark and
// lit by *objects in the world* — emissive glow props that pool light on the
// snow — not a moon fill. This chunk builds that first layer: code-built
// glowing mushroom clusters (real MegaKit props swap in a later chunk) with
// faked additive snow pools. It fades in with the night phase (glowFactor, set
// in applyTimeOfDay) and renders as pure emissive, so it reads "lit" regardless
// of the near-black scene light. Bloom — the halo that makes emissive actually
// *glow* — is now built (slope-vis 2026-07-24): see the bloom NOTE near the top
// of this file and renderSlope; it's night-gated and pushed strong on these caps.
// (A code-built firefly cloud was here too but was cut on the director's look —
// realistic fireflies come from a CC0 pack later; see the IDEAS.md night entry.)
//
// Glow hues are their own ramp, carved out of the daylight 13 the way the
// character ramps were (director sign-off 2026-07-24). Signal red stays
// reserved; none of these fights the cat's scarf.
const GLOW = {
  cyan: 0x5fe9d0, // G1 mushroom cyan
  moss: 0x8cf08a, // G2 luminous moss
  violet: 0xb98cf0, // G3 crystal violet
  amber: 0xf0c06a, // G4 warm lantern
} as const;
const GLOW_HUES = [GLOW.cyan, GLOW.moss, GLOW.violet, GLOW.amber] as const;
// Glow ramps in only past this phase — mushrooms at golden hour would be wrong.
const GLOW_ONSET = 0.55;
// How brightly the emissive caps read at full night (feeds emissiveIntensity;
// pushed higher than 1 so bloom has something to bleed once it lands).
const GLOW_EMISSIVE = 2.2;
// Peak opacity of a prop's additive snow pool at full night.
const POOL_ALPHA = 0.55;

// NOTE (director verdict, 2026-07-24): self-glowing tree trunks are OUT. Two
// passes shipped — a flat emissive up the whole trunk (verdict #3), then a
// base-bright vertical gradient textured by the bark (ref-photo revision) — and
// both were rejected: "the tree glow looks tacky; I don't want the trees to
// glow themselves." The reference photos read as dark tree *silhouettes* against
// an enchanted environment: the glow belongs to the world around the trees
// (ground mushrooms, mist/haze, the light shaft, floating motes), not to the
// wood. All trunk-glow code was removed here; the enchantment is carried by the
// glow field (mushrooms + pools) and the still-to-come environment work. See
// the DESIGN.md "Glowing trunks" note and the ROADMAP / IDEAS night entry.

// A soft round dot (radial white → transparent) — stretched flat, the shape of
// a glow pool on the snow. Generated once, tinted per use by the material's color.
function makeGlowSprite(falloff: number): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(falloff, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Shared, hue-keyed materials so the whole glow field costs one material set,
// like the painted-decor trick. applyGlowPhase scales all of them at once.
let glowCapMaterials: THREE.MeshStandardMaterial[] = [];
let glowPoolMaterials: THREE.MeshBasicMaterial[] = [];
let glowStemMaterial: THREE.MeshStandardMaterial | null = null;

function ensureGlowMaterials(): void {
  if (glowCapMaterials.length) return;
  const poolTex = makeGlowSprite(0.35); // wider soft falloff for a ground pool
  glowCapMaterials = GLOW_HUES.map(
    (hue) =>
      new THREE.MeshStandardMaterial({
        color: 0x0b0f12, // near-black body; the cap reads by its emissive
        emissive: new THREE.Color(hue),
        emissiveIntensity: 0, // brought up by applyGlowPhase
        roughness: 1,
        metalness: 0,
      }),
  );
  glowPoolMaterials = GLOW_HUES.map(
    (hue) =>
      new THREE.MeshBasicMaterial({
        map: poolTex,
        color: new THREE.Color(hue),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
      }),
  );
  glowStemMaterial = new THREE.MeshStandardMaterial({
    color: 0x11161c, // dark stalk — a silhouette holding the cap up
    roughness: 1,
    metalness: 0,
  });
}

interface GlowField {
  readonly group: THREE.Group;
  readonly templates: THREE.Group[]; // one per hue, cloned into the scatter
  readonly placed: Map<string, THREE.Object3D>;
}

// One glowing-mushroom cluster for hue index `h`: a few emissive-capped
// stalks of varied height standing in a shared additive snow pool. Built from
// primitives (the real MegaKit mushrooms replace these next chunk); the
// silhouette and the pool are what sell the read at gameplay distance.
function makeGlowCluster(h: number, rand: () => number): THREE.Group {
  ensureGlowMaterials();
  const cluster = new THREE.Group();
  const capMat = glowCapMaterials[h]!;

  // The snow pool: a flat additive disc under the whole cluster.
  const poolRadius = 1.0 + rand() * 0.8;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(poolRadius * 2, poolRadius * 2),
    glowPoolMaterials[h]!,
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.06; // just above the snow; additive + no depth write
  pool.renderOrder = 1;
  cluster.add(pool);

  const shrooms = 2 + Math.floor(rand() * 3); // 2–4 stalks
  for (let i = 0; i < shrooms; i++) {
    const shroom = new THREE.Group();
    const height = 0.16 + rand() * 0.3;
    const capR = 0.06 + rand() * 0.08;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(capR * 0.32, capR * 0.42, height, 6),
      glowStemMaterial!,
    );
    stem.position.y = height / 2;
    stem.castShadow = false;
    shroom.add(stem);
    // Cap: a squashed dome sitting on the stalk.
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(capR, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      capMat,
    );
    cap.scale.y = 0.7;
    cap.position.y = height;
    cap.castShadow = false;
    shroom.add(cap);
    const a = rand() * Math.PI * 2;
    const r = rand() * poolRadius * 0.6;
    shroom.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    cluster.add(shroom);
  }
  return cluster;
}

function createGlowField(): GlowField {
  const group = new THREE.Group();
  group.visible = false; // off by day; applyGlowPhase turns it on at night
  const templates: THREE.Group[] = [];
  for (let h = 0; h < GLOW_HUES.length; h++) {
    // A deterministic per-hue template, cloned into every scatter cell —
    // same one-material-set economy as the decor. Seeded so it never reshuffles.
    templates.push(makeGlowCluster(h, makeRandom(0x91074 + h * 7919)));
  }
  return { group, templates, placed: new Map() };
}

// Glow scatter recycles along the run exactly like the decor window: sparse
// clusters hugging both treelines, deterministic per cell so a stretch of
// forest always glows the same. Cheap enough to run every frame (a handful of
// live clusters); the group's visibility gates the actual render cost by day.
const GLOW_CELL = 15;
const GLOW_DENSITY = 0.55;

function updateGlowField(field: GlowField, anchorZ: number): void {
  const { group, templates, placed } = field;
  const minZ = anchorZ - DECOR_AHEAD;
  const maxZ = Math.min(anchorZ + DECOR_BEHIND, -4);
  const live = new Set<string>();
  for (const side of [-1, 1]) {
    const first = Math.floor(-maxZ / GLOW_CELL);
    const last = Math.floor(-minZ / GLOW_CELL);
    for (let cell = first; cell <= last; cell++) {
      const key = `${side}:${cell}`;
      live.add(key);
      if (placed.has(key)) continue;
      const random = makeRandom(
        (0x6104 ^ Math.imul(cell, 2654435761)) + side * 104729,
      );
      if (random() > GLOW_DENSITY) {
        placed.set(key, EMPTY_CELL);
        continue;
      }
      const h = Math.floor(random() * templates.length);
      const copy = templates[h]!.clone();
      // Just *outside* the lane edge (never in the driving line — the skier
      // would clip through a mushroom), but close enough that the wide additive
      // pool reaches back into the skiable snow and reads as lane light.
      const x = LANE_EDGE + 0.5 + random() * 7;
      const jitter = random() * 0.8;
      copy.position.set(side * x, 0, -(cell + 0.1 + jitter) * GLOW_CELL);
      copy.rotation.y = random() * Math.PI * 2;
      copy.scale.setScalar(0.85 + random() * 0.6);
      group.add(copy);
      placed.set(key, copy);
    }
  }
  for (const [key, object] of placed) {
    if (live.has(key)) continue;
    if (object !== EMPTY_CELL) group.remove(object);
    placed.delete(key);
  }
}

// NOTE (director, 2026-07-24): the code-built firefly mote cloud was removed —
// too many colors and glued in front of the skier. Realistic fireflies come
// from a CC0 pack in a later chunk (see IDEAS.md night entry).

// Bring the whole enchanted layer in/out with the night phase. Called from
// applyTimeOfDay whenever the phase moves; scales the shared materials so one
// call lights the entire field.
function applyGlowPhase(env: SlopeEnvironment, factor: number): void {
  const on = factor > 0.01;
  env.glow.group.visible = on;
  const ease = on ? factor * factor : 0; // slow start so glow blooms late
  // Bloom rides the same ease so the halo grows in lockstep with the props;
  // 0 by day, which is what lets renderSlope bypass the composer (bloom NOTE).
  if (bloomPass) bloomPass.strength = BLOOM_STRENGTH * ease;
  if (!on) return;
  for (const cap of glowCapMaterials) cap.emissiveIntensity = GLOW_EMISSIVE * ease;
  for (const pool of glowPoolMaterials) pool.opacity = POOL_ALPHA * ease;
}

// ---------------------------------------------------------------------------
// ENCHANTED NIGHT — ground mist (slope-vis 2026-07-24, ref-photo chunk #0)
//
// Josh's reference photos read as dark tree silhouettes standing in luminous
// haze: cool blue mist pooling between and behind the trunks, catching the
// glow, with the driving foreground kept relatively clear. This is that
// near-atmosphere layer — soft additive billboards that hug the snow along the
// treelines (only faint wisps drift across the lane, so hazards stay
// readable), fading in with the night phase a touch ahead of the glow props.
// Nothing emissive touches the wood (director verdict #3: trees stay
// silhouettes); the existing distance Fog still swallows the far forest, this
// is the *near* enchanted haze the photos show. Additive, so it only ever
// lifts the near-black floor into a glow-haze — it never darkens the crushed
// ambient the director asked to protect.

// Mist leads the glow: it starts rolling in at dusk (before GLOW_ONSET 0.55),
// full by night.
const MIST_ONSET = 0.4;
// Recycle window along the run (same scheme as the decor/glow windows).
const MIST_CELL = 12;
const MIST_DENSITY = 0.8;
// A cool night blue — a value shift of snow-shadow #2 (#D3DFF0) toward night.
// This is *atmosphere*, so it comes from the night sky family, not the glow
// ramp; the colored glow the photos show at the light sources comes from the
// additive glow pools shining up into the overlapping mist.
const MIST_COLOR = 0x5a6e9c;

// A soft, slightly uneven puff — a base radial plus a few offset lobes so the
// silhouette doesn't read as a perfect disc. Grayscale; the sprite's color
// tints it. Generated once, shared by every bank.
function makeMistSprite(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const random = makeRandom(0x515c9);
  const puff = (x: number, y: number, r: number, a: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.4})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const c = size / 2;
  puff(c, c, c, 0.9);
  for (let i = 0; i < 5; i++) {
    const a = random() * Math.PI * 2;
    const d = random() * c * 0.5;
    puff(c + Math.cos(a) * d, c + Math.sin(a) * d, c * (0.4 + random() * 0.3), 0.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface MistField {
  readonly group: THREE.Group;
  // Reuses EMPTY_CELL as the "rolled empty" sentinel, like the glow scatter;
  // live cells hold a Sprite.
  readonly placed: Map<string, THREE.Object3D>;
  readonly texture: THREE.CanvasTexture;
}

function createMistField(): MistField {
  const group = new THREE.Group();
  group.visible = false; // off by day; applyMistPhase turns it on at night
  return { group, placed: new Map(), texture: makeMistSprite() };
}

// Non-destructive elapsed clock for the drift sway — its own so it doesn't
// consume the effects clock's delta.
const mistClock = new THREE.Clock();

function updateMistField(field: MistField, anchorZ: number): void {
  // Free by day: nothing to place and nothing placed.
  if (mistFactor <= 0.001 && field.placed.size === 0) return;
  const { group, placed, texture } = field;
  const t = mistClock.getElapsedTime();
  const minZ = anchorZ - DECOR_AHEAD;
  const maxZ = Math.min(anchorZ + DECOR_BEHIND, -4);
  const live = new Set<string>();
  for (const side of [-1, 1]) {
    const first = Math.floor(-maxZ / MIST_CELL);
    const last = Math.floor(-minZ / MIST_CELL);
    for (let cell = first; cell <= last; cell++) {
      const key = `${side}:${cell}`;
      live.add(key);
      if (placed.has(key)) continue;
      const random = makeRandom(
        (0x515c ^ Math.imul(cell, 40503)) + side * 97,
      );
      if (random() > MIST_DENSITY) {
        placed.set(key, EMPTY_CELL);
        continue;
      }
      // Most banks sit in the treeline (where the enchantment lives); an
      // occasional faint wisp crosses the lane at low opacity so the driving
      // line keeps a breath of haze without hiding hazards.
      const central = random() < 0.22;
      const x = central
        ? (random() - 0.5) * LANE_EDGE * 1.2
        : side * (LANE_EDGE + 0.5 + random() * 9);
      const baseY = 0.4 + random() * 1.6;
      const z = -(cell + 0.1 + random() * 0.8) * MIST_CELL;
      const scale = 9 + random() * 10;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          color: new THREE.Color(MIST_COLOR),
          transparent: true,
          opacity: 0, // set each frame from mistFactor below
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: true,
        }),
      );
      // Wider than tall — a low bank, not a ball.
      sprite.scale.set(scale, scale * (0.45 + random() * 0.2), 1);
      sprite.position.set(x, baseY, z);
      sprite.userData = {
        baseX: x,
        baseY,
        baseOpacity: (central ? 0.05 : 0.14) + random() * (central ? 0.04 : 0.09),
        swayAmp: 0.6 + random() * 1.4,
        swaySpeed: 0.05 + random() * 0.09,
        swayPhase: random() * Math.PI * 2,
        bobAmp: 0.15 + random() * 0.35,
      };
      group.add(sprite);
      placed.set(key, sprite);
    }
  }
  // Drift + phase the live banks.
  for (const object of placed.values()) {
    if (!(object instanceof THREE.Sprite)) continue;
    const u = object.userData;
    object.position.x =
      u.baseX + Math.sin(t * u.swaySpeed * 6.283 + u.swayPhase) * u.swayAmp;
    object.position.y =
      u.baseY + Math.sin(t * u.swaySpeed * 4.0 + u.swayPhase) * u.bobAmp;
    (object.material as THREE.SpriteMaterial).opacity = u.baseOpacity * mistFactor;
  }
  // Despawn cells the window has left behind; free each bank's unique material.
  for (const [key, object] of placed) {
    if (live.has(key)) continue;
    if (object !== EMPTY_CELL) {
      group.remove(object);
      (object as THREE.Sprite).material.dispose();
    }
    placed.delete(key);
  }
}

// Bring the haze in/out with the night phase. Turning it off clears the field
// so day pays nothing and no stale banks linger; per-bank opacity while on is
// applied each frame in updateMistField from mistFactor.
function applyMistPhase(field: MistField, factor: number): void {
  const on = factor > 0.01;
  field.group.visible = on;
  if (on) return;
  for (const [key, object] of field.placed) {
    if (object !== EMPTY_CELL) {
      field.group.remove(object);
      (object as THREE.Sprite).material.dispose();
    }
    field.placed.delete(key);
  }
}

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

// (Self-glowing pine trunks were built and then removed — director verdict
// 2026-07-24, "the tree glow looks tacky; I don't want the trees to glow
// themselves." The night enchantment comes from the environment, not the wood.
// See the GLOW-section note above and the DESIGN.md "Glowing trunks" entry.)
