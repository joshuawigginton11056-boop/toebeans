# Parallel sessions: lobby + slope-mechanics + slope-visuals + mountain-graphics + forest-graphics

Three Claude sessions work this repo at the same time, each in its own git
worktree (a separate folder sharing the same repo history). **Read this
whole file before touching code.** The single-session working agreements
in [CLAUDE.md](CLAUDE.md) still apply — one feature per chunk, update the
docs, park tangents in IDEAS.md.

*(Restructured 2026-07-22: the old bedroom/slope pair became this trio.
"Bedroom" was renamed to match the menu lobby that replaced the walkable
room, and the slope session split in two so texture/art work and
gameplay-feel work can run side by side without colliding.)*

*(2026-07-24: UI building folded into the lobby session rather than given
its own worktree — `hud.ts` and all cross-scene UI chrome now belong to
lobby. Still three sessions.)*

*(2026-07-24: the slope-visuals SCENERY split into two sessions —
**mountain-graphics** (terrain, snow, sky, lighting, hazard/checkpoint
mesh styles) and **forest-graphics** (trees, decor scatter, glow props,
mist, treelines). Slope-visuals narrows to the character rig + audio +
asset tools. **This split LANDED 2026-07-25** (slope-vis carved it) — see "The
scenery split" below; `skiScene.ts` is now the shared core and
`mountainGraphics.ts` / `forestGraphics.ts` are the two sessions' owned
files.)*

## Who works where

| Session | Branch | Folder | Dev server |
|---|---|---|---|
| **Lobby** | `lobby` | `C:\Users\joshu\Toebeans-lobby` | launch config `toebeans-lobby` (port 5301) |
| **Slope-mechanics** | `slope-mechanics` | `C:\Users\joshu\Toebeans-slope-mechanics` | launch config `toebeans-slope-mechanics` (port 5302) |
| **Slope-visuals** | `slope-visuals` | `C:\Users\joshu\Toebeans-slope-visuals` | launch config `toebeans-slope-visuals` (port 5303) |
| **Mountain-graphics** | `mountain-graphics` | `C:\Users\joshu\Toebeans-mountain-graphics` | launch config `toebeans-mountain-graphics` (port 5306) |
| **Forest-graphics** | `forest-graphics` | `C:\Users\joshu\Toebeans-forest-graphics` | launch config `toebeans-forest-graphics` (port 5307) |
| **Map-editor** | `map-editor` | `C:\Users\joshu\Toebeans-map-editor` | launch config `toebeans-map-editor` (port 5308) |

**Map-editor session owns** — the director's map-editor feature (a data-driven
slope you build and play; see ROADMAP.md → "Map editor"):
- `shared/src/slopeMap.ts` (+ `.test.ts`) — the `SlopeMap` format + pure helpers
- `client/src/mapEditor.ts` (the editor screen), `client/src/mapStore.ts`
- It reaches ACROSS seams into the tuned sim/terrain because a data-driven slope
  inherently must. Those edits are small/additive/flagged `// (map-editor)`:
  `SkiState.mapGrade` + the map grade read in `shared/src/skiing.ts`
  (`createMapSkiState`); `"map"` cases in `client/src/slopePath.ts`
  (`setActiveMap`/`segmentCenterline`/`segmentToWorld`/`segmentPitch`);
  `setMapTerrain` + the branch-terrain hide in `client/src/skiRender.ts`; a
  **Map Editor** button in `client/src/lobbyUi.ts`; `SceneMode` `"editor"` in
  `shared/src/save.ts`; wiring in `client/src/main.ts`. Owning sessions: this is
  additive — leave the flags in place; polish notes are parked in IDEAS.md tagged
  for you.

The main checkout at `C:\Users\joshu\Toebeans` stays on `master` and is
**merge-target only** — no session edits files there. Josh's own dev
server (usually port 5173) runs from it; merged changes hot-reload for him.

Each worktree has its own `node_modules` — if `npm run check` complains
about missing packages, run `npm install` in **your own** folder.

## File ownership

**Lobby session owns** — the lobby scene *and* all cross-scene UI (edit
freely):
- `client/src/lobbyRender.ts`, `client/src/lobbyUi.ts`
- `client/src/hud.ts` (the in-game HUD — lives on the slope but is UI, so
  it belongs to this session, not the slope sessions)
- any new global UI: menus, overlays, banners, shared UI styling
- `assets/bedroom/` (the furniture models — kept as the future unlock pool)

Note the split of concern: **UI chrome is the lobby session's; slope
sessions own what the UI *reads*.** If the HUD needs a new value to
display (a speed readout, a new life-state), the slope-mechanics session
exposes it on `SkiState`/via `skiRender.ts` and the lobby session renders
it — same additive-seam etiquette as below. The lobby session never edits
the sim; the slope sessions never restyle the HUD.

**Slope-mechanics session owns** — how the slope *plays*, and what exists
where each frame:
- `shared/src/skiing.ts`, `shared/src/skiing.test.ts` (the sim)
- `client/src/skiRender.ts` (camera + the state→presentation wiring: reads
  `SkiState` every frame and tells the rig and scene pieces where to be)

**Slope-visuals session owns** — the character *and* the soundscape (the
scenery moved out to the two graphics sessions below):
- `client/src/skierModel.ts` (the character rig: pose, gear, hair, all
  body presentation)
- `client/src/audio.ts`
- `assets/characters/`
- `tools/` (the asset converters)

**Mountain-graphics session owns** — the ground and the sky:
- `client/src/mountainGraphics.ts` (terrain, snow surface + shader, sky
  dome, day/night lighting solve, palette, hazard + checkpoint mesh styles)
- the terrain/rock GLBs in `assets/slope/`

