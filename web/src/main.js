// Orbit Lab: wires the scenarios, the 3D views, the clock and the panels together.

import * as THREE from 'three';
import { OrbitScene } from './scene/orbitScene.js';
import { DockingScene } from './scene/dockingScene.js';
import { Flight } from './physics/flight.js';
import { elements, norm, moonState } from './physics/orbits.js';
import { R_EARTH } from './physics/constants.js';
import { planHohmann } from './planners/hohmann.js';
import { planGravityAssist } from './planners/gravityAssist.js';
import { planRendezvous, relativeLVLH } from './planners/rendezvous.js';
import { DockingController } from './dockingController.js';
import { settings, buildSettingsSheet } from './ui/settings.js';
import { setupFeedback } from './ui/feedback.js';
import { drawChart } from './ui/chart.js';
import { isMacApp, loadStored, saveStored } from './ui/bridge.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- formatting ----------
const fmtKm = (km) => `${Math.round(km).toLocaleString()} km`;
const fmtDv = (kms) => (Math.abs(kms) < 1 ? `${(kms * 1000).toFixed(1)} m/s` : `${kms.toFixed(3)} km/s`);
function fmtTime(s) {
  s = Math.max(0, s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}
const readout = (el, rows) => {
  el.innerHTML = rows.map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls ?? ''}">${v}</dd>`).join('');
};

// ---------- renderer and scenes ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const applyQuality = () => renderer.setPixelRatio(settings.get('quality') === 'high' ? Math.min(2, window.devicePixelRatio) : 1);
applyQuality();
const labelLayer = $('#labels');
const orbitScene = new OrbitScene(renderer, labelLayer);
const dockingScene = new DockingScene(renderer, labelLayer);
const applyDisplay = () => orbitScene.setOptions({ showSOI: settings.get('showSOI'), showGrid: settings.get('showGrid'), showLabels: settings.get('showLabels') });
applyDisplay();

// ---------- app state ----------
const WARPS = [1, 10, 100, 1000, 10000, 100000];
const app = {
  mode: 'hohmann',
  flight: null,
  plan: null,
  paused: true,
  warp: Number(settings.get('defaultWarp')),
  handover: null,
};

function setFlight(flight, plan) {
  app.flight = flight;
  app.plan = plan;
  app.paused = true;
  orbitScene.setBurns(flight ? flight.burns : []);
  updateClock();
  renderLog();
}

// ---------- toast, banner, log ----------
let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
function renderLog() {
  const el = $('#log');
  const events = app.flight?.events ?? [];
  el.innerHTML = events.slice(-5).map((e) => `<li><time>T+ ${fmtTime(e.t)}</time> ${e.text}</li>`).join('');
  el.hidden = app.mode === 'docking' || !events.length;
}

// ---------- sliders ----------
const sliderFormat = {
  'h-start': (v) => fmtKm(v), 'h-target': (v) => fmtKm(v),
  'a-parking': (v) => fmtKm(v), 'a-flyby': (v) => fmtKm(v), 'a-apogee': (v) => `${Number(v).toFixed(2)}× Moon dist.`,
  'r-chaser': (v) => fmtKm(v), 'r-station': (v) => fmtKm(v), 'r-phase': (v) => `${v}°`,
};
const val = (id) => Number($(`#${id}`).value);
function syncOutputs() {
  for (const [id, f] of Object.entries(sliderFormat)) $(`output[data-for="${id}"]`).textContent = f($(`#${id}`).value);
}
const savedInputs = loadStored('inputs') ?? {};
for (const id of Object.keys(sliderFormat)) if (savedInputs[id] !== undefined) $(`#${id}`).value = savedInputs[id];
function saveInputs() {
  saveStored('inputs', Object.fromEntries(Object.keys(sliderFormat).map((id) => [id, $(`#${id}`).value])));
}

// ---------- scenario: Hohmann ----------
function planHohmannNow() {
  const plan = planHohmann({ startAlt: val('h-start'), targetAlt: val('h-target') });
  setFlight(new Flight({ craft: plan.initialState, burns: plan.burns }), plan);
  orbitScene.setTargetRing(plan.r2);
  readout($('#h-readout'), [
    ['First burn (prograde)', fmtDv(plan.dv1)],
    ['Second burn (circularize)', fmtDv(plan.dv2)],
    ['Total Δv', fmtDv(plan.total), 'strong'],
    ['Transfer time', fmtTime(plan.tof)],
    ['Transfer orbit', `${fmtKm(Math.min(plan.r1, plan.r2) - R_EARTH)} × ${fmtKm(Math.max(plan.r1, plan.r2) - R_EARTH)}`],
  ]);
  const far = plan.r2 / 1000;
  orbitScene.controls.target.set(0, 0, 0);
  orbitScene.focus = 'earth';
  orbitScene.camera.position.set(-far * 0.4, far * 1.6, far * 2.2);
}

