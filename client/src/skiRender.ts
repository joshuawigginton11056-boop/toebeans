import * as THREE from "three";
import type { SkiState } from "@toebeans/shared";

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
  scene.background = new THREE.Color(0xbfe3ff);

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

  const slope = new THREE.Mesh(
    new THREE.PlaneGeometry(SLOPE_WIDTH, SLOPE_LENGTH),
    new THREE.MeshStandardMaterial({ color: 0xf5f9ff }),
  );
  slope.rotation.x = -Math.PI / 2;
  slope.position.z = -SLOPE_LENGTH / 2;
  scene.add(slope);

  const player = new THREE.Group();
  const skierMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2980b9 }),
  );
  skierMesh.position.y = 0.5;
  player.add(skierMesh);

  const catMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.25, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xf39c12 }),
  );
  catMesh.position.set(0, 1.1, -0.15);
  player.add(catMesh);

  scene.add(player);

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
      new THREE.MeshStandardMaterial({ color: 0x27ae60 }),
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
        new THREE.MeshStandardMaterial({ color: 0x1a1a2e }),
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
