import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { SkiState } from "@toebeans/shared";

// Art Style Bible palette (DESIGN.md) — every color in this scene comes
// from these 12 (or a value shift of one, which the bible allows).
const PALETTE = {
  sunlitSnow: 0xf8f5ef,
  skyBlue: 0xbfdcf5,
  glacialIce: 0x79b7d8,
  skierBlue: 0x4e72a8, // reserved: only the player wears this
  birchAmber: 0xe9a960,
  chasmDark: 0x2e3548, // slate rock, deep value shift — never pure black
} as const;

export interface SkiSceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: THREE.Group;
  readonly chasmMeshes: ReadonlyMap<string, THREE.Mesh>;
  readonly checkpointMeshes: ReadonlyMap<number, THREE.Mesh>;
}

const SLOPE_LENGTH = 100;
const SLOPE_WIDTH = 10;

export function createSkiScene(container: HTMLElement): SkiSceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyBlue);

  // Three-quarter front perspective: looking downhill and slightly to the
  // side, matching the 2.5D isometric side-scroller camera described in
  // DESIGN.md's skiing section.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(3, 8, 5);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x808080));

  // One wide snowfield; the skiable lane (SLOPE_WIDTH) sits in the middle
  // and the decor lives on the flanks beyond it.
  const slope = new THREE.Mesh(
    new THREE.PlaneGeometry(80, SLOPE_LENGTH + 80),
    new THREE.MeshStandardMaterial({ color: PALETTE.sunlitSnow }),
  );
  slope.rotation.x = -Math.PI / 2;
  slope.position.z = -SLOPE_LENGTH / 2;
  scene.add(slope);

  const player = new THREE.Group();
  const skierMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1, 0.4),
    new THREE.MeshStandardMaterial({ color: PALETTE.skierBlue }),
  );
  skierMesh.position.y = 0.5;
  player.add(skierMesh);

  const catMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.25, 0.4),
    new THREE.MeshStandardMaterial({ color: PALETTE.birchAmber }),
  );
  catMesh.position.set(0, 1.1, -0.15);
  player.add(catMesh);

  scene.add(player);

  // Real slope-side assets load in the background; the run is playable
  // before they arrive.
  void loadSlopeDecor(scene);

  return {
    renderer,
    scene,
    camera,
    player,
    chasmMeshes: new Map(),
    checkpointMeshes: new Map(),
  };
}

// Pure with respect to SkiState: only reads state to sync mesh transforms
// and the camera, never writes back into it.
export function syncSkiSceneToState(handle: SkiSceneHandle, state: SkiState): void {
  handle.player.position.set(state.lateral, state.height, -state.distance);
  // Fallen over sideways during the crash pause, upright otherwise.
  handle.player.rotation.z = state.status === "crashed" ? Math.PI / 2 : 0;

  const checkpointMeshes = handle.checkpointMeshes as Map<number, THREE.Mesh>;
  for (const checkpoint of state.checkpoints) {
    if (checkpoint === 0 || checkpointMeshes.has(checkpoint)) continue;
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(SLOPE_WIDTH, 0.5),
      new THREE.MeshStandardMaterial({ color: PALETTE.glacialIce }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(0, 0.02, -checkpoint);
    handle.scene.add(marker);
    checkpointMeshes.set(checkpoint, marker);
  }

  const meshes = handle.chasmMeshes as Map<string, THREE.Mesh>;
  for (const chasm of state.chasms) {
    let mesh = meshes.get(chasm.id);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(SLOPE_WIDTH, chasm.width),
        new THREE.MeshStandardMaterial({ color: PALETTE.chasmDark }),
      );
      mesh.rotation.x = -Math.PI / 2;
      handle.scene.add(mesh);
      meshes.set(chasm.id, mesh);
    }
    mesh.position.set(0, 0.01, -(chasm.start + chasm.width / 2));
  }

  handle.camera.position.set(state.lateral, state.height + 4, -state.distance + 8);
  handle.camera.lookAt(state.lateral, state.height, -state.distance - 4);
}

export function render(handle: SkiSceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
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

async function loadSlopeDecor(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const names = Object.values(DECOR_MODELS).flat();
  const templates = new Map<string, THREE.Group>();
  try {
    await Promise.all(
      names.map(async (name) => {
        const gltf = await loader.loadAsync(
          `${import.meta.env.BASE_URL}slope/${name}.glb`,
        );
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
  // starting just past its edge (SLOPE_WIDTH/2 = 5) so the lane stays clear.
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
      const x = side * (5.8 + random() * 9);
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
      const x = side * (16 + random() * 16);
      place(model, x, z, 1.2 + random() * 0.6);
    }
  }
}