// ---------- scenario: Gravity assist ----------
let assistSide = 'trailing';
function assistInputsChanged() {
  $('[data-panel=assist] [data-action=fly]').disabled = true;
  readout($('#a-readout'), [['', 'Press “Find flyby” to search for a trajectory.']]);
}
function planAssistNow() {
  const btn = $('[data-action=find-flyby]');
  btn.disabled = true;
  btn.textContent = 'Searching…';
  setTimeout(() => {
    const plan = planGravityAssist({ parkingAlt: val('a-parking'), flybyAlt: val('a-flyby'), side: assistSide, apogeeFactor: val('a-apogee') });
    btn.disabled = false;
    btn.textContent = 'Find flyby';
    if (!plan.ok) {
      readout($('#a-readout'), [['No trajectory', plan.reason, 'warn']]);
      $('[data-panel=assist] [data-action=fly]').disabled = true;
      return;
    }
    const f = plan.flyby;
    setFlight(new Flight({ craft: plan.initialState, burns: plan.burns, moonPhase0: plan.moonPhase0 }), plan);
    orbitScene.setTargetRing(null);
    orbitScene.frameEarthMoon(app.flight.prop.moonAt(f.closestTime).r);
    $('[data-panel=assist] [data-action=fly]').disabled = false;
    const outcome = f.escapes ? 'Escapes Earth’s gravity' : `New orbit: ${fmtKm(f.after.rp - R_EARTH)} × ${fmtKm(f.after.ra - R_EARTH)}`;
    readout($('#a-readout'), [
      ['Trans-lunar burn', `${fmtDv(plan.dv)} at T+ ${fmtTime(plan.burns[0].t)}`],
      ['Time to closest approach', fmtTime(f.closestTime - plan.burns[0].t)],
      ['Closest approach', `${fmtKm(f.periapsisAlt)} above the Moon`],
      ['Speed relative to the Moon (v∞)', fmtDv(f.vinf)],
      ['Turned by', `${f.turnDeg.toFixed(1)}°`],
      ['Speed vs Earth, in → out', `${fmtDv(f.speedBefore)} → ${fmtDv(f.speedAfter)}`],
      [f.dEnergy >= 0 ? 'Energy gained' : 'Energy lost', `${Math.abs(f.dEnergy).toFixed(3)} km²/s² ≈ ${fmtDv(f.equivalentDv)} of free Δv`, 'strong'],
      ['After the flyby', outcome],
    ]);
  }, 30);
}

// ---------- scenario: Rendezvous ----------
function planRendezvousNow() {
  const plan = planRendezvous({ chaserAlt: val('r-chaser'), stationAlt: val('r-station'), phaseDeg: val('r-phase') });
  $('[data-action=handover]').hidden = true;
  app.handover = null;
  if (!plan.ok) {
    readout($('#r-readout'), [['Can’t plan', plan.reason, 'warn']]);
    setFlight(null, null);
    return;
  }
  setFlight(new Flight({ craft: plan.chaser0, station: plan.station0, burns: plan.burns, moonPhase0: plan.moonPhase0 }), plan);
  orbitScene.setTargetRing(plan.r2);
  readout($('#r-readout'), [
    ['Wait for alignment', fmtTime(plan.wait)],
    ['Station lead needed at burn', `${plan.phiReqDeg.toFixed(1)}°`],
    ['Transfer time', fmtTime(plan.tof)],
    ['Transfer burn', fmtDv(norm(plan.burns[0].dvInertial))],
    ['Matching burn', fmtDv(norm(plan.burns[1].dvInertial))],
    ['Total Δv', fmtDv(plan.totalDv), 'strong'],
    ['Aim-point error (predicted)', `${(plan.missMeters * 100).toFixed(1)} cm`],
  ]);
  orbitScene.setFocus('craft', app.flight);
  orbitScene.camera.position.copy(orbitScene.controls.target).add(new THREE.Vector3(-6, 14, 18));
}

function checkRendezvousArrival(executed) {
  if (app.mode !== 'rendezvous' || !app.flight?.station) return;
  if (executed.some((b) => b.label === 'Match velocity')) {
    const rel = relativeLVLH(app.flight.craft, app.flight.station);
    app.handover = [...rel.pos, ...rel.vel];
    app.paused = true;
    $('[data-action=handover]').hidden = false;
    toast(`Arrived ${Math.hypot(...rel.pos).toFixed(1)} m from the docking port — ready for the docking agent.`);
  }
}

