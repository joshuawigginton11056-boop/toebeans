import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LATERAL_LIMIT } from "@toebeans/shared";

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
  // and the decor lives on the flanks beyond it. The plane is featureless,
  // so it quietly follows the skier's z (see syncEnvironment) — the snow
  // never ends, and its far edge always sits past where the haze fully
  // takes over.
  const slope = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 220),
    new THREE.MeshStandardMaterial({ color: PALETTE.sunlitSnow }),
  );
  slope.rotation.x = -Math.PI / 2;
  slope.position.z = -50;
  slope.receiveShadow = true;
  scene.add(slope);

  // TEXTURE TEST: a painted snow patch spanning the lane just past the
  // start — ski straight over it and compare against the flat snow on
  // either side. Sits above the snowfield like the checkpoint stripes do.
  const painted = getPaintedTextures();
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(SLOPE_WIDTH, 12),
    new THREE.MeshStandardMaterial({
      map: painted.snowAlbedo,
      bumpMap: painted.snowBump,
      bumpScale: 0.35,
    }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(0, 0.015, -11);
  patch.receiveShadow = true;
  scene.add(patch);

  return { sun, skyDome, sunBillboard, slope };
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
): void {
  environment.sun.target.position.copy(anchor);
  environment.sun.position.copy(anchor).addScaledVector(SUN_DIRECTION, 70);
  environment.slope.position.z = anchor.z - 50;
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
// TEXTURE TEST (2026-07-22, direction session) — remove or promote after
// the director's verdict. The Art Style Bible's no-texture rule is amended
// (see DESIGN.md): stylized painted + procedural surface detail, palette
// family kept. Everything below is generated in code — no image files, no
// license rows.
//
// The converted GLBs carry NO UV coordinates (the OBJ→GLB palette tool
// dropped them), so the trees can't wear an image texture the normal way.
// Instead the painted canvases are sampled *triplanar* — by object-space
// position, blended across the three axes by the surface normal — which
// needs no UVs and keeps the paint glued to each tree. The snow patch is a
// plane (planes have UVs), so it samples its canvas the normal way.

interface PaintedTextures {
  readonly snowAlbedo: THREE.CanvasTexture;
  readonly snowBump: THREE.CanvasTexture;
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

  // Painted snow: sunlit-snow base, soft value dapple, the palette's blue
  // creeping into micro-hollows, and sparse near-sun-glow sparkle. All
  // inside the two snow colors' family.
  const snowAlbedo = makeTexture(
    256,
    (ctx) => {
      ctx.fillStyle = "#f8f5ef";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 70; i++) {
        const x = random() * 256;
        const y = random() * 256;
        const r = 10 + random() * 20;
        const squish = 0.45 + random() * 0.4;
        ctx.fillStyle = random() < 0.5 ? "#ebe5da" : "#fffdf8";
        ctx.globalAlpha = 0.5;
        tiled(ctx, 256, x, y, (px, py) => blob(ctx, px, py, r, squish));
      }
      for (let i = 0; i < 40; i++) {
        const x = random() * 256;
        const y = random() * 256;
        const r = 4 + random() * 8;
        ctx.fillStyle = "#d3dff0";
        ctx.globalAlpha = 0.42;
        tiled(ctx, 256, x, y, (px, py) => blob(ctx, px, py, r, 0.55));
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 90; i++) {
        const x = random() * 256;
        const y = random() * 256;
        ctx.fillStyle = random() < 0.6 ? "#ffffff" : "#fff4da";
        ctx.fillRect(x, y, 1 + random(), 1 + random());
      }
    },
    true,
  );
  // The bump is its own soft blob field — height data, not color.
  const snowBump = makeTexture(
    256,
    (ctx) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 70; i++) {
        const x = random() * 256;
        const y = random() * 256;
        const r = 5 + random() * 14;
        const v = random() < 0.5 ? 104 : 152;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.globalAlpha = 0.4;
        tiled(ctx, 256, x, y, (px, py) =>
          blob(ctx, px, py, r, 0.5 + random() * 0.3),
        );
      }
      ctx.globalAlpha = 1;
    },
    false,
  );

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

  // The snow patch tiles ~3 units per repeat across the lane.
  snowAlbedo.repeat.set(8, 4);
  snowBump.repeat.set(8, 4);

  paintedTextures = { snowAlbedo, snowBump, bark, dapple, grain };
  return paintedTextures;
}

// Which painted canvas each palette material wears, how big the strokes
// are (repeats per unit), and how hard they press (0..1).
const DETAIL_BY_MATERIAL: Record<
  string,
  { map: keyof Omit<PaintedTextures, "snowAlbedo" | "snowBump">; scale: number; strength: number }
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
