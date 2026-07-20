import * as THREE from "three";
import type { GameState } from "@toebeans/shared";

export interface SceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly catMeshes: ReadonlyMap<string, THREE.Mesh>;
}

export function createScene(container: HTMLElement): SceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(2, 4, 3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x404040));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x2d3436 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  return { renderer, scene, camera, catMeshes: new Map() };
}

// Pure with respect to GameState: reads state to sync mesh transforms,
// never writes back into it. Mutates only the Three.js scene graph.
export function syncSceneToState(handle: SceneHandle, state: GameState): void {
  const meshes = handle.catMeshes as Map<string, THREE.Mesh>;

  for (const cat of state.cats) {
    let mesh = meshes.get(cat.id);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.4, 1),
        new THREE.MeshStandardMaterial({ color: 0xf39c12 }),
      );
      handle.scene.add(mesh);
      meshes.set(cat.id, mesh);
    }
    mesh.position.set(cat.position.x, cat.position.y + 0.2, cat.position.z);
  }

  for (const [id, mesh] of meshes) {
    if (!state.cats.some((cat) => cat.id === id)) {
      handle.scene.remove(mesh);
      meshes.delete(id);
    }
  }
}

export function render(handle: SceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}
