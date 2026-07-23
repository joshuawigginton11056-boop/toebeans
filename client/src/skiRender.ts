import * as THREE from "three";
import {
  BASE_SPEED,
  BOOST_SPEED,
  JUMP_CHARGE_TIME,
  MIN_SPEED,
  RESPAWN_DELAY,
  TIRED_HOP_DURATION,
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

// ---------------------------------------------------------------------------
// Camera views (V cycles them — wired in main.ts). Each is an orbit position
// around the skier — azimuth 0 = due uphill of them, so the camera faces
// downhill — plus where the camera aims, as an offset from the skier. Every
// parameter eases (VIEW_EASE), so a switch is a swing, not a cut.
interface CameraView {
  readonly name: string;
  /** Radians around +y; 0 puts the camera uphill of the skier. */
  readonly azimuth: number;
  /** Radians above horizontal. */
  readonly elevation: number;
  /** Orbit distance from the skier. */
  readonly radius: number;
  /** Aim point, offset from the skier (world axes; -z = downhill). */
  readonly lookX: number;
  readonly lookY: number;
  readonly lookZ: number;
}

const CAMERA_VIEWS: readonly CameraView[] = [
  // The classic three-quarter front 2.5D framing from DESIGN.md — exactly
  // the numbers the fixed camera always used (offset (0, 4, 8), aimed 4
  // units downhill), just expressed as an orbit. Stays the default.
  {
    name: "classic",
    azimuth: 0,
    elevation: Math.atan2(4, 8),
    radius: Math.hypot(4, 8),
    lookX: 0,
    lookY: 0,
    lookZ: -4,
  },
  // Chase: low and close off the ski tails, aimed over the shoulder at the
  // slope ahead — speed reads hardest here.
  {
    name: "chase",
    azimuth: 0,
    elevation: 0.35,
    radius: 4.6,
    lookX: 0,
    lookY: 0.5,
    lookZ: -6,
  },
  // Side-scroller: a true profile from the skier's right, so downhill runs
  // screen left→right — the purest form of the design doc's 2.5D framing.
  {
    name: "side",
    azimuth: Math.PI / 2,
    elevation: 0.34,
    radius: 7.5,
    lookX: 0,
    lookY: 0.7,
    lookZ: -2,
  },
  // Far: high and well back — the whole-slope tactical read, chasms and
  // checkpoints laid out ahead.
  {
    name: "far",
    azimuth: 0,
    elevation: 0.9,
    radius: 15,
    lookX: 0,
    lookY: 0,
    lookZ: -6,
  },
];

// How fast a view switch swings, and how fast the drag look tracks the
// pointer / settles back home on release (per-second easing rates).
const VIEW_EASE = 4;
const LOOK_EASE = 8;
// Pointer-to-radians drag feel.
const LOOK_SENSITIVITY = 0.006;
// The rig's total pitch clamp: never under the snow, never straight
// overhead (straight-down gimbal-locks lookAt's up vector).
const MIN_ELEVATION = 0.06;
const MAX_ELEVATION = 1.45;

/** The camera rig's eased state — presentation-side memory. */
interface CameraMemory {
  view: number;
  azimuth: number;
  elevation: number;
  radius: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  /** The drag look-around: a rigid extra swing of the whole rig. */
  lookYaw: number;
  lookPitch: number;
  targetLookYaw: number;
  targetLookPitch: number;
  dragging: boolean;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

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
  /**
   * The camera rig (V cycles views, drag looks around) — eased orbit state,
   * presentation-side memory like steerMemory. Deliberately not saved, same
   * reasoning as the scrapped bedroom's follow camera.
   */
  readonly cameraMemory: CameraMemory;
  /** Advance to the next camera view (main.ts wires this to V). */
  readonly cycleView: () => void;
}

// How long the crash tip-over takes to hit the ground, inside the
// RESPAWN_DELAY pause — quick like a real balance loss, then it holds.
const TIP_DURATION = 0.35;

// The tired hop's shape (the sim's TIRED_HOP_DURATION clock drives it): a
// jump press eaten by the landing lockout sinks the spent legs into a deep
// labored crouch (TIRED_DIP, in tuck units — retuned 2026-07-23 from 0.35,
// which read as a stutter; at cruise the baseline tuck is ~0.33, so this
// bottoms out near a full crouch), holds the strain at the bottom, then a
// feeble push extends the legs (TIRED_EXTEND) and lifts the whole rig a few
// centimeters (TIRED_LIFT, world units — a real tap jump flies ~1.4, so the
// hop reads as pathetic on purpose) before gravity wins and everything
// settles. All knobs: deeper dip = wearier legs, more lift = more hop.
const TIRED_DIP = 0.65;
const TIRED_EXTEND = 0.2;
const TIRED_LIFT = 0.07;

export function createSkiScene(container: HTMLElement): SkiSceneHandle {
  const scene = new THREE.Scene();

  // The camera rig places and aims this every frame (see the sync below):
  // the default view is the DESIGN.md three-quarter front perspective, V
  // cycles the alternates in CAMERA_VIEWS, and dragging peeks around.
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
  // (slope-visuals seam addition, 2026-07-23) the renderer rides along so
  // the snow can carve ski-trail depth into its GPU height map each frame.
  const environment = createEnvironment(scene, renderer);

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

  const first = CAMERA_VIEWS[0]!;
  const cameraMemory: CameraMemory = {
    view: 0,
    azimuth: first.azimuth,
    elevation: first.elevation,
    radius: first.radius,
    lookX: first.lookX,
    lookY: first.lookY,
    lookZ: first.lookZ,
    lookYaw: 0,
    lookPitch: 0,
    targetLookYaw: 0,
    targetLookPitch: 0,
    dragging: false,
  };

  // Look around: drag anywhere on the slope canvas to swing the camera
  // around the skier — a *peek*, easing back home on release, so the
  // camera can't be stranded facing uphill mid-run. Pointer events cover
  // mouse and touch (touch-action off so a touch drag isn't a page
  // scroll); capture keeps a drag alive outside the window.
  const canvas = renderer.domElement;
  canvas.style.touchAction = "none";
  let lastPointerX = 0;
  let lastPointerY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    cameraMemory.dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!cameraMemory.dragging) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    // Drag right = look right (the camera orbits the opposite way round
    // the skier), drag down = look down (the camera rises). Yaw reaches a
    // full half-turn either way — you can check uphill on the friend the
    // multiplayer phase will put behind you.
    cameraMemory.targetLookYaw = clamp(
      cameraMemory.targetLookYaw - dx * LOOK_SENSITIVITY,
      -Math.PI,
      Math.PI,
    );
    cameraMemory.targetLookPitch = clamp(
      cameraMemory.targetLookPitch + dy * LOOK_SENSITIVITY,
      -1.3,
      1.3,
    );
  });
  const releaseLook = (): void => {
    cameraMemory.dragging = false;
    cameraMemory.targetLookYaw = 0;
    cameraMemory.targetLookPitch = 0;
  };
  canvas.addEventListener("pointerup", releaseLook);
  canvas.addEventListener("pointercancel", releaseLook);

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
    cameraMemory,
    cycleView: () => {
      cameraMemory.view = (cameraMemory.view + 1) % CAMERA_VIEWS.length;
    },
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

  // The tired hop (director directive 2026-07-23): a jump press eaten by
  // the landing lockout gets a visible answer — the spent legs buckle
  // (extra tuck through the first half of the cue), then push a feeble
  // little lift that barely clears the snow before dropping back. Pure
  // presentation shaped off the sim's tiredHop clock: the sim's height
  // never leaves the ground, so the lift is a rig-local offset — physics,
  // hazards, and the camera (which reads state) never feel it.
  let tiredTuck = 0;
  let tiredLift = 0;
  if (state.tiredHop > 0) {
    const attempt = 1 - state.tiredHop / TIRED_HOP_DURATION;
    if (attempt < 0.45) {
      // The sink: knees give slowly under the press, easing to a stop at
      // the bottom of the labored crouch (sin ends flat at π/2).
      tiredTuck = TIRED_DIP * Math.sin((Math.PI / 2) * (attempt / 0.45));
    } else if (attempt < 0.6) {
      // The strain: held deep at the bottom — the legs trying and failing
      // to find the push. The wobble layer keeps it alive.
      tiredTuck = TIRED_DIP;
    } else {
      // The feeble push and collapse: up out of the crouch, a weak leg
      // extension under a few centimeters of lift, and gravity wins —
      // everything settles back to exactly baseline. At boost speeds the
      // baseline tuck is already near full and the sink clamps invisible,
      // so this half — the lift arc and the extension dipping *below*
      // baseline — is what carries the read there.
      const p = (attempt - 0.6) / 0.4;
      tiredLift = TIRED_LIFT * Math.sin(Math.PI * p);
      tiredTuck =
        p < 0.5
          ? TIRED_DIP * Math.cos(Math.PI * p)
          : -TIRED_EXTEND * Math.sin(Math.PI * (2 * p - 1));
    }
  }
  // Set every frame (0 when the cue is idle) so the rig always lands back
  // exactly on the snow.
  handle.skier.group.position.y = tiredLift;

  handle.skier.setSkiMotion({
    tuck: Math.max(tuck, load) + (airborne ? 0.2 : 0) + jump.envelope + tiredTuck,
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

  // The camera rig: ease the orbit toward the active view, layer the drag
  // look on top (a rigid extra swing of the whole rig around the skier —
  // position orbits one way, the aim point rotates with it), then place
  // and aim. state.height rides along in both, so jumps lift the framing
  // exactly the way the old fixed camera did.
  const cam = handle.cameraMemory;
  const view = CAMERA_VIEWS[cam.view]!;
  const viewEase = Math.min(1, dt * VIEW_EASE);
  cam.azimuth += (view.azimuth - cam.azimuth) * viewEase;
  cam.elevation += (view.elevation - cam.elevation) * viewEase;
  cam.radius += (view.radius - cam.radius) * viewEase;
  cam.lookX += (view.lookX - cam.lookX) * viewEase;
  cam.lookY += (view.lookY - cam.lookY) * viewEase;
  cam.lookZ += (view.lookZ - cam.lookZ) * viewEase;
  const lookEase = Math.min(1, dt * LOOK_EASE);
  cam.lookYaw += (cam.targetLookYaw - cam.lookYaw) * lookEase;
  cam.lookPitch += (cam.targetLookPitch - cam.lookPitch) * lookEase;

  const azimuth = cam.azimuth + cam.lookYaw;
  const elevation = clamp(
    cam.elevation + cam.lookPitch,
    MIN_ELEVATION,
    MAX_ELEVATION,
  );
  const flat = cam.radius * Math.cos(elevation);
  handle.camera.position.set(
    state.lateral + flat * Math.sin(azimuth),
    state.height + cam.radius * Math.sin(elevation),
    -state.distance + flat * Math.cos(azimuth),
  );
  const yawSin = Math.sin(cam.lookYaw);
  const yawCos = Math.cos(cam.lookYaw);
  handle.camera.lookAt(
    state.lateral + cam.lookX * yawCos + cam.lookZ * yawSin,
    state.height + cam.lookY,
    -state.distance + cam.lookZ * yawCos - cam.lookX * yawSin,
  );

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
