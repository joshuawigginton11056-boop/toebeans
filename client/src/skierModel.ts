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
// round-2 "life" fixes — and around it the carve group steers the body into
// turns. The carving bank is *split*, not applied as one roll (playtest:
// "the whole body banks as one plank"): the carve group's roll supplies the
// leg-and-ski lean, the spine bones counter-rotate against it so the torso
// stays near-upright over the snow, and the foot pins push laterally out
// from under the body — which is what real ski angulation is.
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
 * The pole push-off cycle — the visible propulsion while the run is below
 * cruise speed (momentum starts runs at a standstill now). A double-pole
 * push: both arms reach forward together, plant, and drive back past the
 * hips while the torso crunches into the push; the poles pivot at the grip
 * so they plant tip-forward and sweep back with the drive. Driven by
 * setSkiMotion's push (0..1) — the scene fades it out as speed approaches
 * cruise, where gravity takes over from the poles.
 *
 * The arm swing rides the same adduction axis the pole-holding pose uses
 * (on this rig a hanging arm swings forward mostly via local ±z — L
 * negative, R positive), with the elbows straightening into the reach.
 * Amplitudes in radians at full push; the crunch keys off the drive half
 * of the cycle only.
 */
const PUSH_FREQ = 5.2;
const PUSH_ARM_SWING = 0.55;
const PUSH_ARM_LIFT = 0.18;
const PUSH_ELBOW_REACH = -0.3;
const PUSH_CRUNCH = { Abdomen: 0.08, Torso: 0.1, Neck: -0.12 } as const;
/** Body dips this far (game units) into each pole drive. */
const PUSH_DIP = 0.025;
/** How fast the push cycle blends in and out (per second). */
const PUSH_EASE = 6;
/** Pole pivot: tip plants forward on the reach, sweeps back on the drive. */
const POLE_REST_TILT = 0.7;
const POLE_PLANT_SWING = 1.1;
const POLE_DRIVE_SWING = 0.3;
/**
 * Carving bank: how much the carve group rolls into a turn, as a fraction of
 * the eased steer yaw, and the cap that keeps an emergency swerve from
 * tipping the character onto their ear. The gain is higher than the old
 * one-plank bank dared to be — the spine counter-rotation below means the
 * roll reads as legs driving into the turn, not the whole body toppling.
 */
const BANK_GAIN = 0.62;
const BANK_MAX = 0.46;

/**
 * Angulation — the round-2 fix for "the whole body banks as one plank."
 * A carving skier is two systems: the legs and skis lean hard into the turn
 * while the torso stays nearly upright over the snow, the hips hinging
 * sideways between them. The carve roll (BANK_* above) supplies the leg
 * lean; each spine bone here counter-rolls against it by its fraction —
 * ~75% of the bank comes back out through the torso, and the neck levels
 * the head almost fully, because a skier's eyes stay on the hill.
 */
const ANGULATION_COUNTER: Record<string, number> = {
  Abdomen: 0.45,
  Torso: 0.3,
  Neck: 0.12,
};
/**
 * The feet push laterally out from under the body toward the outside of the
 * turn, in game units per radian of eased steer — the "skis out from under
 * you" half of angulation. Capped so a braking swerve (steer ≈ 0.9 rad)
 * can't push the boots past what the leg mesh can plausibly reach.
 */
const FEET_OUT_GAIN = 0.25;
const FEET_OUT_MAX = 0.12;
/**
 * Extra edge-roll on the ski assemblies themselves, beyond the body's bank —
 * carving happens on the ski edges, and the skis commit to the edge a touch
 * harder than the body above them. Rolls each side group about its own
 * ground-level origin, so the ski tilts in place instead of lifting.
 */
const EDGE_GAIN = 0.3;
const EDGE_MAX = 0.15;

/**
 * Stance breathing — the legs' spacing drifts slowly instead of holding one
 * width and stagger forever (playtest: "the legs are still static… wants
 * random movement and spacing"). Each side wanders independently at slow
 * incommensurate rates, in both width (x) and stagger (z). The offsets are
 * applied to the per-side placement that BOTH the gear meshes and the foot
 * pins are computed from, so a ski, its boot, and the foot inside move as
 * one — the breathe can never slide a boot off its ski.
 */
const STANCE_BREATHE: Record<
  "L" | "R",
  {
    xAmp: number;
    xFreq: number;
    xPhase: number;
    zAmp: number;
    zFreq: number;
    zPhase: number;
  }
