// The tutorial's daytime forest-floor biome (onboarding, 2026-07-25).
//
// A new player's first ride happens here instead of on the snowy slope: a
// green forest floor with rolling grassy hills to either side of a flat path,
// scattered low-poly trees, and a CREEK cutting across the ground about
// half a minute in — the gap they learn to jump (the sim already treats the
// creek as a chasm; see shared/src/tutorial.ts).
//
// This file OWNS the tutorial look and keeps it out of the slope's own scenery
// files. It builds one Three.js group and lays it over the scene; while the
// tutorial is on it flips the snow ground + snow decor off (skiScene's
// setSlopeSceneryVisible) and hides the creek's default rock-gap slab so the
// water reads instead. It never touches the sim or the game state — pure
// presentation, like all rendering here.
//
// The run is flat and straight (the "tutorial" segment has no route placement,
// so the sim lays it along -Z with the lane centered on x=0 and the ground at
// y=0). That lets the whole biome be built once in fixed world coordinates.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  TUTORIAL_CREEK_START,
  TUTORIAL_CREEK_WIDTH,
  TUTORIAL_FINISH,
} from "@toebeans/shared";
import type { SkiSceneHandle } from "./skiRender";
import { setSlopeSceneryVisible } from "./skiScene";

// Forest palette — proposed additions to the Art Style Bible's colors (there is
// no green/brown/water in the slope palette yet; parked for bible approval in
// IDEAS.md). Flat, painterly values that sit beside the existing 12.
const COLOR = {
  grassLit: 0x6fa84a, // sunlit meadow green
  grassShade: 0x4d7d39, // hollows + the far rolling hills
  dirt: 0x8a6a43, // the creek banks / bare earth
  water: 0x5fa6c9, // the creek — a cool daylight blue
  trunk: 0x6b4f36, // tree trunks
  leafLit: 0x5c9440, // canopy, lit side
  leafShade: 0x3f6f31, // canopy, shaded — stacks under the lit cone
} as const;

// The flat central path (half-width in world units). The sim's lane runs a bit
// wider than this, but keeping the visible grass flat only across the path — and
// rolling it up into hills past here — frames the run without disturbing the
// flat ground the player actually skis on.
const PATH_HALF = 10;
// How far out (and how tall) the grassy hillsides climb.
const HILL_REACH = 36;
const HILL_HEIGHT = 7.5;

// The ground plane spans the whole run plus generous margins fore and aft, so
// its edges are always lost in the dawn haze rather than popping at a seam.
const GROUND_AHEAD = 90; // past the finish
const GROUND_BEHIND = 24; // above the start
const GROUND_LENGTH = TUTORIAL_FINISH + GROUND_AHEAD + GROUND_BEHIND;
const GROUND_WIDTH = 2 * (HILL_REACH + PATH_HALF) + 24;
const GROUND_CENTER_Z = -(TUTORIAL_FINISH + GROUND_AHEAD - GROUND_BEHIND) / 2;

const CREEK_MID_Z = -(TUTORIAL_CREEK_START + TUTORIAL_CREEK_WIDTH / 2);

// A tiny deterministic random so the forest looks the same every run and on
// every machine (mirrors the slope decor's per-cell PRNG idea).
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const smoothstep = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

// The rolling-hills height at a ground point: dead flat across the path, then
// climbing to either side with a gentle sine roll on top so the hillsides read
// as real terrain, not a ramp. The creek notches the ground down where it
// crosses so the water sits in a shallow bed.
function groundHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  const flank = smoothstep((ax - PATH_HALF) / HILL_REACH);
  const roll = Math.sin(z * 0.045) * Math.sin(x * 0.07);
  let h = flank * (HILL_HEIGHT + roll * 2.2);
  // Notch the creek bed (only near the path — the hills keep their shape).
  const nearCreek = Math.exp(-((z - CREEK_MID_Z) ** 2) / 18);
  h -= nearCreek * (1 - flank) * 0.5;
  return h;
}

function buildGround(): THREE.Mesh {
  const segX = 72;
  const segZ = 150;
  const geo = new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_LENGTH, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, GROUND_CENTER_Z);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const lit = new THREE.Color(COLOR.grassLit);
  const shade = new THREE.Color(COLOR.grassShade);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const rand = makeRandom(20260725);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = groundHeight(x, z);
    pos.setY(i, y);
    // Higher/hillier ground shades darker (like distant slopes catching less
    // light), with a little per-vertex noise so the meadow isn't a flat wash.
    const t = Math.min(1, y / HILL_HEIGHT) * 0.7 + rand() * 0.25;
    c.copy(lit).lerp(shade, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildCreek(): THREE.Group {
  const group = new THREE.Group();
  // The water: a little wider than the deadly span so its banks frame the jump.
  const waterLen = TUTORIAL_CREEK_WIDTH + 2.4;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_WIDTH, waterLen),
    new THREE.MeshStandardMaterial({
      color: COLOR.water,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.9,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.32, CREEK_MID_Z);
  water.receiveShadow = true;
  group.add(water);

  // Muddy banks: thin earthy strips along both edges of the water, lifted just
  // above it so the shoreline reads.
  const bankMat = new THREE.MeshStandardMaterial({
    color: COLOR.dirt,
    roughness: 1,
    flatShading: true,
  });
  for (const side of [-1, 1]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(GROUND_WIDTH, 0.5, 1.1), bankMat);
    bank.position.set(0, -0.2, CREEK_MID_Z + side * (waterLen / 2 + 0.2));
    bank.receiveShadow = true;
    group.add(bank);
  }
  return group;
}

