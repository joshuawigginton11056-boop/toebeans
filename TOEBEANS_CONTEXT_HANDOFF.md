CONTEXT HANDOFF — Toebeans Project
Paste this at the start of any new chat with Claude (advisor role). For Claude Code sessions, don't paste this — the repo's CLAUDE.md and ROADMAP.md are its context.
What this project is

* Toebeans — cozy low-poly 3D sim, casual multiplayer (phased in later)
* Free browser version (ad revenue via web portals like Poki/CrazyGames) markets a paid Steam version (co-op, extra content, achievements)
* Owner is non-technical and is the game director: all creative decisions (design, art approval, scope calls, what's fun) are theirs. Claude handles all technical execution. If Claude drifts into designing, the correction is: "Director call — give me 2–4 options with tradeoffs, I'll choose."

Locked decisions (do not relitigate or contradict)

* Stack: TypeScript strict + Three.js + Vite. Repo layout: /client /server /shared /assets. All game logic = pure functions in /shared on a serializable GameState; rendering never mutates state (multiplayer-proofing).
* Multiplayer is phased: single-player v1.0 first → async social (visits/gifting, Colyseus/Node) → real-time co-op as the Steam headline feature. Not built yet.
* Steam path: Electron wrapper + steamworks.js, later. Steam store page goes live at web launch (M5) to accumulate wishlists. $100 Steam Direct fee.
* Art: low poly, .glb only, CC0 packs (Quaternius/Kenney) first, AI-gen assets only if matching a written style bible; every asset licensed in assets/CREDITS.md; props ≤2k tris. Style bible not yet written.
* Dev tool: Claude Code in the desktop app (not terminal). Owner never touches a command line; anything involving accounts/credentials/payments is done by the owner clicking, with Claude preparing everything up to that point.
* Process: milestones M0 setup → M1 gray-box prototype (fun check gate) → M2 vertical slice → M3 content → M4 polish (60fps mid laptop, <15MB initial load) → M5 web launch (itch.io first, then portals) → M6 async social → M7 Steam. One feature per Claude Code session; ROADMAP.md updated every session; new ideas go to IDEAS.md, reviewed only between milestones.

Key documents the owner has

1. DIRECTORS_PLAYBOOK.md — step-by-step: every step is "You decide/You do" or "Ask Claude: [copy-paste prompt]". This is the master process doc.
2. Repo files: CLAUDE.md (conventions), ROADMAP.md (session log), TOEBEANS_VISION.md (owner's vision doc — covers fantasy/setting and core loop), DESIGN.md (drafted from the vision doc, partially complete — see below), IDEAS.md (empty), README.md, TOEBEANS_CONTEXT_HANDOFF.md (this file).

Current status (as of July 20, 2026)

* Phase 0 (setup): DONE. Repo at C:\Users\joshu\Toebeans, scaffold built and running, walkable gray-box, a render-timing bug already found/fixed.
* GitHub: DONE. Repo `toebeans` pushed to GitHub and set to private (it was briefly public; fixed July 20). Git Credential Manager login complete; Claude Code pushes after every commit. Because the repo is private, advisor Claude cannot fetch files from it — paste or upload file contents into chat instead.
* Phase 1, Step 1.1 (design interview): IN PROGRESS. The owner wrote TOEBEANS_VISION.md, which answers the fantasy/setting and core-loop questions. Claude Code drafted DESIGN.md from it. Three interview questions remain unanswered; the one confirmed verbatim is: "What does 'cozy' mean to you for this game — beyond the low-poly/LOFI/warm-colors aesthetic, what's the feeling you're chasing? Safety, slowness, control, nostalgia, something else?" The other two open questions are recorded in ROADMAP.md (likely from the original interview list: progression, differentiation from Stardew/Animal Crossing).
* End-of-session cleanup (July 20): duplicate untracked file `TOEBEANS_CONTEXT_HANDOFF (1).md` deleted; DESIGN.md draft committed and pushed; ROADMAP.md updated with remaining questions. (If any of these didn't actually complete, verify git status in the next Claude Code session before proceeding.)
* Next step: New Claude Code session finishes Step 1.1 — asks the remaining interview questions one at a time, writes the OWNER'S answers into DESIGN.md (Claude is scribe, not designer). Then Step 1.3: Claude proposes a v1.0/v1.x/Steam scope split with build-cost estimates; owner approves the cut; ROADMAP.md gets milestone checklists. Then Step 1.5: owner brings 3–5 reference screenshots → art style bible written into DESIGN.md.
* Advisor review pending: DESIGN.md draft has not yet been reviewed by advisor Claude for faithfulness to the vision doc (checking Claude Code didn't sneak in design decisions). Owner should paste DESIGN.md + TOEBEANS_VISION.md into an advisor chat for this.

Facts to not hallucinate about

* Game design is PARTIALLY decided: TOEBEANS_VISION.md covers fantasy/setting and core loop; everything not in the vision doc or DESIGN.md is UNDECIDED. Do not invent answers to the open interview questions.
* Nothing is deployed anywhere; no itch.io/portal/Steam accounts exist yet.
* No art assets are in the repo yet; no style bible yet.
* Multiplayer code does not exist yet.
* Owner time budget: up to ~3 hrs/day. Owner is picky about graphics — visual iteration happens via screenshots pasted to Claude with short direction notes.
* An unrelated prior project called "Windowsill" exists in Claude Code's memory with a "design before build" lesson; it is not part of Toebeans.
