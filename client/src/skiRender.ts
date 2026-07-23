import * as THREE from "three";
import {
  BASE_SPEED,
  BOOST_SPEED,
  JUMP_CHARGE_TIME,
  MIN_SPEED,
  RESPAWN_DELAY,
  downhillHeading,
  type SkiState,
} from "@toebeans/shared";
import { createCatRig, type CatRig } from "./catModel";
import { createSkierRig, type SkierRig } from "./skierModel";
import {
  createChasmMesh,
  createCheckpointMarker,
  createEnvironment,
  loadSlopeDecor,
  syncEnvironment,
  type SlopeEnvironment,
} from "./skiScene";

// This file is the slope's state→presentation wiring (slope-mechanics
// territory): the camera, the rig inputs derived from SkiState each frame,
// and what exists where. Everything about how the slope LOOKS — palette,
// lighting, sky, snow, decor, hazard mesh styles — lives in skiScene.ts
// (slope-visuals territory). See PARALLEL.md for the ownership split.

export interface SkiSceneHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: THREE.Group;
  readonly skier: SkierRig;
  readonly cat: CatRig;
  readonly chasmMeshes: ReadonlyMap<string, THREE.Mesh>;
  readonly checkpointMeshes: ReadonlyMap<number, THREE.Mesh>;
  readonly environment: SlopeEnvironment;
  /**
   * Last frame's status and speed, for the pole push-off's "actually
   * gaining" frame-diff — presentation-side memory; SkiState stays ignorant
   * of it. (The steer angle used to be frame-diffed from lateral too; now
   * the sim carries a real heading and the renderer just reads it.)
   */
  readonly steerMemory: { skiing: boolean; speed: number };
  /**
   * Takeoff/landing pop for the hold-to-charge jump: a short crouch offset
   * that fires on the airborne transitions (legs extend on launch, absorb on
   * touchdown) and decays. Presentation-side memory, like steerMemory.
   */
  readonly jumpMemory: { airborne: boolean; envelope: number };
}

// How long the crash tip-over takes to hit the ground, inside the
// RESPAWN_DELAY pause — quick like a real balance loss, then it holds.
const TIP_DURATION = 0.35;

export function createSkiScene(container: HTMLElement): SkiSceneHandle {
  const scene = new THREE.Scene();

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
  // Soft shadow edges per the bible. Three.js retired PCFSoftShadowMap
  // (r185 falls back to PCF with a console warning), so softness comes from
  // the default PCF type plus the sun's shadow.radius in skiScene.ts.
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Weather, lights, sky, and the snowfield — the look is skiScene's.
  const environment = createEnvironment(scene);

  const player = new THREE.Group();

  // A real person on the skis now, not a blue box. The rig owns the model's
  // quirks (scale, which clip is which, the forward ski lean) and takes its
  // colors from the character palette — see skierModel.ts.
  const skier = createSkierRig();
  skier.setPose("skiing");
  skier.setFacing(Math.PI); // both bases are authored facing +z; downhill is -z
  player.add(skier.group);

  // The cat rides on your back (DESIGN.md's core fantasy) — and it *hugs*
  // now, rather than perching upright like a shelf ornament (director's
  // playtest call). The skier rig's mount is a live back-anchor glued to
  // the spine bones (+y up the spine, +z the character's forward, the back
  // surface toward -z), so the cat folds with the crouch, swings through
  // every carve, and tips over in a crash without any slope code here.
  // Laid belly-to-the-back: rotated so its paws press against the back
  // (like a cat clinging to a wall), body up along the spine, head craned
  // over the right shoulder by the clinging pose in catModel.ts.
  const cat = createCatRig();
  cat.setPose("clinging");
  cat.group.position.set(0.06, -0.05, -0.06);
  cat.group.rotation.set(-Math.PI / 2, 0, 0);
  skier.mount.add(cat.group);
  // The hair spring pushes away from a sphere at the cat's head, so hair
  // rests against the cat instead of swallowing it. The center is the cat
  // head's measured mount-space position under the placement above (it
  // holds constant brake↔tuck, because the mount IS the back frame).
  skier.setHairRepulsor({ x: 0.06, y: 0.06, z: -0.3, radius: 0.26 });

  scene.add(player);

  // Real slope-side assets load in the background; the run is playable
  // before they arrive.
  void loadSlopeDecor(scene);

  return {
    renderer,
    scene,
    camera,
    player,
    skier,
    cat,
    chasmMeshes: new Map(),
    checkpointMeshes: new Map(),
    environment,
    steerMemory: { skiing: true, speed: 0 },
    jumpMemory: { airborne: false, envelope: 0 },
  };
}