// ---------------------------------------------------------------------------
// FOREST PROPS — the real slope .glb models, recolored out of their winter frost
// (onboarding foliage pass, 2026-07-25). The forest used to be code-built cones;
// the director asked for the actual tree models from assets/slope, but in a
// summer dress. Those files ship frosted — a white "Snow" material, and the
// pines wear a snow texture atlas — so makeSummer strips the frost: snow that
// sits ON foliage becomes green leaves, snow caps on rocks/logs are hidden, and
// the pack's amber "Green" canopy is repainted the biome's summer green. No
// textures survive (bible: no textures), so the models match the flat-shaded
// look of the ground, creek, and grass.

// Each prop's kind decides how its frost is handled and how tall it stands once
// normalized to a target height.
type PropKind = "pine" | "tree" | "bush" | "rock" | "log";

const PINE_MODELS = [
  "StylizedPine_1",
  "StylizedPine_2",
  "StylizedPine_3",
  "StylizedPine_4",
  "StylizedPine_5",
] as const;
const LEAFY_MODELS = [
  "PineTree_Snow_1",
  "PineTree_Snow_2",
  "PineTree_Snow_4",
  "PineTree_Snow_5",
  "BirchTree_Snow_1",
  "BirchTree_Snow_2",
  "BirchTree_Snow_3",
  "BirchTree_Snow_5",
] as const;
const BUSH_MODELS = ["Bush_Snow_1", "Bush_Snow_2"] as const;
const ROCK_MODELS = [
  "Rock_Snow_1",
  "Rock_Snow_2",
  "Rock_Snow_3",
  "Rock_Snow_4",
  "Rock_Snow_5",
  "Rock_Snow_6",
  "Rock_Snow_7",
] as const;
const LOG_MODELS = ["WoodLog_Snow", "TreeStump_Snow"] as const;

// Rocks and logs lose their snow entirely; everything leafy turns its frost into
// green foliage.
function snowRoleFor(kind: PropKind): "leaf" | "hide" {
  return kind === "rock" || kind === "log" ? "hide" : "leaf";
}

// The world height each kind is normalized to (source models vary wildly in
// scale, so every clone is resized to sit in these ranges).
function targetHeight(kind: PropKind, r: number): number {
  switch (kind) {
    case "pine":
      return 5.5 + r * 3; // the forest's heroes
    case "tree":
      return 3.5 + r * 1.8;
    case "bush":
      return 0.7 + r * 0.5;
    case "rock":
      return 0.5 + r * 0.7;
    case "log":
      return 0.5 + r * 0.5;
  }
}

// Repaint one frosted material into its summer form. Idempotent (a material
// shared across meshes may pass through twice), and it drops every texture map
// so nothing carries the snow atlas.
function summerize(mat: THREE.MeshStandardMaterial, snow: "leaf" | "hide"): void {
  mat.map = null;
  mat.metalness = 0;
  mat.roughness = 1;
  mat.flatShading = true;
  const name = mat.name.replace(/\.\d+$/, "");
  switch (name) {
    case "Green":
      mat.color.set(COLOR.leafLit); // the pack's amber canopy -> summer green
      break;
    case "DarkGreen":
      mat.color.set(COLOR.leafShade);
      break;
    case "PineSnow": // the pines' snow-laden canopy shell
    case "Snow":
      if (snow === "leaf") {
        mat.color.set(COLOR.leafLit); // snow-on-foliage becomes green leaves
      } else {
        mat.transparent = true; // frost cap on a rock/log — make it vanish
        mat.opacity = 0;
        mat.depthWrite = false;
      }
      break;
    // Wood / PineBark stay brown trunks; White / Black stay birch bark; Rock
    // stays stone — all kept as authored.
  }
  mat.needsUpdate = true;
}

function makeSummer(root: THREE.Object3D, snow: "leaf" | "hide"): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) summerize(m, snow);
    }
  });
}

interface PropTemplate {
  readonly group: THREE.Group;
  readonly kind: PropKind;
  readonly height: number; // natural (unscaled) height
  readonly minY: number; // natural base offset, so clones plant flush on ground
}

