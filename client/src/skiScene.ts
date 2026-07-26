import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { LATERAL_LIMIT } from "@toebeans/shared";
import {
  createLensSplash,
  createSkyDome,
  createSnowDepthMaterial,
  createSnowEffects,
  createSnowMaterial,
  createSnowTrail,
  createSnowfieldGeometry,
  createStarfield,
  createSunBillboard,
  getSnowTextures,
  repaintSkyDome,
  setSnowNightFade,
  updateSnowEffects,
  updateSnowTrail,
  SNOWFIELD_LEAD,
  SNOWFIELD_LENGTH,
  SNOW_Z_STEP,
  type SnowTrail,
} from "./mountainGraphics";
import {
  applyMistPhase,
  applyRayPhase,
  createMistField,
  createRayField,
  nightBloomFactor,
  updateMistField,
  updateRayField,
  updateSlopeDecor,
  type MistField,
  type RayField,
} from "./forestGraphics";
// Preserve the public API: these now live in the feature files but stay
// importable from skiScene.ts so skiRender.ts / main.ts need no change.
export {
  createChasmMesh,
  createCheckpointMarker,
  createTerrainSnowMaterial,
} from "./mountainGraphics";
export {
  loadSlopeDecor,
  buildFrozenLake,
  setDecorGrounded,
} from "./forestGraphics";

// skiScene.ts — the SHARED CORE of the slope's look (2026-07-24 scenery carve,
// see PARALLEL.md). The scenery itself moved to mountainGraphics.ts (ground +
// sky) and forestGraphics.ts (trees + glow + mist); what stays here is the
// foundation both halves depend on: the Art Style Bible palette (day + night),
// the snow-light solve, the day/night time-of-day engine, the shared
// makeRandom PRNG, and the createEnvironment/renderSlope/syncEnvironment
// orchestration + the SlopeEnvironment seam that skiRender.ts (slope-mechanics)
// calls. The engine drives the feature files by calling small functions they
// expose (nightBloomFactor / applyMistPhase / setSnowNightFade / repaintSkyDome);
// the feature files import this core for shared constants, never the reverse
// for their internals. Public API (createEnvironment, syncEnvironment,
// renderSlope, createChasmMesh, createCheckpointMarker, loadSlopeDecor, ...) is
// preserved here — re-exported where a symbol now lives in a feature file — so
// skiRender.ts / main.ts need no change.

/**
 * THE DISTANCE HAZE, as numbers anyone can build against (slope-mech additive,
 * 2026-07-26 — smallest change per PARALLEL.md; these were inline literals).
 *
 * Exported because the fog plane is a CONTRACT, not a private look tweak: anything that
 * spawns, streams or culls with distance has to agree with it or its work becomes
 * visible. The forest scatter's window was sized "past the fog far plane (150)" and then
 * the fog was pulled back to 300 in a different session's file — so trees began
 * materialising 130 units inside clear air, in full view, and the map read as slowly
 * loading in. Derive from these; don't copy the numbers.
 */
export const FOG_NEAR = 80;
export const FOG_FAR = 300;

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
  // Sky: a dim, deep navy at the horizon melting up to near-black overhead.
  // The fog rides the horizon color so distance fades into the sky. Both were
  // lifted (forest-graphics fog pass, 2026-07-25) — the old 0x1e2740/0x0b0f1c
  // pair put a bright, partly-fogged snow band against a near-black sky, and
  // the value cliff between them read as a hard horizon LINE ("the fog doesn't
  // blend, there's a line at the bottom"). Raising the horizon toward the
  // lit-snow value, and the zenith so the sky doesn't crater to black right
  // above it, turns that seam into a continuous horizon glow the ground melts
  // into — real aerial-perspective fog. Still a dark night; the lift is small
  // and lives at the far horizon, so it never washes the near lane.
  skyHorizon: 0x293651,
  skyZenith: 0x121829,
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
export const SUN_DIRECTION = new THREE.Vector3(-0.15, 0.5, -1).normalize();

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

// How far out the sun/moon disc rides from the camera. Must sit BEYOND the
// mountain backdrop ring (radius ≤184, mountainGraphics.ts) so the ridgeline
// OCCLUDES the low dawn sun — it rises behind the peaks instead of being pasted
// in front of them (the "why is the sun in front of the mountain?" callout).
// Still inside the camera's 200u far plane. discScale is tuned to keep the disc
// the same apparent size it had at the old 150u. (2026-07-25, sky fix.)
const DISC_DISTANCE = 192;

