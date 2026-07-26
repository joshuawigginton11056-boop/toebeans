// forestGraphics.ts — everything growing on and glowing over the slope
// (forest-graphics session). Split out of skiScene.ts on 2026-07-24 (the
// scenery carve — see PARALLEL.md): trees, decor scatter, treelines, the
// painted-detail texturing, the drifting mist banks, and the moonlight shafts
// breaking through the canopy. (The enchanted-night glowing plants — mushroom
// clusters + snow pools + cast lights — were removed 2026-07-25; see the NIGHT
// BLOOM ONSET note below.) The shared day/night engine + palette live in the
// core (skiScene.ts), which imports and drives what this file builds;
// nightBloomFactor/applyMistPhase/applyRayPhase are called by the core engine
// with the raw time-of-day phase and gate themselves.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BRANCH_SEGMENTS, LATERAL_LIMIT } from "@toebeans/shared";
import { LANE_EDGE, makeRandom } from "./skiScene";
import {
  segmentCenterline,
  segmentToWorld,
  trailGroundHeightAtZ,
} from "./slopePath";

// How "on" the ground mist is (0 by day, 1 at full night) — set by
// applyMistPhase from the time-of-day phase and read each frame in
// updateMistField to fade the banks. Lives here with the mist it drives.
let mistFactor = 0;

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

// GRADE GROUNDING (forest-graphics, 2026-07-25). The scatter is laid out in raw
// world Z and used to pin every tree to y = 0 — fine on the flat Overlook, but on
// the BRANCHING map the run rides a graded mountain (y ≈ 140–280), so the trees sat
// down on the distant valley floor: a green band on the horizon that never rose to
// meet the frozen lake (which IS on the grade). When true, each tree is lifted to the
// graded ground at its Z (trailGroundHeightAtZ) so the forest surrounds the skier and
// the lake reads as a clearing after it. Off by default so the Overlook stays flat;
// main.ts turns it on beside addBranchTerrain/buildFrozenLake.
let decorGrounded = false;
export function setDecorGrounded(on: boolean): void {
  decorGrounded = on;
}

