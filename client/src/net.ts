// Ghost-racing networking (multiplayer session, 2026-07-24). Client-only —
// the sim never changes. Each browser stays in full charge of its own skier
// and just *broadcasts where it is* a few times a second; the other player is
// drawn as a "ghost" (see ghosts.ts). No shared server-side simulation, no
// authority, no collisions. The smallest thing that lets two people see each
// other ski the same slope.
//
// Two transports run at once, and a packet from either is treated the same
// (ghosts are keyed by sender id, so a duplicate just overwrites itself):
//   • Supabase Realtime "broadcast" — a hosted relay, so two people on
//     *different networks* can connect. Needs VITE_SUPABASE_URL +
//     VITE_SUPABASE_ANON_KEY (the anon key is public by design — it's built
//     for shipping in a webpage).
//   • BroadcastChannel — a browser built-in that links tabs of the same site
//     on the *same machine*, with zero setup. Always on. It's what makes
//     two-tab local testing work, and it's a free bonus same-device path.

import { createClient } from "@supabase/supabase-js";
import type { Appearance } from "@toebeans/shared";
import {
  SUPABASE_ANON_KEY as BAKED_ANON_KEY,
  SUPABASE_URL as BAKED_URL,
} from "./supabaseConfig";

/**
 * One player's live pose on the wire — small and JSON-serializable, which is
 * exactly what the pure-`GameState` architecture was built to allow. Sent
 * ~12×/sec; ghosts.ts interpolates between packets so motion stays smooth.
 */
export interface PosePacket {
  /** Stable id for this browser session — how ghosts are keyed and how we
   * ignore echoes of our own packets. */
  id: string;
  /** Short label the friend chose, shown floating over their ghost. */
  name: string;
  appearance: Appearance;
  /** false when the sender is sitting in the lobby → their ghost is hidden. */
  onSlope: boolean;
  /** The sim fields a ghost needs to place + pose itself, mirroring what
   * skiRender.ts reads for the local player. */
  seg: string;
  dist: number;
  lat: number;
  h: number;
  spd: number;
  hd: number;
  st: string;
}

export type NetStatus = "connecting" | "connected" | "error" | "closed";

export interface NetRoom {
  readonly code: string;
  /** True if this room can reach players on other machines (Supabase up).
   * False = same-device tabs only (BroadcastChannel), which still works for
   * local testing but not for a friend across the internet. */
  readonly canReachRemote: boolean;
  send(packet: PosePacket): void;
  close(): void;
}

export interface RoomHandlers {
  onPacket(packet: PosePacket): void;
  onStatus(status: NetStatus): void;
}

// One anon Supabase client for the whole session, created lazily. Values come
// from env vars if set (a local override — see client/.env.example), otherwise
// the baked-in project defaults in supabaseConfig.ts, so the live site works
// out of the box. If both ended up blank, rooms fall back to same-device
// BroadcastChannel only.
const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) || BAKED_URL;
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  BAKED_ANON_KEY;

/** Whether cross-network play is wired up (both Supabase values present). */
export function isRemoteConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let supabase: ReturnType<typeof createClient> | null = null;
function getSupabase(): ReturnType<typeof createClient> | null {
  if (!isRemoteConfigured()) return null;
  if (!supabase) {
    supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      // We use broadcast only — no auth session, no database. Keep it quiet.
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return supabase;
}

// Room codes: 4 chars, no vowels or look-alikes (0/O, 1/I/L) so they're easy
// to read aloud to a brother. Uppercased everywhere so "join" is forgiving.
const CODE_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
export function makeRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** A random per-session id for this browser (used as the packet sender id). */
export function makePlayerId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `p-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  );
}

const CHANNEL_PREFIX = "toebeans-room-";

/**
 * Join (or create — same thing on a broadcast relay) the room with `code` and
 * start relaying pose packets. The caller owns broadcasting *its* packets via
 * `send`; incoming packets arrive on `handlers.onPacket`.
 */
export function connectRoom(code: string, handlers: RoomHandlers): NetRoom {
  const channelName = CHANNEL_PREFIX + code;
  const canReachRemote = isRemoteConfigured();

  // --- BroadcastChannel: same-machine tabs, zero setup, always available. ---
  // (Guard for very old browsers / non-window contexts, though every target
  // browser has it.)
  const bc =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(channelName)
      : null;
  if (bc) {
    bc.onmessage = (event: MessageEvent) => {
      const packet = event.data as PosePacket;
      handlers.onPacket(packet);
    };
  }

  // --- Supabase broadcast: the cross-network relay, when configured. ---
  const client = getSupabase();
  const channel = client
    ? client.channel(channelName, {
        config: { broadcast: { self: false } },
      })
    : null;

  if (channel) {
    channel.on("broadcast", { event: "pose" }, ({ payload }) => {
      handlers.onPacket(payload as PosePacket);
    });
    channel.subscribe((status) => {
      // Supabase status strings → our simpler set.
      if (status === "SUBSCRIBED") handlers.onStatus("connected");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        handlers.onStatus("error");
      else if (status === "CLOSED") handlers.onStatus("closed");
    });
    // Deferred so the caller's `room = connectRoom(...)` assignment lands
    // before the first status fires (otherwise a status handler that reads the
    // room sees null). The real SUBSCRIBED/error callbacks are already async.
    queueMicrotask(() => handlers.onStatus("connecting"));
  } else {
    // No relay — but BroadcastChannel still links same-device tabs, so the
    // room is "connected" locally right away. Deferred for the same
    // room-assignment reason as above.
    queueMicrotask(() => handlers.onStatus("connected"));
  }

  return {
    code,
    canReachRemote,
    send(packet: PosePacket): void {
      bc?.postMessage(packet);
      channel?.send({ type: "broadcast", event: "pose", payload: packet });
    },
    close(): void {
      bc?.close();
      if (channel && client) void client.removeChannel(channel);
      handlers.onStatus("closed");
    },
  };
}
