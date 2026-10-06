# Orbit Lab: Setup, Run, Use

## Setup

You need macOS 13 or later, the Xcode command line tools (`xcode-select --install`), and Node.js 18 or later.

```bash
npm install
```

## Run the Mac app

```bash
npm run mac
open "build/Orbit Lab.app"
```

`npm run mac` bundles the web code, compiles the Swift shell, draws the icon and puts **Orbit Lab.app** in `build/`. Drag it to Applications if you want to keep it.

## Use the website

Open **https://amalmehta.github.io/OrbitLab/**. It's the same app as the Mac version. In a browser, settings and feedback are kept in local storage, and the gear button opens Settings (some browsers keep ⌘, for themselves).

The site rebuilds and redeploys automatically on every push to `main` (see `.github/workflows/pages.yml`). To redeploy by hand: GitHub ▸ Actions ▸ Website ▸ Run workflow.

## Run in a browser (for development)

```bash
npm run dev
```

Then open http://localhost:8123. The bundle rebuilds itself when you save a file.

## Using it

Pick a scenario from the tabs at the top (or press ⌘1–⌘4 in the app, 1–4 in a browser).

### Hohmann Transfer
Set a start and target altitude and inclination. Presets: **Cape Canaveral / Baikonur / Kourou** for the start tilt, and **Space station / GPS / Geostationary** for the target (altitude and tilt together). If the inclinations differ, the plan splits the tilt between the two burns and shows how much that saves over a separate plane change. The plan updates as you drag. The cyan line is the predicted path and the red dots are the burns. Press **Fly it** to watch it happen; the orange line is where the craft has actually been.

### Gravity Assist
Choose a parking orbit (altitude and inclination), how close to pass the Moon, which side to pass on, how energetic the trans-lunar burn is, and how tilted the Moon's orbit is (18.3°–28.6°; the tilt applies to every scenario). Press **Find flyby**. The planner picks your parking orbit's node so the Moon is in its plane when you arrive, then searches for the moment to fire. The panel shows the flyby's speed, turn angle, how much energy it gave or took, and how much it tilted your orbit. If the parking inclination is lower than the Moon's angle from the equator at arrival, it tells you how high to go. Arriving at apogee, a pass on either side gains energy. To find a flyby that *loses* energy, raise the burn energy to about 1.3× and pass **in front of** the Moon.

### Rendezvous
Set your altitude, the station's altitude, how far ahead the station is, both inclinations, and the station's node offset. If the planes differ, the plan starts with a plane-change burn where they cross. It then shows how long to wait for the phase angle to line up, and the transfer and matching burns. Press **Fly it**. When you arrive 40 m behind the docking port, press **Hand over to the docking agent →**.

### Docking Agent
A small neural network flies the last 15–50 m to the docking port.
- **Train**: learns live using PPO in a background thread. Replays use the latest policy, and faded lines show earlier attempts. Starting from scratch, it usually docks most of the time after about 60k steps (a minute or two).
- **Load pretrained**: the shipped agent, trained for about 290k steps.
- **Start from scratch**: wipes the agent and starts training.

**Your agent is saved between launches.** While it trains, Orbit Lab saves its network, step count and learning curve every 10 seconds and when you pause. Next time you open the app it comes back, labelled "Yours, saved <date>", and **Train** continues from there. **Load pretrained** and **Start from scratch** replace the saved agent. To stop saving, turn off *Remember my trained agent between launches* in Settings.

A replay ends with **Docked** (contact under 0.25 m/s), **Hit the station too hard**, **Drifted away** or **Ran out of time**.

### Controls
| | |
|---|---|
| Play / pause | Space, or ▶ in the top bar (⌘P in the app) |
| Time warp | `,` slower, `.` faster |
| Camera | drag to orbit, scroll to zoom; **Focus** buttons follow Earth, Moon or the spacecraft |
| Settings | ⌘, or the gear button |
| Feedback | the **Feedback** tab on the right edge (or Help ▸ Send Feedback…) |

### Settings
Everything lives in one sheet: time warp for flights, slowing down for burns, labels, the Moon's sphere of influence, the reference grid, graphics quality, whether the docking agent starts pretrained, whether to remember your trained agent, learning rate, and replay speed. In the Mac app, settings are saved in the app's preferences (UserDefaults). In a browser, they're saved in local storage.

### Feedback
Feedback is saved locally. The Mac app writes it to `~/Library/Application Support/Orbit Lab/feedback.jsonl`; a browser keeps it in local storage. **Open as GitHub issue** opens a pre-filled issue in your browser. Nothing is sent automatically.

## Tests and tools

```bash
npm test                 # physics, planners and RL (≈40 s; one test trains PPO from scratch)
npm run train -- 160     # retrain the shipped agent → web/assets/pretrained-docking.json
node scripts/screenshots.mjs   # regenerate README screenshots (needs npm run dev + Chrome)
```