export const SLOPE_LENGTH = 100;
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
  // Enchanted-night atmosphere (fades in with the night phase).
  readonly mist: MistField; // drifting cool haze banks along the treeline
  readonly rays: RayField; // moonlight shafts breaking through the canopy
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

// Small deterministic PRNG (mulberry32) so seeded scatter never shifts between
// loads — a shared foundation used by both graphics halves (mountain snow
// textures, forest decor/glow/mist).
export function makeRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The billboard placement direction for the current phase — syncEnvironment
// reads it each frame to hang the sun/moon. Lerped in applyTimeOfDay.
const currentDiscDir = SUN_BILLBOARD_DIRECTION.clone();

// --- Enchanted-night bloom (slope-vis 2026-07-24) --------------------------
// The moonlight-ray shafts read as light but not *glowing* without a halo
// bleeding off their bright tops. (This bloom was first built for the emissive
// glowing-plant props; those were removed 2026-07-25, and the rays now feed it.)
// Technique: a full-scene UnrealBloomPass with a luminance threshold. It looks
// like it would blow out the daytime snow, but it never runs by day — bloom
// strength rides the night factor (0 until dusk), and renderSlope bypasses the
// composer entirely while strength is ~0, so the crisp high-key daylight is
// byte-identical to before. At night the scene is crushed near-black, so the
// only pixels above threshold are the bright ray tops: the full-scene bloom is
// *naturally* selective to them, no per-object bloom layer needed. Held at
// module scope like the mist singleton — there is only ever one slope environment.
let bloomComposer: EffectComposer | null = null;
let bloomPass: UnrealBloomPass | null = null;
// Peak strength at full night. History: 1.5 → 2.2 to "increase the bloom,"
// then back to 1.5 (forest-graphics, 2026-07-25) — the 2.2 + GLOW_EMISSIVE 3.5
// pairing didn't enlarge the halo, it piled brightness back onto the mushroom
// caps ("the bloom increase just brightened the mushrooms"). The halo is grown
// the correct way now: WIDER radius + LOWER threshold spread the same light
// into a soft glow, while the caps themselves sit dimmer (GLOW_EMISSIVE 2.0).
const BLOOM_STRENGTH = 1.5;
// Halo spread. Widened 0.7 → 0.9 so the glow feathers out further from each
// cap — this is what actually makes a mushroom read as *glowing* rather than
// just bright, without over-driving the source.
const BLOOM_RADIUS = 0.9;
// Lowered 0.55 → 0.42 so the now-dimmer caps and their pools still clear the
// threshold and bloom. The night snow/mist still sit well below this (the
// scene is crushed near-black), so they never smear.
const BLOOM_THRESHOLD = 0.42;

