# Parallel sessions: bedroom + slope

Two Claude sessions work this repo at the same time, each in its own git
worktree (a separate folder sharing the same repo history). **Read this
whole file before touching code.** The single-session working agreements
in [CLAUDE.md](CLAUDE.md) still apply — one feature per chunk, update the
docs, park tangents in IDEAS.md.

## Who works where

| Session | Branch | Folder | Dev server |
|---|---|---|---|
| **Bedroom** | `bedroom` | `C:\Users\joshu\Toebeans-bedroom` | launch config `toebeans-bedroom` (port 5301) |
| **Slope** | `slope` | `C:\Users\joshu\Toebeans-slope` | launch config `toebeans-slope` (port 5302) |

The main checkout at `C:\Users\joshu\Toebeans` stays on `master` and is
**merge-target only** — no session edits files there. Josh's own dev
server (usually port 5173) runs from it; merged changes hot-reload for him.

Each worktree has its own `node_modules` — if `npm run check` complains
about missing packages, run `npm install` in **your own** folder.

## File ownership

**Bedroom session owns** (edit freely) — the name is historical: the
walkable bedroom was scrapped for the menu lobby on 2026-07-22, and this
session owns the lobby now:
- `client/src/lobbyRender.ts`, `client/src/lobbyUi.ts`
- `assets/bedroom/` (the furniture models — kept as the future unlock pool)

**Slope session owns** (edit freely):
- `client/src/skiRender.ts`, `client/src/skierModel.ts`, `client/src/audio.ts`
- `shared/src/skiing.ts`, `shared/src/skiing.test.ts`
- `assets/slope/`

**Shared territory** — both scenes depend on these. Keep edits small,
additive, and localized; expect merge conflicts here and resolve them by
keeping both sides' intent:
- `client/src/main.ts` (scene switching, key handling)
- `client/src/hud.ts`
- `client/src/catModel.ts` (the cat appears in both scenes)
- `client/src/save.ts`, `shared/src/save.ts`, `shared/src/index.ts`,
  `shared/src/appearance.ts`
- `ROADMAP.md`, `IDEAS.md`, `assets/CREDITS.md`
- `package.json` / `package-lock.json` (adding a dependency? mention it in
  your ROADMAP entry so the other session knows to `npm install` after
  merging)

**Never** edit the other session's owned files, even for a "quick fix" —
write the problem into IDEAS.md tagged for the other session instead.

## Special rules

- **`SAVE_VERSION`** (in `shared/src/save.ts`): bump it only *after* step 1
  of the merge protocol below (so you've already absorbed the other
  session's possible bump). If master's version moved since you branched,
  re-number yours on top of it. Never both bump in the same cycle without
  a merge in between.
- **ROADMAP.md / IDEAS.md**: prefix every new entry heading with
  `(bedroom)` or `(slope)`. On merge conflict, keep both sides.
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
4. Keep working on your branch. The other session absorbs your work at its
   next step 1.

Every commit gets pushed (standing rule from Josh).
