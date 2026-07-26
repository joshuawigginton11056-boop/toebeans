// (map-editor) localStorage glue for the director's map, kept out of the
// versioned game save (like settings.ts): a map is an authoring artifact, not
// game progress. The shared module owns the format + healing (decodeMap); this
// just reads/writes the string, tolerating every localStorage failure (private
// mode, disabled, quota) the same way save.ts / settings.ts do.

import { decodeMap, defaultMap, encodeMap, type SlopeMap } from "@toebeans/shared";

const MAP_KEY = "toebeans-map";

export function loadMap(): SlopeMap {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    if (raw === null) return defaultMap();
    return decodeMap(JSON.parse(raw)) ?? defaultMap();
  } catch {
    return defaultMap();
  }
}

export function saveMap(map: SlopeMap): void {
  try {
    localStorage.setItem(MAP_KEY, encodeMap(map));
  } catch {
    /* nothing to do — an unsaved edit is better than a crash */
  }
}