> = {
  L: { xAmp: 0.02, xFreq: 0.9, xPhase: 0, zAmp: 0.028, zFreq: 0.6, zPhase: 1.1 },
  R: { xAmp: 0.02, xFreq: 0.7, xPhase: 2.3, zAmp: 0.028, zFreq: 0.75, zPhase: 3.9 },
};

/**
 * Procedural micro-motion — the "life" layer (playtest: "symmetric and
 * frozen"). Small sinusoidal offsets, per bone, on top of the brake↔tuck
 * blend: the arms float independently (different frequencies and phases, so
 * they never sync up into a march), the torso rocks as weight shifts, the
 * head makes tiny corrections — and the legs work (the round-2 fix: the
 * first life pass left the leg bones alone and they read frozen). Leg
 * wobble is free on this rig: the feet are separate root-level bones pinned
 * to the skis, so wiggling the Upper/LowerLeg chain pumps the knees without
 * ever moving a boot. Frequencies are in radians/second and deliberately
 * incommensurate — the pattern never visibly repeats. Amplitudes scale up
 * with speed (see applySkiPose): gentle balance drift at a braking crawl,
 * busy working-body at a full tuck.
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
  UpperLegL: [{ axis: 0, amp: 0.045, freq: 1.7, phase: 1.2 }],
  UpperLegR: [{ axis: 0, amp: 0.045, freq: 2.15, phase: 4.0 }],
  LowerLegL: [{ axis: 0, amp: 0.06, freq: 2.45, phase: 0.4 }],
  LowerLegR: [{ axis: 0, amp: 0.06, freq: 1.95, phase: 2.9 }],
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
  /**
   * Per-side ski + boot assemblies, repositioned every frame to the same
   * placement the foot pins use (see footPlacement) — that shared source is
   * what lets the stance breathe and the feet push out in a carve without a
   * boot ever sliding off its ski. Each side's origin is at ground level
   * under the boot, so rolling one onto its edge tilts it in place.
   */
  readonly sides: { readonly L: THREE.Group; readonly R: THREE.Group };
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

  const buildSide = (side: "L" | "R"): THREE.Group => {
    const assembly = new THREE.Group();

    // The ski: a plank with an upturned tip, sized to the chunky big-headed
    // characters rather than to real skis — short and wide reads cuter.
    const ski = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.035, 1.15),
      skiMaterial,
    );
    ski.position.set(0, 0.0175, 0.12); // more ski ahead than behind
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.2), skiMaterial);
    tip.position.set(0, 0.052, 0.76);
    tip.rotation.x = -0.5; // front end curls up

    const boot = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.16, 0.26),
      bootMaterial,
    );
    boot.position.set(0, 0.115, 0); // standing on the ski

    for (const mesh of [ski, tip, boot]) mesh.castShadow = true;
    assembly.add(ski, tip, boot);
    // Neutral placement so the first skiing frame looks right even before
    // the first update repositions it.
    assembly.position.set(
      (side === "L" ? 1 : -1) * SKI_STANCE,
      0,
      SKI_STAGGER[side],
    );
    return assembly;
  };

  const sides = { L: buildSide("L"), R: buildSide("R") };
  group.add(sides.L, sides.R);

  const poles = { L: createPole(poleMaterial), R: createPole(poleMaterial) };
  group.add(poles.L, poles.R);
  return { group, sides, poles };
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
// Hair physics.
//
// Every roster character's hair is a single glTF primitive with its own
// "Hair" material, 100%-weighted to the Head bone (verified across all 11
// .glbs — max and only weight is 1.0). That makes real hair motion cheap and
// *exact*: lift that primitive out of the skinned mesh into a rigid mesh
// parented to the Head bone (bit-identical at rest, because skinning with a
// single weight-1 bone IS a rigid parent), pivot it at the crown, and swing
// the pivot with a damped spring. The roots up top barely move — they stay
// tucked under any hat, which is separate geometry with its own Hat material
// and deliberately does not flap — while the lower hair does the swinging.
//
// What forces the spring: drag from the head's real motion through the air
// (world-space velocity, saturating so slope speed leans the hair back
// without pinning it flat), wind gusts while skiing, and a repulsor sphere
// where the cat's head rides (setHairRepulsor) so the hair physically clears
// the cat instead of clipping through it — the director's "hair must react
// against the cat".

