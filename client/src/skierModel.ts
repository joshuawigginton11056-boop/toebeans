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
//
// The ski pose and ski gear below lean on the same fact: posed and built
// once against the shared skeleton, they work for every character in the
// roster (and any added later) with no per-character work.

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
// in DESIGN.md). So "skiing" plays the Idle clip as a base layer and builds
// the actual crouch procedurally on top — see the ski pose section below.
const POSE_CLIPS: Record<SkierPose, string> = {
  idle: "Idle",
  walking: "Walk",
  skiing: "Idle",
};

/** Which named material takes which runtime color. */
const MATERIAL_REGIONS: Record<string, CharacterRegion> = {
  Skin: "skin",
  Hair: "hair",
};

// ---------------------------------------------------------------------------
// The ski pose.
//
// A real crouch, posed in code on the shared skeleton: Euler deltas applied
// on top of the Idle frame every update, *after* the mixer has written the
// bones. Idle tracks every bone (checked in the source clips), so the mixer
// rewrites each bone each frame and the deltas can never accumulate — and
// the idle animation's subtle breathing survives underneath the crouch.
//
// Two keyed poses — BRAKING (weight back, nearly upright, snowplow-ish) and
// FULL TUCK (deep crouch, torso folded, arms in) — blended by the lean
// input via setSkiMotion's tuck (0..1). That makes the up/down speed control
// legible on the body, which was the director's playtest ask. On top of the
// blend sit the stagger, wobble, and bob layers (constants below) — the
// round-2 "life" fixes — and around it the carve group steers and banks the
// whole body into turns.
//
// The crouch works because of a quirk of this rig: Foot.L/Foot.R are
// root-level bones, separate from the leg chains (the pack animates legs
// IK-style). Dropping the pelvis (Body bone) folds the knees while the feet
// stay planted — exactly what skiing needs. The feet themselves are frozen
// to fixed positions on the skis, so idle sway can't slide a boot off its
// ski.

type Xyz = readonly [number, number, number];

// Bone names here are the *loaded* names, not the pack's authored ones:
// GLTFLoader sanitizes node names for animation binding, so "Foot.L" in the
// .glb arrives in the scene graph as "FootL". (The clips go through the
// same loader, so their tracks match by construction.)

/**
 * Bone rotation deltas, radians about each bone's local axes.
 *
 * Deliberately asymmetric (playtest: "the body reads as one rigid block").
 * The stance leads with the left foot — see SKI_STAGGER — so the left leg
 * rides straighter and the right folds a touch deeper, the left arm carries
 * higher and more bent than the right, and the torso twists slightly toward
 * the lead side with the neck counter-turning so the face stays downhill.
 * Real skiers are never symmetric; the numbers differ side-to-side by just
 * enough to read as a person balancing rather than a mirrored mannequin.
 */
const SKI_POSE_ROTATIONS: Record<string, { brake: Xyz; tuck: Xyz }> = {
  Abdomen: { brake: [0.14, 0.05, 0], tuck: [0.52, 0.07, 0] },
  Torso: { brake: [0.1, 0.05, 0], tuck: [0.38, 0.07, 0] },
  // Neck counter-bends so the face keeps looking downhill, not at the snow —
  // and counter-twists against the shoulder twist above for the same reason.
  Neck: { brake: [-0.12, -0.04, 0], tuck: [-0.44, -0.06, 0] },
  UpperLegL: { brake: [-0.14, 0, 0], tuck: [-0.66, 0, 0] },
  UpperLegR: { brake: [-0.22, 0, 0], tuck: [-0.78, 0, 0] },
  LowerLegL: { brake: [0.24, 0, 0], tuck: [0.9, 0, 0] },
  LowerLegR: { brake: [0.32, 0, 0], tuck: [1.0, 0, 0] },
  // Arms forward-and-in to hold the poles, hands tucking closer as the
  // crouch deepens. On this rig the swing that brings a hanging arm forward
  // is mostly local -Z (adduction), not X — solved numerically against the
  // live skeleton by placing the fist where a pole grip belongs.
  UpperArmL: { brake: [0.16, -0.03, -0.5], tuck: [0.2, -0.04, -0.66] },
  UpperArmR: { brake: [0.06, 0.03, 0.46], tuck: [0.1, 0.04, 0.62] },
  LowerArmL: { brake: [0.68, 0, 0], tuck: [1.02, 0, 0] },
  LowerArmR: { brake: [0.56, 0, 0], tuck: [0.9, 0, 0] },
};

