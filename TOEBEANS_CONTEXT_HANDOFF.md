# CONTEXT HANDOFF — Toebeans Project
*Paste this at the start of any new chat with Claude (advisor role). For Claude Code sessions, don't paste this — the repo's CLAUDE.md and ROADMAP.md are its context.*

## What this project is
- **Toebeans** — cozy low-poly 3D sim, casual multiplayer (phased in later)
- Free browser version (ad revenue via web portals like Poki/CrazyGames) markets a paid Steam version (co-op, extra content, achievements)
- Owner is non-technical and is the **game director**: all creative decisions (design, art approval, scope calls, what's fun) are theirs. Claude handles all technical execution. If Claude drifts into designing, the correction is: "Director call — give me 2–4 options with tradeoffs, I'll choose."

## Locked decisions (do not relitigate or contradict)
- **Stack:** TypeScript strict + Three.js + Vite. Repo layout: /client /server /shared /assets. All game logic = pure functions in /shared on a serializable GameState; rendering never mutates state (multiplayer-proofing).
- **Multiplayer is phased:** single-player v1.0 first → async social (visits/gifting, Colyseus/Node) → real-time co-op as the Steam headline feature. Not built yet.
- **Steam path:** Electron wrapper + steamworks.js, later. Steam store page goes live at web launch (M5) to accumulate wishlists. $100 Steam Direct fee.
- **Art:** low poly, .glb only, CC0 packs (Quaternius/Kenney) first, AI-gen assets only if matching a written style bible; every asset licensed in assets/CREDITS.md; props ≤2k tris. Style bible not yet written.
- **Dev tool:** Claude Code in the **desktop app** (not terminal). Owner never touches a command line; anything involving accounts/credentials/payments is done by the owner clicking, with Claude preparing everything up to that point.
- **Process:** milestones M0 setup → M1 gray-box prototype (fun check gate) → M2 vertical slice → M3 content → M4 polish (60fps mid laptop, <15MB initial load) → M5 web launch (itch.io first, then portals) → M6 async social → M7 Steam. One feature per Claude Code session; ROADMAP.md updated every session; new ideas go to IDEAS.md, reviewed only between milestones.

## Key documents the owner has
1. **DIRECTORS_PLAYBOOK.md** — step-by-step: every step is "You decide/You do" or "Ask Claude: [copy-paste prompt]". This is the master process doc.
2. Repo files (created): CLAUDE.md (conventions), ROADMAP.md (session log), DESIGN.md (EMPTY — by design), IDEAS.md (empty), README.md.

## Current status (as of July 19, 2026)
- **Phase 0 (setup): DONE.** Repo at C:\Users\joshu\Toebeans, scaffold built and running, walkable gray-box, a render-timing bug already found/fixed. 2 local commits.
- **In progress:** pushing to a new private GitHub repo (`toebeans`) — owner was creating the GitHub account/repo and completing the one-time Git Credential Manager browser login; Claude Code then adds the remote and pushes after every commit.
- **Next step: Phase 1, Step 1.1** — Claude Code interviews the owner one question at a time (setting, core loop, meaning of "cozy", progression, differentiation from Stardew/Animal Crossing) and writes THEIR answers into DESIGN.md. Claude is scribe, not designer. Then Step 1.3: Claude proposes a v1.0/v1.x/Steam scope split with build-cost estimates; owner approves the cut; ROADMAP.md gets milestone checklists. Then Step 1.5: owner brings 3–5 reference screenshots → art style bible written into DESIGN.md.
- **No game design exists yet.** Do not invent setting, mechanics, or loop details — those come from the owner's interview answers.

## Facts to not hallucinate about
- The game content/mechanics are UNDECIDED (DESIGN.md is intentionally empty).
- Nothing is deployed anywhere; no itch.io/portal/Steam accounts exist yet.
- No art assets are in the repo yet; no style bible yet.
- Multiplayer code does not exist yet.
- Owner time budget: up to ~3 hrs/day. Owner is picky about graphics — visual iteration happens via screenshots pasted to Claude with short direction notes.
- An unrelated prior project called "Windowsill" exists in Claude Code's memory with a "design before build" lesson; it is not part of Toebeans.
