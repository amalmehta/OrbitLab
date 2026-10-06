// Drives the Docking Agent mode: trains PPO in a Web Worker while the main thread replays
// episodes with the latest policy, so you watch the agent improve in real time.

import { PPOAgent, Trainer, compact } from './rl/ppo.js';
import { DockingEnv, DOCKING } from './rl/dockingEnv.js';
import { seededRandom } from './rl/mlp.js';
import { loadStored, saveStored } from './ui/bridge.js';
import pretrained from '../assets/pretrained-docking.json';

const SAVE_EVERY_MS = 10000;
const SAVE_VERSION = 1;

/* global __WORKER_SOURCE__ */

export class DockingController {
  constructor({ scene, settings, onStats, onEpisode }) {
    this.scene = scene;
    this.settings = settings;
    this.onStats = onStats;
    this.onEpisode = onEpisode;
    this.env = new DockingEnv(seededRandom(2026));
    this.history = [];
    this.training = false;
    this.pendingStart = null;
    this.pauseUntil = 0;
    this.acc = 0;
    this.stats = { iteration: 0, totalSteps: 0, episodes: 0, successRate: 0 };
    this.lastSave = 0;
    this.worker = this.makeWorker();
    if (!this.restore()) this.reset(settings.get('startPretrained'));
    settings.onChange((k) => { if ((k === 'rememberAgent' || k === '*') && !settings.get('rememberAgent')) this.forget(); });
  }

  // ---- saving between launches ----

  remember() {
    return Boolean(this.settings.get('rememberAgent'));
  }

  save() {
    // Only agents that are yours: trained this session, or restored from a previous one.
    const yours = this.source !== 'pretrained' && (this.stats.iteration > 0 || this.restored);
    if (!this.remember() || !yours) return;
    this.lastSave = Date.now();
    saveStored('agent', compact({
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      agent: this.agent.toJSON(),
      stats: { totalSteps: this.stats.totalSteps, successRate: this.stats.successRate },
      history: this.history,
    }));
  }

  forget() {
    saveStored('agent', null);
  }

  // Load the agent saved last time. Returns false if there is none or it doesn't fit this version.
  restore() {
    if (!this.remember()) return false;
    const saved = loadStored('agent');
    if (!saved || saved.version !== SAVE_VERSION || !saved.agent?.actor) return false;
    try {
      this.stopTraining();
      this.agent = PPOAgent.fromJSON({ ...saved.agent, hyper: { ...saved.agent.hyper, ...this.hyper() } });
    } catch (err) {
      console.warn('Saved docking agent could not be loaded; starting fresh', err);
      return false;
    }
    this.source = 'saved';
    this.restored = true;
    this.savedAt = saved.savedAt;
    const startSteps = saved.stats?.totalSteps ?? 0;
    this.history = saved.history ?? [];
    this.stats = { iteration: 0, totalSteps: startSteps, episodes: 0, successRate: saved.stats?.successRate ?? 0 };
    const seed = Math.floor(Math.random() * 1e6);
    if (this.worker) {
      this.worker.postMessage({ type: 'init', weights: saved.agent, hyper: this.hyper(), seed, startSteps });
    } else {
      this.localTrainer = new Trainer(this.agent, seed + 1);
      this.localTrainer.totalSteps = startSteps;
    }
    this.scene.clearGhosts();
    this.newEpisode();
    this.onStats?.(this.stats, this.history, this);
    return true;
  }

