// Ghost skiers (multiplayer session, 2026-07-24). Draws the *other* players
// into the slope scene from the pose packets net.ts relays. A ghost reuses the
// exact same rig + cat as the local player (skierModel.ts / catModel.ts) and is
// placed the same way skiRender.ts places the local skier — so it looks like a
// real second racer, not a stand-in. Purely visual: no game state, no
// collisions, no life loss. You can ski right through a ghost.
//
// Smoothing: packets arrive ~12×/sec, so we render each ghost a short beat in
// the past (INTERP_DELAY) and interpolate between the two packets bracketing
// that render time. That trades a little latency for motion with no stutter —
// the standard trick for networked movement. A ghost that goes silent for
// GHOST_TIMEOUT is removed (the friend closed the tab or lost connection).

import * as THREE from "three";
import {
  BOOST_SPEED,
  MIN_SPEED,
  downhillHeading,
  type Appearance,
} from "@toebeans/shared";
import { createCatRig, type CatRig } from "./catModel";
import { createSkierRig, type SkierRig } from "./skierModel";
import { segmentCenterline } from "./slopePath";
import type { PosePacket } from "./net";

// Render this many milliseconds behind real time, so there's almost always a
// newer packet to interpolate toward instead of extrapolating past the last
// one. ~1.5 send intervals at 12 Hz.
const INTERP_DELAY = 130;
// Drop a ghost we haven't heard from in this long — they've left.
const GHOST_TIMEOUT = 3000;
// Keep a short history per ghost for interpolation; more than enough.
const BUFFER_LIMIT = 12;

interface Sample {
  packet: PosePacket;
  /** Local arrival time (performance.now) — clocks differ across machines, so
   * we never trust the sender's clock, only when *we* got it. */
  at: number;
}

interface Ghost {
  readonly group: THREE.Group;
  readonly rig: SkierRig;
  readonly cat: CatRig;
  buffer: Sample[];
  lastSeen: number;
  appearanceKey: string;
  onSlope: boolean;
}

export interface GhostsHandle {
  /** Feed a freshly received packet in. */
  ingest(packet: PosePacket): void;
  /** Advance every ghost one frame: interpolate, place, pose, expire. */
  update(now: number, dt: number): void;
  /** Tear every ghost down (e.g. leaving the room). */
  clear(): void;
}

function appearanceKey(a: Appearance): string {
  return `${a.character}-${a.skin}-${a.hair}`;
}

