import { createInitialState, setCatVelocity, step, type GameState } from "@toebeans/shared";
import { createScene, render, syncSceneToState } from "./render";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

const sceneHandle = createScene(container);

let state: GameState = setCatVelocity(createInitialState(), "cat-1", {
  x: 0.5,
  y: 0,
  z: 0.3,
});

let lastTime = performance.now();

function loop(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  state = step(state, dt);
  syncSceneToState(sceneHandle, state);
  render(sceneHandle);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

window.addEventListener("resize", () => {
  sceneHandle.camera.aspect = window.innerWidth / window.innerHeight;
  sceneHandle.camera.updateProjectionMatrix();
  sceneHandle.renderer.setSize(window.innerWidth, window.innerHeight);
});
