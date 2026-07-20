# Roadmap

## 2026-07-19 — Project scaffold

Set up the project from scratch: TypeScript (strict) + Three.js + Vite for
the client, npm workspaces for `client`/`server`/`shared`, Vitest for tests.

- `/shared` holds a serializable `GameState` (a list of cats with
  position/velocity) and pure functions (`step`, `setCatVelocity`) that
  return new state instead of mutating.
- `/client` renders that state with Three.js (`render.ts`) — reads state,
  never writes to it. Currently shows one placeholder cat (an orange box)
  drifting across a floor, just to prove the pipeline works.
- `/server` is a minimal stub that imports `/shared` — nothing real yet.
- `npm run check` (typecheck + Vitest) passes; `npm run build` succeeds.
- Fixed a real bug found while testing: the renderer read the container's
  size before layout had settled, producing a 0×0 canvas. Now sizes off
  `window.innerWidth/innerHeight` instead.

**Next:** first actual feature — replace the placeholder box with something
that reflects real gameplay (see [DESIGN.md](DESIGN.md) once that exists,
or [IDEAS.md](IDEAS.md) for candidates).

## 2026-07-20 — GitHub remote, design doc scribing

Created a private GitHub repo
([joshuawigginton11056-boop/toebeans](https://github.com/joshuawigginton11056-boop/toebeans))
and pushed the existing history to it. Going forward, every commit gets
pushed too.

Josh wrote and uploaded `TOEBEANS_VISION.md` — the director's full game
vision (core fantasy, ski loop, leveling/unlocks, environment XP, later-phase
multiplayer, look & feel). [DESIGN.md](DESIGN.md) was written from it as the
working design doc; the vision file stays the source of truth if the two
ever disagree.

The vision doc doesn't answer everything from the original design interview.
Three questions are still open:

1. What does "cozy" mean to you for this game — beyond the low-poly / LOFI /
   warm-colors aesthetic, what's the feeling you're chasing? Is it about
   safety, slowness, control, nostalgia, something else?
2. What is the player ultimately working toward — is there an endgame, or is
   progression meant to be open-ended?
3. What makes Toebeans different from Stardew Valley / Animal Crossing, in
   your own words?

**Next:** answer the three open interview questions above, fold the answers
into DESIGN.md, then pick the first real feature to build (see
[IDEAS.md](IDEAS.md) for candidates).
