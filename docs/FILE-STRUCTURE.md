# Orbit Lab: What's Where

```
Orbit Lab/
├── README.md                     Screenshots and links
├── Orbit Lab.md                  Project brief, deliverables, assumptions, changelog
├── package.json                  npm scripts: dev, build, test, train, mac
├── .github/workflows/pages.yml   Builds web/ and publishes the website to GitHub Pages
├── docs/
│   ├── INSTRUCTIONS.md           Setup, run, use
│   ├── SYSTEM-DESIGN.md          Architecture, flows, decisions, limits
│   ├── FILE-STRUCTURE.md         This file
│   └── images/                   README screenshots (made by scripts/screenshots.mjs)
├── mac/
│   ├── Sources/main.swift        App entry point
│   ├── Sources/AppDelegate.swift Window, WKWebView, menus, ⌘, settings, storage and feedback bridge
│   ├── Info.plist                Bundle metadata (name, identifier, icon)
│   └── MakeIcon.swift            Draws the app icon at build time
├── scripts/
│   ├── build-web.mjs             esbuild bundle → web/dist/app.js (workers inlined); --serve for dev
│   ├── build-mac.sh              Builds build/Orbit Lab.app
│   ├── train-docking.mjs         Trains the docking agent in Node and saves the checkpoint
│   └── screenshots.mjs           Captures README screenshots in headless Chrome
├── tests/
│   ├── physics.test.mjs          Hohmann numbers, energy conservation, burns, impacts
│   ├── planners.test.mjs         Each planner, flown in the full model
│   └── rl.test.mjs               Backprop gradient check, environment, PPO learns, pretrained agent
└── web/
    ├── index.html                Layout: top bar, side panels, viewport, feedback tab, settings sheet
    ├── styles.css                All styling
    ├── assets/pretrained-docking.json   Shipped docking policy (actor and critic weights)
    └── src/
        ├── main.js               Wires scenarios, scenes, clock, panels and keyboard together
        ├── dockingController.js  Docking mode: training worker, replays, hand-over
        ├── physics/
        │   ├── constants.js      Earth and Moon constants (km, s)
        │   ├── orbits.js         Vector maths, Hohmann, orbital elements, Moon ephemeris
        │   ├── propagator.js     RK4 restricted three-body integrator, impulsive burns
        │   └── flight.js         A flight in progress: time, burns, trail, predicted path
        ├── planners/
        │   ├── hohmann.js        Two-burn transfer between circular orbits
        │   ├── gravityAssist.js  Searches the TLI burn time for a target lunar flyby
        │   └── rendezvous.js     Phasing wait, Newton-targeted transfer, matching burn
        ├── rl/
        │   ├── mlp.js            Small neural network with backprop and Adam
        │   ├── dockingEnv.js     Clohessy–Wiltshire docking environment and reward
        │   ├── ppo.js            PPO agent, trainer and evaluation
        │   └── trainer.worker.js Runs training off the main thread
        ├── scene/
        │   ├── orbitScene.js     Earth–Moon 3D view, paths, markers, labels
        │   ├── dockingScene.js   Station, capsule, thruster plumes, trails
        │   ├── bodies.js         Earth, Moon, atmosphere, stars, markers
        │   ├── textures.js       Procedural planet textures (pure functions)
        │   └── textures.worker.js Paints textures off the main thread
        └── ui/
            ├── settings.js       All preferences and the Settings sheet
            ├── feedback.js       Feedback tab
            ├── chart.js          Training success chart
            └── bridge.js         Mac app ↔ page messages and storage fallback
```

Generated and not committed: `web/dist/` (bundle), `build/` (Mac app), `node_modules/`.