/** How far the pelvis drops in the crouch, in game units. */
const SKI_BODY_DROP = { brake: 0.03, tuck: 0.16 };
/** Hips shift back a touch in the tuck (butt back, chest forward). */
const SKI_BODY_BACK = { brake: 0, tuck: 0.05 };

/** Each foot this far off center — must match the ski positions below. */
const SKI_STANCE = 0.13;
/** Feet ride this far above the snow: on top of the skis, inside the boots. */
const SKI_FOOT_LIFT = 0.055;
/**
 * Lead-foot stagger, in game units along the ski direction: the left ski
 * (and its boot and foot) rides ahead, the right trails. Part of breaking
 * the mirrored-mannequin symmetry; must match between the gear meshes and
 * the foot pinning, or a boot slides off its ski.
 */
const SKI_STAGGER = { L: 0.06, R: -0.04 } as const;

/** How fast the body eases between brake and tuck (per second). */
const TUCK_EASE = 8;
/** How fast the body eases into a turn (per second). */
const STEER_EASE = 8;
/**
 * Carving bank: how much the body rolls into a turn, as a fraction of the
 * eased steer yaw, and the cap that keeps an emergency swerve from tipping
 * the character onto their ear.
 */
const BANK_GAIN = 0.45;
const BANK_MAX = 0.32;

/**
 * Procedural micro-motion — the "life" layer (playtest: "symmetric and
 * frozen"). Small sinusoidal offsets, per bone, on top of the brake↔tuck
 * blend: the arms float independently (different frequencies and phases, so
 * they never sync up into a march), the torso rocks as weight shifts, the
 * head makes tiny corrections. Frequencies are in radians/second and
 * deliberately incommensurate — the pattern never visibly repeats.
 * Amplitudes scale up with speed (see applySkiPose): gentle balance drift
 * at a braking crawl, busy working-body at a full tuck.
 */
const SKI_WOBBLE: Record<
  string,
  readonly { axis: 0 | 1 | 2; amp: number; freq: number; phase: number }[]
> = {
  UpperArmL: [{ axis: 0, amp: 0.05, freq: 2.3, phase: 0 }],
  UpperArmR: [{ axis: 0, amp: 0.05, freq: 2.9, phase: 2.1 }],
  LowerArmL: [{ axis: 0, amp: 0.045, freq: 3.4, phase: 0.7 }],
  LowerArmR: [{ axis: 0, amp: 0.045, freq: 2.6, phase: 3.5 }],
  Abdomen: [{ axis: 2, amp: 0.028, freq: 1.6, phase: 0.3 }],
  Torso: [{ axis: 1, amp: 0.03, freq: 1.2, phase: 1.7 }],
  Neck: [{ axis: 0, amp: 0.02, freq: 1.9, phase: 2.6 }],
};

/** Pelvis bob (game units) — knees pump as the skis run over the snow. */
const BOB_AMP = { brake: 0.006, tuck: 0.016 };
/** Bob rate (radians/second) — quickens with speed. */
const BOB_FREQ = { brake: 5, tuck: 11 };
/**
 * High-frequency snow chatter at speed, added to the bob. Gated off while
 * airborne — a body in the air has nothing to chatter against (the carve
 * hiss in audio.ts goes silent on the same reasoning).
 */
const CHATTER_AMP = 0.005;
const CHATTER_FREQ = 27;

// ---------------------------------------------------------------------------
// Ski gear: skis, boots, poles — built in code out of flat-shaded primitive
// shapes, the same way the cat's scarf is (cheap, palette-exact, and no
// asset exists to download: there is no CC0 ski set any more than there is
// a CC0 skiing clip). The boots double as the fix for the roster's missing
// feet — the pack's characters have no shoe geometry, so the leg stumps
// just disappear into boot boxes, which is what boots are for.
//
// Colors: skis are warm wood — birch amber (#7), not birch bark (#8),
// because pale bark wood disappears against sunlit snow (measured: the lit
// top face classifies as snow). Amber also ties the skis to the cat riding
// above them. Poles slate (#9), boots the character palette's default boot
// brown (DESIGN.md).
const SKI_COLOR = 0xe9a960;
const POLE_COLOR = 0x66738c;
const BOOT_COLOR = 0x3a2f2f;

interface SkiGear {
  readonly group: THREE.Group;
  /** Pole grips get glued to the fists every frame — see updatePoles. */
  readonly poles: { readonly L: THREE.Group; readonly R: THREE.Group };
}

