# Parallel sessions: lobby + slope-mechanics + slope-visuals

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

## Who works where

| Session | Branch | Folder | Dev server |
|---|---|---|---|
| **Lobby** | `lobby` | `C:\Users\joshu\Toebeans-lobby` | launch config `toebeans-lobby` (port 5301) |
| **Slope-mechanics** | `slope-mechanics` | `C:\Users\joshu\Toebeans-slope-mechanics` | launch config `toebeans-slope-mechanics` (port 5302) |
| **Slope-visuals** | `slope-visuals` | `C:\Users\joshu\Toebeans-slope-visuals` | launch config `toebeans-slope-visuals` (port 5303) |

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

**Slope-visuals session owns** — how the slope *looks and sounds*:
- `client/src/skiScene.ts` (palette, lighting, sky, snow surface, decor
  scatter, hazard/checkpoint mesh styles)
- `client/src/skierModel.ts` (the character rig: pose, gear, hair, all
  body presentation)
- `client/src/audio.ts`
- `assets/slope/`, `assets/characters/`
- `tools/` (the asset converters)

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
  `(lobby)`, `(slope-mech)`, or `(slope-vis)`. Older entries keep their
  historical `(bedroom)`/`(slope)` tags. On merge conflict, keep both
  sides.
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