/** Spring stiffness (rad/s² per rad of deflection) — ~1 Hz natural sway. */
const HAIR_STIFFNESS = 40;
/** ~0.35 of critical damping: a visible pendulum overshoot, no jitter. */
const HAIR_DAMPING = 4.4;
/** Hard clamp on the swing, radians — hair never folds inside the skull. */
const HAIR_MAX_SWING = 0.42;
/** Hatted characters swing less: their roots sit under a brim. */
const HAIR_HAT_FACTOR = 0.5;
/** Head speed (units/s) at which the drag tilt saturates. */
const HAIR_DRAG_REF = 9;
/** Drag tilt at full saturation, radians. */
const HAIR_DRAG_MAX = 0.3;
/** Wind-gust wobble while skiing, radians at full tuck. */
const HAIR_GUST = 0.06;
/** How hard the cat repulsor pushes at full penetration, radians. */
const HAIR_PUSH = 0.8;
/** A frame step this large is a respawn teleport, not motion — no impulse. */
const HAIR_TELEPORT = 1.5;
/** Spring integration clamp — hidden-tab dt spikes must not explode it. */
const HAIR_DT_MAX = 1 / 30;

interface HairRig {
  /** Rotating this at the crown is the swing. Parented to the Head bone. */
  readonly pivot: THREE.Object3D;
  readonly head: THREE.Object3D;
  /**
   * Hair bounding box in pivot space. The repulsor probes the box's
   * *closest point* to the cat, not the volume's center — the center of a
   * hairdo rides half a unit from where the cat actually touches it (the
   * boots taught this: containment failures live in the mesh extent,
   * center distances look fine throughout).
   */
  readonly boxMin: THREE.Vector3;
  readonly boxMax: THREE.Vector3;
  readonly maxSwing: number;
  prevHead: THREE.Vector3 | null;
  swingX: number;
  swingZ: number;
  velX: number;
  velZ: number;
}

/**
 * Lift the hair primitive off the skeleton and hang it from the Head bone.
 * Runs per instance, after bindMaterialRegions, so the rigid mesh reuses the
 * instance's owned Hair material — runtime recoloring keeps working on it.
 * Characters with no hair (the bald one) simply return null.
 */
function splitHair(
  root: THREE.Object3D,
  bones: Map<string, THREE.Object3D>,
): HairRig | null {
  const head = bones.get("Head");
  if (!head) return null;
  let source: THREE.SkinnedMesh | null = null;
  let hasHat = false;
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    // glTF splits primitives per material, so each mesh is single-material.
    const material = Array.isArray(object.material)
      ? object.material[0]
      : object.material;
    if (!material) return;
    if (material.name === "Hair") source = object;
    if (material.name.startsWith("Hat")) hasHat = true;
  });
  if (source === null) return null;
  const skinned: THREE.SkinnedMesh = source;
  const headIndex = skinned.skeleton.bones.indexOf(head as THREE.Bone);
  if (headIndex < 0) return null;

  // Bake the geometry into Head-bone space. Because every weight is 1.0,
  // the shader's whole skinning chain for these vertices is ONE matrix —
  //   meshWorld ∘ bindMatrixInverse ∘ headWorld ∘ headInverseBind ∘ bind
  // — so conjugating it back into the head bone's frame gives an exact
  // bake. (A first attempt used just headInverseBind ∘ bind and rendered
  // the hair double-sized: the model-normalization scale lives in
  // meshWorld, and skipping the conjugation skips it.) The clone matters:
  // the template and its other instances share the source geometry.
  root.updateMatrixWorld(true);
  const geometry = skinned.geometry.clone();
  geometry.applyMatrix4(
    new THREE.Matrix4()
      .copy(head.matrixWorld)
      .invert()
      .multiply(skinned.matrixWorld)
      .multiply(skinned.bindMatrixInverse)
      .multiply(head.matrixWorld)
      .multiply(skinned.skeleton.boneInverses[headIndex]!)
      .multiply(skinned.bindMatrix),
  );
  geometry.deleteAttribute("skinIndex");
  geometry.deleteAttribute("skinWeight");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  const crown = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.max.y,
    (box.min.z + box.max.z) / 2,
  );
  const mesh = new THREE.Mesh(
    geometry,
    Array.isArray(skinned.material) ? skinned.material[0] : skinned.material,
  );
  mesh.castShadow = true;
  mesh.position.copy(crown).negate();
  const pivot = new THREE.Object3D();
  pivot.position.copy(crown);
  pivot.add(mesh);
  head.add(pivot);
  skinned.visible = false; // the rigid copy replaces it

  return {
    pivot,
    head,
    boxMin: box.min.clone().sub(crown),
    boxMax: box.max.clone().sub(crown),
    maxSwing: HAIR_MAX_SWING * (hasHat ? HAIR_HAT_FACTOR : 1),
    prevHead: null,
    swingX: 0,
    swingZ: 0,
    velX: 0,
    velZ: 0,
  };
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
  /**
   * Pole push-off strength, 0..1: how hard the arms are working to get the
   * run up to speed. The scene derives it from the run's speed (full pushes
   * at a standstill, fading to none as gravity takes over near cruise).
   */
  readonly push: number;
}