function createSkiGear(): SkiGear {
  const group = new THREE.Group();
  const skiMaterial = new THREE.MeshStandardMaterial({
    color: SKI_COLOR,
    roughness: 0.9,
  });
  const bootMaterial = new THREE.MeshStandardMaterial({
    color: BOOT_COLOR,
    roughness: 0.9,
  });
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: POLE_COLOR,
    roughness: 0.7,
  });

  for (const side of [-1, 1]) {
    const x = side * SKI_STANCE;
    // side 1 is the character's left (feet pin at +x for L below) — the lead
    // ski. Ski, tip, and boot all shift together so the boot stays centered
    // on its own ski and the foot pinning lands inside the boot.
    const stagger = side === 1 ? SKI_STAGGER.L : SKI_STAGGER.R;

    // The ski: a plank with an upturned tip, sized to the chunky big-headed
    // characters rather than to real skis — short and wide reads cuter.
    const ski = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.035, 1.15),
      skiMaterial,
    );
    ski.position.set(x, 0.0175, 0.12 + stagger); // more ski ahead than behind
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.2), skiMaterial);
    tip.position.set(x, 0.052, 0.76 + stagger);
    tip.rotation.x = -0.5; // front end curls up

    const boot = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.16, 0.26),
      bootMaterial,
    );
    boot.position.set(x, 0.115, stagger); // standing on the ski

    for (const mesh of [ski, tip, boot]) mesh.castShadow = true;
    group.add(ski, tip, boot);
  }

  const poles = { L: createPole(poleMaterial), R: createPole(poleMaterial) };
  group.add(poles.L, poles.R);
  return { group, poles };
}

// A pole's origin is its grip, so gluing it to a fist is just a position
// copy. Tilted so the tip trails behind, and short enough that it hovers
// just off the snow at the neutral crouch's hand height (0.41) — a longer
// pole punched visibly through the snow plane (measured, not guessed).
function createPole(material: THREE.Material): THREE.Group {
  const pole = new THREE.Group();
  // Low segment counts on purpose — the bible wants visible facets.
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.012, 0.46, 6),
    material,
  );
  shaft.position.y = -0.23;
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.014, 6),
    material,
  );
  basket.position.y = -0.4;
  for (const mesh of [shaft, basket]) mesh.castShadow = true;
  pole.add(shaft, basket);
  pole.rotation.x = 0.7;
  return pole;
}

// ---------------------------------------------------------------------------

export interface SkiMotion {
  /**
   * How deep the ski crouch is: 0 = braking (upright, weight back),
   * 1 = full tuck.
   */
  readonly tuck: number;
  /**
   * Steering angle in radians — atan2(sideways speed, downhill speed),
   * positive when moving toward the character's right. The rig yaws the
   * body toward the movement direction and rolls it into a carving bank.
   */
  readonly steer: number;
  /** Mid-air bodies don't chatter against the snow. */
  readonly airborne: boolean;
}