// ---------- scenario: Docking ----------
const docking = new DockingController({
  scene: dockingScene,
  settings,
  onStats: (s, history, ctl) => {
    readout($('#d-stats'), [
      ['Agent', ctl.describe()],
      ['Training steps', Math.round(s.totalSteps).toLocaleString()],
      ['Updates this session', s.iteration],
      ['Success, last 50 tries', `${Math.round(s.successRate * 100)}%`, 'strong'],
    ]);
    drawChart($('#d-chart'), history);
  },
  onEpisode: (outcome, env) => {
    const text = { docked: `Docked ✓ — ${env.speed().toFixed(2)} m/s contact, ${env.fuel.toFixed(2)} m/s Δv`, crashed: 'Hit the station too hard ✕', drifted: 'Drifted away ✕', timeout: 'Ran out of time' }[outcome];
    banner(text, outcome === 'docked' ? 'good' : 'bad');
  },
});

let bannerTimer;
function banner(text, kind) {
  const el = $('#banner');
  el.textContent = text;
  el.className = `banner ${kind}`;
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, 1500);
}

function updateTrainButton() {
  $('[data-action=train]').textContent = docking.training ? 'Pause training' : 'Train';
}

// ---------- modes ----------
function setMode(mode) {
  if (!['hohmann', 'assist', 'rendezvous', 'docking'].includes(mode)) return;
  app.mode = mode;
  saveStored('mode', mode);
  $$('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== mode; });
  const orbital = mode !== 'docking';
  orbitScene.controls.enabled = orbital;
  dockingScene.controls.enabled = !orbital;
  $('#clock-controls').style.visibility = orbital ? 'visible' : 'hidden';
  $('#focus').hidden = !orbital;
  if (!orbital) orbitScene.hideLabels();
  if (mode === 'hohmann') planHohmannNow();
  if (mode === 'assist') { setFlight(null, null); orbitScene.setTargetRing(null); orbitScene.frameEarthMoon(); assistInputsChanged(); }
  if (mode === 'rendezvous') planRendezvousNow();
  if (mode === 'docking') {
    if (app.handover) { docking.handOver(app.handover); app.handover = null; }
    onResize();
    drawChart($('#d-chart'), docking.history);
  }
  renderLog();
}

// ---------- clock ----------
function updateClock() {
  $('#warp').textContent = `${app.warp.toLocaleString()}×`;
  $('[data-action=pause]').textContent = app.paused ? '▶' : '❚❚';
  const f = app.flight;
  const next = f?.nextBurn;
  $('#clock').textContent = f ? `T+ ${fmtTime(f.t)}${next ? ` · ${next.label} in ${fmtTime(next.t - f.t)}` : ''}${f.impact ? ` · impacted the ${f.impact}` : ''}` : 'No flight planned';
}
function setWarp(dir) {
  const i = WARPS.indexOf(app.warp);
  app.warp = WARPS[Math.max(0, Math.min(WARPS.length - 1, (i < 0 ? 3 : i) + dir))];
  updateClock();
}
function togglePause() {
  if (!app.flight || app.mode === 'docking') return;
  app.paused = !app.paused;
  updateClock();
}

// ---------- wiring ----------
$$('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('[data-action=pause]').addEventListener('click', togglePause);
$('[data-action=slower]').addEventListener('click', () => setWarp(-1));
$('[data-action=faster]').addEventListener('click', () => setWarp(1));
$$('[data-focus]').forEach((b) => b.addEventListener('click', () => orbitScene.setFocus(b.dataset.focus, app.flight)));

$$('input[type=range]').forEach((input) => input.addEventListener('input', () => {
  syncOutputs();
  saveInputs();
  if (input.id.startsWith('h-')) planHohmannNow();
  if (input.id.startsWith('a-')) assistInputsChanged();
  if (input.id.startsWith('r-')) planRendezvousNow();
}));
$$('.presets button').forEach((b) => b.addEventListener('click', () => {
  const input = $(`#${b.parentElement.dataset.target}`);
  input.value = b.dataset.value;
  input.dispatchEvent(new Event('input'));
}));
$$('#a-side button').forEach((b) => b.addEventListener('click', () => {
  assistSide = b.dataset.value;
  $$('#a-side button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  assistInputsChanged();
}));
$('[data-action=find-flyby]').addEventListener('click', planAssistNow);
$$('[data-action=fly]').forEach((b) => b.addEventListener('click', () => {
  if (!app.flight) return;
  if (app.flight.t > 0) { // fly again from the start
    if (app.mode === 'hohmann') planHohmannNow();
    if (app.mode === 'rendezvous') planRendezvousNow();
    if (app.mode === 'assist') setFlight(new Flight({ craft: app.plan.initialState, burns: app.plan.burns, moonPhase0: app.plan.moonPhase0 }), app.plan);
  }
  app.warp = Number(settings.get('defaultWarp'));
  app.paused = false;
  updateClock();
}));
$$('[data-action=replan]').forEach((b) => b.addEventListener('click', () => (app.mode === 'hohmann' ? planHohmannNow() : planRendezvousNow())));
$('[data-action=handover]').addEventListener('click', () => setMode('docking'));
$('[data-action=train]').addEventListener('click', () => {
  docking.training ? docking.stopTraining() : docking.startTraining();
  updateTrainButton();
});
$('[data-action=pretrained]').addEventListener('click', () => { docking.reset(true); updateTrainButton(); });
$('[data-action=scratch]').addEventListener('click', () => { docking.reset(false); docking.startTraining(); updateTrainButton(); });
const speedSelect = $('#d-speed');
speedSelect.value = String(settings.get('playbackSpeed'));
speedSelect.addEventListener('change', () => settings.set('playbackSpeed', Number(speedSelect.value)));

// Settings sheet
const settingsSheet = buildSettingsSheet($('#settings'));
function openSettings() { settingsSheet.render(); $('#settings').hidden = false; }
function closeSettings() { $('#settings').hidden = true; }
$('[data-action=settings]').addEventListener('click', openSettings);
$$('[data-action=close-settings]').forEach((b) => b.addEventListener('click', closeSettings));
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
settings.onChange((k) => {
  applyDisplay();
  applyQuality();
  onResize();
  speedSelect.value = String(settings.get('playbackSpeed'));
  if (k === 'learningRate') toast('New learning rate applies the next time the agent is reset.');
});

// Feedback
const feedback = setupFeedback({
  tab: $('#feedback-tab'),
  panel: $('#feedback-panel'),
  getContext: () => ({ mode: app.mode, app: isMacApp() ? 'Mac app' : navigator.userAgent }),
});

// Keyboard
window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.target.type !== 'range';
  if (e.key === ',' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSettings(); return; }
  if (e.key === 'Escape') { closeSettings(); feedback.close(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); togglePause(); }
  if (e.key === ',') setWarp(-1);
  if (e.key === '.') setWarp(1);
  const modes = { 1: 'hohmann', 2: 'assist', 3: 'rendezvous', 4: 'docking' };
  if (modes[e.key]) setMode(modes[e.key]);
});

// Native menu hooks (the Mac app calls these).
window.orbitLab = { setMode, openSettings, openFeedback: () => feedback.open(), togglePause };

// ---------- render loop ----------
const viewport = $('#viewport');
let width = 1, height = 1;
function onResize() {
  width = viewport.clientWidth;
  height = viewport.clientHeight;
  renderer.setSize(width, height, false);
}
new ResizeObserver(onResize).observe(viewport);
onResize();

let last = performance.now();
let clockAccum = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.mode === 'docking') {
    docking.tick(dt, now / 1000);
    const r = docking.readout();
    readout($('#d-readout'), [
      ['Start', r.handover ? 'Hand-over from your rendezvous' : 'Random point in the approach corridor'],
      ['Distance to port', `${r.distance.toFixed(2)} m`],
      ['Closing speed', `${r.closing.toFixed(3)} m/s`],
      ['Δv used', `${r.fuel.toFixed(2)} m/s`],
      ['Elapsed', fmtTime(r.time)],
    ]);
    dockingScene.render(width, height);
  } else {
    const f = app.flight;
    if (f && !app.paused && !f.impact) {
      let simDt = app.warp * dt;
      const next = f.nextBurn;
      if (settings.get('slowForBurns') && next) {
        const remaining = next.t - f.t;
        // close in on the burn geometrically (8% of the remaining time per frame), then 10× for the last seconds
        if (remaining < simDt * 30) simDt = Math.min(simDt, Math.max(remaining * 0.08, 10 * dt));
      }
      const executed = f.advance(simDt);
      for (const b of executed) {
        const mag = b.dvInertial ? norm(b.dvInertial) : Math.hypot(...b.dv);
        toast(`${b.label}: ${fmtDv(mag)}`);
      }
      if (executed.length) { renderLog(); checkRendezvousArrival(executed); }
      if (f.impact) { app.paused = true; renderLog(); toast(`Impact with the ${f.impact}`); }
    }
    const t = f?.t ?? 0;
    orbitScene.update(f, f ? f.moon() : moonState(0, 1.9), t);
    if (f) orbitScene.placeBurns(f.burns.map((b) => f.burnPositions?.[b.id]));
    orbitScene.render(width, height);
    clockAccum += dt;
    if (clockAccum > 0.1) { clockAccum = 0; updateClock(); }
  }
  requestAnimationFrame(frame);
}

syncOutputs();
setMode(loadStored('mode') ?? 'hohmann');
requestAnimationFrame(frame);

// Exposed for debugging in the browser console.
window.__orbitLab = { app, docking, orbitScene, elements };
