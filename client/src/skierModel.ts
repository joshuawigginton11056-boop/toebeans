import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  resolveAppearance,
  type Appearance,
  type AppearanceColors,
  type CharacterRegion,
  type SkierBase,
} from "@toebeans/shared";

// The skier: you. A real rigged model in both scenes, recolored at runtime
// from the character palette (DESIGN.md → Character palette).
//
// Two CC0 Quaternius bases ship at once while the director picks between
// them by eye; they carry their six color regions in completely different
// ways, and this module is the only place that knows the difference:
//
//   modular  — six named materials, no textures. Recolor = set a material
//              color.
//   animated — one mesh whose atlas was baked to palette vertex colors by
//              tools/glb_palette.py. Recolor = rewrite the entries of the
//              color attribute that match a region's baked color.
//
// Everything above this file just calls setAppearance() and never learns
// which base is loaded. When the director calls it, the losing base and its
// branch here get deleted.

/** How tall the skier stands in game units — a person, not a cat. */
const SKIER_HEIGHT = 1.6;

const MODEL_URLS: Record<SkierBase, string> = {
  modular: `${import.meta.env.BASE_URL}characters/Skier_Modular.glb`,
  animated: `${import.meta.env.BASE_URL}characters/Skier_Animated.glb`,
};

export type SkierPose = "idle" | "walking" | "skiing";

// Clip names differ between the two bases (one prefixes everything with
// "Man_"). Neither has a real skiing animation — there is no CC0 skiing
// human anywhere, per the asset research in DESIGN.md — so "skiing" borrows
// the idle clip and gets its read from the forward lean below.
const POSE_CLIPS: Record<SkierBase, Record<SkierPose, string>> = {
  modular: { idle: "Man_Idle", walking: "Man_Walk", skiing: "Man_Idle" },
  animated: { idle: "Idle", walking: "Walking", skiing: "Idle" },
};

/** How far the skier tips downhill in the ski pose, in radians. */
const SKI_LEAN = -0.22;

// Which named material is which region, for the modular base.
const MATERIAL_REGIONS: Record<string, CharacterRegion> = {
  Skin: "skin",
  Hair: "hair",
  Eyes: "eyes",
  Shirt: "coat",
  Pants: "trousers",
  Socks: "boots",
};

// What each region was baked to in Skier_Animated.glb, for the animated
// base. These are the --map targets used when the atlas was converted; they
// are identifiers here, not style choices, so changing the ramp defaults in
// /shared does NOT mean changing these.
const BAKED_REGION_COLORS: Record<CharacterRegion, number> = {
  skin: 0xdca77e,
  hair: 0x4a3628,
  eyes: 0x3b2b22,
  coat: 0x4e72a8,
  trousers: 0x3e3a3a,
  boots: 0x3a2f2f,
};

export interface SkierRig {
  /** Parent this into a scene and position it — the model loads into it. */
  readonly group: THREE.Group;
  /** Switch clips. Cheap to call every frame; repeats are ignored. */
  setPose(pose: SkierPose): void;
  /**
   * Which way the character is turned, in radians, 0 being +z (both bases
   * are authored facing +z). Set this rather than rotating `group`: the ski
   * lean is applied *above* the turn, so that a downhill-facing skier still
   * leans downhill and not backwards into the hill.
   */
  setFacing(radians: number): void;
  /** Recolor (and if the base changed, swap models). Cheap to repeat. */
  setAppearance(appearance: Appearance): void;
  /** Advance the animation. No-op until the model has loaded. */
  update(dt: number): void;
}

/** One loaded, cloned, ready-to-color copy of a base model. */
interface Instance {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Map<string, THREE.AnimationAction>;
  readonly base: SkierBase;
  applyColor(region: CharacterRegion, color: THREE.Color): void;
  pose: SkierPose | null;
}

const templates = new Map<SkierBase, Promise<THREE.Group>>();

function loadTemplate(base: SkierBase): Promise<THREE.Group> {
  let template = templates.get(base);
  if (!template) {
    template = new GLTFLoader().loadAsync(MODEL_URLS[base]).then((gltf) => {
      const model = gltf.scene;

      // Normalize: scale to SKIER_HEIGHT with the boots on y=0, so callers
      // place the skier with a plain position and never think about the
      // source units (both bases are authored tiny inside a scaled
      // armature, and at different scales from each other).
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = SKIER_HEIGHT / size.y;
      model.scale.setScalar(scale);
      model.position.y = -box.min.y * scale;

      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          // The skier's shadow on the snow is the bible's height cue on jumps.
          object.castShadow = true;
        }
      });

      const wrapper = new THREE.Group();
      wrapper.add(model);
      wrapper.animations = gltf.animations;
      return wrapper;
    });
    templates.set(base, template);
  }
  return template;
}