export interface SkierRig {
  /** Parent this into a scene and position it — the model loads into it. */
  readonly group: THREE.Group;
  /**
   * Turns (and banks) with the character. Parent riders and props here —
   * the cat mounts on the skier's back through this, so it comes along
   * through every turn instead of hovering in place while the body yaws
   * out from under it. Coordinates are the character's own frame: the
   * character faces local +z, so "behind the back" is local -z.
   */
  readonly mount: THREE.Group;
  /** Switch clips. Cheap to call every frame; repeats are ignored. */
  setPose(pose: SkierPose): void;
  /**
   * Which way the character is turned, in radians, 0 being +z (the pack is
   * authored facing +z). Set this rather than rotating `group` so the ski
   * gear turns with the character.
   */
  setFacing(radians: number): void;
  /**
   * Drive the skiing body: crouch depth, steering, airborne. Tuck and steer
   * are eased internally so changes roll through the body instead of
   * snapping. Only visible in the "skiing" pose.
   */
  setSkiMotion(motion: SkiMotion): void;
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
  readonly bones: Map<string, THREE.Object3D>;
  /**
   * The pelvis. Its authored name is "Body", but that collides with the
   * pack's mesh node (also "Body"), so the loader renames the bone with a
   * suffix — finding it structurally, as the parent of "Hips", dodges the
   * fragile generated name.
   */
  readonly pelvis: THREE.Object3D | null;
  /** Game units per source unit — converts pose offsets into bone space. */
  readonly scale: number;
  applyColor(region: CharacterRegion, color: THREE.Color): void;
  pose: SkierPose | null;
  /**
   * Base transforms for every bone the ski pose touches, captured off the
   * frozen Idle frame the first time this instance skis. The crouch
   * overwrites these bones absolutely (snapshot ⊗ delta) every frame rather
   * than nudging whatever is there: the skiing base clip is paused, and a
   * paused clip's writes get skipped by the mixer's dirty-check — a
   * relative nudge would silently accumulate into a spin.
   */
  skiRest: {
    pelvis: THREE.Vector3 | null;
    rotations: Map<string, THREE.Quaternion>;
    feet: Map<string, { p: THREE.Vector3; q: THREE.Quaternion }>;
  } | null;
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
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (object instanceof THREE.Bone) bones.set(object.name, object);
  });
  return {
    root,
    mixer,
    actions,
    bones,
    pelvis: bones.get("Hips")?.parent ?? null,
    scale: root.children[0]?.scale.x ?? 1,
    applyColor: bindMaterialRegions(root),
    pose: null,
    skiRest: null,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Scratch objects reused across frames — this runs per update.
const scratchEuler = new THREE.Euler();
const scratchQuaternion = new THREE.Quaternion();
const scratchVector = new THREE.Vector3();

/**
 * Overlay the ski crouch on top of the frozen Idle base frame.
 *
 * `time` drives the micro-motion layer (SKI_WOBBLE + the pelvis bob) —
 * a monotonically accumulating pose clock, not wall time.
 */
function applySkiPose(
  instance: Instance,
  tuck: number,
  time: number,
  airborne: boolean,
): void {
  instance.skiRest ??= captureSkiRest(instance);

  // Micro-motion grows with speed: quiet balance drift while braking,
  // busy working-body at full tuck.
  const wobbleScale = 0.35 + 0.65 * tuck;

  for (const [name, delta] of Object.entries(SKI_POSE_ROTATIONS)) {
    const bone = instance.bones.get(name);
    const rest = instance.skiRest.rotations.get(name);
    if (!bone || !rest) continue;
    scratchEuler.set(
      lerp(delta.brake[0], delta.tuck[0], tuck),
      lerp(delta.brake[1], delta.tuck[1], tuck),
      lerp(delta.brake[2], delta.tuck[2], tuck),
    );
    for (const wobble of SKI_WOBBLE[name] ?? []) {
      const swing =
        wobble.amp * wobbleScale * Math.sin(wobble.freq * time + wobble.phase);
      if (wobble.axis === 0) scratchEuler.x += swing;
      else if (wobble.axis === 1) scratchEuler.y += swing;
      else scratchEuler.z += swing;
    }
    bone.quaternion
      .copy(rest)
      .multiply(scratchQuaternion.setFromEuler(scratchEuler));
  }

  // The crouch itself: drop the pelvis. The feet are separate root-level
  // bones, so this folds the knees while the boots stay on the skis — which
  // also means the bob below reads as knees pumping, not the body floating.
  const bob =
    lerp(BOB_AMP.brake, BOB_AMP.tuck, tuck) *
      Math.sin(lerp(BOB_FREQ.brake, BOB_FREQ.tuck, tuck) * time) +
    (airborne ? 0 : tuck * tuck * CHATTER_AMP * Math.sin(CHATTER_FREQ * time));
  if (instance.pelvis && instance.skiRest.pelvis) {
    instance.pelvis.position
      .copy(instance.skiRest.pelvis)
      .add(
        scratchVector.set(
          0,
          (-lerp(SKI_BODY_DROP.brake, SKI_BODY_DROP.tuck, tuck) + bob) /
            instance.scale,
          -lerp(SKI_BODY_BACK.brake, SKI_BODY_BACK.tuck, tuck) / instance.scale,
        ),
      );
  }

  // Plant the feet: pinned to fixed spots on the skis, left foot leading.
  for (const side of ["L", "R"] as const) {
    const foot = instance.bones.get(`Foot${side}`);
    const rest = instance.skiRest.feet.get(side);
    if (!foot || !rest) continue;
    foot.position.set(
      ((side === "L" ? 1 : -1) * SKI_STANCE) / instance.scale,
      rest.p.y + SKI_FOOT_LIFT / instance.scale,
      SKI_STAGGER[side] / instance.scale,
    );
    foot.quaternion.copy(rest.q);
  }
}

function captureSkiRest(instance: Instance): NonNullable<Instance["skiRest"]> {
  const rotations = new Map<string, THREE.Quaternion>();
  for (const name of Object.keys(SKI_POSE_ROTATIONS)) {
    const bone = instance.bones.get(name);
    if (bone) rotations.set(name, bone.quaternion.clone());
  }
  const feet = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion }>();
  for (const side of ["L", "R"] as const) {
    const foot = instance.bones.get(`Foot${side}`);
    if (foot) {
      feet.set(side, { p: foot.position.clone(), q: foot.quaternion.clone() });
    }
  }
  return {
    pelvis: instance.pelvis?.position.clone() ?? null,
    rotations,
    feet,
  };
}

