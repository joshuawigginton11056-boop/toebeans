# Slope Direction — The Branching Map

_Director description, 2026-07-24. **Status: a new slope direction, NOT yet
reconciled with the current three-linear-slopes model in
[DESIGN.md](DESIGN.md#the-handcrafted-slopes--slope-1-the-overlook-scenic-showcase).**
Captured faithfully here so we can build against it session to session; the open
questions in §7 are the director's to resolve before this rewrites DESIGN.md._

A visual version of this concept exists as an Artifact:
https://claude.ai/code/artifact/0ee5c116-41f5-4cc7-b742-444d637cbe93

---

## 1. The idea in one breath

Instead of multiple separate tracks, a slope is **one continuous map with many
branching opportunities**, skied summit-to-flag as the sun sets (cat on your back,
as always). At certain points the **world reaches out and grabs you** into a detour
world — a tree swallows you, a yeti smashes a hole in a frozen lake, a penguin
swoops in to carry you underwater — then returns you to the mountain at roughly the
**same point in time** you'd have reached anyway. One map, many outcomes, so it
never feels dry: freshness comes from **discovery** first (you don't know a world
exists until it eats you), then **mastery** (learning the clean line into each one).

## 2. The two kinds of branch

- **Type A — detour that rejoins.** Leaves the mountain and returns to the **same
  world-position** at the **same elapsed time**. Cosmetic + collectibles, no lasting
  route change. (Tree, Frozen Lake.)
- **Type B — route split.** A genuine fork that does **not** reunite until the flag.
  Only **same total route time** applies, for fairness. (Yeti's Peak.) Keep Type B
  rare — each is a whole alternate segment to build and time-balance. Currently one.

## 3. The one law everything obeys

> **Same clock, same flag.** Every detour returns you to the same point at ~the same
> time; every full route from summit to flag takes the **same total time**. No line is
> faster — so a friend-race is never won by routing, only by skiing cleaner and
> crashing less. The bird flies at exactly ski speed; no world is a shortcut.

## 4. The map (topology)

Read as a resort trail map: sunset at the summit, flag in the valley.

```
                 START · SUMMIT  (shared, sunset)
                        |
                 ENCHANTED FOREST — Fork 1 (Type A)
                   |            \
                (road)       tree world → tallest tree → bird → back to road
                   |            /
                 FROZEN LAKE — Fork 2 (Type A)   [yeti smashes a hole]
                   |            \
             (around hole)   into hole → drivable penguin → underwater
                   |             penguin castle → back on normal trail ↘
                   |                                                     ↘
                 YETI'S PEAK — Fork 3 (Type B, splits to the flag)        ↘
                   /                         \                             |
        through: CAVE                  around: LEDGE (yeti's son           |
              |                          shoves you — NO life lost)        |
        main road: friend  ←────────────  steep VALLEY                     |
        surfaces from lake                    |                            |
              |                            ICE CASTLE                      |
        CLIFF jump  ←──────────────────────────┘                          |
              |    ↖________ lake route merges into the cliff line ________|
            FINISH  (all routes reconverge, ~same clock)
```

**Only three full routes to time-balance** (the tree detour is a same-time no-op on
any of them):
1. **Ice Line** — summit → forest → around lake → ledge → valley → ice castle → flag.
   _Riskiest feel; runs blind to the finish (no friend contact until the flag)._
2. **Cave Line** — summit → forest → around lake → cave → road → cliff → flag.
   _The reunion route; you meet your friend surfacing from their lake run._
3. **Water Line** — summit → forest → into lake → penguin castle → road → cliff → flag.

## 5. Fork-by-fork

**0 · Summit Descent (shared).** Both skiers drop in together down the first mountain
as the sun sets, then glide into the enchanted forest as it goes dark. No choice yet.

**1 · Enchanted Forest — Type A.** Trigger: hit a specific great tree; it swallows you.
- _Into the tree:_ ~8s in a world of animals → out the tallest tree → drop into a bird
  and fly it down. Fly too long and it lands you on the road anyway.
- _Stay on the road:_ you reach the far tree the moment the tree-taker's bird lands.
- _Exclusive reward:_ forest animals + achievement.

**2 · Frozen Lake — Type A.** Trigger: a yeti hoists a boulder and smashes a hole
through the ice in front of you.
- _Into the hole:_ a drivable penguin swoops in → underwater world → sunken penguin
  castle → surface back on the normal trail (feeds toward the cliff line).
- _Around the hole:_ skirt the gap, press on to Yeti's Peak.
- _Exclusive reward:_ penguin-castle collectibles.

**3 · Yeti's Peak — Type B (splits to the flag).** Through the mountain, or around it.
- _Through — the cave:_ pop out on the main road, watch your friend surface from their
  lake run, reunite, jump the cliff to the flag together.
- _Around — the ledge:_ the tight ledge; slow down and the yeti's son shoves you off —
  **no life lost** — down the steep face into the valley, through the Ice Castle, to
  the flag.
- _Exclusive reward:_ ice-castle collectibles — the reason to run it blind.

## 6. How it maps onto existing Toebeans systems

- **Cat's nine lives — unchanged.** Hitting a wall costs a life; run out and you
  forfeit (half XP), exactly as today.
- **Respawn = checkpoint.** A world's entrance acts as a checkpoint: crash inside a
  world and you restart at its entrance at base speed (matches "back to the last
  checkpoint"). Low-stakes worlds are what make players brave enough to go in.
- **Shove ≠ crash (NEW rule).** Hazards that only reposition you (the yeti's son) cost
  **no life** — they're the world routing you. Only hitting a wall costs a life.
- **XP / time — compatible.** Since every route is the same length, time-based XP stays
  fair across branches. XP-per-surviving-life (finish rich → level faster) fits the
  existing "identical base stats, greatness through levels" model.
- **Friend-race = the later-phase multiplayer**, not v1.0. The "survival duel, diverge-
  then-reveal" framing is a strong addition to the already-planned head-to-head races
  (crash respawns you behind, forfeit on nine lives, winner/loser XP). Single-player
  here is discovery + collection.

## 7. Open reconciliation (director's call — resolve before this rewrites DESIGN.md)

1. **Branching map vs. three linear slopes.** ROADMAP already frames "The Overlook"
   as the **onboarding run** and this branching map as **"the actual map"** (the next
   slope-mechanics job) — so those two coexist. The remaining question is the wider
   plan: does the branching map become the **template all slopes** follow (each slope
   its own branching world-set), or is there **one** big branching map plus linear
   others? This decides how Slopes 2–3 and the escalation model are structured.
2. **Reusing the in-flight Overlook mechanics.** The straight-slope work (finite
   track, `slopePath.ts` centerline, turning/feel, spray) is reusable groundwork —
   the branching map is a routing/handoff layer on top of the same skiing sim. Confirm
   we build branching *on* that foundation, not instead of it.
3. **Friend-race timing.** The design leans on racing a friend, but v1.0 is single-
   player (MP is a later phase). Confirm: v1.0 branching map is solo (discovery/
   collection), race lands with the MP phase.
4. **Collectibles + Steam achievements = a new reward layer.** Not in the current XP
   model, and Steam is a later phase. Decide how world-exclusive collectibles relate
   to XP/leveling, and whether achievements wait for the Steam version.
5. **Same-clock authoring cost.** Keeping three routes the same length is the real
   balancing job; only provable by grayblocking timings.

## 8. Build note (do not build yet)

When it's greenlit: grayblock only, and **prove "same clock, same flag" with ONE Type
A fork** (the tree) before building the rest — trigger volume → swap into a detour
segment → exit onto the spine at the same world-position + same elapsed time. That
handoff is the riskiest system in the whole concept; de-risk it first, reusing the
existing skiing sim and `slopePath.ts` centerline. Then the lake (Type A), then Yeti's
Peak (Type B). Multiplayer, collectibles/achievements, and art come after a solid solo
run exists.