// Load every prop model, recolor it, and measure it — done once, in the
// background. Returns a name->template map the scatter clones from.
async function loadProps(): Promise<Map<string, PropTemplate>> {
  const loader = new GLTFLoader();
  const specs: Array<readonly [readonly string[], PropKind]> = [
    [PINE_MODELS, "pine"],
    [LEAFY_MODELS, "tree"],
    [BUSH_MODELS, "bush"],
    [ROCK_MODELS, "rock"],
    [LOG_MODELS, "log"],
  ];
  const jobs = specs.flatMap(([names, kind]) =>
    names.map(async (name) => {
      const gltf = await loader.loadAsync(
        `${import.meta.env.BASE_URL}slope/${name}.glb`,
      );
      const model = gltf.scene;
      makeSummer(model, snowRoleFor(kind));
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const template: PropTemplate = {
        group: model,
        kind,
        height: Math.max(0.001, box.max.y - box.min.y),
        minY: box.min.y,
      };
      return [name, template] as const;
    }),
  );
  return new Map(await Promise.all(jobs));
}

// Clone a template onto the ground at (x, z), resized to its kind's height and
// planted so its base sits flush on the rolling terrain.
function placeProp(
  forest: THREE.Group,
  tmpl: PropTemplate,
  x: number,
  z: number,
  rand: () => number,
): void {
  const inst = tmpl.group.clone(true);
  const scale = targetHeight(tmpl.kind, rand()) / tmpl.height;
  inst.scale.setScalar(scale);
  inst.position.set(x, groundHeight(x, z) - tmpl.minY * scale - 0.05, z);
  inst.rotation.y = rand() * Math.PI * 2;
  forest.add(inst);
}

const pick = <T>(list: readonly T[], r: () => number): T =>
  list[Math.floor(r() * list.length)]!;

// Scatter the loaded models down both grassy flanks — trees leading, with rocks,
// logs, and bushes filling between them — always clear of the flat path the
// player skis and of the creek banks so nothing hides the jump.
function placeProps(
  forest: THREE.Group,
  templates: Map<string, PropTemplate>,
): void {
  const near = (z: number, gap: number): boolean =>
    Math.abs(z - CREEK_MID_Z) < gap;

  // Trees: the forest proper, mostly pines with leafy trees mixed in.
  const treeRand = makeRandom(71337);
  for (let z = GROUND_BEHIND; z > -(TUTORIAL_FINISH + GROUND_AHEAD); z -= 5) {
    for (const side of [-1, 1]) {
      if (treeRand() > 0.6) continue;
      if (near(z, 4)) continue; // keep the creek banks open
      const name =
        treeRand() < 0.6 ? pick(PINE_MODELS, treeRand) : pick(LEAFY_MODELS, treeRand);
      const tmpl = templates.get(name);
      if (!tmpl) continue;
      const x = side * (PATH_HALF + 2 + treeRand() * (HILL_REACH - 2));
      placeProp(forest, tmpl, x, z - treeRand() * 4, treeRand);
    }
  }

  // Rocks and logs: strewn through the whole forest floor, a touch closer to the
  // path than the trees so the ground reads as lived-in.
  const groundRand = makeRandom(0x2f0c9);
  for (let z = GROUND_BEHIND; z > -(TUTORIAL_FINISH + GROUND_AHEAD); z -= 4) {
    for (const side of [-1, 1]) {
      if (groundRand() > 0.4) continue;
      if (near(z, 3)) continue;
      const name =
        groundRand() < 0.4 ? pick(LOG_MODELS, groundRand) : pick(ROCK_MODELS, groundRand);
      const tmpl = templates.get(name);
      if (!tmpl) continue;
      const x = side * (PATH_HALF + 0.5 + groundRand() * HILL_REACH);
      placeProp(forest, tmpl, x, z - groundRand() * 3, groundRand);
    }
  }

  // Bushes: leafy foliage clumps tucked among the trees.
  const bushRand = makeRandom(0x51a33);
  for (let z = GROUND_BEHIND; z > -(TUTORIAL_FINISH + GROUND_AHEAD); z -= 6) {
    for (const side of [-1, 1]) {
      if (bushRand() > 0.4) continue;
      if (near(z, 3)) continue;
      const tmpl = templates.get(pick(BUSH_MODELS, bushRand));
      if (!tmpl) continue;
      const x = side * (PATH_HALF + 1 + bushRand() * HILL_REACH);
      placeProp(forest, tmpl, x, z - bushRand() * 4, bushRand);
    }
  }
}

