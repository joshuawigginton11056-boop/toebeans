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
* Art: low poly, .glb only, CC0 packs first, AI-gen assets only if matching the written style bible; every asset licensed in assets/CREDITS.md; props ≤2k tris. The Art Style Bible IS written (DESIGN.md, July 21, 2026, from the director's five Omno reference images): 12-color palette, shape language, lighting/haze rules, snow-remembers rules. Visual target: Omno.
* Workflow: no pull requests, ever — solo project, director reviews and approves in-session, Claude Code commits and merges straight to master. Confirmed as a standing convention (ROADMAP's M1 ski-slope entry explicitly logs a direct merge, no PR).
* Dev tool: Claude Code in the desktop app (repo lives on the owner's PC). Owner never touches a command line; anything involving accounts/credentials/payments is done by the owner clicking, with Claude preparing everything up to that point. Cloud sessions (Claude Code on the web) are also in use when the owner is away from the PC — they work directly off GitHub and commit straight to master; the local PC copy must `git pull` at the start of the next desktop session whenever a cloud session has landed work.
* Process: milestones M0 setup → M1 gray-box prototype (fun check gate) → M2 vertical slice → M3 content → M4 polish (60fps mid laptop, <15MB initial load) → M5 web launch (itch.io first, then portals) → M6 async social → M7 Steam. One feature per Claude Code session; ROADMAP.md updated every session; new ideas go to IDEAS.md, reviewed only between milestones.
* Repo access: the repo is currently PUBLIC (flipped from private on July 20, 2026, specifically so advisor Claude could read files directly instead of the owner pasting them in). Advisor Claude can now fetch CLAUDE.md, DESIGN.md, IDEAS.md, README.md, and ROADMAP.md straight from GitHub — no copy-paste needed, though the owner may still paste things ad hoc (e.g. the Director's Playbook, which lives as a Claude.ai artifact and is NOT yet committed to the repo).

Key documents the owner has

1. DIRECTORS_PLAYBOOK.md — step-by-step process doc: every step is "You decide/You do" or "Ask Claude: [copy-paste prompt]." Exists as a Claude.ai artifact only; not yet in the repo.
2. Repo files: CLAUDE.md (conventions), ROADMAP.md (session log), TOEBEANS_VISION.md (director's own vision doc — the source of truth for design if it and DESIGN.md ever disagree), DESIGN.md (working design doc restating the vision, plus the approved v1.0/v1.x/Steam scope split and the Art Style Bible), IDEAS.md (parked ideas), README.md, assets/CREDITS.md (per-asset license ledger), TOEBEANS_CONTEXT_HANDOFF.md (this file).

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

Current status (as of July 21, 2026)

* Phase 0 (setup): DONE. Scaffold built and running. Repo `toebeans` on GitHub — now PUBLIC (was private at creation).
* Phase 1, Steps 1.1–1.4 (design + scope split): DONE. TOEBEANS_VISION.md written by the director; DESIGN.md scribed from it; three open design questions resolved; v1.0/v1.x/Steam cut approved as proposed. Friend/cat/environment viewing deferred to M6.
* Phase 1, Step 1.5 (art references → style bible): DONE (July 21, 2026). Director supplied five Omno reference images with likes/dislikes; the Art Style Bible was written into DESIGN.md: 12-color palette, shape language, lighting/haze rules, "snow remembers" rules (ski trails/footprints — the director's one explicit dislike in the references was flat depthless snow), asset sourcing rules, per-asset triangle budgets, and the CREDITS.md requirement.
* Phase 2 / M1 (gray-box prototype): COMPLETE, July 21, 2026. All build items done (gray-box slope with 3 chasms; 9 lives + crash/checkpoint loop; gray-box bedroom walk; cat follows/sits, including a route-around-furniture fix after playtest feedback). Fun check gate: director playtested and ruled **PASS, barely** — the loop justifies investing in art, but the thin margin means feel tuning (speeds, jump arc, crash pause, follow distances) stays a live concern through M2 rather than a solved problem.
* Phase 3 / M2 (vertical slice — polish ONE area end to end): IN PROGRESS.
  - Director call (July 21, 2026): the polish area is the **ski slope**; the bedroom reaches the same level in M3.
  - Director call (same day): assets from the **Quaternius Ultimate Nature Pack** (CC0, chosen from a researched shortlist).
  - [x] First real assets: 24 snow-variant models (birches, dead birches, pines, rocks, stump, log, bushes) converted to .glb by a new repo tool (`tools/obj2glb_palette.py`) that remaps every material to the bible's 12-color palette, snaps origins to base, and enforces the 2k-triangle prop budget. All 24 credited in assets/CREDITS.md. 87 instances scattered seeded-deterministically along the slope flanks; scene colors (sky, snow, chasms, checkpoints, skier blue, cat amber) aligned to the palette in both scenes.
  - Lighting/haze pass: DONE (July 21, 2026). Director playtested it: "starting to come together" — approved as-is, with picky visual tweaks deliberately deferred until all M2 items are done (one tuning pass at the end, not nibbling between features). One low warm sun with soft blue shadows (shadow color derived mathematically from the palette's two snow colors, verified by pixel-reading the rendered frame: shadowed snow lands within 1/255 of palette #2), dawn-pink distance fog, a gradient sky dome, and a visible glowing sun disc just above the horizon. Note: Three.js retired its "PCFSoft" shadow mode in r185; the bible's parenthetical was updated (soft edges now come from PCF + blur radius — same look, different knob).
  - [x] Real UI: DONE (July 21, 2026). Plain-text HUD replaced with a palette-styled DOM overlay (client/src/hud.ts): the cat's 9 lives as nine cat-face icons that fade to snow-shadow blue when spent, centered crash/forfeit banners (forfeit is the game's one signal-red panel), and keycap-chip control hints per scene. Direction defaults chosen in-session (questions went unanswered): HUD-only scope (no title screen — parked in IDEAS.md), 9 icons over icon-×-number, soft-rounded tone over Omno-minimal. A bundled rounded font (Fredoka/Baloo) is parked in IDEAS.md pending a director yes/no (requires a file download).
  - Slope sound EFFECTS: DONE (July 21, 2026) — synthesized in-browser with Web Audio (no audio files/licenses): speed-tracking wind + ski-carve hiss (silent mid-air), boost rush, and one-shots for jump/land/crash/checkpoint/respawn/forfeit; M mutes. Playtest verdict (same day): PASSED — "speed feels real now," wind is the director's favorite; one note, the carve hiss is too loud → parked in IDEAS.md for the end-of-M2 tuning pass. Music still deliberately deferred — director picks the direction (lofi vs ambient-only vs instrumental); question stays open.
  - Direction questions re-asked and answered (July 21, 2026): UI defaults — nine cat-face lives and HUD-only scope RATIFIED; visual tone CHANGED to a middle ground (cat faces stay cute, pills/chunk/panels calm down — restyle is its own upcoming session). Title screen idea evolved: it should be a *dynamic* showcase of the world (landscape, enemies, terrain, animals) as those get built — parked in IDEAS.md.
  - [ ] Remaining M2 items: UI tone restyle (middle ground), music direction + hookup, save/load, character art (skier/cat models under the assets item).
  - The cat model is the known thin spot: the pack has no cat; the Quaternius animal pack may not either (unverified). Fallback: hand-model a simple chunky cat to the bible.
  - `crouch` is intentionally unbuilt — no hazard (tree limbs) exists yet for it to react to; will be added together with tree limbs rather than wired to nothing.
  - Claude Code's browser screenshots have timed out four sessions running in this repo; logic gets verified by stepping the real modules in the live page, and rendered-look judgments go to the director's own eyes via `npm run dev`.

Facts to not hallucinate about

* Game design v1 direction is DECIDED and lives in DESIGN.md / TOEBEANS_VISION.md; do not contradict it or invent details beyond it.
* The v1.0/v1.x/Steam scope split IS decided (Step 1.3/1.4 both done and approved) — do not treat it as still open.
* Nothing is deployed anywhere; no itch.io/portal/Steam accounts exist yet. The game only runs via `npm run dev` on the owner's machine.
* Art assets DO exist in the repo now (24 CC0 .glb models in assets/slope/, all credited in assets/CREDITS.md) and the style bible IS written (DESIGN.md). XP, UI beyond a plain-text HUD, sound, and save/load still do not exist.
* Multiplayer code does not exist yet.
* IDEAS.md has two parked ideas: a finish line / run completion (needed before XP can exist), and the nature pack's ~126 unused non-snow models as future-environment dressing. Nothing else is parked.
* README.md is current again as of July 21, 2026 (describes both scenes, the slope's first real art, and the controls).
* The repo is now public — advisor Claude can read repo files directly via GitHub's raw URLs. This does not mean advisor Claude can write to the repo; commits still go through Claude Code.
* Owner time budget: up to ~3 hrs/day. Owner is picky about graphics — visual iteration happens via screenshots pasted to Claude with short direction notes.
* An unrelated prior project called "Windowsill" exists in Claude Code's memory with a "design before build" lesson; it is not part of Toebeans.