// Pure with respect to SkiState: only reads state to sync mesh transforms
// and the camera, never writes back into it.
export function syncSkiSceneToState(
  handle: SkiSceneHandle,
  state: SkiState,
  dt: number,
): void {
  // The crouch depth reads straight off the speed magnitude, which fully
  // encodes the lean input (up = fast = tuck, down = slow = braking upright,
  // boost beyond MAX_SPEED = deepest tuck) — so the speed control is
  // legible on the body. Magnitude, not the raw value: speed is signed now
  // (negative = riding switch), and a fast switch run still tucks.
  // Airborne adds a bit of extra tuck for the jump.
  const pace = Math.abs(state.speed);
  const tuck = (pace - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED);

  // Steering: the sim carries a real heading now (0 = straight downhill,
  // out to fully sideways and past it), so the body just turns to it — no
  // more frame-diffing lateral, which topped out at 45° of visible turn and
  // couldn't tell "skiing sideways" from "drifting". The model eases toward
  // it internally, so a respawn's snap back to 0 rolls out smoothly.
  const skiing = state.status === "skiing";
  // The steer follows the heading through the crash pause too — the state
  // holds the fatal heading until respawn, and zeroing it here made the
  // body unwind while tipping over (turning round 2, playtest item 2).
  // On respawn the heading snaps to 0 and the model's easing rolls it out.
  const steer = state.heading;
  // The carve angle drives the bank/angulation and is *stance-relative*:
  // riding switch, the body leans off how far the skis are turned from
  // straight-backwards, not from straight-downhill — otherwise a clean
  // switch run would hold a maxed-out bank forever. Scaled down toward a
  // standstill (banking comes from carving at speed; a stopped pivot
  // stands upright — which also smooths the stance flip at the sideways
  // pivot, where speed passes through zero), and zeroed in the air: no
  // edge to lean against, and mid-spin the stance sign isn't settled yet.
  const airborne = state.height > 0;
  const stance = state.speed < 0 ? Math.PI : 0;
  const carve = airborne
    ? 0
    : downhillHeading(state.heading - stance) * Math.min(1, pace / MIN_SPEED);
  // Riding switch, the head and torso twist to look over a shoulder at
  // where you're actually going. The small deadband keeps the sideways
  // pivot (speed jittering around zero) from nodding the head back and
  // forth.
  const switchLook = state.speed < -0.5 ? 1 : 0;
  // The pole push-off: poles drive while the run is on the snow, below
  // cruise speed, and actually gaining — detected the same frame-diff way
  // as the steer above, so braking down to MIN_SPEED (speed falling or
  // parked at its floor) never pumps the arms. Fades out as the push-off
  // approaches cruise, where gravity has taken over from the poles.
  // All magnitudes: a switch push-off pumps the arms the same way.
  const grounded = state.height <= 0;
  const gaining =
    skiing && handle.steerMemory.skiing && pace > handle.steerMemory.speed;
  const push =
    grounded && gaining
      ? Math.max(0, Math.min(1, 1 - pace / (0.85 * BASE_SPEED)))
      : 0;
  handle.steerMemory.skiing = skiing;
  handle.steerMemory.speed = pace;

  // Hold-to-charge jump on the body: the loading crouch reads straight off
  // the sim's charge (deeper as it fills, full crouch at a full charge), and
  // a short envelope pops the legs out on the takeoff frame and absorbs the
  // touchdown — so a jump reads load → explode upward → tuck → absorb
  // instead of teleporting off the snow.
  const jump = handle.jumpMemory;
  if (!jump.airborne && airborne) jump.envelope = -0.5; // legs extend
  if (jump.airborne && !airborne && skiing) jump.envelope = 0.55; // absorb
  jump.airborne = airborne;
  jump.envelope -= jump.envelope * Math.min(1, dt * 7);
  const load = state.jumpCharge / JUMP_CHARGE_TIME;

  handle.skier.setSkiMotion({
    tuck: Math.max(tuck, load) + (airborne ? 0.2 : 0) + jump.envelope,
    steer,
    carve,
    switchLook,
    airborne,
    push,
  });

  handle.cat.update(dt);
  handle.skier.update(dt);
  handle.player.position.set(state.lateral, state.height, -state.distance);
  // The crash tip-over: chasms are the game's only crash now (turning
  // round 3 removed the fall-over), and a chasm always reads as a forward
  // drop — downhill, the way you were traveling, whatever the stance.
  // Animated over the start of the crash pause — the respawn timer doubles
  // as the clock (forfeit holds it at 0 = fully tipped) — and accelerating
  // like a real topple, not a linear hinge.
  if (state.status === "skiing") {
    handle.player.rotation.set(0, 0, 0);
  } else {
    const progress = Math.min(
      1,
      (RESPAWN_DELAY - state.respawnTimer) / TIP_DURATION,
    );
    const tip = (Math.PI / 2) * progress * progress;
    handle.player.rotation.set(-tip, 0, 0);
  }

  const checkpointMeshes = handle.checkpointMeshes as Map<number, THREE.Mesh>;
  for (const checkpoint of state.checkpoints) {
    if (checkpoint === 0 || checkpointMeshes.has(checkpoint)) continue;
    const marker = createCheckpointMarker();
    marker.position.set(0, 0.02, -checkpoint);
    handle.scene.add(marker);
    checkpointMeshes.set(checkpoint, marker);
  }

  const meshes = handle.chasmMeshes as Map<string, THREE.Mesh>;
  for (const chasm of state.chasms) {
    let mesh = meshes.get(chasm.id);
    if (!mesh) {
      mesh = createChasmMesh(chasm.width);
      handle.scene.add(mesh);
      meshes.set(chasm.id, mesh);
    }
    mesh.position.set(0, 0.01, -(chasm.start + chasm.width / 2));
  }

  handle.camera.position.set(state.lateral, state.height + 4, -state.distance + 8);
  handle.camera.lookAt(state.lateral, state.height, -state.distance - 4);

  // Atmosphere follows the run downhill — the offsets are skiScene's.
  // (slope-visuals seam addition) the snow also gets the two numbers it
  // needs to carve ski trails: which way the skis point, and whether
  // they're on the snow at all.
  const anchor = new THREE.Vector3(state.lateral, 0, -state.distance);
  syncEnvironment(handle.environment, anchor, handle.camera, {
    heading: state.heading,
    grounded: state.height <= 0 && state.status === "skiing",
  });
}

export function render(handle: SkiSceneHandle): void {
  handle.renderer.render(handle.scene, handle.camera);
}
