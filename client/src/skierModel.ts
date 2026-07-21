import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  resolveAppearance,
  resolveCharacter,
  type Appearance,
  type AppearanceColors,
  type CharacterRegion,
} from "@toebeans/shared";

// The skier: you. A real rigged model in both scenes, picked from a roster
// of CC0 Quaternius characters (DESIGN.md → Characters & customization).
//
// The whole module leans on one fact about that pack: **every character in
// it shares a single skeleton and a single set of clips**. Three things fall
// out of that, and they're why this file is much simpler than the two-base
// version it replaces:
//
//   * The clips live in ONE shared file (CharacterClips.glb) and are bound
//     to whichever character is loaded by bone name. Each character .glb
//     therefore ships geometry only — a bit over half the download saved.
//   * Every character scales by the same rule, measured off the Head bone
//     rather than the bounding box, so a hat or a tall hairstyle makes a
//     character *taller* instead of quietly shrinking their body.
//   * Recoloring is uniform: the pack is textureless with named materials,
//     so skin and hair are just material colors. The rest of the outfit is
//     baked to the palette at conversion time by tools/gltf_character.py.

/** Where the Head bone sits, in game units, when the skier stands upright. */
const HEAD_BONE_HEIGHT = 1.03;

/** The bone the scale is measured from. Present on every character. */
const SCALE_REFERENCE_BONE = "Head";

const CLIPS_URL = `${import.meta.env.BASE_URL}characters/CharacterClips.glb`;

function characterUrl(id: string): string {
  return `${import.meta.env.BASE_URL}characters/${id}.glb`;
}

export type SkierPose = "idle" | "walking" | "skiing";

// There is no skiing clip: no CC0 pack contains one (see the asset research
// in DESIGN.md), so "skiing" borrows the idle clip and gets its read from
// the forward lean below. A real ski pose is parked in IDEAS.md — it can be
// posed on the rig directly, and now that the roster shares one skeleton it
// only has to be built once for all of them.
const POSE_CLIPS: Record<SkierPose, string> = {
  idle: "Idle",
  walking: "Walk",
  skiing: "Idle",
};

/** How far the skier tips downhill in the ski pose, in radians. */
const SKI_LEAN = -0.22;

/** Which named material takes which runtime color. */
const MATERIAL_REGIONS: Record<string, CharacterRegion> = {
  Skin: "skin",
  Hair: "hair",
};

export interface SkierRig {
  /** Parent this into a scene and position it — the model loads into it. */
  readonly group: THREE.Group;
  /** Switch clips. Cheap to call every frame; repeats are ignored. */
  setPose(pose: SkierPose): void;
  /**
   * Which way the character is turned, in radians, 0 being +z (the pack is
   * authored facing +z). Set this rather than rotating `group`: the ski lean
   * is applied *above* the turn, so that a downhill-facing skier still leans
   * downhill and not backwards into the hill.
   */
  setFacing(radians: number): void;
  /** Swap character and/or recolor. Cheap to repeat. */
  setAppearance(appearance: Appearance): void;
  /** Advance the animation. No-op until the model has loaded. */
  update(dt: number): void;
}

/** One loaded, cloned, ready-to-color copy of a character. */
interface Instance {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Map<string, THREE.AnimationAction>;
  applyColor(region: CharacterRegion, color: THREE.Color): void;
  pose: SkierPose | null;
}

const templates = new Map<string, Promise<THREE.Group>>();
let clips: Promise<THREE.AnimationClip[]> | null = null;

function loadClips(): Promise<THREE.AnimationClip[]> {
  clips ??= new GLTFLoader()
    .loadAsync(CLIPS_URL)
    .then((gltf) => gltf.animations);
  return clips;
}

function loadTemplate(id: string): Promise<THREE.Group> {
  let template = templates.get(id);
  if (!template) {
    template = new GLTFLoader().loadAsync(characterUrl(id)).then((gltf) => {
      const model = gltf.scene;

      // Normalize so callers place the skier with a plain position and never
      // think about the source units. Scale comes off the Head bone, not the
      // bounding box: the roster includes hats and long hair, and scaling
      // those to a fixed total height would shrink the *body* to make room.
      model.updateWorldMatrix(true, true);
      const head = model.getObjectByName(SCALE_REFERENCE_BONE);
      if (!head) {
        throw new Error(`${id}: no ${SCALE_REFERENCE_BONE} bone to scale from`);
      }
      const headHeight = head.getWorldPosition(new THREE.Vector3()).y;
      model.scale.setScalar(HEAD_BONE_HEIGHT / headHeight);

      // Feet on y=0. Measured after scaling, and off the mesh rather than the
      // skeleton, so shoe soles land on the snow instead of hovering.
      model.updateWorldMatrix(true, true);
      model.position.y = -new THREE.Box3().setFromObject(model).min.y;

      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          // The skier's shadow on the snow is the bible's height cue on jumps.
          object.castShadow = true;
        }
      });

      const wrapper = new THREE.Group();
      wrapper.add(model);
      return wrapper;
    });
    templates.set(id, template);
  }
  return template;
}

