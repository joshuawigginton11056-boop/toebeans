CONTEXT HANDOFF — Toebeans Project
Paste this at the start of any new chat with Claude (advisor role). For Claude Code sessions, don't paste this — the repo's CLAUDE.md and ROADMAP.md are its context.
What this project is

* Toebeans — cozy low-poly 3D sim, casual multiplayer (phased in later)
* Free browser version (ad revenue via web portals like Poki/CrazyGames) markets a paid Steam version (co-op, extra content, achievements)
* Owner is non-technical and is the game director: all creative decisions (design, art approval, scope calls, what's fun) are theirs. Claude handles all technical execution. If Claude drifts into designing, the correction is: "Director call — give me 2–4 options with tradeoffs, I'll choose."

Locked decisions (do not relitigate or contradict)

* Stack: TypeScript strict + Three.js + Vite. Repo layout: /client /server /shared /assets. All game logic = pure functions in /shared on a serializable GameState; rendering never mutates state (multiplayer-proofing).
* Multiplayer is phased: single-player v1.0 first → async social (visits/gifting, Colyseus/Node) → real-time co-op as the Steam headline feature. Not built yet. Friend/cat/environment viewing is deferred to M6 (director decision, July 20, 2026) — v1.0 is strictly single-player.
* Steam path: Electron wrapper + steamworks.js, later. Steam store page goes live at web launch (M5) to accumulate wishlists. $100 Steam Direct fee.
* Art: low poly, .glb only, CC0 packs (Quaternius/Kenney) first, AI-gen assets only if matching a written style bible; every asset licensed in assets/CREDITS.md; props ≤2k tris. Style bible not yet written. Visual target: Omno.
* Dev tool: Claude Code in the desktop app (repo lives on the owner's PC at C:\Users\joshu\Toebeans). Owner never touches a command line; anything involving accounts/credentials/payments is done by the owner clicking, with Claude preparing everything up to that point. Cloud sessions (Claude Code on the web) are also in use when the owner is away from the PC — they clone fresh from GitHub and are instructed to commit directly to master (no branches/PRs); the local PC copy must `git pull` at the start of the next desktop session.
* Process: milestones M0 setup → M1 gray-box prototype (fun check gate) → M2 vertical slice → M3 content → M4 polish (60fps mid laptop, <15MB initial load) → M5 web launch (itch.io first, then portals) → M6 async social → M7 Steam. One feature per Claude Code session; ROADMAP.md updated every session; new ideas go to IDEAS.md, reviewed only between milestones.

Key documents the owner has

1. DIRECTORS_PLAYBOOK.md — step-by-step: every step is "You decide/You do" or "Ask Claude: [copy-paste prompt]". This is the master process doc.
2. Repo files: CLAUDE.md (conventions), ROADMAP.md (session log), TOEBEANS_VISION.md (director's vision doc — the source of truth for design), DESIGN.md (complete v1 design doc, restates the vision + "Design intent" section with the director's interview answers), IDEAS.md, README.md, TOEBEANS_CONTEXT_HANDOFF.md (this file).

What the game is (from DESIGN.md — decided, do not contradict)

* Core fantasy: you're a human with a pet cat (both customizable); you live in a small environment (starting as a boring bedroom) that you decorate; the cat is your best friend — pet it, pick it up, hug it.
* Core loop: ski mountain slopes (cat strapped to your back) → earn XP → level up → unlock environments/furniture/appliances/cosmetics → decorate and interact for more XP → repeat.
* Skiing: simple controls (left/right/up/down/jump/crouch/boost); hazards = chasing snowballs, chasms, tree limbs; checkpoints on crash; the cat's 9 lives — lose all and the run forfeits for half XP. v1.0 slopes are handcrafted (random-gen difficulty modes maybe later). Faster finish = more XP.
* Progression: no stat upgrades ever, identical base stats for all; leveling unlocks environments (bedroom → apartment → skyrise → space shuttle, laboratory, Mars, Heaven, jungle…), furniture/customization, and cosmetics. Environments are collected, not replaced; each saves its layout.
* Environment XP: timed-task XP from appliances/tech (grill, TV, computer, reading); passive/AFK XP from furniture (bed, couch), accruing up to 24h while the game is closed.
* Multiplayer (M6+, not v1.0): head-to-head slope races, leaderboards, friend visits with a 15% XP boost for both, cats socializing. Full details in DESIGN.md.
* Look & feel: low-poly cute wholesome; Sims-style bird's-eye camera in environments, 2.5D isometric side-scroller for skiing (two rendering modes — a known cost driver); LOFI music + ambient audio; small detail touches (ski trails, glowing lamps, crackling fireplaces, meows).
* Design intent: cozy = comfort, a relaxing second home away from the world's stress; progression is open-ended with no fixed endgame; differentiation from Stardew/Animal Crossing comes from the graphics (Omno target) and gameplay.

Current status (as of end of day, July 20, 2026)

* Phase 0 (setup): DONE. Scaffold built and running, walkable gray-box, render-timing bug fixed. Repo `toebeans` on GitHub, private, in sync with the PC copy as of the last desktop session (cloud sessions have since committed to master — next desktop session must pull first).
* Phase 1, Step 1.1 (design interview): DONE. All interview questions answered; director confirmed the "Design intent" section is accurate. Advisor review of DESIGN.md vs. the vision doc: complete, passed — faithful restatement, no designer drift, one conflict found and resolved (friend-viewing → M6, recorded in DESIGN.md and ROADMAP.md).
* Next step: Phase 1, Step 1.3 — Claude proposes a v1.0/v1.x/Steam scope split with build-cost estimates; owner approves the cut; ROADMAP.md gets milestone checklists. Known open quantities that Step 1.3 must propose as options with tradeoffs (director chooses): number of v1.0 handcrafted slopes, number of v1.0 environments (the environment list is open-ended), rough furniture/cosmetic item counts. Expect the dual camera/rendering modes to be a major cost line.
* Then Step 1.5: owner brings 3–5 reference screenshots → art style bible written into DESIGN.md (Omno is the stated visual target).
* Noted for IDEAS.md / M6: v1.0 saves live in browser storage (clearing cache wipes the save); cloud saves need accounts and pair naturally with M6.

Facts to not hallucinate about

* Game design v1 direction is DECIDED and lives in DESIGN.md / TOEBEANS_VISION.md; do not contradict it or invent details beyond it. The v1.0/v1.x/Steam scope split is NOT yet decided — that's Step 1.3.
* Nothing is deployed anywhere; no itch.io/portal/Steam accounts exist yet.
* No art assets are in the repo yet; no style bible yet.
* Multiplayer code does not exist yet.
* The repo is private: advisor Claude cannot fetch files from GitHub — the owner pastes or uploads file contents into chat instead.
* Owner time budget: up to ~3 hrs/day. Owner is picky about graphics — visual iteration happens via screenshots pasted to Claude with short direction notes.
* An unrelated prior project called "Windowsill" exists in Claude Code's memory with a "design before build" lesson; it is not part of Toebeans.
