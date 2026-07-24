import * as THREE from "three";
import {
  BASE_SPEED,
  BOOST_SPEED,
  BRANCH_SEGMENTS,
  JUMP_CHARGE_TIME,
  LATERAL_LIMIT,
  MIN_SPEED,
  RESPAWN_DELAY,
  SINGLE_TRAIL,
  TIRED_HOP_DURATION,
  downhillHeading,
  roadSegmentIds,
  singleTrailNext,
  type SkiState,
} from "@toebeans/shared";
import { createCatRig, type CatRig } from "./catModel";
import { createSkierRig, type SkierRig } from "./skierModel";
import {
  segmentCenterline,
  segmentPitch,
  segmentToWorld,
  slopeCenterline,
} from "./slopePath";
import {
  createChasmMesh,
  createCheckpointMarker,
  createEnvironment,
  loadSlopeDecor,
  renderSlope,
  syncEnvironment,
  type SlopeEnvironment,
} from "./skiScene";

// This file is the slope's state→presentation wiring (slope-mechanics
// territory): the camera, the rig inputs derived from SkiState each frame,
// and what exists where. Everything about how the slope LOOKS — palette,
// lighting, sky, snow, decor, hazard mesh styles — lives in skiScene.ts
// (slope-visuals territory). See PARALLEL.md for the ownership split.

// ---------------------------------------------------------------------------
// Camera zoom (camera round 3, 2026-07-23 director verdict: free zoom, fixed
// angle). Round 2 blended elevation/aim off the radius, so zooming *swung the
// angle* between the low chase framing and the high overhead one — it read as
// "it only zooms between the top angle and the close one" rather than a free
// in/out. So the framing angle is now FIXED (the classic DESIGN.md
// three-quarter front) and the wheel/pinch move only the orbit distance,
// across a wide free range. The eased orbit rig survives; only what drives it
// changed.

// The fixed framing: bit-for-bit the old fixed camera — offset (0, 4, 8),
// aimed 4 units downhill. Elevation and aim are constants now; only the
// distance changes. At DEFAULT_RADIUS with no look layered on, this
// reproduces the old (0, 4, 8) offset exactly (flat = 8, height = 4), so the
// default look is unchanged from every round before.
const FIXED_ELEVATION = Math.atan2(4, 8); // radians above horizontal
const DEFAULT_RADIUS = Math.hypot(4, 8);
const AIM_X = 0;
const AIM_Y = 0;
const AIM_Z = -4; // aim point offset from the skier (world axes; -z = downhill)

// The free zoom range — now the only zoom tuning knob (round 3 dropped the
// per-distance framing blend). Wider than round 2's [4.6, 15] so "free" feels
// free: in tight for a chase read, way back for the whole-slope tactical view.
const MIN_RADIUS = 3;
const MAX_RADIUS = 40;

// How fast the zoom eases toward its target distance, and how fast the look
// tracks the pointer (per-second easing rates).
const ZOOM_EASE = 6;
const LOOK_EASE = 8;
// Wheel/pinch feel: wheel deltaY is ~±100 per notch, so ~3 units of radius per
// notch across the wider range; pinch is px of finger spread.
const ZOOM_SENSITIVITY = 0.03;
const PINCH_SENSITIVITY = 0.08;
// Touch drag feel (pointer px → radians), kept from round 1.
const LOOK_SENSITIVITY = 0.006;
// Mouse look (camera round 3): Pointer-Lock relative mouselook. Accumulate
// mousemove deltas (px → radians) so you can look as far as you keep turning
// the mouse, past any window edge, with the system cursor hidden. Click the
// slope to engage the lock, Esc to release. Supersedes round 2's no-click
// mouse-position look, which topped out when the cursor hit the window edge.
const MOUSE_LOOK_SENSITIVITY = 0.0022;
// The rig's total pitch clamp: never under the snow, never straight
// overhead (straight-down gimbal-locks lookAt's up vector).
const MIN_ELEVATION = 0.06;
const MAX_ELEVATION = 1.45;
// Look pitch is measured off the fixed elevation, so its travel is exactly
// what keeps the final elevation inside the clamp above — no winding past the
// snow or the zenith that you'd then have to unturn back out of.
const LOOK_PITCH_MIN = MIN_ELEVATION - FIXED_ELEVATION;
const LOOK_PITCH_MAX = MAX_ELEVATION - FIXED_ELEVATION;