export interface SkierRig {
  /** Parent this into a scene and position it — the model loads into it. */
  readonly group: THREE.Group;
  /**
   * The skier's back, as a live frame: glued every update to the spine
   * bones (origin on the upper back, +y up along the spine, +z the
   * character's forward — so the back surface itself lies toward -z).
   * Parent riders here — the cat hugs the back through this, so it folds
   * with the crouch, swings through every carve, and tips over in a crash,
   * all without knowing anything about the pose underneath it.
   */
  readonly mount: THREE.Group;
  /**
   * A sphere (in mount space) the hair is pushed away from — where the
   * riding cat's head is. The hair physically clearing the cat is what
   * finally kills the cat-in-the-hair overlap. Null disables it (bedroom).
   */
  setHairRepulsor(
    repulsor: { x: number; y: number; z: number; radius: number } | null,
  ): void;
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
  /** The split-off swinging hair, or null for the bald character. */
  readonly hair: HairRig | null;
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
  // Order matters: splitHair reuses the owned materials bindMaterialRegions
  // just created, so recoloring reaches the rigid hair too.
  const applyColor = bindMaterialRegions(root);
  return {
    root,
    mixer,
    actions,
    bones,
    pelvis: bones.get("Hips")?.parent ?? null,
    scale: root.children[0]?.scale.x ?? 1,
    applyColor,
    hair: splitHair(root, bones),
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
const scratchVectorB = new THREE.Vector3();
const scratchVectorC = new THREE.Vector3();
const scratchVectorD = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();

/** Where one foot (and its ski + boot) belongs this frame, in game units. */
interface FootPlacement {
  x: number;
  z: number;
}

/**
 * The single source of truth for where a foot goes: base stance, lead-foot
 * stagger, the angulation push toward the outside of the turn, and the slow
 * stance breathe. The foot pin divides these by the model scale; the gear
 * assembly uses them as-is — same numbers, so boot and ski always agree.
 */
function footPlacement(
  side: "L" | "R",
  steer: number,
  time: number,
  wobbleScale: number,
): FootPlacement {
  const breathe = STANCE_BREATHE[side];
  // Positive steer = turning right = lean right (local -x under the facing
  // mirror) — so the feet push out the other way, toward local +x.
  const out = Math.max(
    -FEET_OUT_MAX,
    Math.min(FEET_OUT_MAX, FEET_OUT_GAIN * steer),
  );
  return {
    x:
      (side === "L" ? 1 : -1) * SKI_STANCE +
      out +
      wobbleScale *
        breathe.xAmp *
        Math.sin(breathe.xFreq * time + breathe.xPhase),
    z:
      SKI_STAGGER[side] +
      wobbleScale *
        breathe.zAmp *
        Math.sin(breathe.zFreq * time + breathe.zPhase),
  };
}

/**
 * Overlay the ski crouch on top of the frozen Idle base frame.
 *
 * `time` drives the micro-motion layer (SKI_WOBBLE + the pelvis bob) —
 * a monotonically accumulating pose clock, not wall time. `bank` is the
 * carve group's eased roll, which the spine counter-rotates against
 * (ANGULATION_COUNTER); `feet` is where this frame pins the feet, computed
 * once in update() and shared with the gear assemblies.
 */
function applySkiPose(
  instance: Instance,
  tuck: number,
  time: number,
  airborne: boolean,
  bank: number,
  feet: Record<"L" | "R", FootPlacement>,
  push: number,
  pushSwing: number,
): void {
  instance.skiRest ??= captureSkiRest(instance);

  // Micro-motion grows with speed: quiet balance drift while braking,
  // busy working-body at full tuck.
  const wobbleScale = 0.35 + 0.65 * tuck;

  // Push-off cycle phases: the reach half (arms forward, elbows straight)
  // and the drive half (arms sweeping back, torso crunching into it).
  const pushReach = push * Math.max(0, pushSwing);
  const pushDrive = push * Math.max(0, -pushSwing);

  for (const [name, delta] of Object.entries(SKI_POSE_ROTATIONS)) {
    const bone = instance.bones.get(name);
    const rest = instance.skiRest.rotations.get(name);
    if (!bone || !rest) continue;
    scratchEuler.set(
      lerp(delta.brake[0], delta.tuck[0], tuck),
      lerp(delta.brake[1], delta.tuck[1], tuck),
      lerp(delta.brake[2], delta.tuck[2], tuck),
    );
    // Angulation: counter-roll the spine against the carve bank so the
    // torso rides near-upright while the legs lean. On this rig a spine
    // bone's local +z side-bend tips the head the SAME way the carve's +z
    // roll does (measured live, not assumed) — so countering subtracts.
    const counter = ANGULATION_COUNTER[name];
    if (counter !== undefined) scratchEuler.z -= counter * bank;
    // The double-pole push: both arms swing together through the full
    // cycle on the adduction axis (forward reach ↔ backward drive), the
    // elbows straighten into the reach, and the trunk crunches into the
    // drive half only — with the neck countering so the eyes stay downhill.
    if (push > 0) {
      const armSwing = push * pushSwing * PUSH_ARM_SWING;
      if (name === "UpperArmL") {
        scratchEuler.z -= armSwing;
        scratchEuler.x -= pushReach * PUSH_ARM_LIFT;
      } else if (name === "UpperArmR") {
        scratchEuler.z += armSwing;
        scratchEuler.x -= pushReach * PUSH_ARM_LIFT;
      } else if (name === "LowerArmL" || name === "LowerArmR") {
        scratchEuler.x += pushReach * PUSH_ELBOW_REACH;
      } else if (name in PUSH_CRUNCH) {
        scratchEuler.x += pushDrive * PUSH_CRUNCH[name as keyof typeof PUSH_CRUNCH];
      }
    }
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
    (airborne ? 0 : tuck * tuck * CHATTER_AMP * Math.sin(CHATTER_FREQ * time)) -
    // The body dips into each pole drive — the legs load up as the arms
    // push, which is what makes the push read as effort instead of a wave.
    pushDrive * PUSH_DIP;
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

  // Plant the feet: pinned to this frame's placements — the same numbers
  // the gear assemblies were just moved to, so each foot lands inside its
  // boot wherever the carve push and the stance breathe have taken it.
  // The cos/sin pre-rotation is the snow-contact compensation (see the gear
  // positioning in update()): the carve roll would otherwise lift the
  // outside foot off the snow, so each pin is placed where the roll will
  // carry it back onto the ground plane.
  const cosBank = Math.cos(bank);
  const sinBank = Math.sin(bank);
  for (const side of ["L", "R"] as const) {
    const foot = instance.bones.get(`Foot${side}`);
    const rest = instance.skiRest.feet.get(side);
    if (!foot || !rest) continue;
    foot.position.set(
      (feet[side].x * cosBank) / instance.scale,
      rest.p.y + (SKI_FOOT_LIFT - feet[side].x * sinBank) / instance.scale,
      feet[side].z / instance.scale,
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

  // The rider's mount — glued to the spine every update (see updateMount),
  // so whatever is parented here rides the actual back through crouch,
  // carve, and crash. It lives in the carve group like the model does.
  const mount = new THREE.Group();
  carve.add(mount);

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
  let pushTarget = 0;
  let pushCurrent = 0;
  /** This frame's point in the push cycle — shared with the pole pivots. */
  let pushSwing = 0;
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

  let hairRepulsor: {
    x: number;
    y: number;
    z: number;
    radius: number;
  } | null = null;

  // Glue the mount to the spine: origin on the upper back between the
  // Abdomen and Neck bones, +y up along the spine, +z the character's
  // forward. Derived from bone positions rather than copying one bone's
  // orientation, so it doesn't depend on the pack's bone-axis conventions
  // (which have burned this file before — the spine-counter sign, the
  // pelvis name collision). Runs every update, all poses: the bedroom just
  // has nothing mounted.
  function updateMount(): void {
    if (active === null) return;
    const abdomen = active.bones.get("Abdomen");
    const neck = active.bones.get("Neck");
    if (!abdomen || !neck) return;
    carve.updateWorldMatrix(true, false);
    const a = carve.worldToLocal(abdomen.getWorldPosition(scratchVector));
    const n = carve.worldToLocal(neck.getWorldPosition(scratchVectorB));
    const up = scratchVectorC.copy(n).sub(a).normalize();
    // Right-handed basis around the spine, referenced to character-forward.
    const side = scratchVectorD.set(0, 0, 1).cross(up).negate().normalize();
    mount.position.copy(a).lerp(n, 0.55);
    mount.quaternion.setFromRotationMatrix(
      scratchMatrix.makeBasis(side, up, side.clone().cross(up)),
    );
  }

  // The hair spring — see the hair-physics section above for the model.
  function updateHair(dt: number): void {
    const hair = active?.hair;
    if (!hair || dt <= 0) return;

    hair.head.getWorldPosition(scratchVector);
    if (hair.prevHead === null) {
      hair.prevHead = scratchVector.clone();
      return;
    }
    const step = scratchVectorB.copy(scratchVector).sub(hair.prevHead);
    const distance = step.length();
    hair.prevHead.copy(scratchVector);
    // World → head-local, for drag directions and the repulsor push alike.
    hair.head.getWorldQuaternion(scratchQuaternion).invert();

    let targetX = 0;
    let targetZ = 0;
    // Drag: the hair tilts away from the head's motion through the air.
    // tanh saturates it — slope speed leans the hair back convincingly
    // without pinning it flat, and a bedroom stroll gives a gentle trail.
    // A respawn-teleport step is not motion and gets no impulse (the same
    // guard the carve layer needed).
    if (distance < HAIR_TELEPORT) {
      step.divideScalar(dt).applyQuaternion(scratchQuaternion);
      targetX = HAIR_DRAG_MAX * Math.tanh(step.z / HAIR_DRAG_REF);
      targetZ = -HAIR_DRAG_MAX * Math.tanh(step.x / HAIR_DRAG_REF);
    }

    // Wind gusts on the slope, scaling with speed like the audio's wind
    // layer. Incommensurate frequencies, same reasoning as SKI_WOBBLE.
    if (pose === "skiing") {
      const gust = HAIR_GUST * (0.4 + 0.6 * tuckCurrent);
      targetX += gust * Math.sin(2.1 * poseTime + 0.5);
      targetZ += gust * 0.6 * Math.sin(1.7 * poseTime + 2.9);
    }

    // The cat: push the hair out of the repulsor sphere, proportional to
    // penetration — so the hair rests *against* the cat instead of inside.
    // The probe point is the hair box's closest point to the cat, not the
    // volume's center: a hairdo's center rides half a unit from where the
    // cat actually touches it.
    if (hairRepulsor !== null) {
      const cat = mount.localToWorld(
        scratchVectorB.set(hairRepulsor.x, hairRepulsor.y, hairRepulsor.z),
      );
      const closest = hair.pivot
        .worldToLocal(scratchVectorC.copy(cat))
        .clamp(hair.boxMin, hair.boxMax);
      const away = hair.pivot.localToWorld(closest).sub(cat);
      const gap = away.length();
      if (gap > 1e-5 && gap < hairRepulsor.radius) {
        const push =
          HAIR_PUSH * ((hairRepulsor.radius - gap) / hairRepulsor.radius);
        away.normalize().applyQuaternion(scratchQuaternion);
        targetX += -away.z * push;
        targetZ += away.x * push;
      }
    }

    // Damped spring toward the target, clamped so it can never fold the
    // hair inside the skull (and less swing under a hat brim).
    const h = Math.min(dt, HAIR_DT_MAX);
    hair.velX += (HAIR_STIFFNESS * (targetX - hair.swingX) - HAIR_DAMPING * hair.velX) * h;
    hair.velZ += (HAIR_STIFFNESS * (targetZ - hair.swingZ) - HAIR_DAMPING * hair.velZ) * h;
    const limit = hair.maxSwing;
    hair.swingX = Math.max(-limit, Math.min(limit, hair.swingX + hair.velX * h));
    hair.swingZ = Math.max(-limit, Math.min(limit, hair.swingZ + hair.velZ * h));
    hair.pivot.rotation.set(hair.swingX, 0, hair.swingZ);
  }

  // Glue each pole's grip to its fist. Runs after the pose is applied, so
  // the poles follow the hands through the brake↔tuck blend for free.
  // During a push-off the pole also pivots at the grip: tip swinging
  // forward to plant on the reach, sweeping back past the rest tilt on
  // the drive — the grip stays glued to the fist throughout.
  function updatePoles(): void {
    if (active === null || pose !== "skiing") return;
    const tilt =
      POLE_REST_TILT +
      pushCurrent *
        (POLE_DRIVE_SWING * Math.max(0, -pushSwing) -
          POLE_PLANT_SWING * Math.max(0, pushSwing));
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
      pole.rotation.x = tilt;
    }
  }

  return {
    group,
    mount,
    setPose(next: SkierPose): void {
      pose = next;
      applyPose();
    },
    setFacing(radians: number): void {
      facing.rotation.y = radians;
    },
    setHairRepulsor(repulsor): void {
      hairRepulsor = repulsor;
    },
    setSkiMotion(motion: SkiMotion): void {
      tuckTarget = Math.min(1, Math.max(0, motion.tuck));
      steerTarget = motion.steer;
      airborne = motion.airborne;
      pushTarget = Math.min(1, Math.max(0, motion.push));
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
        // Whole turns are visually identity: when the sim collapses a
        // landed spin to its downhill-equivalent (heading 2π → 0), shift
        // by the same full turns before easing, so the body settles out of
        // the spin instead of visibly unwinding a whole rotation backward.
        steerCurrent +=
          2 * Math.PI * Math.round((steerTarget - steerCurrent) / (2 * Math.PI));
        steerCurrent += (steerTarget - steerCurrent) * ease(STEER_EASE);
        pushCurrent += (pushTarget - pushCurrent) * ease(PUSH_EASE);
        pushSwing = Math.sin(PUSH_FREQ * poseTime);
        // Yaw toward the movement direction. The scene's facing is the
        // downhill half-turn (y = π), which mirrors x — so a positive
        // (rightward) steer needs a negative local yaw to come out turned
        // right in the world.
        carve.rotation.y = -steerCurrent;
        // …and roll into the turn. Positive local z-roll tips the head
        // toward local -x, which the facing mirror maps to the character's
        // right — so bank carries steer's sign directly. The spine
        // counter-rotates against this roll inside applySkiPose, which is
        // what turns a plank-tilt into angulation.
        const bank = Math.max(
          -BANK_MAX,
          Math.min(BANK_MAX, BANK_GAIN * steerCurrent),
        );
        carve.rotation.z = bank;
        // One placement per foot per frame, shared by the gear assemblies
        // and the foot pins so they can never disagree.
        const wobbleScale = 0.35 + 0.65 * tuckCurrent;
        const feet = {
          L: footPlacement("L", steerCurrent, poseTime, wobbleScale),
          R: footPlacement("R", steerCurrent, poseTime, wobbleScale),
        };
        const edge = Math.max(
          -EDGE_MAX,
          Math.min(EDGE_MAX, EDGE_GAIN * steerCurrent),
        );
        // Skis stay ON the snow while the body rolls — that's the other
        // half of angulation. The carve roll happens at the body's center,
        // so left alone it would lift the outside ski clean off the ground
        // (measured: 0.09 units at a cruise carve). Each assembly therefore
        // counter-rolls (edge - bank: its world tilt ends up at exactly the
        // edge angle) and is pre-rotated into the position the carve roll
        // will carry back onto the ground plane.
        const cosBank = Math.cos(bank);
        const sinBank = Math.sin(bank);
        for (const side of ["L", "R"] as const) {
          const assembly = gear.sides[side];
          assembly.position.set(
            feet[side].x * cosBank,
            -feet[side].x * sinBank,
            feet[side].z,
          );
          assembly.rotation.z = edge - bank;
        }
        applySkiPose(
          active,
          tuckCurrent,
          poseTime,
          airborne,
          bank,
          feet,
          pushCurrent,
          pushSwing,
        );
        updatePoles();
      } else {
        carve.rotation.y = 0;
        carve.rotation.z = 0;
      }
      // After the pose has settled the bones: glue the mount to the spine,
      // then run the hair spring (it reads the head's settled position).
      updateMount();
      updateHair(dt);
    },
  };
}
