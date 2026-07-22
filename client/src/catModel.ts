import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// The cat: a real model at last (assets/characters/Cat.glb — Quaternius,
// CC0, palette-recolored by tools/glb_palette.py). It's a rigged, animated
// mesh, so the same file serves both scenes: it walks and sits in the
// bedroom and rides along on the slope.
//
// Both scenes go through this module so there's one place that knows the
// model's quirks — its source scale, which animation clip means what, and
// the signal-red scarf that ties it to the cat faces in the HUD.

const MODEL_URL = `${import.meta.env.BASE_URL}characters/Cat.glb`;

// How tall the cat stands in game units. The source model is authored at a
// different scale (and inside a 100× armature), so rather than hardcode a
// magic multiplier we measure the loaded model and normalize to this.
const CAT_HEIGHT = 0.42;

const SCARF_COLOR = 0xc6473e; // palette signal red — matches the HUD cat faces

// Clip names in the .glb are prefixed by the exporter
// ("AnimalArmature|AnimalArmature|AnimalArmature|Walk"), so we match on the
// trailing segment instead of the full string.
export type CatPose = "sitting" | "walking" | "clinging";

// "clinging" is the slope's riding pose: no CC0 cat has a hug clip, so it
// freezes Idle at one frame and builds the cling procedurally on top — the
// same technique as the skier's crouch, right down to the gotcha: bones are
// overwritten ABSOLUTELY from a captured base frame every update, never
// nudged relatively. (The first attempt multiplied deltas onto the playing
// Idle and the cat slowly tumbled around its own bones — the mixer skips
// rewriting bones whose values it thinks are unchanged, so relative offsets
// accumulate. Measured, not theorized.) The breathing a live Idle would
// have given comes from the small procedural sway in CLING_LIFE instead.
const POSE_CLIPS: Record<CatPose, string> = {
  sitting: "Idle",
  walking: "Walk",
  clinging: "Idle",
};

type Xyz = readonly [number, number, number];

/**
 * The cling, as rotation deltas (radians, local axes) composed onto the
 * captured base frame. The cat lies belly-down against the skier's back
 * (the *mount* supplies that orientation — see skiRender), so in its own
 * local frame the cling is: front legs reaching out and around into the
 * hug, back legs splayed for grip, the head craned up and to one side to
 * peek over the skier's shoulder, and the tail swept round for balance.
 *
 * Bone names are the loaded names: GLTFLoader strips dots, so the pack's
 * "FrontLeg.L" arrives as "FrontLegL" (same gotcha as the skier's rig).
 */
const CLING_POSE: Record<string, Xyz> = {
  Body: [-0.06, 0, 0], // barely arched — a strong arch bowed the rear off the back
  FrontLegL: [-0.85, 0, 0.55], // reach forward and out — the hug
  FrontLegR: [-0.85, 0, -0.55],
  BackLegL: [0.65, 0, 0.4], // folded tight against the lower back
  BackLegR: [0.65, 0, -0.4],
  Head: [-0.62, 0.5, 0], // crane up, turn to peek over the shoulder
  Tail: [0.2, 0, 0.9], // swept to the side, cat-counterweight style
};

/**
 * The clinging cat's life layer: a slow breathe through the body, a lazy
 * tail sway, tiny head adjustments. Same recipe as the skier's SKI_WOBBLE —
 * incommensurate frequencies so it never visibly repeats.
 */
const CLING_LIFE: Record<
  string,
  readonly { axis: 0 | 1 | 2; amp: number; freq: number; phase: number }[]
> = {
  Body: [{ axis: 0, amp: 0.035, freq: 1.3, phase: 0 }],
  Head: [
    { axis: 0, amp: 0.04, freq: 0.9, phase: 1.4 },
    { axis: 1, amp: 0.05, freq: 0.55, phase: 3.1 },
  ],
  Tail: [
    { axis: 2, amp: 0.22, freq: 1.1, phase: 0.7 },
    { axis: 0, amp: 0.1, freq: 0.75, phase: 2.2 },
  ],
};

export interface CatRig {
  /** Parent this into a scene and position it — the model loads into it. */
  readonly group: THREE.Group;
  /** Switch clips. Cheap to call every frame; repeats are ignored. */
  setPose(pose: CatPose): void;
  /** Advance the animation. No-op until the model has loaded. */
  update(dt: number): void;
}

let templatePromise: Promise<THREE.Group> | null = null;

function loadTemplate(): Promise<THREE.Group> {
  templatePromise ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const model = gltf.scene;

    // Normalize: scale to CAT_HEIGHT and sit the feet on y=0, so callers can
    // place the cat with a plain position and not think about source units.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = CAT_HEIGHT / size.y;
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;

    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        // Colors live in the mesh's COLOR_0 attribute (the texture was baked
        // out by tools/glb_palette.py), so the material has to read them.
        const material = object.material as THREE.MeshStandardMaterial;
        material.vertexColors = true;
      }
    });

    // Wrap in a group so our scale/offset survives SkeletonUtils cloning and
    // callers get a clean origin-at-the-paws object to position.
    const wrapper = new THREE.Group();
    wrapper.add(model);
    wrapper.animations = gltf.animations;

    // Place the scarf off the actual skeleton rather than guessed fractions:
    // the neck is just behind and below the head bone.
    model.updateWorldMatrix(true, true);
    const head = model.getObjectByName("Head");
    const neck = new THREE.Vector3(0, CAT_HEIGHT * 0.4, 0);
    if (head) {
      head.getWorldPosition(neck);
      neck.set(0, neck.y * 0.94, neck.z * 0.55);
    }
    // A neck is a good deal thinner than the body it's measured from.
    wrapper.add(createScarf(neck, size.x * scale * 0.2));
    return wrapper;
  });
  return templatePromise;
}

