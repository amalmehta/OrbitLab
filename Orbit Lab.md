PROJECT NAME: Orbit Lab

META-INSTRUCTIONS:

<Read it all before acting. Ask about anything unclear, contradictory or
 underspecified — before starting and mid-build. Ask in the question widget
 (AskUserQuestion): related questions batched, concrete options, your
 recommendation first. Plain text only if the widget isn't available.>

<Don't expand scope. Anything not listed here is a proposal, including changes
 to this file — propose it, don't do it.>

<Prefer doing over describing: run the code, write the files, test it.>

<Always in scope, no proposal needed: when it goes on GitHub, a README that is
 easy to read at a glance — a line on what it is, then clear visuals
 (screenshots, a diagram or a chart), then links. Everything else goes in
 linked files: docs/INSTRUCTIONS.md (setup, run, use),
 docs/SYSTEM-DESIGN.md (see below) and docs/FILE-STRUCTURE.md (what's where). If what you're
 building is an application rather than a script, also a small unobtrusive feedback tab, and a settings
 button or tab (⌘, on the Mac) that gathers its preferences in one place.>

<If what you're building is an application, build it as a Mac app first; the
 website comes after, as its own step.>

<Name things the way a person would say them — "Goal Tracker", not
 goal_tracker — for the app, its windows, titles, files people open, repo
 descriptions and README headings. When you create the GitHub repo, name it
 with no "_" or "-": one word or joined words, e.g. GoalTracker.>

<Always in scope: a system design doc in the codebase, docs/SYSTEM-DESIGN.md,
 kept current as the build changes. Cover the architecture (with a Mermaid
 diagram), each component's job, the main flows, where data lives, the key
 design decisions and their trade-offs, how it's tested, and known limits.>

<Finish by listing every deliverable: path, what it is, how to check it works.>

<Git rules (no Claude attribution, never commit .claude/) are in
 ~/.claude/CLAUDE.md and apply on their own — nothing to repeat here.>

<Keep the changelog at the bottom current.>

CONTEXT:

A three.js sandbox for orbital mechanics where you plan Hohmann transfers, gravity assists and rendezvous burns, then watch an RL agent learn to dock with a station.

It combines their rocket-building interest, their three.js work and their RL control experience from the drone and driving sims.

DELIVERABLES:

<What you want at the end: the app, files, links. One per line.>

- build/Orbit Lab.app — the Mac app (build with `npm run mac`)
- web/ — the three.js app the Mac app runs (also runs in a browser with `npm run dev`)
- web/assets/pretrained-docking.json — pretrained PPO docking agent
- tests/ — physics, planner and RL tests (`npm test`)
- README.md, docs/INSTRUCTIONS.md, docs/SYSTEM-DESIGN.md, docs/FILE-STRUCTURE.md
- https://github.com/amalmehta/OrbitLab — public repo
- https://amalmehta.github.io/OrbitLab/ — the website (GitHub Pages, deployed by .github/workflows/pages.yml)

OPEN QUESTIONS / ASSUMPTIONS:

<Agent fills in: what it guessed, what it decided without asking.>

Asked and answered (2026-10-06): Mac shell = Swift + WKWebView; RL agent trains live in the app and ships pretrained; world = Earth + Moon + station; public GitHub repo OrbitLab.

Decided without asking:
- Physics: restricted three-body in Earth's equatorial frame (Earth fixed, Moon on a circular orbit tilted 18.3°–28.6°, default 28°), RK4, impulsive burns. No lunar eccentricity or node precession, Sun, J2 or drag.
- Out-of-plane maneuvers (asked and answered 2026-10-06): Hohmann splits the plane change optimally between its two burns; the lunar flyby picks the parking orbit's node to contain the Moon's arrival position and solves burn time + node together; rendezvous does a separate plane-change burn where the planes cross, then plans coplanar.
- Gravity assist: you choose which side of the Moon to pass, not "gain/lose energy". Arriving near apogee, both sides gain energy, so the panel reports the true change. A hotter TLI (about 1.3×) plus a leading-side pass loses energy.
- Rendezvous delivers the chaser 40 m behind the docking port, at rest, which is where the docking agent takes over.
- Docking: Clohessy–Wiltshire dynamics, translation only, 3-axis thrust up to 0.04 m/s², soft dock = within 0.5 m at under 0.25 m/s. Starts 15–50 m out in a 35° cone.
- RL: PPO written from scratch (no ML library), so it runs the same in Node and in a Web Worker.
- Feedback is saved locally (Mac: ~/Library/Application Support/Orbit Lab/feedback.jsonl) with an "Open as GitHub issue" button. Nothing is sent automatically.
- Planet textures are procedural (no image files), because WebGL can't load file:// images inside WKWebView.
- Dark theme only. Bundle id com.amalmehta.orbitlab. Not notarized (ad-hoc signed for local use).

Proposals (not done; say the word):
- Lunar eccentricity and node precession.
- Combining the rendezvous plane change with the transfer burn, and over-the-pole lunar flybys.

CHANGELOG:

- 2026-10-06 — created
- 2026-09-15 — added meta-instruction: built-out applications include a small feedback tab
- 2026-09-15 — added meta-instruction: no "Claude" attribution in commits, PRs, or branches
- 2026-09-16 — added meta-instruction: always include a README when adding to GitHub
- 2026-09-16 — changed meta-instruction: ask clarifying questions in the question widget
- 2026-09-17 — added meta-instructions: Claude never a contributor; never commit .claude/
- 2026-09-26 — compressed the meta-instructions and every field prompt; git rules moved to the global instruction file
- 2026-09-27 — added meta-instruction: applications are built as a Mac app first, then a website
- 2026-09-28 — folded inputs, instructions, constraints, deliverables and done criteria into one free-form CONTEXT
- 2026-09-28 — changed meta-instruction: a README on GitHub always includes a visual
- 2026-09-28 — added meta-instruction: name things like a person would, never snake_case
- 2026-09-28 — changed meta-instruction: README leads with visuals; instructions live in a linked guide
- 2026-09-28 — changed meta-instruction: README is visuals and links; details in docs/INSTRUCTIONS.md and docs/FILE-STRUCTURE.md
- 2026-09-29 — changed meta-instruction: GitHub repo names have no "_" or "-"
- 2026-10-02 — added a DELIVERABLES field after CONTEXT
- 2026-10-02 — added meta-instruction: every project has a system design doc at docs/SYSTEM-DESIGN.md
- 2026-10-05 — added meta-instruction: applications include a settings button or tab
- 2026-10-06 — built v1.0: Mac app with Hohmann, gravity-assist and rendezvous planners, plus a live-training PPO docking agent; docs, tests, GitHub repo
- 2026-10-06 — website step: published to GitHub Pages via a build-and-deploy workflow
- 2026-10-06 — trained docking agents are saved between launches (Mac app and website), with a setting to turn it off
- 2026-10-06 — lunar inclination (equatorial frame, Moon tilt slider) and out-of-plane maneuvers in all three planners