export function updateSlopeDecor(anchorZ: number): void {
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
        const treeZ = -(cell + 0.1 + jitter) * band.cellSize;
        // Sit on the graded mountain (branching map) instead of the y=0 valley floor.
        const treeY = decorGrounded ? trailGroundHeightAtZ(treeZ) : 0;
        copy.position.set(side * x, treeY, treeZ);
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
// NIGHT BLOOM ONSET
//
// The enchanted-night GLOWING PLANTS — code-built mushroom clusters, their
// additive snow pools, and the hue-matched cast PointLights — were REMOVED
// here on Josh's call (2026-07-25, "remove the glowing plants from the
// forest"). What survives is the night-bloom onset the moonlight rays still
// ride: the rays' bright tops feed the core bloom pass, which ramps from this
// phase (see nightBloomFactor below and skiScene.ts's applyTimeOfDay). The old
// glow-prop machinery (hues, emissive/pool/cast-light tuning, and the earlier
// rejected self-glowing trunks) is preserved in git history and the DESIGN.md
// night notes. makeGlowSprite (below) is kept — the ray landing pool reuses it.

// Night bloom ramps in only past this phase — nothing enchanted at golden hour.
const NIGHT_BLOOM_ONSET = 0.55;

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

// NOTE (director, 2026-07-24): the code-built firefly mote cloud was removed —
// too many colors and glued in front of the skier. Realistic fireflies come
// from a CC0 pack in a later chunk (see IDEAS.md night entry).

// The eased night factor that sizes the core-owned night bloom. Called from
// applyTimeOfDay whenever the phase moves; the moonlight rays' bright tops feed
// the bloom pass this scales (bloom lives in the core — see skiScene.ts's
// applyTimeOfDay). Formerly applyGlowPhase, which also lit the now-removed glow
// props; with the glowing plants gone it only reports this factor.
export function nightBloomFactor(phase: number): number {
  // Gate on NIGHT_BLOOM_ONSET (dusk) so the core engine just passes the raw
  // phase. Returns the eased 0..1 factor; the ease is a slow start so the bloom
  // blooms late.
  const factor = Math.min(
    1,
    Math.max(0, (phase - NIGHT_BLOOM_ONSET) / (1 - NIGHT_BLOOM_ONSET)),
  );
  return factor > 0.01 ? factor * factor : 0; // slow start so bloom blooms late
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

// Distance falloff (fog-pass 2026-07-25). The banks are ADDITIVE, so without a
// far fade the many cells the perspective stacks toward the end of the window
// (DECOR_AHEAD 170, past the fog's far=150) sum into a bright wall that stops
// dead at the window edge — a hard "the fog ends here" line at the horizon, the
// opposite of floating haze. Fade each bank out over this forward-distance band
// so the mist thins into the distance and dissolves before it can pile up. Near
// and mid banks (the haze you actually drive through) stay at full strength.
const MIST_FADE_START = 50; // full haze up to here (metres ahead of the anchor)
const MIST_FADE_END = 130; // gone by here — before the horizon can wall up

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

export interface MistField {
  readonly group: THREE.Group;
  // Reuses EMPTY_CELL as the "rolled empty" sentinel, like the glow scatter;
  // live cells hold a Sprite.
  readonly placed: Map<string, THREE.Object3D>;
  readonly texture: THREE.CanvasTexture;
}

export function createMistField(): MistField {
  const group = new THREE.Group();
  group.visible = false; // off by day; applyMistPhase turns it on at night
  return { group, placed: new Map(), texture: makeMistSprite() };
}

// Non-destructive elapsed clock for the drift sway — its own so it doesn't
// consume the effects clock's delta.
const mistClock = new THREE.Clock();

export function updateMistField(field: MistField, anchorZ: number): void {
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
    // Fade banks out with forward distance so the far ones never stack into a
    // bright additive wall (see MIST_FADE_START/END). dAhead > 0 is ahead of the
    // anchor; behind-camera banks (negative) stay at full strength.
    const dAhead = anchorZ - object.position.z;
    const f = Math.min(
      1,
      Math.max(0, (dAhead - MIST_FADE_START) / (MIST_FADE_END - MIST_FADE_START)),
    );
    const distFade = 1 - f * f * (3 - 2 * f);
    (object.material as THREE.SpriteMaterial).opacity =
      u.baseOpacity * mistFactor * distFade;
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
export function applyMistPhase(field: MistField, phase: number): void {
  // Gate on MIST_ONSET here (a touch before the glow) and store mistFactor for
  // updateMistField to fade each bank by. The core engine passes the raw phase.
  mistFactor = Math.min(1, Math.max(0, (phase - MIST_ONSET) / (1 - MIST_ONSET)));
  const on = mistFactor > 0.01;
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
// ENCHANTED NIGHT — moonlight shafts (slope-vis 2026-07-25, env look #0)
//
// The other half of the environmental night look (director redirect: "only a
// few rays of moonlight breaking through") and the most prominent element of
// reference photo 2 — a bright misty shaft raking down through a canopy gap.
// Faked god-ray cones the cheap, view-stable way: each shaft is two crossed
// vertical quads wearing a soft top-bright/base-transparent gradient, additive,
// so from any horizontal angle the camera sees a soft volume of light, not a
// blade. A soft additive pool marks where the beam lands on the snow. The
// gradient fades to nothing at the base ON PURPOSE — the bright part lives high
// in the canopy, so a shaft over the lane never washes out the driving surface
// where the skier actually is (the recurring night-readability rule). Shafts
// lean down-lane along the incoming moonlight (RAY_DIR), scatter sparsely with
// the decor/glow/mist windows, and fade in with the night phase. Nothing here
// touches the wood — trees stay dark silhouettes (director verdict #3).
//
// Tuning knobs (live look-pass): RAY_ONSET, RAY_CELL/RAY_DENSITY,
// RAY_CENTRAL_CHANCE, RAY_COLOR, and the per-shaft opacity/size ranges in
// makeRayShaft. Bloom (core, skiScene.ts) haloes the bright shaft tops for free
// once night lands.

// A cool pale moonlight — a bright value shift of snow-shadow #2 (#D3DFF0)
// toward the moon disc; stays in the palette's night family, never signal red.
const RAY_COLOR = 0xbfd4f2;
// Rays are deep-night moonlight: they come in with the glow (a touch before its
// GLOW_ONSET 0.55) and ease in slow so they bloom late.
const RAY_ONSET = 0.5;
// Sparse — "a few rays," not a forest of beams. One potential shaft per this
// many metres of run, and even then only RAY_DENSITY of the cells spawn one.
// Thinned 0.7 → 0.45 on the director's "too strong / randomly dropped in" call
// (2026-07-25): fewer beams read as real breaks in the canopy, not a lightshow.
const RAY_CELL = 30;
const RAY_DENSITY = 0.45;
// How often a shaft is a central hero beam over the lane (ref photo 2) rather
// than a treeline-flank shaft. Cut 0.32 → 0.12 (same call): a beam standing
// straight over the open lane is exactly what read as a "spotlight dropped in."
// Almost all shafts now rake in from the treeline, filtering past the trunks.
const RAY_CENTRAL_CHANCE = 0.12;

// Base→top direction of a shaft: angled, leaning down-lane (−z, toward the
// moon's azimuth) and a touch left, so the beams rake in from the moon rather
// than dropping straight down. Was near-vertical (−0.15, 1.7, −1) ≈ 30° off
// plumb, which still read as a spotlight; leaned to ~42° off plumb (director,
// 2026-07-25: "should be angled from the moon, come around the tree leaves").
// Still steeper than the moon's own low elevation so the shafts stand up in the
// canopy instead of lying flat across the snow.
const RAY_DIR = new THREE.Vector3(-0.25, 1.25, -1.1).normalize();
const rayQuat = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 1, 0),
  RAY_DIR,
);

// A soft vertical light-shaft mask: a hint of fade-in at the very top (emerging
// from the canopy), full through the upper third, easing to transparent at the
// base, with soft feathered sides. Grayscale; the material's color tints it.
// Generated once, shared by every shaft.
function makeRaySprite(): THREE.CanvasTexture {
  const w = 64;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // Vertical falloff (canvas top = shaft top).
  const vert = ctx.createLinearGradient(0, 0, 0, h);
  vert.addColorStop(0, "rgba(255,255,255,0.55)");
  vert.addColorStop(0.12, "rgba(255,255,255,0.95)");
  vert.addColorStop(0.5, "rgba(255,255,255,0.5)");
  vert.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = vert;
  ctx.fillRect(0, 0, w, h);
  // Multiply by a horizontal core so the beam is soft-sided from any angle the
  // crossed quads present.
  ctx.globalCompositeOperation = "destination-in";
  const horiz = ctx.createLinearGradient(0, 0, w, 0);
  horiz.addColorStop(0, "rgba(255,255,255,0)");
  horiz.addColorStop(0.5, "rgba(255,255,255,1)");
  horiz.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = horiz;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface RayField {
  readonly group: THREE.Group;
  // Reuses EMPTY_CELL as the "rolled empty" sentinel; live cells hold a shaft
  // cluster whose userData carries its materials + shimmer params.
  readonly placed: Map<string, THREE.Object3D>;
  readonly shaftTex: THREE.CanvasTexture;
  readonly poolTex: THREE.CanvasTexture;
}

export function createRayField(): RayField {
  const group = new THREE.Group();
  group.visible = false; // off by day; applyRayPhase turns it on at night
  return {
    group,
    placed: new Map(),
    shaftTex: makeRaySprite(),
    poolTex: makeGlowSprite(0.4), // reuse the glow-pool sprite for the landing
  };
}

// One moonlight shaft: crossed additive quads leaning along RAY_DIR, base
// pinned to the snow, plus a soft ground pool. Its own materials (few shafts
// live at once) so each can shimmer on its own phase; disposed on despawn.
function makeRayShaft(
  field: RayField,
  rand: () => number,
  central: boolean,
): THREE.Group {
  const cluster = new THREE.Group();
  const tint = new THREE.Color(RAY_COLOR);
  // Narrower than before (director "too strong": 2026-07-25) — a thin raking
  // ray reads as light through a canopy gap, a wide one reads as a spotlight.
  const width = central ? 2.5 + rand() * 1.5 : 1.5 + rand() * 1.1;
  const height = central ? 26 + rand() * 9 : 20 + rand() * 9;

  const shaftMat = new THREE.MeshBasicMaterial({
    map: field.shaftTex,
    color: tint,
    transparent: true,
    opacity: 0, // set each frame from rayFactor + shimmer
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  // Pivot at the base so the beam plants on the snow (y=0) and towers up.
  const shaftGeo = new THREE.PlaneGeometry(width, height);
  shaftGeo.translate(0, height / 2, 0);
  const shaftGroup = new THREE.Group();
  shaftGroup.quaternion.copy(rayQuat);
  for (let i = 0; i < 2; i++) {
    const quad = new THREE.Mesh(shaftGeo, shaftMat);
    quad.rotation.y = (i * Math.PI) / 2; // crossed pair reads volumetric
    quad.renderOrder = 2;
    shaftGroup.add(quad);
  }
  cluster.add(shaftGroup);

  // The pool where the beam meets the snow.
  const poolMat = new THREE.MeshBasicMaterial({
    map: field.poolTex,
    color: tint,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });
  const poolR = width * (central ? 1.2 : 1.0);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(poolR * 2, poolR * 2),
    poolMat,
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.05;
  pool.renderOrder = 1;
  cluster.add(pool);

  cluster.userData = {
    shaftMat,
    poolMat,
    // Roughly halved (director "moon beams too strong", 2026-07-25). The pool
    // is cut hardest of all: a bright disc directly under a beam is the single
    // biggest "spotlight" tell, so it's now only a faint kiss of light where
    // the raking shaft grazes the snow, not a stage spot.
    baseShaft: central ? 0.15 : 0.08 + rand() * 0.06,
    basePool: central ? 0.11 : 0.06 + rand() * 0.05,
    shimmerPhase: rand() * Math.PI * 2,
    shimmerSpeed: 0.15 + rand() * 0.25,
  };
  return cluster;
}

// Its own clock so the shimmer doesn't consume another layer's delta.
const rayClock = new THREE.Clock();
// 0 by day, eased 0..1 through night — set by applyRayPhase, read per frame.
let rayFactor = 0;

export function updateRayField(field: RayField, anchorZ: number): void {
  if (rayFactor <= 0.001 && field.placed.size === 0) return;
  const { group, placed } = field;
  const t = rayClock.getElapsedTime();
  const minZ = anchorZ - DECOR_AHEAD;
  const maxZ = Math.min(anchorZ + DECOR_BEHIND, -4);
  const live = new Set<string>();
  const first = Math.floor(-maxZ / RAY_CELL);
  const last = Math.floor(-minZ / RAY_CELL);
  for (let cell = first; cell <= last; cell++) {
    const key = `${cell}`;
    live.add(key);
    if (placed.has(key)) continue;
    const random = makeRandom((0x7a11 ^ Math.imul(cell, 2246822519)) + 131);
    if (random() > RAY_DENSITY) {
      placed.set(key, EMPTY_CELL);
      continue;
    }
    const central = random() < RAY_CENTRAL_CHANCE;
    const side = random() < 0.5 ? -1 : 1;
    // Central hero beams sit over the lane; flank beams stand just past the
    // treeline edge, raking in from the side.
    const x = central
      ? (random() - 0.5) * LANE_EDGE
      : side * (LANE_EDGE + 1 + random() * 8);
    const z = -(cell + 0.1 + random() * 0.8) * RAY_CELL;
    const cluster = makeRayShaft(field, random, central);
    cluster.position.set(x, 0, z);
    group.add(cluster);
    placed.set(key, cluster);
  }
  // Fade + shimmer the live shafts (mist drifting through a beam makes it
  // breathe; a slow per-shaft sine fakes it cheaply).
  for (const object of placed.values()) {
    if (object === EMPTY_CELL) continue;
    const u = object.userData;
    const shimmer =
      0.82 + 0.18 * Math.sin(t * u.shimmerSpeed * 6.283 + u.shimmerPhase);
    (u.shaftMat as THREE.Material).opacity = u.baseShaft * rayFactor * shimmer;
    (u.poolMat as THREE.Material).opacity = u.basePool * rayFactor * shimmer;
  }
  // Despawn behind the window; free each shaft's geometry + materials.
  for (const [key, object] of placed) {
    if (live.has(key)) continue;
    if (object !== EMPTY_CELL) {
      group.remove(object);
      disposeRayCluster(object);
    }
    placed.delete(key);
  }
}

function disposeRayCluster(cluster: THREE.Object3D): void {
  cluster.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  const u = cluster.userData;
  (u.shaftMat as THREE.Material | undefined)?.dispose();
  (u.poolMat as THREE.Material | undefined)?.dispose();
}

// Bring the shafts in/out with the night phase; called from applyTimeOfDay.
// Turning off clears the field so day pays nothing and no stale beams linger.
export function applyRayPhase(field: RayField, phase: number): void {
  const raw = Math.min(1, Math.max(0, (phase - RAY_ONSET) / (1 - RAY_ONSET)));
  rayFactor = raw * raw; // slow start so the beams bloom in late
  const on = rayFactor > 0.01;
  field.group.visible = on;
  if (on) return;
  for (const [key, object] of field.placed) {
    if (object !== EMPTY_CELL) {
      field.group.remove(object);
      disposeRayCluster(object);
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

// ---------------------------------------------------------------------------
// THE FROZEN LAKE (forest-graphics, 2026-07-25)
//
// The §4 map's second area is the FROZEN LAKE (route.ts's `lake` segment): the
// run leaves the enchanted forest and crosses a sheet of ice, the frozen-lake
// gap (the `lake-gap` chasm at segment-distance 50) the jump every route learns
// here. Until now that segment was dressed exactly like the rest of the run —
// open graded snow — so "the frozen lake" existed only in the sim. This lays the
// ice: a glassy blue sheet skinned onto the lane across the lake segment, frosting
// into the snow at its shores and broken by the gap you leap.
//
// PLACEMENT. Like the chasm/checkpoint meshes (skiRender.ts), the sheet follows
// segmentCenterline("lake", s).y — the REAL graded ground the skier rides — not
// the flat dressed snowfield (which sits at y=0, the parked grade-seam). So the
// ice sits flush on the terrain wherever the run actually is, and stays glued to
// it if the corridor curve ever turns on (segmentToWorld carries the x/z). Built
// ONCE, branching-map only (called beside addBranchTerrain in main.ts) — the flat
// Overlook never visits the lake segment.
//
// LOOK. A cool ice-blue that catches a hard specular glint off the low sun / moon
// (roughness 0.22), so the sheet reads as glass by day and moonlit ice at night
// for free — no time-of-day special-casing. The colour + cracks live in a seeded
// canvas texture; per-vertex ALPHA fades the sheet to nothing at its lateral
// shores and at the torn edges of the gap, letting the white snow terrain show
// through as a frosted shoreline instead of a hard-cut rectangle of ice.

// The lane is flat across |lateral| ≤ LATERAL_LIMIT (12); the ice fills it and
// laps one unit up the bank, where its alpha has already faded to a frosted shore.
const ICE_HALF = LATERAL_LIMIT + 1;
// Sit a hair above the flat lane so it never z-fights the terrain beneath it.
const ICE_LIFT = 0.04;
// Keep the ice off the segment seams (forest→lake, lake→runout) so it reads as a
// lake WITHIN the area, not an abrupt wall of ice at the boundary.
const ICE_END_INSET = 5;
// Clear this much ice back from each side of the gap chasm so the jump reads as
// torn-open water/ice, with a frosted broken rim (the longitudinal end-fade).
const ICE_GAP_MARGIN = 1.6;

// Lateral columns (fractions of ICE_HALF), denser near the shore for a clean
// alpha fade; the matching alpha per column frosts the edge into the snow.
const ICE_COLS = [-1, -0.86, -0.62, -0.32, 0, 0.32, 0.62, 0.86, 1];
const iceEdgeAlpha = (frac: number): number => {
  // Full ice out to |frac| 0.66, then smoothstep to 0 at the shore.
  const t = Math.min(1, Math.max(0, (Math.abs(frac) - 0.66) / (1 - 0.66)));
  return 1 - t * t * (3 - 2 * t);
};
// Fade the ice down over this many metres at each ribbon end (segment inset ends
// AND the torn gap edges) so ice never stops on a hard line.
const ICE_END_FADE = 3.5;

// A seeded ice canvas: an ice-blue base, soft frost blotches, a scatter of
// light-catching sparkle, and a thin branching CRACK network — the colour the
// material wears (vertex colour only carries the shore alpha). Tiled, so it wraps.
let iceTexture: THREE.CanvasTexture | null = null;
function getIceTexture(): THREE.CanvasTexture {
  if (iceTexture) return iceTexture;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const random = makeRandom(0x1cef);
  // Base ice blue (a cooler, deeper cousin of snow-shadow #D3DFF0).
  ctx.fillStyle = "#a7c4e4";
  ctx.fillRect(0, 0, size, size);
  // Soft frost blotches — large pale patches, tiled so they wrap at the seams.
  const blot = (x: number, y: number, r: number, hex: string, a: number): void => {
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, hex);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = a;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
  };
  for (let i = 0; i < 14; i++) {
    blot(random() * size, random() * size, 40 + random() * 90, "#d6e6f6", 0.5);
  }
  for (let i = 0; i < 6; i++) {
    blot(random() * size, random() * size, 24 + random() * 40, "#eef6ff", 0.55);
  }
  ctx.globalAlpha = 1;
  // Cracks: a few trunks, each throwing short branches. Dark hairline core with a
  // faint bright edge so the ice reads as fractured glass, not painted lines.
  const crack = (
    x: number,
    y: number,
    ang: number,
    len: number,
    depth: number,
  ): void => {
    let cx = x;
    let cy = y;
    let a = ang;
    const steps = Math.max(2, Math.floor(len / 10));
    ctx.lineCap = "round";
    for (let i = 0; i < steps; i++) {
      const nx = cx + Math.cos(a) * 10;
      const ny = cy + Math.sin(a) * 10;
      ctx.strokeStyle = "rgba(240,248,255,0.5)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      ctx.strokeStyle = "rgba(96,124,160,0.55)";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      cx = nx;
      cy = ny;
      a += (random() - 0.5) * 0.5;
      if (depth > 0 && random() < 0.25) {
        crack(cx, cy, a + (random() - 0.5) * 1.6, len * 0.5, depth - 1);
      }
    }
  };
  for (let i = 0; i < 7; i++) {
    crack(random() * size, random() * size, random() * Math.PI * 2, 90 + random() * 120, 2);
  }
  // A dusting of sparkle grains (the ice catching stray light).
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = random() < 0.5 ? "rgba(255,255,255,0.8)" : "rgba(210,230,250,0.7)";
    const s = 0.8 + random() * 1.4;
    ctx.fillRect(random() * size, random() * size, s, s);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  iceTexture = texture;
  return iceTexture;
}

// Build one ice ribbon over segment-distances [s0, s1] of the lake segment: a
// flat grid on the graded lane, frosting to alpha 0 at the shores and the two
// ends. Returns the mesh (or null if the span is too short to bother with).
function buildIceRibbon(s0: number, s1: number): THREE.Mesh | null {
  const span = s1 - s0;
  if (span < 4) return null;
  const rows = Math.max(2, Math.ceil(span / 1.5) + 1);
  const cols = ICE_COLS.length;
  const positions = new Float32Array(rows * cols * 3);
  const colors = new Float32Array(rows * cols * 4);
  const uvs = new Float32Array(rows * cols * 2);
  for (let i = 0; i < rows; i++) {
    const s = s0 + (i / (rows - 1)) * span;
    const centerY = segmentCenterline("lake", s).y;
    // End fade: distance to the nearer ribbon end, ramped over ICE_END_FADE.
    const endT = Math.min(1, Math.min(s - s0, s1 - s) / ICE_END_FADE);
    const endFade = endT * endT * (3 - 2 * endT);
    for (let j = 0; j < cols; j++) {
      const frac = ICE_COLS[j]!;
      const lat = frac * ICE_HALF;
      const w = segmentToWorld("lake", s, lat);
      const k3 = (i * cols + j) * 3;
      positions[k3] = w.x;
      positions[k3 + 1] = centerY + ICE_LIFT;
      positions[k3 + 2] = w.z;
      const k4 = (i * cols + j) * 4;
      colors[k4] = 1;
      colors[k4 + 1] = 1;
      colors[k4 + 2] = 1;
      colors[k4 + 3] = iceEdgeAlpha(frac) * endFade;
      const k2 = (i * cols + j) * 2;
      uvs[k2] = frac * 1.4; // across
      uvs[k2 + 1] = s * 0.1; // along (repeat every 10 m)
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = i * cols + j + 1;
      const c = (i + 1) * cols + j;
      const d = (i + 1) * cols + j + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: getIceTexture(),
      vertexColors: true, // RGBA — carries the shore/gap alpha fade
      transparent: true,
      roughness: 0.22, // glassy: a hard specular glint off the sun / moon
      metalness: 0,
      // Center is opaque, so writing depth keeps the sheet solid; only the thin
      // frosted rim blends over the snow beneath.
      depthWrite: true,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

// Lay the frozen lake across the `lake` segment, leaving a torn gap around each
// of its chasms (the jump). Branching-map only; call once at run setup.
export function buildFrozenLake(scene: THREE.Scene): void {
  const seg = BRANCH_SEGMENTS.lake;
  if (!seg) return;
  const lake = new THREE.Group();
  lake.name = "frozenLake";
  // The ice spans the segment (inset from both seams), split into ribbons around
  // each chasm gap. Walk left→right, closing a ribbon before every gap.
  const gaps = seg.chasms
    .map((c) => ({ from: c.start - ICE_GAP_MARGIN, to: c.start + c.width + ICE_GAP_MARGIN }))
    .sort((a, b) => a.from - b.from);
  let cursor = ICE_END_INSET;
  const end = seg.length - ICE_END_INSET;
  for (const gap of gaps) {
    if (gap.from > cursor) {
      const ribbon = buildIceRibbon(cursor, Math.min(gap.from, end));
      if (ribbon) lake.add(ribbon);
    }
    cursor = Math.max(cursor, gap.to);
  }
  if (cursor < end) {
    const ribbon = buildIceRibbon(cursor, end);
    if (ribbon) lake.add(ribbon);
  }
  scene.add(lake);
}

