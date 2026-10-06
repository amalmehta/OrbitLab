// Drives the Docking Agent mode: trains PPO in a Web Worker while the main thread replays
// episodes with the latest policy, so you watch the agent improve in real time.

import { PPOAgent, Trainer } from './rl/ppo.js';
import { DockingEnv, DOCKING } from './rl/dockingEnv.js';
import { seededRandom } from './rl/mlp.js';
import pretrained from '../assets/pretrained-docking.json';

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
    this.worker = this.makeWorker();
    this.reset(settings.get('startPretrained'));
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

  reset(usePretrained) {
    this.stopTraining();
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
    this.onStats?.(this.stats, this.history, this);
  }

  startTraining() {
    if (this.training) return;
    this.training = true;
    if (this.worker) this.worker.postMessage({ type: 'start' });
    else this.localLoop();
  }

  stopTraining() {
    this.training = false;
    if (this.worker) this.worker.postMessage({ type: 'stop' });
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