// Shortest-arc angle lerp — headings wrap at ±π, so a naive lerp would spin
// the body the long way around when crossing the seam.
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d -= 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI));
  return a + d * t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createGhosts(scene: THREE.Scene): GhostsHandle {
  const ghosts = new Map<string, Ghost>();

  function spawn(packet: PosePacket): Ghost {
    const group = new THREE.Group();
    group.rotation.order = "YXZ";
    const rig = createSkierRig();
    rig.setPose("skiing");
    rig.setFacing(Math.PI); // authored facing +z; downhill is -z (as skiRender)
    rig.setAppearance(packet.appearance);
    group.add(rig.group);

    // The cat rides the ghost's back too — same mount + clinging pose as the
    // local skier (skiRender.ts), so a ghost is a full racer, cat and all.
    const cat = createCatRig();
    cat.setPose("clinging");
    cat.group.position.set(0.06, -0.05, -0.06);
    cat.group.rotation.set(-Math.PI / 2, 0, 0);
    rig.mount.add(cat.group);

    scene.add(group);
    const ghost: Ghost = {
      group,
      rig,
      cat,
      buffer: [],
      lastSeen: 0,
      appearanceKey: appearanceKey(packet.appearance),
      onSlope: packet.onSlope,
    };
    ghosts.set(packet.id, ghost);
    return ghost;
  }

  function remove(id: string): void {
    const ghost = ghosts.get(id);
    if (!ghost) return;
    scene.remove(ghost.group);
    ghosts.delete(id);
  }

  return {
    ingest(packet: PosePacket): void {
      const now = performance.now();
      const ghost = ghosts.get(packet.id) ?? spawn(packet);
      ghost.lastSeen = now;
      ghost.onSlope = packet.onSlope;

      // Appearance is baked into the rig meshes, not interpolated per frame —
      // only re-apply when the friend actually changes character/skin/hair.
      const key = appearanceKey(packet.appearance);
      if (key !== ghost.appearanceKey) {
        ghost.rig.setAppearance(packet.appearance);
        ghost.appearanceKey = key;
      }

      ghost.buffer.push({ packet, at: now });
      if (ghost.buffer.length > BUFFER_LIMIT) ghost.buffer.shift();
    },

    update(now: number, dt: number): void {
      const renderTime = now - INTERP_DELAY;
      for (const [id, ghost] of ghosts) {
        if (now - ghost.lastSeen > GHOST_TIMEOUT) {
          remove(id);
          continue;
        }

        // In the lobby the friend has no ghost on the slope.
        ghost.group.visible = ghost.onSlope;
        if (!ghost.onSlope) {
          ghost.rig.update(dt);
          ghost.cat.update(dt);
          continue;
        }

        const buf = ghost.buffer;
        if (buf.length === 0) continue;

        // Find the two samples bracketing renderTime; interpolate between them.
        // Before the first / after the last, hold the nearest packet.
        let a = buf[0]!;
        let b = buf[buf.length - 1]!;
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i]!.at <= renderTime && buf[i + 1]!.at >= renderTime) {
            a = buf[i]!;
            b = buf[i + 1]!;
            break;
          }
        }
        const span = b.at - a.at;
        const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.at) / span)) : 1;

        const pa = a.packet;
        const pb = b.packet;
        // Segment can change on the branching map; interpolating across a
        // segment seam is meaningless, so snap to the newer packet's segment
        // and interpolate the offsets within it. On the Overlook seg is always
        // "main", so this never triggers.
        const seg = pb.seg;
        const dist = pa.seg === pb.seg ? lerp(pa.dist, pb.dist, t) : pb.dist;
        const lat = pa.seg === pb.seg ? lerp(pa.lat, pb.lat, t) : pb.lat;
        const height = lerp(pa.h, pb.h, t);
        const heading = lerpAngle(pa.hd, pb.hd, t);
        const speed = lerp(pa.spd, pb.spd, t);

        // Place on the road exactly like skiRender.ts does for the local
        // skier: centerline point + lateral offset along its normal, yaw the
        // body onto the road tangent. (Crash tip-over is skipped for ghosts —
        // a nicety, not needed to read "there's my brother.")
        const pt = segmentCenterline(seg, dist);
        const cosH = Math.cos(pt.heading);
        const sinH = Math.sin(pt.heading);
        ghost.group.position.set(pt.x + cosH * lat, height, pt.z + sinH * lat);
        ghost.group.rotation.set(0, -pt.heading, 0);

        // Pose from the interpolated state — the same derivation skiRender.ts
        // runs, minus the frame-diff niceties (pole push, jump envelope, tired
        // hop) that need real local input history a ghost doesn't have.
        const pace = Math.abs(speed);
        const tuck = (pace - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED);
        const airborne = height > 0;
        const stance = speed < 0 ? Math.PI : 0;
        const carve = airborne
          ? 0
          : downhillHeading(heading - stance) * Math.min(1, pace / MIN_SPEED);
        const switchLook = speed < -0.5 ? 1 : 0;
        ghost.rig.setSkiMotion({
          tuck: tuck + (airborne ? 0.2 : 0),
          steer: heading,
          carve,
          switchLook,
          airborne,
          push: 0,
        });
        ghost.rig.update(dt);
        ghost.cat.update(dt);
      }
    },

    clear(): void {
      for (const id of [...ghosts.keys()]) remove(id);
    },
  };
}
