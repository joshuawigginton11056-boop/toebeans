# Toebeans

A cozy 3D game: ski mountain slopes with your cat, earn XP, and decorate a
home you customize together. Early build — two playable scenes (a bedroom
to walk around and a ski slope with crashes, checkpoints, and the cat's 9
lives). The slope is getting its real art first — snowy trees and rocks,
the dawn lighting pass, the real UI, sound effects, save/load, and a real
animated cat are all in; the skier is still a blue box, and the bedroom is
still gray-box. Most of the game described in [`DESIGN.md`](DESIGN.md)
isn't built yet. See [`ROADMAP.md`](ROADMAP.md) for what's done and what's
next.

## Running it

```
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`). You start
in a gray-box bedroom — placeholder box shapes, except the cat, which is
a real model; the rest of the real art starts on the slope. The game
remembers where you were: close the tab and reopen it and you resume the
same scene, spot, and run. Controls:

- **Enter** — switch between the bedroom and the ski slope. Every trip to
  the slope is a fresh run with full lives (this is also how you retry
  after losing all 9).
- **M** — mute/unmute. All sound is synthesized in the browser; there are
  no audio files.
- In the bedroom: **arrow keys or WASD** to walk around; the bed, dresser,
  and desk block your path. The cat trots over to greet you, follows you
  around, and sits back down when it catches up.
- On the slope: **arrow keys or WASD** to steer left/right and lean
  up/down to speed up or brake, **Space** to jump the gaps in the snow,
  **Shift** to boost. Crashing costs one of the cat's 9 lives and sends
  you back to the last checkpoint (ice-blue stripe); lose all 9 and the
  run is forfeited. The nine cat faces in the top-left corner are the
  lives — each one fades out as it's spent — and the chips along the
  bottom of the screen show the controls for whichever scene you're in.
  The treelines flanking the run are the first real art, and your cat
  rides along on your back — see [`assets/CREDITS.md`](assets/CREDITS.md)
  for where the models come from.

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
