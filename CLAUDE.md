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
- `npm run check` — typecheck + test. Run this before considering any change done.
  Passing `check` is necessary but not sufficient: a session is only done when
  there's something demonstrable in the browser that the owner can verify himself
  in under a minute.

## How to actually SEE a slope change (learned the slow way, 2026-07-26)

**You cannot drive a real-time ski run through an automated browser tab.** An
unfocused tab throttles `requestAnimationFrame` to ~1 Hz and then stops it: the run
either takes giant `dt` steps (skipping whole trigger windows, and tearing the debug
readout into self-inconsistent reads) or freezes outright. Screenshots still composite
on demand, so the page *looks* live when the sim hasn't advanced in 30 s — check
`elapsed` on the `?debug` readout before trusting anything you see.

**Render the view you want instead.** Vite serves the sources, so in the page you can
import the real modules and build a second scene with your own camera — no waiting, no
decor scatter in the way, and repeatable:

```js
const B = '/@fs/<abs repo path>/client/src/';
const rend = await import(B + 'skiRender.ts');
const sp   = await import(B + 'slopePath.ts');
const fg   = await import(B + 'forestGraphics.ts');
const THREE = await import('/@id/three');      // NOT '/node_modules/...'
const box = document.createElement('div');
box.style.cssText = 'position:fixed;inset:0;z-index:9999';
document.body.appendChild(box);
const h = rend.createSkiScene(box);
rend.addBranchTerrain(h);
fg.buildFrozenLake(h.scene);                    // dressing is opt-in
const eye = sp.trailPointAtRoute(300, -4);      // route distance + lateral
const look = sp.trailPointAtRoute(470, 20);
const cam = new THREE.PerspectiveCamera(64, box.clientWidth / box.clientHeight, 0.5, 3000);
cam.position.set(eye.x, eye.y + 26, eye.z);
cam.lookAt(look.x, look.y + 4, look.z);
h.scene.fog.near = 300; h.scene.fog.far = 1600;  // haze hides mid-distance geometry
h.renderer.render(h.scene, cam);
```

Then screenshot. To find which mesh owns a visual artifact, toggle
`h.scene.children[i].visible` and re-render — that is how a stray sliver was traced to
a phantom lake band in one pass.

**For LAYOUT questions, skip the browser entirely.** `client/src/slopePath.ts` has no
three.js dependency, so `npx tsx` a throwaway script that imports it directly and emits
an SVG plan view — top-down, labelled, exact. Much faster than flying the map.