// Output dither (forest-graphics, 2026-07-25 — "night fog still shows sharp
// horizontal banding"). The banding Josh saw was NOT the mist and NOT the fog
// curve (scene.fog is linear + smooth): it was plain 8-bit POSTERIZATION. At
// night the whole frame lives in a tiny dark value range (sky navy 0x121829→
// 0x293651, snow 0x12182b→0x4e608a fogged toward the horizon), so a smooth
// gradient rounds to a handful of adjacent 8-bit codes and each code paints a
// wide flat terrace — the "steps across the fogged snow" and the stepped sky.
// Fix: a final ordered-dither pass on the composited image, applied in display
// space just before the 8-bit write, so the quantization boundary is scattered
// into imperceptible noise instead of a hard contour. Amplitude ~1 LSB (±1/255)
// via a triangular-PDF interleaved-gradient-noise dither, keyed on gl_FragCoord
// (screen-static, no temporal shimmer). It only runs inside the night-bloom
// composer, i.e. exactly when the scene is dark enough to band; daytime bypasses
// the composer entirely so the high-key look is byte-identical.
const DitherShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    // Interleaved gradient noise — a cheap ordered dither pattern.
    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Two decorrelated samples → triangular PDF in [-1, 1] LSB.
      float n = ign(gl_FragCoord.xy) - ign(gl_FragCoord.xy + vec2(3.7, 1.3));
      c.rgb += n * (1.0 / 255.0);
      gl_FragColor = c;
    }`,
};

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
  setSnowNightFade(k);

  // The night bloom ramps in only past dusk; nightBloomFactor (forest) gates
  // itself and returns the eased factor that drives the core-owned bloom, which
  // the moonlight rays' bright tops feed.
  const bloomEase = nightBloomFactor(k);
  if (bloomPass) bloomPass.strength = BLOOM_STRENGTH * bloomEase;

  // Ground mist leads the bloom slightly (dusk fog rolling in before night
  // settles); applyMistPhase (forest) gates itself on the phase.
  applyMistPhase(env.mist, k);

  // Moonlight shafts come in with the glow; applyRayPhase (forest) gates itself
  // on the phase. Their bright tops feed the same night bloom as the props.
  applyRayPhase(env.rays, k);
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
  //
  // Pulled back (mountain-graphics, 2026-07-25): the old 35→150 saturated the
  // whole mid-distance to flat dawn-pink well inside the camera's far=200, so
  // the open summit — where you stand at the top and should SEE the run drop
  // away — was a pink wall a stone's throw ahead. 60→195 keeps the foreground
  // crisp and lets the descending slope read most of the way to the far plane,
  // hazing gently into the peak vista instead of hitting a curtain. Still a real
  // aerial-perspective cue (farther = pinker), just over a believable depth.
  scene.fog = new THREE.Fog(PALETTE.dawnPink, FOG_NEAR, FOG_FAR);

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

  // Enchanted-night atmosphere: the drifting haze banks. Off by day, faded in
  // with the night phase (a touch ahead of the moonlight rays).
  const mist = createMistField();
  scene.add(mist.group);

  // Enchanted-night moonlight: the god-ray shafts through the canopy. Off by
  // day; faded in with the night phase. Bloom haloes their bright tops.
  const rays = createRayField();
  scene.add(rays.group);

  const environment: SlopeEnvironment = {
    sun,
    ambient,
    skyDome,
    sunBillboard,
    stars,
    slope,
    trail,
    mist,
    rays,
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
    discScale: 44, // = 34 × (DISC_DISTANCE/150): same apparent size, farther out
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
    discScale: 28, // the moon reads smaller/crisper; = 22 × (DISC_DISTANCE/150)
    discOpacity: 1,
    discDir: MOON_BILLBOARD_DIRECTION.clone(),
    stars: 1,
  };
  activeEnvironment = environment;
  activeScene = scene;

  // Night-bloom composer (see the bloom NOTE up top). RenderPass draws the
  // scene, UnrealBloomPass bleeds the bright moonlight-ray tops, OutputPass does
  // the tone-map + sRGB convert so the composited image matches a straight
  // render. Strength starts at 0 (day) and is driven each phase change by
  // nightBloomFactor; the composer is only ever used once strength climbs.
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
  // Final ordered-dither pass (see DitherShader) — kills the 8-bit posterization
  // banding on the dark night sky/snow gradients. Added last so EffectComposer
  // renders it to screen (OutputPass's sRGB/tonemap output lands in the half-
  // float buffer, the dither is added just before the 8-bit write).
  bloomComposer.addPass(new ShaderPass(DitherShader));
  // Keep the composer's render targets matched to the canvas. main.ts resizes
  // the renderer; this rides the same event for the composer's own buffers.
  window.addEventListener("resize", () => {
    bloomComposer?.setSize(window.innerWidth, window.innerHeight);
  });

  applyTimeOfDay(timeOfDay); // re-assert whatever phase persisted across runs

  return environment;
}

/**
 * Draw the slope. At night the moonlight rays need a bloom halo on their bright
 * tops, so we composite through the bloom pass; by day bloom
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
  // The haze banks ride the same window and drift on their own clock. Also a
  // cheap no-op by day (mistFactor 0, nothing placed).
  updateMistField(environment.mist, anchor.z);
  // The moonlight shafts ride the same window and shimmer on their own clock.
  // Cheap no-op by day (rayFactor 0, nothing placed).
  updateRayField(environment.rays, anchor.z);
  environment.skyDome.position.copy(camera.position);
  environment.stars.position.copy(camera.position);
  // The disc direction is the current time-of-day's (lerped in applyTimeOfDay)
  // — the sun sits near the horizon, the moon a little higher.
  environment.sunBillboard.position
    .copy(camera.position)
    .addScaledVector(currentDiscDir, DISC_DISTANCE);
  // Loose snow — spray kicked off the skis, flurries drifting past the
  // lens. Reads the skier's speed straight off the anchor's motion (no new
  // seam field) and its own frame clock; see updateSnowEffects.
  updateSnowEffects(anchor, camera, trailInput);
}
