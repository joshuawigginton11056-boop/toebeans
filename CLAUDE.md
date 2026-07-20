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
- Game design decisions and rationale live in [DESIGN.md](DESIGN.md).

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
/assets   Art, audio, and other static assets (not code).
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
  `client/src/render.ts`) only *reads* `GameState` to sync a Three.js scene
  graph. It's fine for rendering code to mutate Three.js objects
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
