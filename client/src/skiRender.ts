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
// Camera zoom (camera round 2, 2026-07-23 director verdict: pre-built views
// are out, free control is in). The camera is one downhill-facing orbit whose
// distance the player sets continuously — mouse wheel / pinch driving the
// radius through a clamped range. Elevation and aim don't hold fixed; they're
// *blended off the radius* through these knots, so each distance stays framed
// the way its old round-1 view was tuned (director's recommended start): close
// = the low over-the-shoulder chase, mid = the DESIGN.md three-quarter
// classic, far = the high whole-slope tactical read. The eased orbit rig
// survives; only what drives it changed. Knots are ordered by radius.
interface ZoomKnot {
  /** Orbit distance from the skier. */
  readonly radius: number;
  /** Radians above horizontal. */
  readonly elevation: number;
  /** Aim point, offset from the skier (world axes; -z = downhill). */
  readonly lookX: number;
  readonly lookY: number;
  readonly lookZ: number;
}

const ZOOM_KNOTS: readonly ZoomKnot[] = [
  // Chase: low and close off the ski tails, aimed over the shoulder — speed
  // reads hardest here. The zoomed-in end of the range.
  { radius: 4.6, elevation: 0.35, lookX: 0, lookY: 0.5, lookZ: -6 },
  // Classic: the DESIGN.md three-quarter front framing, bit-for-bit the old
  // fixed numbers (offset (0, 4, 8), aimed 4 downhill). The default distance.
  { radius: Math.hypot(4, 8), elevation: Math.atan2(4, 8), lookX: 0, lookY: 0, lookZ: -4 },
  // Far: high and well back — chasms and checkpoints laid out ahead. The
  // zoomed-out end.
  { radius: 15, elevation: 0.9, lookX: 0, lookY: 0, lookZ: -6 },
];

const MIN_RADIUS = ZOOM_KNOTS[0]!.radius;
const MAX_RADIUS = ZOOM_KNOTS[ZOOM_KNOTS.length - 1]!.radius;
// Classic distance is the default framing (unchanged from the old fixed cam).
const DEFAULT_RADIUS = ZOOM_KNOTS[1]!.radius;

// Blend the elevation and aim offset for a given orbit distance by walking the
// knots — piecewise-linear, so the framing slides smoothly as you zoom.
function framingForRadius(radius: number): {
  elevation: number;
  lookX: number;
  lookY: number;
  lookZ: number;
} {
  const r = clamp(radius, MIN_RADIUS, MAX_RADIUS);
  let lo = ZOOM_KNOTS[0]!;
  let hi = ZOOM_KNOTS[ZOOM_KNOTS.length - 1]!;
  for (let i = 0; i < ZOOM_KNOTS.length - 1; i++) {
    if (r >= ZOOM_KNOTS[i]!.radius && r <= ZOOM_KNOTS[i + 1]!.radius) {
      lo = ZOOM_KNOTS[i]!;
      hi = ZOOM_KNOTS[i + 1]!;
      break;
    }
  }
  const span = hi.radius - lo.radius;
  const t = span > 0 ? (r - lo.radius) / span : 0;
  return {
    elevation: lo.elevation + (hi.elevation - lo.elevation) * t,
    lookX: lo.lookX + (hi.lookX - lo.lookX) * t,
    lookY: lo.lookY + (hi.lookY - lo.lookY) * t,
    lookZ: lo.lookZ + (hi.lookZ - lo.lookZ) * t,
  };
}

// How fast the zoom eases toward its target distance, and how fast the mouse
// look tracks the pointer (per-second easing rates).
const ZOOM_EASE = 6;
const LOOK_EASE = 8;
// Wheel/pinch feel: wheel deltaY is ~±100 per notch, so ~1 unit of radius per
// notch (≈10 notches across the whole range); pinch is px of finger spread.
const ZOOM_SENSITIVITY = 0.01;
const PINCH_SENSITIVITY = 0.03;
// Touch drag feel (pointer px → radians), kept from round 1.
const LOOK_SENSITIVITY = 0.006;
// No-click mouse look (camera round 2): the cursor's offset from canvas center
// drives the look — centered = camera home, edges = full look, no button. A
// deadzone keeps the camera still during normal play, and the offset is
// squared so near-center is gentle and only a deliberate push to the edge
// reaches the extremes (checking uphill). Max reach matches round 1's drag.
const LOOK_DEADZONE = 0.15;
const MAX_LOOK_YAW = Math.PI;
const MAX_LOOK_PITCH = 1.3;
// The rig's total pitch clamp: never under the snow, never straight
// overhead (straight-down gimbal-locks lookAt's up vector).
const MIN_ELEVATION = 0.06;
const MAX_ELEVATION = 1.45;

// Map a centered axis (mouse offset in [-1, 1]) to a look fraction: dead near
// zero, then a signed square ramp out to 1 at the edge.
function shapeLookAxis(v: number): number {
  const a = Math.abs(v);
  if (a <= LOOK_DEADZONE) return 0;
  const t = Math.min(1, (a - LOOK_DEADZONE) / (1 - LOOK_DEADZONE));
  return Math.sign(v) * t * t;
}

