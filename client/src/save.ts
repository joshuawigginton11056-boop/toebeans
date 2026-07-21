import { decodeSave, encodeSave, type SaveData } from "@toebeans/shared";

// Browser-storage glue for the pure save logic in /shared. This is the only
// file that touches localStorage; everything about what a save *contains*
// lives in shared/src/save.ts where it's testable.

const SAVE_KEY = "toebeans-save";

// localStorage can throw (private browsing, storage disabled, quota) — in
// every such case the game simply plays without persistence.

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw === null ? null : decodeSave(raw);
  } catch {
    return null;
  }
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, encodeSave(save));
  } catch {
    // Storage unavailable — play on without saving.
  }
}