// Reduce an angle to [-π, π] by whole turns — used to unwind the unbounded
// mouse yaw before easing it home, so it takes the short way back without a
// visible jump (sin/cos ignore the removed multiples of 2π).
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** The camera rig's eased state — presentation-side memory. */
interface CameraMemory {
  /** Orbit distance, eased toward targetRadius; drives elevation + aim too. */
  radius: number;
  /** Zoom target the wheel/pinch sets, clamped [MIN_RADIUS, MAX_RADIUS]. */
  targetRadius: number;
  /**
   * The look-around: a rigid extra swing of the whole rig around the skier.
   * Yaw is unbounded (mouse look accumulates freely; touch drag clamps to
   * ±π); pitch stays within LOOK_PITCH_MIN/MAX so the elevation can't leave
   * its clamp.
   */
  lookYaw: number;
  lookPitch: number;
  targetLookYaw: number;
  targetLookPitch: number;
  /** A touch drag is in progress (mouse look uses Pointer Lock, no drag). */
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
   * The camera rig (wheel/pinch zooms, Pointer-Lock mouse / touch drag looks
   * around) — eased orbit state, presentation-side memory like steerMemory.
   * Deliberately not saved, same reasoning as the scrapped bedroom's follow
   * camera.
   */
  readonly cameraMemory: CameraMemory;
}

// How long the crash tip-over takes to hit the ground, inside the
// RESPAWN_DELAY pause — quick like a real balance loss, then it holds.
const TIP_DURATION = 0.35;

// The tired hop's shape (the sim's TIRED_HOP_DURATION clock drives it): a
// jump press eaten by the landing lockout gives a quick wind-up crouch on the
// spent legs (TIRED_DIP, in tuck units — at cruise the baseline tuck is ~0.33,
// so this bottoms out near a full crouch), then a feeble push that extends the
// legs (TIRED_EXTEND) and actually pops the whole rig off the snow (TIRED_LIFT,
// world units) before gravity wins and everything settles. Retuned round 2
// (director verdict 2026-07-23: "by deep i meant an actual small hop"): the
// old shape sank slow and *held* the strain at the bottom, reading as a
// grounded buckle — that hold is gone, the wind-up is quick, and the lift is
// the event. A real tap jump flies ~1.4, so TIRED_LIFT ~0.3 (a fifth of that)
// still reads as a pathetic little hop that lands going nowhere. All knobs:
// deeper dip = wearier legs, more lift = more hop, TIRED_DIP_FRACTION = how
// much of the cue is the wind-up before the hop.
const TIRED_DIP = 0.65;
const TIRED_EXTEND = 0.2;
const TIRED_LIFT = 0.3;
// Fraction of the cue spent on the quick wind-up crouch; the rest is the hop.
const TIRED_DIP_FRACTION = 0.3;