/** The camera rig's eased state — presentation-side memory. */
interface CameraMemory {
  /** Orbit distance, eased toward targetRadius; drives elevation + aim too. */
  radius: number;
  /** Zoom target the wheel/pinch sets, clamped [MIN_RADIUS, MAX_RADIUS]. */
  targetRadius: number;
  /** The look-around: a rigid extra swing of the whole rig around the skier. */
  lookYaw: number;
  lookPitch: number;
  targetLookYaw: number;
  targetLookPitch: number;
  /** A touch drag is in progress (mouse look is position-based, no drag). */
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
   * The camera rig (wheel/pinch zooms, the mouse position looks around) —
   * eased orbit state, presentation-side memory like steerMemory. Deliberately
   * not saved, same reasoning as the scrapped bedroom's follow camera.
   */
  readonly cameraMemory: CameraMemory;
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
  // the default framing is the DESIGN.md three-quarter front perspective at
  // the classic distance; wheel/pinch zooms in and out, the mouse looks around.
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

  const cameraMemory: CameraMemory = {
    radius: DEFAULT_RADIUS,
    targetRadius: DEFAULT_RADIUS,
    lookYaw: 0,
    lookPitch: 0,
    targetLookYaw: 0,
    targetLookPitch: 0,
    dragging: false,
  };

  // Camera controls (camera round 2). Mouse and touch part ways here, by the
  // director's call: on mouse the look is automatic — the cursor's offset from
  // canvas center *is* the input, no button — while touch keeps a finger drag
  // (which makes sense for a touchscreen) and adds a two-finger pinch to zoom.
  // The wheel zooms on either. touch-action off so a touch drag/pinch isn't a
  // page scroll; capture keeps a drag alive outside the window.
  const canvas = renderer.domElement;
  canvas.style.touchAction = "none";

  // Wheel zoom (both input kinds): scroll up (deltaY < 0) pulls the camera in.
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      cameraMemory.targetRadius = clamp(
        cameraMemory.targetRadius + event.deltaY * ZOOM_SENSITIVITY,
        MIN_RADIUS,
        MAX_RADIUS,
      );
    },
    { passive: false },
  );

  // Touch bookkeeping: which fingers are down (for the pinch), and the last
  // single-finger position (for the drag). Mouse ignores all of this.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0; // 0 = not pinching
  let lastPointerX = 0;
  let lastPointerY = 0;
  const pointerSpread = (): number => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  };

  // No-click mouse look: the cursor's position on the canvas drives the look
  // directly — centered = home, edges = full look. A move to the edge peeks;
  // moving back re-centers (round 1's snap-back-on-release becomes this).
  // Leaving the canvas (onto the HUD, say) re-centers too.
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // not laid out yet
      const nx = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      const ny = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      // Mouse right = look right (the camera orbits the opposite way round
      // the skier); mouse toward the bottom = look down (the camera rises).
      cameraMemory.targetLookYaw = -shapeLookAxis(nx) * MAX_LOOK_YAW;
      cameraMemory.targetLookPitch = shapeLookAxis(ny) * MAX_LOOK_PITCH;
      return;
    }
    // Touch/pen: update this finger, then either pinch (two down) or drag.
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointers.size >= 2) {
      const spread = pointerSpread();
      if (pinchDist > 0) {
        // Fingers spreading apart (spread growing) pulls the camera in.
        cameraMemory.targetRadius = clamp(
          cameraMemory.targetRadius - (spread - pinchDist) * PINCH_SENSITIVITY,
          MIN_RADIUS,
          MAX_RADIUS,
        );
      }
      pinchDist = spread;
      return;
    }
    if (!cameraMemory.dragging) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    // Same directions as the mouse look; yaw reaches a full half-turn either
    // way — you can check uphill on the friend multiplayer will put behind you.
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

  // Mouse leaves the canvas → recenter the look (it's parked, not stranded).
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    cameraMemory.targetLookYaw = 0;
    cameraMemory.targetLookPitch = 0;
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return; // mouse look needs no press
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      // Second finger down → pinch; suspend the drag look.
      pinchDist = pointerSpread();
      cameraMemory.dragging = false;
    } else {
      cameraMemory.dragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    }
  });
  const endTouch = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      // All fingers up → ease the look back home, like round 1's release.
      cameraMemory.dragging = false;
      cameraMemory.targetLookYaw = 0;
      cameraMemory.targetLookPitch = 0;
    } else {
      // One finger left after a pinch → resume dragging from where it is.
      cameraMemory.dragging = true;
      const rest = pointers.values().next().value!;
      lastPointerX = rest.x;
      lastPointerY = rest.y;
    }
  };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);

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

  // The camera rig: ease the orbit distance toward the zoom target, read the
  // elevation and aim off that eased distance (so the framing slides with the
  // zoom), then layer the look on top (a rigid extra swing of the whole rig
  // around the skier — position orbits one way, the aim point rotates with it)
  // and place and aim. The base azimuth is a constant 0 (downhill-facing) now
  // that views are gone; the look yaw is the only thing that swings it.
  // state.height rides along in both, so jumps lift the framing exactly the
  // way the old fixed camera did.
  const cam = handle.cameraMemory;
  const zoomEase = Math.min(1, dt * ZOOM_EASE);
  cam.radius += (cam.targetRadius - cam.radius) * zoomEase;
  const framing = framingForRadius(cam.radius);
  const lookEase = Math.min(1, dt * LOOK_EASE);
  cam.lookYaw += (cam.targetLookYaw - cam.lookYaw) * lookEase;
  cam.lookPitch += (cam.targetLookPitch - cam.lookPitch) * lookEase;

  const azimuth = cam.lookYaw;
  const elevation = clamp(
    framing.elevation + cam.lookPitch,
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
    state.lateral + framing.lookX * yawCos + framing.lookZ * yawSin,
    state.height + framing.lookY,
    -state.distance + framing.lookZ * yawCos - framing.lookX * yawSin,
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
