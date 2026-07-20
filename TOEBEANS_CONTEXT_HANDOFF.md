CONTEXT HANDOFF — Toebeans Project
Paste this at the start of any new chat with Claude (advisor role). For Claude Code sessions, don't paste this — the repo's CLAUDE.md and ROADMAP.md are its context.

What this project is

* Toebeans — cozy low-poly 3D sim, casual multiplayer (phased in later)
* Free browser version (ad revenue via web portals like Poki/CrazyGames) markets a paid Steam version (co-op, extra content, achievements)
* Owner is non-technical and is the game director: all creative decisions (design, art approval, scope calls, what's fun) are theirs. Claude handles all technical execution. If Claude drifts into designing, the correction is: "Director call — give me 2–4 options with tradeoffs, I'll choose."

Locked decisions (do not relitigate or contradict)

* Stack: TypeScript strict + Three.js + Vite. Repo layout: /client /server /shared /assets. All game logic = pure functions in /shared on a serializable GameState; rendering never mutates state (multiplayer-proofing).
* Multiplayer is phased: single-player v1.0 first → async social (visits/gifting) as M6 → real-time co-op as the Steam headline feature (M7). Not built yet. Friend/cat/environment viewing is deferred to M6 (director decision, July 20, 2026) — v1.0 is strictly single-player.
* Steam path: Electron wrapper + steamworks.js, later. Steam store page goes live at web launch (M5) to accumulate wishlists. $100 Steam Direct fee.
* Art: low poly, .glb only, CC0 packs first, AI-gen assets only if matching a written style bible; every asset licensed in assets/CREDITS.md; props ≤2k tris. Style bible not yet written. Visual target: Omno.
* Workflow: no pull requests, ever — solo project, director reviews and approves in-session, Claude Code commits and merges straight to master. Confirmed as a standing convention (ROADMAP's M1 ski-slope entry explicitly logs a direct merge, no PR).
* Dev tool: Claude Code in the desktop app (repo lives on the owner's PC). Owner never touches a command line; anything involving accounts/credentials/payments is done by the owner clicking, with Claude preparing everything up to that point. Cloud sessions (Claude Code on the web) are also in use when the owner is away from the PC — they work directly off GitHub and commit straight to master; the local PC copy must `git pull` at the start of the next desktop session whenever a cloud session has landed work.
* Process: milestones M0 setup → M1 gray-box prototype (fun check gate) → M2 vertical slice → M3 content → M4 polish (60fps mid laptop, <15MB initial load) → M5 web launch (itch.io first, then portals) → M6 async social → M7 Steam. One feature per Claude Code session; ROADMAP.md updated every session; new ideas go to IDEAS.md, reviewed only between milestones.
* Repo access: the repo is currently PUBLIC (flipped from private on July 20, 2026, specifically so advisor Claude could read files directly instead of the owner pasting them in). Advisor Claude can now fetch CLAUDE.md, DESIGN.md, IDEAS.md, README.md, and ROADMAP.md straight from GitHub — no copy-paste needed, though the owner may still paste things ad hoc (e.g. the Director's Playbook, which lives as a Claude.ai artifact and is NOT yet committed to the repo).

Key documents the owner has

1. DIRECTORS_PLAYBOOK.md — step-by-step process doc: every step is "You decide/You do" or "Ask Claude: [copy-paste prompt]." Exists as a Claude.ai artifact only; not yet in the repo.
2. Repo files: CLAUDE.md (conventions), ROADMAP.md (session log), TOEBEANS_VISION.md (director's own vision doc — the source of truth for design if it and DESIGN.md ever disagree), DESIGN.md (working design doc restating the vision, plus the approved v1.0/v1.x/Steam scope split), IDEAS.md (one parked idea: finish line / run completion), README.md, TOEBEANS_CONTEXT_HANDOFF.md (this file).

What the game is (from DESIGN.md — decided, do not contradict)

* Core fantasy: you're a human with a pet cat (both customizable); you live in a small environment (starting as a boring bedroom) that you decorate; the cat is your best friend — pet it, pick it up, hug it.
* Core loop: ski mountain slopes (cat strapped to your back) → earn XP → level up → unlock environments/furniture/appliances/cosmetics → decorate and interact for more XP → repeat.
* Skiing: controls are left/right/up(speed up)/down(brake)/jump/crouch/boost; hazards = chasing snowballs, chasms, tree limbs (crouch is for these — not built yet); checkpoints on crash; the cat's 9 lives — lose all and the run forfeits for half XP. v1.0 slopes are handcrafted (3 of them); random-gen difficulty modes may come later. Faster finish = more XP.
* Progression: no stat upgrades ever, identical base stats for all; leveling unlocks environments (bedroom → apartment → skyrise → space shuttle, laboratory, Mars, Heaven, jungle…), furniture/customization, and cosmetics. Environments are collected, not replaced; each saves its own layout.
* Environment XP: timed-task XP from appliances/tech (grill, TV, computer, reading); passive/AFK XP from furniture (bed, couch), accruing up to 24h while the game is closed, calculated on return.
* Multiplayer (M6+, not v1.0): head-to-head slope races, leaderboards, friend visits with a 15% XP boost for both, cats socializing. Full details in DESIGN.md.
* Look & feel: low-poly cute wholesome; Sims-style rotating bird's-eye camera in environments, 2.5D isometric/three-quarter side-scroller for skiing; LOFI music + ambient audio; small detail touches (ski trails, glowing lamps, crackling fireplaces, meows).
* Design intent: cozy = comfort, a relaxing second home away from the world's stress; progression is open-ended with no fixed endgame; differentiation from Stardew/Animal Crossing comes from the graphics (Omno target) and gameplay.

v1.0 scope (locked, approved by director July 20, 2026 — see DESIGN.md "Scope: v1.0 / v1.x / Steam")

* One environment (the bedroom), 6–8 starter furniture/appliance items (at least one timed-task + one passive/AFK), furniture placement system, 3 handcrafted ski slopes with full hazard set + checkpoints + 9-lives, XP/leveling with level-gated unlocks, browser-storage save system, basic character + cat customization, music/ambient audio hookup.
* Everything else (more environments/slopes, procedural difficulty modes, environment save slots, expanded catalog, M6 async social) is v1.x. Real-time co-op, leaderboards, friend visits, and achievements are Steam-phase only.

Current status (as of end of day, July 20, 2026)

* Phase 0 (setup): DONE. Scaffold built and running. Repo `toebeans` on GitHub — now PUBLIC (was private at creation).
* Phase 1, Steps 1.1–1.2 (design): DONE. Director wrote TOEBEANS_VISION.md directly; DESIGN.md was scribed from it. Three open questions (what "cozy" means, progression/endgame shape, differentiator from Stardew/Animal Crossing) were resolved and folded into DESIGN.md's "Design intent" section. One conflict found and resolved: friend/cat/environment viewing deferred to M6, recorded in both DESIGN.md and ROADMAP.md.
* Phase 1, Step 1.3 (v1.0/v1.x/Steam scope split): DONE. Director approved the recommended cut as proposed, no adjustments. Written into DESIGN.md; ROADMAP.md got the M1→M5 milestone checklist.
* Phase 1, Step 1.4 (approve the cut): DONE — folded into the 1.3 approval above.
* Phase 1, Step 1.5 (art reference photos → style bible): NOT STARTED in the repo. Director has collected 3–5 low-poly reference screenshots (known from advisor conversation only — not yet reflected in any repo file). Deliberately deferred until M1 passes its fun check, since M1 is gray-box/placeholder-shapes only and doesn't need art direction yet. Should run as its own session before M2 begins.
* Phase 2 / M1 (prototype, in progress):
  - [x] Gray-box ski slope — DONE. `/shared/skiing.ts` (pure logic), `/client/src/skiRender.ts` (three-quarter camera, placeholder box meshes), one hazard type (3 chasms), full keyboard controls (steer/lean/jump/boost).
  - [x] Cat's 9 lives + crash/checkpoint loop — DONE. Crashing costs a life, pauses 1.5s, respawns at the last checkpoint (one just past each chasm); losing all 9 forfeits the run (on-screen message; half XP once XP exists). HUD shows the lives counter.
  - [x] Character moves around a gray-box bedroom — DONE. `/shared/bedroom.ts` (pure walking + wall/furniture collision with slide-along edges), `/client/src/bedroomRender.ts` (fixed Sims-style bird's-eye camera — rotation is an M2 item). The game now starts in the bedroom; Enter switches bedroom ↔ slope, and each trip to the slope is a fresh full-lives run (doubles as the retry after a forfeit). 24 tests passing across the suite; logic verified live in the browser by Claude Code.
  - [ ] Basic cat follows/sits in the room — NEXT queued item (director confirmed, July 20, 2026): the last M1 build item before the fun-check gate.
  - [ ] Fun check gate — not yet run. Needs the cat item built first, then a genuine 30+ minute honest playtest per the playbook's Step 2.2. Feel tuning (speeds, jump arc, pause length) belongs in that session.
  - Director has not yet personally playtested the ski slope firsthand (known from advisor conversation, not the repo) — was waiting on desktop access as of the last advisor session. This is the very next real-world action: pull latest on the PC via Claude Code, run `npm run dev`, and playtest before deciding whether to continue M1 or ask Claude Code to diagnose and offer fix options.
  - `crouch` is intentionally unbuilt — no hazard (tree limbs) exists yet for it to react to; will be added together with tree limbs rather than wired to nothing.

Facts to not hallucinate about

* Game design v1 direction is DECIDED and lives in DESIGN.md / TOEBEANS_VISION.md; do not contradict it or invent details beyond it.
* The v1.0/v1.x/Steam scope split IS decided (Step 1.3/1.4 both done and approved) — do not treat it as still open.
* Nothing is deployed anywhere; no itch.io/portal/Steam accounts exist yet. The game only runs via `npm run dev` on the owner's machine.
* No art assets are in the repo yet; no style bible yet.
* Multiplayer code does not exist yet.
* IDEAS.md has one parked idea (a finish line / run completion, needed before XP can exist — noticed during the 9-lives session). Nothing else is parked.
* README.md is current again as of July 20, 2026 (describes both gray-box scenes and their controls).
* The repo is now public — advisor Claude can read repo files directly via GitHub's raw URLs. This does not mean advisor Claude can write to the repo; commits still go through Claude Code.
* Owner time budget: up to ~3 hrs/day. Owner is picky about graphics — visual iteration happens via screenshots pasted to Claude with short direction notes.
* An unrelated prior project called "Windowsill" exists in Claude Code's memory with a "design before build" lesson; it is not part of Toebeans.