export function createSkierRig(): SkierRig {
  // group → facing → carve → model. The old intermediate "lean" group is
  // gone: the ski lean is now part of the procedural crouch, applied in
  // bone-local space, so it can't be flipped by the downhill half-turn the
  // way the whole-group lean once was. The carve group is the steering
  // layer: it yaws the character toward the movement direction and rolls
  // them into the turn, underneath whatever facing the scene sets.
  const group = new THREE.Group();
  const facing = new THREE.Group();
  group.add(facing);
  const carve = new THREE.Group();
  facing.add(carve);

  // Ski gear rides in the carve group so it turns AND banks with the
  // character — carving happens on the ski edges, so the skis tilting into
  // the turn with the body is the point. Only visible in the skiing pose —
  // the bedroom doesn't wear skis indoors.
  const gear = createSkiGear();
  gear.group.visible = false;
  carve.add(gear.group);

  const instances = new Map<string, Instance>();
  let active: Instance | null = null;
  let pose: SkierPose = "idle";
  let colors: AppearanceColors | null = null;
  let tuckTarget = 0.5;
  let tuckCurrent = 0.5;
  let steerTarget = 0;
  let steerCurrent = 0;
  let airborne = false;
  /** The micro-motion clock — accumulates only while skiing. */
  let poseTime = 0;

  function syncGearVisibility(): void {
    gear.group.visible = pose === "skiing" && active !== null;
  }

  function applyPose(): void {
    syncGearVisibility();
    if (active === null || active.pose === pose) return;
    const next = active.actions.get(POSE_CLIPS[pose]);
    if (!next) return;
    const previous =
      active.pose === null ? undefined : active.actions.get(POSE_CLIPS[active.pose]);
    next.reset().play();
    // Skiing freezes its base clip at one frame: Idle sways the arms, and a
    // skier holding poles shouldn't wave them around — all slope motion
    // comes from the tuck blend and the terrain instead. A paused action
    // still writes its frame every mixer update, which is what keeps the
    // crouch deltas from accumulating.
    next.paused = pose === "skiing";
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
    if (active) carve.remove(active.root);
    carve.add(instance.root);
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

  // Glue each pole's grip to its fist. Runs after the pose is applied, so
  // the poles follow the hands through the brake↔tuck blend for free.
  function updatePoles(): void {
    if (active === null || pose !== "skiing") return;
    for (const side of ["L", "R"] as const) {
      const pole = gear.poles[side];
      const fist = active.bones.get(`Fist${side}`);
      if (!fist) {
        pole.visible = false;
        continue;
      }
      pole.visible = true;
      fist.getWorldPosition(scratchVector);
      pole.position.copy(carve.worldToLocal(scratchVector));
    }
  }

  return {
    group,
    mount: carve,
    setPose(next: SkierPose): void {
      pose = next;
      applyPose();
    },
    setFacing(radians: number): void {
      facing.rotation.y = radians;
    },
    setSkiMotion(motion: SkiMotion): void {
      tuckTarget = Math.min(1, Math.max(0, motion.tuck));
      steerTarget = motion.steer;
      airborne = motion.airborne;
    },
    setAppearance(appearance: Appearance): void {
      colors = resolveAppearance(appearance);
      ensureLoaded(resolveCharacter(appearance).id);
      applyColors();
    },
    update(dt: number): void {
      if (active === null) return;
      active.mixer.update(dt);
      if (pose === "skiing") {
        poseTime += dt;
        const ease = (rate: number): number => 1 - Math.exp(-rate * dt);
        tuckCurrent += (tuckTarget - tuckCurrent) * ease(TUCK_EASE);
        steerCurrent += (steerTarget - steerCurrent) * ease(STEER_EASE);
        // Yaw toward the movement direction. The scene's facing is the
        // downhill half-turn (y = π), which mirrors x — so a positive
        // (rightward) steer needs a negative local yaw to come out turned
        // right in the world.
        carve.rotation.y = -steerCurrent;
        // …and roll into the turn. Positive local z-roll tips the head
        // toward local -x, which the facing mirror maps to the character's
        // right — so bank carries steer's sign directly.
        carve.rotation.z = Math.max(
          -BANK_MAX,
          Math.min(BANK_MAX, BANK_GAIN * steerCurrent),
        );
        applySkiPose(active, tuckCurrent, poseTime, airborne);
        updatePoles();
      } else {
        carve.rotation.y = 0;
        carve.rotation.z = 0;
      }
    },
  };
}
