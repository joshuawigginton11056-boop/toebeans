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

// One low-poly tree: a trunk with two stacked foliage cones, flat-shaded per the
// bible's shape language. Reused (cloned) across the forest.
function makeTreeTemplate(): THREE.Group {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: COLOR.trunk, roughness: 1, flatShading: true }),
  );
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  tree.add(trunk);

  const litMat = new THREE.MeshStandardMaterial({ color: COLOR.leafLit, roughness: 1, flatShading: true });
  const shadeMat = new THREE.MeshStandardMaterial({ color: COLOR.leafShade, roughness: 1, flatShading: true });
  const lower = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.6, 7), shadeMat);
  lower.position.y = 2.7;
  lower.castShadow = true;
  tree.add(lower);
  const upper = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.3, 7), litMat);
  upper.position.y = 3.9;
  upper.castShadow = true;
  tree.add(upper);
  return tree;
}

function buildForest(): THREE.Group {
  const forest = new THREE.Group();
  const template = makeTreeTemplate();
  const rand = makeRandom(71337);
  // March down both flanks placing trees in the hills, clear of the path and
  // clear of the creek's edges so nothing hides the jump. The run advances
  // toward -Z, so worldZ steps from just behind the start (+GROUND_BEHIND) down
  // past the finish.
  for (
    let worldZ = GROUND_BEHIND;
    worldZ > -(TUTORIAL_FINISH + GROUND_AHEAD);
    worldZ -= 6
  ) {
    for (const side of [-1, 1]) {
      if (rand() > 0.55) continue;
      if (Math.abs(worldZ - CREEK_MID_Z) < 4) continue; // keep the creek banks open
      const x = side * (PATH_HALF + 2 + rand() * (HILL_REACH - 2));
      const jitterZ = worldZ - rand() * 4;
      const tree = template.clone();
      tree.position.set(x, groundHeight(x, jitterZ) - 0.1, jitterZ);
      tree.rotation.y = rand() * Math.PI * 2;
      tree.scale.setScalar(0.8 + rand() * 0.9);
      forest.add(tree);
    }
  }
  return forest;
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
  group.add(buildForest());
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
