# Toebeans

A cozy 3D game: ski mountain slopes with your cat, earn XP, and decorate a
home you customize together. Early build — the first gray-box prototype
piece (skiing) is playable; most of the game described in
[`DESIGN.md`](DESIGN.md) isn't built yet. See [`ROADMAP.md`](ROADMAP.md)
for what's done and what's next.

## Running it

```
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`). You'll see
a gray-box ski slope — placeholder box shapes, no art yet. Controls:

- **Arrow keys or WASD** — steer left/right, lean up/down to speed up or
  brake
- **Space** — jump (clears the gaps in the snow)
- **Shift** — boost

Other useful commands:

- `npm run check` — makes sure nothing is broken (types + tests). Run this
  after any change.
- `npm run build` — builds the game for production/sharing.

## Where things live

- [`CLAUDE.md`](CLAUDE.md) — how this project works and how Claude should
  operate in it (stack, folder structure, the state/rendering split, working
  agreements).
- [`ROADMAP.md`](ROADMAP.md) — session-by-session log of what changed and
  what's next.
- [`DESIGN.md`](DESIGN.md) — game design decisions, including the approved
  v1.0/v1.x/Steam scope split.
- [`IDEAS.md`](IDEAS.md) — a parking lot for ideas that come up but aren't
  being built yet.