  // Short description of where the current agent came from, for the panel.
  describe() {
    if (this.source === 'pretrained') return 'Pretrained';
    if (this.source === 'saved') {
      const when = this.savedAt ? new Date(this.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
      return this.stats.iteration ? 'Yours, training further' : `Yours, saved ${when}`;
    }
    return 'Learning from scratch';
  }

  makeWorker() {
    try {
      const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = (e) => this.onWorkerMessage(e.data);
      return w;
    } catch (err) {
      console.warn('Web Worker unavailable, training on the main thread', err);
      return null;
    }
  }

  hyper() {
    return { lr: Number(this.settings.get('learningRate')) };
  }

  // Replaces the current agent (and the saved one) with the pretrained agent or an untrained one.
  reset(usePretrained) {
    this.stopTraining();
    this.restored = false;
    this.forget();
    const seed = Math.floor(Math.random() * 1e6);
    this.agent = usePretrained ? PPOAgent.fromJSON({ ...pretrained, hyper: { ...pretrained.hyper, ...this.hyper() } }) : new PPOAgent(this.hyper(), seed);
    this.source = usePretrained ? 'pretrained' : 'scratch';
    const startSteps = usePretrained ? pretrained.trainedSteps ?? 0 : 0;
    this.history = usePretrained ? [{ steps: startSteps, success: pretrained.evalSuccess ?? 1 }] : [];
    this.stats = { iteration: 0, totalSteps: startSteps, episodes: 0, successRate: usePretrained ? pretrained.evalSuccess ?? 1 : 0 };
    if (this.worker) {
      this.worker.postMessage({ type: 'init', weights: usePretrained ? pretrained : null, hyper: this.hyper(), seed, startSteps });
    } else {
      this.localTrainer = new Trainer(this.agent, seed + 1);
      this.localTrainer.totalSteps = startSteps;
    }
    this.scene.clearGhosts();
    this.newEpisode();
    this.onStats?.(this.stats, this.history, this);
  }

  onWorkerMessage(msg) {
    if (msg.type !== 'progress') return;
    this.loadWeights(msg.weights);
    this.recordStats(msg.stats);
  }

  loadWeights(w) {
    this.agent.actor.load(w.actor);
    this.agent.critic.load(w.critic);
    this.agent.logStd.set(w.logStd);
  }

  recordStats(s) {
    this.stats = s;
    if (s.episodes > 0) this.history.push({ steps: s.totalSteps, success: s.successRate });
    if (this.history.length > 400) this.history.splice(1, 1);
    // Once a pretrained agent has been trained further it becomes "yours" and is worth saving.
    if (this.source === 'pretrained') { this.source = 'saved'; this.restored = true; }
    if (this.saveSoon || Date.now() - this.lastSave > SAVE_EVERY_MS) { this.saveSoon = false; this.save(); }
    this.onStats?.(this.stats, this.history, this);
  }

  startTraining() {
    if (this.training) return;
    this.training = true;
    if (this.worker) this.worker.postMessage({ type: 'start' });
    else this.localLoop();
  }

  stopTraining() {
    const wasTraining = this.training;
    this.training = false;
    if (this.worker) this.worker.postMessage({ type: 'stop' });
    if (wasTraining) { this.save(); this.saveSoon = true; } // and again when the in-flight update lands
  }

  localLoop() {
    if (!this.training) return;
    this.recordStats(this.localTrainer.iterate());
    setTimeout(() => this.localLoop(), 30);
  }

  // Start the next replay from a specific relative state (the rendezvous hand-over).
  handOver(state6) {
    this.pendingStart = Float64Array.from(state6);
    this.newEpisode();
  }

  newEpisode() {
    this.scene.startEpisode();
    if (this.pendingStart) {
      this.env.reset(this.pendingStart);
      this.handover = true;
      this.pendingStart = null;
    } else {
      this.env.reset();
      this.handover = false;
    }
    this.episodeDone = false;
    this.scene.update(this.env.state, null);
  }

  // Called every animation frame with wall-clock seconds since the last frame.
  tick(dtWall, now) {
    if (this.episodeDone) {
      if (now > this.pauseUntil) this.newEpisode();
      return;
    }
    this.acc += dtWall * Number(this.settings.get('playbackSpeed'));
    let steps = Math.floor(this.acc / DOCKING.dt);
    this.acc -= steps * DOCKING.dt;
    steps = Math.min(steps, 200);
    for (let i = 0; i < steps && !this.env.done; i++) {
      const { action } = this.agent.act(this.env.observe(), true);
      this.env.step(action);
    }
    this.scene.update(this.env.state, this.env.lastAccel);
    if (this.env.done) {
      this.episodeDone = true;
      this.pauseUntil = now + 1.6;
      this.onEpisode?.(this.env.outcome, this.env);
    }
  }

  readout() {
    const e = this.env;
    const s = e.state;
    const closing = -(s[0] * s[3] + s[1] * s[4] + s[2] * s[5]) / Math.max(1e-6, e.distance());
    return { distance: e.distance(), closing, speed: e.speed(), fuel: e.fuel, time: e.steps * DOCKING.dt, outcome: e.outcome, handover: this.handover };
  }
}