/**
 * The modular base: give this instance its own copies of the six named
 * materials (SkeletonUtils.clone shares them with the template), and index
 * them by region.
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
    for (const material of byRegion.get(region) ?? []) {
      material.color.copy(color);
    }
  };
}

/**
 * The animated base: its regions live in the baked color attribute, so give
 * this instance its own geometry and work out which vertices belong to
 * which region by matching their baked color.
 *
 * Matching is nearest-of-six rather than exact equality: the bake wrote
 * sRGB→linear floats and three.js reads them back through its own color
 * management, so the values are equal in intent but not always bit for bit.
 */
function bindVertexRegions(root: THREE.Object3D): Instance["applyColor"] {
  const expected = (
    Object.entries(BAKED_REGION_COLORS) as [CharacterRegion, number][]
  ).map(([region, hex]) => ({ region, color: new THREE.Color(hex) }));

  interface Binding {
    readonly attribute: THREE.BufferAttribute;
    readonly indices: Map<CharacterRegion, number[]>;
  }
  const bindings: Binding[] = [];

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry.clone();
    object.geometry = geometry;
    const attribute = geometry.getAttribute("color") as
      | THREE.BufferAttribute
      | undefined;
    if (!attribute) return;

    const indices = new Map<CharacterRegion, number[]>();
    const sample = new THREE.Color();
    for (let i = 0; i < attribute.count; i++) {
      sample.setRGB(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
      let best = expected[0]!;
      let bestDistance = Infinity;
      for (const candidate of expected) {
        const dr = sample.r - candidate.color.r;
        const dg = sample.g - candidate.color.g;
        const db = sample.b - candidate.color.b;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      const list = indices.get(best.region) ?? [];
      list.push(i);
      indices.set(best.region, list);
    }
    bindings.push({ attribute, indices });
  });

  return (region, color) => {
    for (const binding of bindings) {
      const list = binding.indices.get(region);
      if (!list || list.length === 0) continue;
      for (const index of list) {
        binding.attribute.setXYZ(index, color.r, color.g, color.b);
      }
      binding.attribute.needsUpdate = true;
    }
  };
}

function createInstance(base: SkierBase, template: THREE.Group): Instance {
  const root = cloneSkinned(template) as THREE.Group;
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of template.animations) {
    // The exporter prefixes the armature name onto every clip name.
    actions.set(clip.name.split("|").pop() ?? clip.name, mixer.clipAction(clip));
  }

  // Vertex colors only mean anything if the material is told to read them —
  // and the modular base has no color attribute to read.
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const material = object.material as THREE.MeshStandardMaterial;
      material.vertexColors = base === "animated";
    }
  });

  const applyColor =
    base === "animated" ? bindVertexRegions(root) : bindMaterialRegions(root);

  return { root, mixer, actions, base, applyColor, pose: null };
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

  const instances = new Map<SkierBase, Instance>();
  let active: Instance | null = null;
  let pose: SkierPose = "idle";
  let colors: AppearanceColors | null = null;

  function applyPose(): void {
    lean.rotation.x = pose === "skiing" ? SKI_LEAN : 0;
    if (active === null || active.pose === pose) return;
    const next = active.actions.get(POSE_CLIPS[active.base][pose]);
    if (!next) return;
    const previous =
      active.pose === null
        ? undefined
        : active.actions.get(POSE_CLIPS[active.base][active.pose]);
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

  function activate(base: SkierBase): void {
    const instance = instances.get(base);
    if (!instance || active === instance) return;
    if (active) facing.remove(active.root);
    facing.add(instance.root);
    active = instance;
    applyColors();
    applyPose();
  }

  function ensureLoaded(base: SkierBase): void {
    if (instances.has(base)) {
      activate(base);
      return;
    }
    void loadTemplate(base)
      .then((template) => {
        if (instances.has(base)) return;
        instances.set(base, createInstance(base, template));
        activate(base);
      })
      .catch((error: unknown) => {
        // A missing skier must not stop the game — the scene runs on
        // without a visible player rather than throwing in the loop.
        console.error(`skier model (${base}) failed to load`, error);
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
      ensureLoaded(appearance.base);
      applyColors();
    },
    update(dt: number): void {
      active?.mixer.update(dt);
    },
  };
}