export function createSkiScene(container: HTMLElement): SkiSceneHandle {
  const scene = new THREE.Scene();

  // The camera rig places and aims this every frame (see the sync below):
  // the framing is a fixed DESIGN.md three-quarter front angle; wheel/pinch
  // zooms the distance in and out, the mouse (Pointer Lock) / touch looks around.
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
  const environment = createEnvironment(scene, renderer, camera);

  const player = new THREE.Group();
  // Yaw-then-pitch: the road's curve yaws the whole rig to the centerline
  // tangent (rotation.y, straight = 0 today), and the crash tip-over pitches
  // it forward (rotation.x) inside that turned frame. YXZ so the two compose
  // cleanly once the curve turns on.
  player.rotation.order = "YXZ";

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

  // Camera controls (camera round 3). Mouse and touch part ways here, by the
  // director's call. Mouse: Pointer-Lock relative mouselook — click the slope
  // to lock (system cursor hidden), then mousemove deltas accumulate so you
  // can look as far as you keep turning, past any window edge; Esc releases
  // and the look eases home. Touch: a finger drag peeks (eases home on
  // release) and a two-finger pinch zooms — unchanged from round 2. The wheel
  // zooms on either. touch-action off so a touch drag/pinch isn't a page
  // scroll; capture keeps a drag alive outside the window.
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

  // --- Mouse: Pointer-Lock relative mouselook -----------------------------
  let mouseLocked = false;
  // Click the slope to engage the lock — Pointer Lock requires a user gesture.
  // requestPointerLock may reject (not user-activated, or the doc is still
  // exiting a prior lock); ignore it, the player just clicks again. Wrapped in
  // Promise.resolve so it's safe whether the browser returns a promise or not.
  canvas.addEventListener("mousedown", () => {
    if (!mouseLocked) {
      void Promise.resolve(canvas.requestPointerLock()).catch(() => {});
    }
  });
  document.addEventListener("pointerlockchange", () => {
    mouseLocked = document.pointerLockElement === canvas;
    if (!mouseLocked) {
      // Esc (or any unlock) → ease the look home, unwinding the unbounded yaw
      // by whole turns first so it takes the short way back with no jump.
      cameraMemory.lookYaw = wrapAngle(cameraMemory.lookYaw);
      cameraMemory.targetLookYaw = 0;
      cameraMemory.targetLookPitch = 0;
    }
  });
  // While locked, movementX/Y are relative deltas even at the screen edge.
  // Mouse right = look right (the rig orbits the opposite way round the
  // skier); mouse down = look down (the camera rises). Yaw is unbounded — turn
  // as far as you like; pitch clamps so you can't look under the snow or past
  // straight up.
  document.addEventListener("mousemove", (event) => {
    if (!mouseLocked) return;
    cameraMemory.targetLookYaw -= event.movementX * MOUSE_LOOK_SENSITIVITY;
    cameraMemory.targetLookPitch = clamp(
      cameraMemory.targetLookPitch + event.movementY * MOUSE_LOOK_SENSITIVITY,
      LOOK_PITCH_MIN,
      LOOK_PITCH_MAX,
    );
  });

  // --- Touch/pen: drag to peek, two fingers to pinch-zoom (round 2) --------
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

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") return; // mouse look is Pointer Lock now
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
      LOOK_PITCH_MIN,
      LOOK_PITCH_MAX,
    );
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return; // mouse engages via mousedown → lock
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
    if (attempt < TIRED_DIP_FRACTION) {
      // The quick wind-up: knees drop fast under the press, easing to a stop
      // at the bottom of the crouch (sin ends flat at π/2). No hold at the
      // bottom anymore — it flows straight into the hop.
      tiredTuck = TIRED_DIP * Math.sin((Math.PI / 2) * (attempt / TIRED_DIP_FRACTION));
    } else {
      // The hop — the event: legs push up out of the crouch, the whole rig
      // pops off the snow (a real little arc, cat and shadow riding it), a
      // weak leg extension dips below baseline near the top, and gravity wins,
      // settling everything back to exactly baseline. At boost speeds the
      // baseline tuck is already near full and the wind-up clamps invisible,
      // so the lift arc plus the extension below baseline is what carries the
      // read there.
      const p = (attempt - TIRED_DIP_FRACTION) / (1 - TIRED_DIP_FRACTION);
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
  // The road maps the sim's (distance, lateral) to world space (slopePath.ts):
  // straight today, so this is exactly the old `(lateral, height, -distance)`,
  // but everything pinned to the lane now curves together when the road does.
  // `-heading` yaws the body onto the tangent (0 while straight). Now keyed by
  // the run's current SEGMENT (branching map — SLOPE_BRANCHING.md §8): "main"
  // (the Overlook) has no placement, so segmentCenterline falls through to the
  // global road and the un-branched run is bit-for-bit unchanged; a branching
  // run places into whichever spine/detour corridor it's skiing.
  const skierPt = segmentCenterline(state.segmentId, state.distance);
  const skierCosH = Math.cos(skierPt.heading);
  const skierSinH = Math.sin(skierPt.heading);
  const skierX = skierPt.x + skierCosH * state.lateral;
  const skierZ = skierPt.z + skierSinH * state.lateral;
  const curveYaw = -skierPt.heading;
  // The real grade (slope-mech, 2026-07-24): the branching map descends in
  // world-Y, so the skier's ground height is the centerline's y (0 on the flat
  // Overlook — unchanged), and state.height (the jump) rides on top of it.
  handle.player.position.set(skierX, skierPt.y + state.height, skierZ);
  // Lay the body along the slope: a nose-down pitch equal to the downhill grade
  // (negative rotation.x is the downhill/forward direction, same convention as
  // the crash tip below), 0 on the un-graded Overlook so its skier stays
  // upright. Pitches within the road-yawed frame (rotation.order = "YXZ").
  const slopePitch = -segmentPitch(state.segmentId, state.distance);
  // The crash tip-over: chasms are the game's only crash now (turning
  // round 3 removed the fall-over), and a chasm always reads as a forward
  // drop — downhill, the way you were traveling, whatever the stance.
  // Animated over the start of the crash pause — the respawn timer doubles
  // as the clock (forfeit holds it at 0 = fully tipped) — and accelerating
  // like a real topple, not a linear hinge. The tip pitches within the
  // road-yawed frame (rotation.order = "YXZ"), so it stays a forward drop
  // down the curve, and composes on top of the slope pitch.
  if (state.status === "skiing") {
    handle.player.rotation.set(slopePitch, curveYaw, 0);
  } else {
    const progress = Math.min(
      1,
      (RESPAWN_DELAY - state.respawnTimer) / TIP_DURATION,
    );
    const tip = (Math.PI / 2) * progress * progress;
    handle.player.rotation.set(slopePitch - tip, curveYaw, 0);
  }

  // Hazards and checkpoints span the lane at their distance, so they ride the
  // road too: centered on the centerline (lateral 0) and yawed to its tangent,
  // so the slab lies square across the curve. Straight today → x 0, no yaw.
  const checkpointMeshes = handle.checkpointMeshes as Map<number, THREE.Mesh>;
  for (const checkpoint of state.checkpoints) {
    if (checkpoint === 0 || checkpointMeshes.has(checkpoint)) continue;
    const marker = createCheckpointMarker();
    const pt = segmentCenterline(state.segmentId, checkpoint);
    marker.position.set(pt.x, pt.y + 0.02, pt.z);
    // Lie the slab flat on the graded ground: yaw to the tangent, pitch to the
    // slope (0 on the flat Overlook). YXZ so the two compose like the rig.
    marker.rotation.set(-segmentPitch(state.segmentId, checkpoint), -pt.heading, 0, "YXZ");
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
    const chasmMid = chasm.start + chasm.width / 2;
    const pt = segmentCenterline(state.segmentId, chasmMid);
    mesh.position.set(pt.x, pt.y + 0.01, pt.z);
    mesh.rotation.set(-segmentPitch(state.segmentId, chasmMid), -pt.heading, 0, "YXZ");
  }

  // The camera rig: ease the orbit distance toward the zoom target, hold the
  // framing angle fixed (round 3 — no more radius-driven blend), then layer
  // the look on top (a rigid extra swing of the whole rig around the skier —
  // position orbits one way, the aim point rotates with it) and place and aim.
  // The base azimuth is a constant 0 (downhill-facing); the look yaw is the
  // only thing that swings it. state.height rides along in both, so jumps lift
  // the framing exactly the way the old fixed camera did.
  const cam = handle.cameraMemory;
  const zoomEase = Math.min(1, dt * ZOOM_EASE);
  cam.radius += (cam.targetRadius - cam.radius) * zoomEase;
  const lookEase = Math.min(1, dt * LOOK_EASE);
  cam.lookYaw += (cam.targetLookYaw - cam.lookYaw) * lookEase;
  cam.lookPitch += (cam.targetLookPitch - cam.lookPitch) * lookEase;

  const azimuth = cam.lookYaw;
  const elevation = clamp(
    FIXED_ELEVATION + cam.lookPitch,
    MIN_ELEVATION,
    MAX_ELEVATION,
  );
  const flat = cam.radius * Math.cos(elevation);
  // The rig is built in the skier's tangent frame (+z = uphill, +x = lane
  // right) exactly as before, then rotated by the road's heading and dropped
  // at the skier's world point — so "behind and above, looking downhill"
  // follows the curve. Straight today (skierPt.heading 0) → skierCosH 1,
  // skierSinH 0, and this is bit-for-bit the old world-axis math.
  const localPosX = flat * Math.sin(azimuth);
  const localPosZ = flat * Math.cos(azimuth);
  handle.camera.position.set(
    skierX + localPosX * skierCosH - localPosZ * skierSinH,
    // skierPt.y grounds the framing on the real grade (0 on the flat Overlook),
    // and state.height rides on top so jumps lift the camera as before.
    skierPt.y + state.height + cam.radius * Math.sin(elevation),
    skierZ + localPosX * skierSinH + localPosZ * skierCosH,
  );
  const yawSin = Math.sin(cam.lookYaw);
  const yawCos = Math.cos(cam.lookYaw);
  const localAimX = AIM_X * yawCos + AIM_Z * yawSin;
  const localAimZ = AIM_Z * yawCos - AIM_X * yawSin;
  handle.camera.lookAt(
    skierX + localAimX * skierCosH - localAimZ * skierSinH,
    skierPt.y + state.height + AIM_Y,
    skierZ + localAimX * skierSinH + localAimZ * skierCosH,
  );

  // Atmosphere follows the run downhill — the offsets are skiScene's.
  // (slope-visuals seam addition) the snow also gets the two numbers it
  // needs to carve ski trails: which way the skis point, and whether
  // they're on the snow at all.
  //
  // The anchor is the skier's world ground point on the road (straight today,
  // so = the old `(lateral, 0, -distance)`). SEAM NOTE (slope-mech →
  // slope-vis): when the curve turns on, the snow window/decor/trails need the
  // road too — the anchor already carries the curved position, but `heading`
  // here is still fall-line-relative (from the sim). Combine it with the
  // centerline tangent (`slopeCenterline(state.distance).heading`) on the
  // visuals side so trails point the right way in world space. Parked in
  // IDEAS.md (slope-vis).
  //
  // GRADE SEAM (slope-mech, 2026-07-24): the anchor now carries the real ground
  // y (skierPt.y — 0 on the flat Overlook, descending on the branching map).
  // The snow surface still ignores anchor.y (flat plane), so on the branching
  // map the skier rides the grayblock corridor while the dressed snow stays at
  // 0 — the slope-vis task is to sit + tilt the snow surface to anchor.y (see
  // IDEAS.md). Harmless on the Overlook (y stays 0).
  const anchor = new THREE.Vector3(skierX, skierPt.y, skierZ);
  syncEnvironment(handle.environment, anchor, handle.camera, {
    heading: state.heading,
    grounded: state.height <= 0 && state.status === "skiing",
  });
}