// ---------------------------------------------------------------------------
// GRASS — code-built blade tufts scattered across the meadow (no grass model in
// the pack). Two layers, both drawn as a single InstancedMesh so thousands of
// blades cost one draw call each: a short dense carpet over the grass, and
// sparser TALL tufts standing among the trees (the "higher grass" the director
// asked for). The immediate driving lane is left clear; blades start a few
// metres out and climb the hillsides.

// A single flat-shaded blade: a slim 3-sided spike, base on the ground.
function makeBlade(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.06, 1, 3, 1);
  geo.translate(0, 0.5, 0);
  return geo;
}

function makeGrassLayer(
  blade: THREE.BufferGeometry,
  mats: THREE.Matrix4[],
  cols: THREE.Color[],
): THREE.InstancedMesh {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(blade, mat, mats.length);
  for (let i = 0; i < mats.length; i++) {
    mesh.setMatrixAt(i, mats[i]!);
    mesh.setColorAt(i, cols[i]!);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // instances span the whole run
  return mesh;
}

function buildGrass(): THREE.Group {
  const group = new THREE.Group();
  const blade = makeBlade();
  const rand = makeRandom(0x6a5511);
  const shortM: THREE.Matrix4[] = [];
  const shortC: THREE.Color[] = [];
  const tallM: THREE.Matrix4[] = [];
  const tallC: THREE.Color[] = [];

  const carpet = new THREE.Color(COLOR.grassLit);
  const leaf = new THREE.Color(COLOR.leafLit);
  const shade = new THREE.Color(COLOR.grassShade);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let z = GROUND_BEHIND; z > -(TUTORIAL_FINISH + GROUND_AHEAD); z -= 1.6) {
    for (const side of [-1, 1]) {
      const tufts = 1 + Math.floor(rand() * 3);
      for (let t = 0; t < tufts; t++) {
        const cx = side * (3 + rand() * (PATH_HALF + HILL_REACH - 3));
        const cz = z - rand() * 1.6;
        if (Math.abs(cz - CREEK_MID_Z) < 2.5) continue; // keep the water clear
        // Higher tufts only stand out among the trees (past the path edge).
        const tall = rand() < 0.18 && Math.abs(cx) > PATH_HALF;
        const blades = tall ? 5 + Math.floor(rand() * 4) : 3 + Math.floor(rand() * 3);
        for (let b = 0; b < blades; b++) {
          const bx = cx + (rand() - 0.5) * 0.5;
          const bz = cz + (rand() - 0.5) * 0.5;
          const height = tall ? 0.9 + rand() * 0.8 : 0.25 + rand() * 0.35;
          const width = tall ? 0.8 + rand() * 0.5 : 0.7 + rand() * 0.6;
          e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
          q.setFromEuler(e);
          pos.set(bx, groundHeight(bx, bz), bz);
          scl.set(width, height, width);
          const m = new THREE.Matrix4().compose(pos, q, scl);
          const col = (tall ? leaf : carpet).clone().lerp(shade, rand() * 0.5);
          if (tall) {
            tallM.push(m);
            tallC.push(col);
          } else {
            shortM.push(m);
            shortC.push(col);
          }
        }
      }
    }
  }

  group.add(makeGrassLayer(blade, shortM, shortC));
  group.add(makeGrassLayer(blade, tallM, tallC));
  return group;
}

export interface TutorialBiome {
  /** Show/hide the whole forest and flip the snow scenery off/on with it. */
  setActive(active: boolean): void;
  /** Per-frame while active: keep the creek's default rock-gap slab hidden. */
  update(handle: SkiSceneHandle): void;
}

// Build the biome once and drop it into the scene (hidden until the tutorial
// starts). Cheap to leave in the scene between runs — it's just off.
export function createTutorialBiome(handle: SkiSceneHandle): TutorialBiome {
  const group = new THREE.Group();
  group.add(buildGround());
  group.add(buildCreek());
  group.add(buildGrass());
  // The real .glb props load in the background; the biome is fine before they
  // arrive (same graceful pattern as the slope decor). A failed load just
  // leaves the grassy ground + grass tufts, still playable.
  const forest = new THREE.Group();
  group.add(forest);
  void loadProps()
    .then((templates) => placeProps(forest, templates))
    .catch((error) => {
      console.error("tutorial forest props failed to load", error);
    });
  group.visible = false;
  handle.scene.add(group);

  let active = false;

  return {
    setActive(next: boolean): void {
      active = next;
      group.visible = next;
      // While the forest is up, the snowy ground + snow decor step aside.
      setSlopeSceneryVisible(!next);
    },
    update(h: SkiSceneHandle): void {
      if (!active) return;
      // The creek uses the sim's chasm plumbing, so a default rock-gap slab is
      // created for it (lazily, on the frame it first comes into range). Keep
      // it hidden so only the water shows.
      const creekSlab = h.chasmMeshes.get("creek");
      if (creekSlab) creekSlab.visible = false;
    },
  };
}
