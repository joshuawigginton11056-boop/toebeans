# Toebeans

A cozy 3D game: ski mountain slopes with your cat, earn XP, and decorate a
home you customize together. Early build — the game opens on a menu lobby
(a title screen with a snowy diorama behind it) and has one playable
scene: the ski slope, with crashes, checkpoints, and the cat's 9 lives.
The slope wears the game's real art — painted snowy trees and rocks, dawn
lighting, carved ski trails, a playable cast of 11 characters with your
animated cat riding on your back — plus the real UI, synthesized sound,
and save/load. Most of the game described in [`DESIGN.md`](DESIGN.md)
isn't built yet. See [`ROADMAP.md`](ROADMAP.md) for what's done and what's
next.

## Running it

```
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`). You start
on the title screen — its buttons have their keyboard shortcuts printed
right on them (pick a character, skin and hair colors, sound). The game
remembers where you were: close the tab and reopen it and you resume the
same spot and run. Controls:

- **Enter** — hit the slopes, or head back to the lobby. Every trip to
  the slope is a fresh run with full lives (this is also how you retry
  after losing all 9).
- **M** — mute/unmute. All sound is synthesized in the browser; there are
  no audio files.
- On the slope: **left/right (or A/D)** steer — turns are real: the skis
  stay where you point them, and holding a turn carves all the way around
  into riding switch (backwards), settling there. The opposite key carves
  you back. **Up (or W)** speeds up and straightens you onto the fall
  line in whichever stance you're in; **down (or S)** brakes — and so
  does turning: skis sideways scrub speed to a hockey stop. **Space**
  charges a jump while held (deeper crouch, higher jump — release to
  launch) and, held again mid-air, spins the body for 180s and 360s; land
  backwards and you're riding switch, not crashing. Landings take a
  short beat before you can jump again. **Shift** boosts, and
  commits harder into turns. **Scroll (or pinch)** zooms the camera in and
out through a wide range at a fixed three-quarter angle; **click the
slope** to grab the mouse and look around freely (the cursor hides; Esc
lets go), or **drag** to peek on a touchscreen. Falling into a chasm costs one of the cat's
  9 lives and sends you back to the last checkpoint (ice-blue stripe);
  lose all 9 and the run is forfeited. The nine cat faces in the top-left
  are the lives — each fades as it's spent — and the chips along the
  bottom show the controls. See [`assets/CREDITS.md`](assets/CREDITS.md)
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
  v1.0/v1.x/Steam scope split and the Art Style Bible.
- [`IDEAS.md`](IDEAS.md) — a parking lot for ideas that come up but aren't
  being built yet.
- [`PARALLEL.md`](PARALLEL.md) — how the three parallel Claude sessions
  (lobby, slope-mechanics, slope-visuals) share the repo.