**Forest-graphics session owns** — everything growing on and glowing over
the slope:
- `client/src/forestGraphics.ts` (trees, decor scatter, treelines, the
  enchanted-night glow props + snow pools, drifting mist banks)
- the tree/plant/decor GLBs in `assets/slope/`

> **The scenery split (LANDED 2026-07-25, slope-vis).** The old 3299-line
> `client/src/skiScene.ts` was carved into **three** files: a shared
> `skiScene.ts` — the palette + `solveSnowLights` + the `applyTimeOfDay`/
> `setTimeOfDay` day-night engine + the `createEnvironment`/`syncEnvironment`/
> `renderSlope` orchestration, imported by both halves — plus
> `mountainGraphics.ts` (ground + sky) and `forestGraphics.ts` (trees + glow +
> mist), each owned by its session per the table above. The carve was
> behavior-preserving (moved code byte-identical bar the added `export`s; the
> rewired glow/mist/snow-fade seams verified equivalent) and the public API is
> unchanged (re-exported from `skiScene.ts`), so `skiRender.ts`/`main.ts`
> needed no edit. **`skiScene.ts` is now the shared core** — the same
> small/additive/localized etiquette as the other shared-territory files
> applies to it; mountain and forest each own their own feature file outright.
> NOTE: the ownership table lists "day/night lighting solve, palette" under
> mountain-graphics, but those in fact live in the shared core (per this
> split) — treat the core as their home.

**The mechanics↔visuals seam.** `skiRender.ts` computes *numbers* from
`SkiState` and passes them across the seam — to `skierModel.ts` via
`setSkiMotion(...)` and to `skiScene.ts` via `syncEnvironment(...)` and the
mesh factories. Reading the other side is always fine; **editing** it is
not. If your feature genuinely needs the other side of the seam to change
(a new `setSkiMotion` field, a new factory), make the **smallest additive
change that works**, mark it with a comment naming your session, say so in
your ROADMAP entry, and park any polish it deserves in IDEAS.md tagged for
the owner. Never restyle, rework, or "improve" the other session's file
while you're in there.

**Shared territory** — multiple scenes depend on these. Keep edits small,
additive, and localized; expect merge conflicts here and resolve them by
keeping both sides' intent:
- `client/src/main.ts` (scene switching, key handling)
- `client/src/catModel.ts` (the cat appears in both scenes)
- `client/src/save.ts`, `shared/src/save.ts`, `shared/src/index.ts`,
  `shared/src/appearance.ts`
- `ROADMAP.md`, `IDEAS.md`, `DESIGN.md`, `assets/CREDITS.md`
- `package.json` / `package-lock.json` (adding a dependency? mention it in
  your ROADMAP entry so the other sessions know to `npm install` after
  merging)
- `.claude/launch.json` (one file lists every session's dev server)

**Never** edit another session's owned files, even for a "quick fix" —
write the problem into IDEAS.md tagged for that session instead.

## Special rules

- **`SAVE_VERSION`** (in `shared/src/save.ts`): bump it only *after* step 1
  of the merge protocol below (so you've already absorbed any other
  session's bump). If master's version moved since you branched, re-number
  yours on top of it. Never two sessions bumping in the same cycle without
  a merge in between.
- **ROADMAP.md / IDEAS.md**: prefix every new entry heading with
  `(lobby)`, `(slope-mech)`, `(slope-vis)`, `(mountain)`, or `(forest)`.
  Older entries keep their historical `(bedroom)`/`(slope)` tags. On merge
  conflict, keep both sides.
- **The Art Style Bible in DESIGN.md binds all three sessions** — during
  the texture transition (see the bible's status note), check the bible's
  current wording before making any new asset or material.
- **Vite ports are strict** — if your dev server won't start, another
  session holds the port; don't steal a different config, tell Josh.

## Merge protocol — after every chunk

A "chunk" = one coherent feature, done and verified (`npm run check`
passes, live-verified in your own dev server). Then:

1. **Sync down** (in your worktree):
   ```
   git fetch origin
   git merge origin/master --no-edit
   ```
   Resolve any conflicts, run `npm run check` again, commit the merge.
2. **Push your branch**: `git push` (first time:
   `git push -u origin <branch>`).
3. **Merge up** through the main checkout (safe to run from anywhere —
   step 1 guarantees no conflicts):
   ```
   git -C C:\Users\joshu\Toebeans pull
   git -C C:\Users\joshu\Toebeans merge <your-branch> --no-edit
   git -C C:\Users\joshu\Toebeans push
   ```
   If the main checkout is dirty or the merge conflicts anyway, **stop and
   tell Josh** — don't force anything.
4. Keep working on your branch. The other sessions absorb your work at
   their next step 1.

Every commit gets pushed (standing rule from Josh).

## How the game gets online

The repo is wired to **Vercel** (`vercel.json` at the root). Vercel watches
GitHub and rebuilds the hosted game automatically — **the trigger is a push,
not a file save.** So:

- **Pushing to `master` updates the main public link** (the one Josh shares).
  In practice that means step 3 of the merge protocol above — merging your
  chunk up to master and pushing it — is *also* what publishes it live.
  Master is the production branch.
- **Pushing to a session branch** (`lobby`, `slope-mechanics`,
  `slope-visuals`) builds *that branch* at its own **preview URL**, so
  work-in-progress is viewable before it reaches master. Find these on
  Vercel's Deployments tab.
- **A build that fails `npm run build` does NOT go live** — Vercel keeps the
  last good version up and flags the bad deploy. This is why the merge
  protocol requires `npm run check` green before you push: a broken push
  doesn't white-screen the site, but it does mean "pushed" ≠ "live" until
  the build passes. Confirm a green checkmark on the Deployments tab.

Nothing here changes the workflow — it just means the live site is a
downstream consequence of the pushes you're already doing.