/**
 * Give this instance its own copies of the named materials — SkeletonUtils
 * .clone shares them with the template, so without this, recoloring one
 * character would recolor every copy of it — and index them by region.
 */
function bindMaterialRegions(root: THREE.Object3D): Instance["applyColor"] {
  const byRegion = new Map<CharacterRegion, THREE.MeshStandardMaterial[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const owned = materials.map((material) => {
      const copy = (material as THREE.MeshStandardMaterial).clone();
      const region = MATERIAL_REGIONS[copy.name];
      if (region) {
        const list = byRegion.get(region) ?? [];
        list.push(copy);
        byRegion.set(region, list);
      }
      return copy;
    });
    object.material = Array.isArray(object.material) ? owned : owned[0]!;
  });

  return (region, color) => {
    // A character with no Hair material (the bald one) simply has nothing to
    // recolor here — not an error.
    for (const material of byRegion.get(region) ?? []) {
      material.color.copy(color);
    }
  };
}

function createInstance(
  template: THREE.Group,
  animations: THREE.AnimationClip[],
): Instance {
  const root = cloneSkinned(template) as THREE.Group;
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of animations) {
    // The clips come from a different file than the mesh; the mixer binds
    // their tracks to this character's bones by name, which works because
    // the whole pack shares one skeleton.
    actions.set(clip.name, mixer.clipAction(clip));
  }
  return { root, mixer, actions, applyColor: bindMaterialRegions(root), pose: null };
}

export function createSkierRig(): SkierRig {
  // group → lean → facing → model. The order matters: the lean has to sit
  // ABOVE the turn, or turning the skier downhill (a half turn) flips which
  // way the lean tips them and they lean back into the hill.
  const group = new THREE.Group();
  // The ski pose is a lean, not a clip — see POSE_CLIPS.
  const lean = new THREE.Group();
  const facing = new THREE.Group();
  group.add(lean);
  lean.add(facing);

  const instances = new Map<string, Instance>();
  let active: Instance | null = null;
  let pose: SkierPose = "idle";
  let colors: AppearanceColors | null = null;

  function applyPose(): void {
    lean.rotation.x = pose === "skiing" ? SKI_LEAN : 0;
    if (active === null || active.pose === pose) return;
    const next = active.actions.get(POSE_CLIPS[pose]);
    if (!next) return;
    const previous =
      active.pose === null ? undefined : active.actions.get(POSE_CLIPS[active.pose]);
    next.reset().play();
    if (previous && previous !== next) {
      previous.crossFadeTo(next, 0.25, false); // don't snap between poses
    }
    active.pose = pose;
  }

  function applyColors(): void {
    if (active === null || colors === null) return;
    for (const [region, hex] of Object.entries(colors) as [
      CharacterRegion,
      string,
    ][]) {
      active.applyColor(region, new THREE.Color(hex));
    }
  }

  function activate(id: string): void {
    const instance = instances.get(id);
    if (!instance || active === instance) return;
    if (active) facing.remove(active.root);
    facing.add(instance.root);
    active = instance;
    applyColors();
    applyPose();
  }

  function ensureLoaded(id: string): void {
    if (instances.has(id)) {
      activate(id);
      return;
    }
    void Promise.all([loadTemplate(id), loadClips()])
      .then(([template, animations]) => {
        if (!instances.has(id)) {
          instances.set(id, createInstance(template, animations));
        }
        activate(id);
      })
      .catch((error: unknown) => {
        // A missing character must not stop the game — the scene runs on
        // without a visible player rather than throwing in the loop.
        console.error(`character model (${id}) failed to load`, error);
      });
  }

  return {
    group,
    setPose(next: SkierPose): void {
      pose = next;
      applyPose();
    },
    setFacing(radians: number): void {
      facing.rotation.y = radians;
    },
    setAppearance(appearance: Appearance): void {
      colors = resolveAppearance(appearance);
      ensureLoaded(resolveCharacter(appearance).id);
      applyColors();
    },
    update(dt: number): void {
      active?.mixer.update(dt);
    },
  };
}