// The branching map's TERRAIN (slope-mech, 2026-07-24 — "create the real
// mountain", director). Was grayblock box-strips; now a real, believable mountain
// SURFACE: one continuous mesh per segment, the playable lane smooth and flush
// with the sim's ground, flanked by snowbanks that rise into rolling mountainside
// so you ski down a real hill, not a chute of stacked boxes. Follows the curved
// centerlines (segmentToWorld) AND the varying grade (segmentCenterline.y /
// segmentPitch) so the ground descends + bends exactly under the run.
//
// SINGLE TRAIL (slope-mech, 2026-07-24 redirect — IDEAS.md START HERE): the forks
// are parked, so this builds ONLY the played trail's segments (route.ts's
// SINGLE_TRAIL — summit → the back of the forest), riding the smooth continuous
// TRAIL_LINE centerline. No detour corridors, no fork-marker rocks. The trail's
// terminal (the back of the forest, singleTrailNext → null) extends a flat RUNOUT —
// there is no finish line yet (director), so the run coasts off onto the valley
// floor. Built once when a run starts (main.ts). Reopening the map = iterate more
// of the graph here again. (Still one mesh PER segment for now; merging the trail
// into a single seamless surface is the next chunk — Josh split it off.)
//
// SEAM NOTE (slope-mech → slope-vis): this is a PLAIN-SHADED placeholder surface —
// real geometry, no dressing. skiScene.ts (slope-vis) owns the final look (snow
// material/displacement, decor, ski-trail carving) and will re-skin or replace
// this mesh; the geometry helpers it needs are the same slopePath.ts exports used
// here. Deliberately in skiRender (slope-mech): it's the ground the sim rides.
export function addBranchTerrain(handle: SkiSceneHandle): void {
  // Which segments are the default road vs. detour worlds — the single source of
  // truth in route.ts. Kept as the faintest snow tint (road cool, detours a hair
  // greener) so the topology still reads without debug boxes.
  const road = roadSegmentIds();

  // The cross-section of a corridor: a flat playable LANE (|lateral| ≤ LANE_HALF,
  // exactly the sim's ground so the skier sits flush at any lane position), then
  // FLANKS that rise into snowbanks out to ±FLANK_HALF. Columns are anchored at
  // 0 and ±LANE_HALF so the lane stays crisply flat, coarser out on the banks.
  const LANE_HALF = LATERAL_LIMIT; // 12
  const FLANK_HALF = 46;
  const BERM_HEIGHT = 12; // how high the banks climb by the outer edge
  const COLS = [
    -46, -38, -30, -22, -16, -LANE_HALF, -6, 0, 6, LANE_HALF, 16, 22, 30, 38, 46,
  ];
  const STEP_LONG = 5; // longitudinal sample spacing (units of travel)
  const RUNOUT = 180; // flat coast-out past a terminal segment's flag

  // Gentle rolling relief on the banks (a few octaves of sin, deterministic and
  // built once), faded to 0 at the lane edge so the piste stays clean.
  const flankRelief = (x: number, z: number): number =>
    3.2 * Math.sin(x * 0.06 + z * 0.02) +
    1.8 * Math.sin(x * 0.15 - z * 0.09) +
    2.0 * Math.cos(z * 0.11 + x * 0.045);

  // The height of a cross-section vertex: flat across the lane at the centerline
  // y, rising smoothly into a noisy bank beyond it.
  const crossY = (centerY: number, lat: number, wx: number, wz: number): number => {
    const a = Math.abs(lat);
    if (a <= LANE_HALF) return centerY;
    const t = Math.min(1, (a - LANE_HALF) / (FLANK_HALF - LANE_HALF));
    const smooth = t * t * (3 - 2 * t);
    return centerY + (BERM_HEIGHT + flankRelief(wx, wz)) * smooth;
  };

  for (const id of SINGLE_TRAIL) {
    const seg = BRANCH_SEGMENTS[id];
    if (!seg) continue;
    // Terminal on the PLAYED TRAIL (not the parked graph): the back of the forest
    // is where singleTrailNext runs out, and there the surface extends the runout.
    const isTerminal = singleTrailNext(id) === null;
    const spanEnd = seg.length + (isTerminal ? RUNOUT : 0);
    const rows = Math.max(2, Math.ceil(spanEnd / STEP_LONG) + 1);
    const cols = COLS.length;

    const positions = new Float32Array(rows * cols * 3);
    for (let i = 0; i < rows; i++) {
      const s = (i / (rows - 1)) * spanEnd;
      const centerY = segmentCenterline(id, s).y;
      for (let j = 0; j < cols; j++) {
        const lat = COLS[j]!;
        const w = segmentToWorld(id, s, lat);
        const k = (i * cols + j) * 3;
        positions[k] = w.x;
        positions[k + 1] = crossY(centerY, lat, w.x, w.z);
        positions[k + 2] = w.z;
      }
    }

    // Two triangles per grid cell, wound so the normals face up (+y).
    const indices: number[] = [];
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = i * cols + j + 1;
        const c = (i + 1) * cols + j;
        const d = (i + 1) * cols + j + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: road.has(id) ? 0xe4edf6 : 0xdbe8e0,
        roughness: 1,
      }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    handle.scene.add(mesh);
  }
  // Fork-marker boulders are parked with the forks (the "world grabs you" landmarks
  // at each trigger). They return when the map reopens — iterate the trigger
  // segments again then. Nothing to place on the single trail.
}

export function render(handle: SkiSceneHandle): void {
  // (slope-vis seam add, 2026-07-24) the draw goes through skiScene so the
  // night-bloom composer can composite the enchanted glow; by day this is a
  // straight renderer.render. skiScene owns the look, this file owns the tick.
  renderSlope(handle.renderer, handle.scene, handle.camera);
}