// The cat's signature: a signal-red scarf, the one detail carried over from
// the nine cat faces in the HUD so the icon and the animal read as the same
// character. Built in code rather than modeled — it's a ring.
function createScarf(neck: THREE.Vector3, radius: number): THREE.Mesh {
  const scarf = new THREE.Mesh(
    // Low segment counts on purpose — the bible wants visible facets.
    new THREE.TorusGeometry(radius, radius * 0.42, 6, 12),
    new THREE.MeshStandardMaterial({ color: SCARF_COLOR, roughness: 0.9 }),
  );
  scarf.castShadow = true;
  // A torus rings its own Z axis by default, which is already the cat's
  // forward axis — so no rotation: it sits around the neck like a collar.
  // It doesn't follow the skeleton; at gameplay distance a fixed collar
  // reads fine, and it avoids rigging work for one prop.
  scarf.position.copy(neck);
  return scarf;
}

// Scratch objects reused across frames — the cling runs per update.
const scratchEuler = new THREE.Euler();
const scratchQuaternion = new THREE.Quaternion();

export function createCatRig(): CatRig {
  const group = new THREE.Group();
  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  const bones = new Map<string, THREE.Object3D>();
  let current: CatPose | null = null;
  let pending: CatPose = "sitting";

  void loadTemplate()
    .then((template) => {
      const instance = cloneSkinned(template) as THREE.Group;
      group.add(instance);
      instance.traverse((object) => {
        if (object instanceof THREE.Bone) bones.set(object.name, object);
      });
      mixer = new THREE.AnimationMixer(instance);
      for (const clip of template.animations) {
        // Exporter prefixes the armature name onto every clip.
        actions.set(clip.name.split("|").pop() ?? clip.name, mixer.clipAction(clip));
      }
      current = null;
      applyPose(pending);
    })
    .catch((error: unknown) => {
      // The cat is cosmetic to the simulation — a failed load must not stop
      // the game. The scene just runs without a visible cat.
      console.error("cat model failed to load", error);
    });

  // Base transforms for the bones the cling touches, captured off the
  // frozen Idle frame the first time the cat clings. The cling overwrites
  // these bones absolutely (base ⊗ delta) every frame — see POSE_CLIPS.
  let clingRest: Map<string, THREE.Quaternion> | null = null;
  let clingTime = 0;

  function applyPose(pose: CatPose): void {
    if (mixer === null || pose === current) return;
    const next = actions.get(POSE_CLIPS[pose]);
    if (!next) return;
    const previous = current === null ? undefined : actions.get(POSE_CLIPS[current]);
    next.reset().play();
    // Clinging freezes its base clip at one frame — a cat holding on for
    // dear life shouldn't cycle a grooming idle. All motion comes from the
    // CLING_LIFE layer instead.
    next.paused = pose === "clinging";
    if (previous && previous !== next) {
      // Short cross-fade so sitting down doesn't snap.
      previous.crossFadeTo(next, 0.25, false);
    }
    if (pose !== "clinging") clingRest = null; // re-capture on next cling
    current = pose;
  }

  return {
    group,
    setPose(pose: CatPose): void {
      pending = pose;
      applyPose(pose);
    },
    update(dt: number): void {
      if (mixer === null) return;
      mixer.update(dt);
      if (current !== "clinging") return;
      // Capture the base frame after the mixer has written it once, then
      // overwrite absolutely every frame — relative nudges accumulate on
      // bones the paused mixer stops rewriting (the skier's gotcha).
      clingRest ??= new Map(
        Object.keys(CLING_POSE)
          .map((name) => [name, bones.get(name)] as const)
          .filter((entry): entry is readonly [string, THREE.Object3D] => !!entry[1])
          .map(([name, bone]) => [name, bone.quaternion.clone()]),
      );
      clingTime += dt;
      for (const [name, delta] of Object.entries(CLING_POSE)) {
        const bone = bones.get(name);
        const rest = clingRest.get(name);
        if (!bone || !rest) continue;
        scratchEuler.set(delta[0], delta[1], delta[2]);
        for (const life of CLING_LIFE[name] ?? []) {
          const swing = life.amp * Math.sin(life.freq * clingTime + life.phase);
          if (life.axis === 0) scratchEuler.x += swing;
          else if (life.axis === 1) scratchEuler.y += swing;
          else scratchEuler.z += swing;
        }
        bone.quaternion
          .copy(rest)
          .multiply(scratchQuaternion.setFromEuler(scratchEuler));
      }
    },
  };
}
