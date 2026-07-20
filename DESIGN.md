# Design Doc

Source of truth: [TOEBEANS_VISION.md](TOEBEANS_VISION.md) (written by the
director). This doc restates that vision in design-doc form and tracks what's
still open. When the two disagree, the vision file wins — update this doc to
match.

## Core Fantasy

You are a human with a pet cat. You design both: your character and your
cat. You live in a small environment — starting as a boring bedroom — that
you customize with furniture, decorations, paint, and more. The cat isn't
decoration: it's your best friend. You can pet it, pick it up, and hug it.

## Core Loop

Ski mountain slopes (cat strapped to your back) → earn XP → level up →
unlock new environments, furniture, appliances, and cosmetics → decorate and
interact with your space for more XP → repeat.

## Skiing

- **Controls:** left, right, up, down, jump, crouch, speed boost. Simple
  controls; the danger comes from the slopes.
- **Hazards:** giant snowballs chase from behind (jump to let them pass or
  get flattened), chasms to jump, tree limbs to duck under (crouch).
  Crashing sends you back to the last checkpoint.
- **The cat's nine lives:** hitting an obstacle costs one of the cat's 9
  lives. Run out and you forfeit the run — you still earn XP, but only half
  of what a completed run pays.
- **Slope structure (v1.0):** hybrid — handcrafted slopes with XP set by
  each slope's difficulty. Randomly generated slopes with selectable Easy /
  Difficult / Hard / Extreme modes (paying incrementally more XP) may come
  later if easier to add then.
- **Single-player skiing:** solo runs earn full XP. Finishing time affects
  XP — faster pays more, slower pays less. Crashing carries no penalty
  beyond a lost cat life and the time lost restarting at the checkpoint.

## Leveling & Unlocks

- Everyone starts at level 1 with basic items. **All players have identical
  base statistics** — no stat upgrades, ever. Greatness is earned only
  through high levels.
- Leveling unlocks:
  - **New environments:** bedroom → apartment → skyrise → and beyond (space
    shuttle, laboratory, Mars, Heaven, jungle, and others).
  - **Room customization:** beds, sheet/blanket/pillow colors, windows,
    curtains, appliances, furniture, optional technologies (computer, TV),
    carpet, flooring, rugs, optional fireplaces, indoor grill, and more.
  - **Cosmetics:** clothes for the character, outfits for the cat.
- **Environments are collected, not replaced.** Owned items are stored: in
  a new environment you can redeploy items you already own or buy new ones
  matching that environment's style.
- **Each environment saves its layout.** Switching environments preserves
  how each one is decorated. Later (post-v1.0), environment slots let you
  save multiple layouts per environment.

## Environment XP

- **Timed-task XP (appliances & tech):** interactable objects run a task on
  a timer — the grill cooks hot dogs, the TV is watched, a book is read by
  the fire, games are played on the computer, etc.
- **Passive/AFK XP (furniture):** the bed can be slept in, the couch laid
  on, and so on. Accrues even while the game is closed — on return, the
  game calculates what was earned while away. Accrual stops after 24 hours.

## Multiplayer (later phase — not in v1.0)

- **Head-to-head races:** invite a friend or match online to race a slope.
  Crashing respawns you at the last checkpoint, behind your opponent. Only
  one skier (and their cat) wins and earns the most XP — losers still earn
  100% of the loss reward (25% less than the winner's). Losing all nine cat
  lives mid-race still pays the full loss XP. If your opponent forfeits, you
  auto-win and can either finish the slope or end the run.
- **Leaderboards:** weekly and all-time win/loss-rate, plus leaderboards for
  the biggest winner and the biggest loser.
- **Friend visits:** invite friends into your environment for shared XP.
  Every interaction is available to guests — any appliance, technology, or
  furniture, exactly as the host would use it. Playing together grants both
  players a **15% XP boost**, which also applies when skiing online
  together.
- **Cats socialize too:** visiting cats play together and nap together.
- **Social design:** the friend boost gives low-level players a reason to
  find high-level partners (nice appliances, faster XP) and high-level
  players a reason to host (easy boost toward the next unlock) — a
  community, perhaps on Reddit, grows around this.

## Look & Feel

- **Graphics:** low-poly, cute, wholesome.
- **Cameras:** environments use a Sims-style bird's-eye view with full room
  rotation (so all walls can hold art). Skiing uses a 2.5D
  isometric/axonometric side-scroller with a three-quarter front
  perspective — you clearly see what's ahead, and (multiplayer phase only)
  behind you, the friend you just passed getting crushed by a snowball.
- **Detail touches — skiing:** skis carve marks into the snow; a visible
  snow trail changes with speed.
- **Detail touches — environments:** colors run warm or dark depending on
  decor; lamps glow; fireplaces crackle; book pages bend; cats meow.
- **Audio:** LOFI music plus ambient sounds — rain, birdsong, wind — and
  appropriate sounds for furniture, appliances, and decorations.

## Design intent

- **What "cozy" means:** Cozy is about comfort. The game should feel
  relaxing. Players should want to live in their environments with the cat,
  and go on snowy ski adventures. It should be a second home, away from the
  stress and worries of the world.

- **Progression and endgame:** Progression is open-ended, not building to a
  fixed endgame. Levels continue to rise (at a slower rate each level). New
  environments and customization keep players interested. Friend/cat/
  environment viewing is deferred to M6 (async social) per director
  decision, July 20, 2026 — v1.0 has no friend-viewing and is fully
  single-player. So: relax, ski, get creative, and love on your cat.

- **What makes Toebeans different from Stardew Valley / Animal Crossing:**
  The graphics and gameplay separate it from both. The visual target is
  graphics like *Omno*.
