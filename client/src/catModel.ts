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
export type CatPose = "sitting" | "walking";

const POSE_CLIPS: Record<CatPose, string> = {
  sitting: "Idle",
  walking: "Walk",
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

export function createCatRig(): CatRig {
  const group = new THREE.Group();
  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  let current: CatPose | null = null;
  let pending: CatPose = "sitting";

  void loadTemplate()
    .then((template) => {
      const instance = cloneSkinned(template) as THREE.Group;
      group.add(instance);
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

  function applyPose(pose: CatPose): void {
    if (mixer === null || pose === current) return;
    const next = actions.get(POSE_CLIPS[pose]);
    if (!next) return;
    const previous = current === null ? undefined : actions.get(POSE_CLIPS[current]);
    next.reset().play();
    if (previous && previous !== next) {
      // Short cross-fade so sitting down doesn't snap.
      previous.crossFadeTo(next, 0.25, false);
    }
    current = pose;
  }

  return {
    group,
    setPose(pose: CatPose): void {
      pending = pose;
      applyPose(pose);
    },
    update(dt: number): void {
      mixer?.update(dt);
    },
  };
}
