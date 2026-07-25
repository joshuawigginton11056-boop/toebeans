// forestGraphics.ts — everything growing on and glowing over the slope
// (forest-graphics session). Split out of skiScene.ts on 2026-07-24 (the
// scenery carve — see PARALLEL.md): trees, decor scatter, treelines, the
// painted-detail texturing, the enchanted-night glow props + snow pools, the
// drifting mist banks, and the moonlight shafts breaking through the canopy.
// The shared day/night engine + palette live in the core (skiScene.ts), which
// imports and drives what this file builds; applyGlowPhase/applyMistPhase/
// applyRayPhase are called by the core engine with the raw time-of-day phase
// and gate themselves.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LANE_EDGE, makeRandom, type SlopeEnvironment } from "./skiScene";

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
// pushed past 1 so bloom has something to bleed). History: 2.2 → 3.5 on the
// "increase the bloom" call, then back to 2.0 on the follow-up (2026-07-25):
// the 3.5 bump didn't grow the halo, it just *brightened the mushroom bodies*
// (director: "lower the brightness of the plants themselves"). The halo is now
// grown the right way instead — in the core bloom pass (bigger BLOOM_RADIUS +
// lower BLOOM_THRESHOLD), not by over-driving the emissive. Look-pass knob.
const GLOW_EMISSIVE = 2.0;
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

export interface GlowField {
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

export function createGlowField(): GlowField {
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

export function updateGlowField(field: GlowField, anchorZ: number): void {
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
export function applyGlowPhase(env: SlopeEnvironment, phase: number): number {
  // Gate on GLOW_ONSET here (dusk) so the core engine just passes the raw
  // phase. Returns the eased 0..1 factor so the core can size the night bloom
  // (bloom lives in the core — see skiScene.ts's applyTimeOfDay).
  const factor = Math.min(1, Math.max(0, (phase - GLOW_ONSET) / (1 - GLOW_ONSET)));
  const on = factor > 0.01;
  env.glow.group.visible = on;
  const ease = on ? factor * factor : 0; // slow start so glow blooms late
  if (on) {
    for (const cap of glowCapMaterials) cap.emissiveIntensity = GLOW_EMISSIVE * ease;
    for (const pool of glowPoolMaterials) pool.opacity = POOL_ALPHA * ease;
  }
  return ease;
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

