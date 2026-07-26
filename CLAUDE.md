# Toebeans

A game project. The owner is **non-technical** — explain things in plain
language, don't assume familiarity with tooling, and avoid jargon unless
it's explained.

## Working agreements

- **One feature per session.** Don't bundle unrelated changes together.
- **Update [ROADMAP.md](ROADMAP.md) every session** with what changed and
  what's next.
- **New ideas go in [IDEAS.md](IDEAS.md), not into code.** If a tangent
  comes up mid-session, write it down there instead of implementing it.
- Game design decisions and rationale live in DESIGN.md — **except the branching
  map, where SLOPE_BRANCHINGv3.md supersedes DESIGN.md.** DESIGN.md still describes
  the older three-linear-slopes model; the two are not yet reconciled (see
  SLOPE_BRANCHINGv3.md §7 #1). For any slope or map work, SLOPE_BRANCHINGv3.md wins.
  ## Working with the owner

The owner is non-technical, owns all creative decisions, and delegates technical
execution entirely.

- **Plan before code, every session.** State your plan and what you'll change,
  then wait for approval before writing anything.
- **Describe plans and results in terms of what he will see in the browser**, not
  files, types, or refactors. Name files only when asked.
- **For decisions with a creative or design component, don't choose.** Present 2–4
  options with tradeoffs and let him pick.
- **For purely technical decisions with no design impact, just choose.** Don't ask
  him to arbitrate implementation details or read code to answer a question.
- **Scope is a fence, not a suggestion.** If you find work outside the current
  session's item, write it in IDEAS.md and mention it once. Don't do it.
- **The spec file wins over conversation.** If something said in a session
  contradicts SLOPE_BRANCHING.md, say so rather than following the conversation.
- **Timing law:** every fork on the branching map is same-clock. If a change makes
  the same-clock test fail, stop and report — don't adjust the tolerance.

## Stack

- TypeScript, `strict: true` everywhere (see `tsconfig.base.json`).
- Three.js for rendering.
- Vite for the client dev server/build.
- Vitest for tests.
- npm workspaces: `client`, `server`, `shared`.

## Structure

```
/client   Vite + Three.js app. Rendering only.
/server   Server-side code.
/shared   Pure game logic, shared between client and server.
/assets   Art, audio, and other static assets (not code). Vite serves
          this directory as-is, so assets/slope/X.glb is /slope/X.glb
          in the game. Every asset needs a row in assets/CREDITS.md.
          Subfolders: slope/ (scenery), characters/ (the cat + the
          11-character playable roster and shared clips), bedroom/
          (furniture — the walkable bedroom was scrapped 2026-07-22;
          these are kept as the future unlock pool).
/tools    Build-time scripts (not shipped). Converters bring downloaded
          models in line with the Art Style Bible in DESIGN.md,
          depending on how the source colors itself:
            obj2glb_palette.py — for OBJ sources with one material per
              part (the Quaternius Nature Pack). Remaps materials.
            obj2glb_bedroom.py — thin wrapper on the above with the
              furniture packs' material table.
            glb_palette.py — for .glb sources that color themselves with
              a shared texture atlas (Quaternius characters/animals).
              Bakes each vertex's atlas swatch into palette vertex colors
              and strips the texture, since the bible bans textures. The
              baked regions (e.g. the cat's body/belly/eyes/nose) are
              what customization recolors later.
            gltf_character.py — for the textureless named-material
              character pack: recolors materials, strips per-character
              clips (one shared CharacterClips.glb serves the roster).
```

## The core rule: state and rendering are separate

All game logic lives in `/shared` as **pure functions** operating on a
**serializable `GameState`**:

- `GameState` (and everything inside it) must be plain, JSON-serializable
  data — no class instances, no functions, no `Map`/`Set` on the state
  itself.
- Functions that change state (e.g. `step`, `setCatVelocity`) take a
  `GameState` and return a **new** `GameState`. They never mutate their
  input.
- **Rendering never mutates `GameState`.** Code in `/client` (see
  `client/src/skiRender.ts`) only *reads* game state to sync a Three.js
  scene graph. (The lobby, `lobbyRender.ts`, has no game state at all — a
  pure menu-backdrop diorama.) It's fine for rendering code to mutate Three.js objects
  (meshes, the renderer, the scene) — just never the game state itself.

This keeps game logic testable without a renderer, and keeps `/server` able
to run the same simulation headlessly.

## Commands

Run from the repo root:

- `npm run dev` — start the client dev server (Vite + Three.js).
- `npm run build` — build the client for production.
- `npm run test` — run the Vitest suite.
- `npm run typecheck` — TypeScript project-wide type check.
- `npm run check` — typecheck + test. Run this before considering any
  change done.
- `npm run check` — typecheck + test. Run this before considering any change done.
  Passing `check` is necessary but not sufficient: a session is only done when
  there's something demonstrable in the browser that the owner can verify himself
  in under a minute.
