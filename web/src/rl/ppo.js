// Proximal Policy Optimization with a Gaussian policy, written from scratch for small networks.

import { MLP, gaussian, seededRandom } from './mlp.js';
import { DockingEnv, OBS_SIZE, ACT_SIZE } from './dockingEnv.js';

export const DEFAULT_HYPER = {
  hidden: 48,
  numEnvs: 8,
  horizon: 256,        // steps per env per update → 2048 samples
  epochs: 6,
  minibatch: 128,
  gamma: 0.99,
  lambda: 0.95,
  clip: 0.2,
  lr: 1e-3,
  entropyCoef: 0.0,
  maxGradNorm: 0.5,
  initLogStd: -0.5,
};

const LOG_2PI = Math.log(2 * Math.PI);

export class PPOAgent {
  constructor(hyper = {}, seed = 7) {
    this.h = { ...DEFAULT_HYPER, ...hyper };
    this.rand = seededRandom(seed);
    const H = this.h.hidden;
    this.actor = new MLP([OBS_SIZE, H, H, ACT_SIZE], this.rand, 0.1);
    this.critic = new MLP([OBS_SIZE, H, H, 1], this.rand, 1);
    this.logStd = new Float64Array(ACT_SIZE).fill(this.h.initLogStd);
    this.logStdM = new Float64Array(ACT_SIZE);
    this.logStdV = new Float64Array(ACT_SIZE);
    this.logStdT = 0;
  }

  // Returns { action, logp, value } — action is the unclipped Gaussian sample.
  act(obs, deterministic = false) {
    const mu = this.actor.forward(obs);
    const action = new Float64Array(ACT_SIZE);
    let logp = 0;
    for (let i = 0; i < ACT_SIZE; i++) {
      const std = Math.exp(this.logStd[i]);
      const eps = deterministic ? 0 : gaussian(this.rand);
      action[i] = mu[i] + std * eps;
      logp += -0.5 * eps * eps - this.logStd[i] - 0.5 * LOG_2PI;
    }
    const value = this.critic.forward(obs)[0];
    return { action, logp, value };
  }

  value(obs) {
    return this.critic.forward(obs)[0];
  }

  update(batch) {
    const h = this.h;
    const N = batch.obs.length;
    // normalize advantages
    let mean = 0, sq = 0;
    for (let i = 0; i < N; i++) mean += batch.adv[i];
    mean /= N;
    for (let i = 0; i < N; i++) sq += (batch.adv[i] - mean) ** 2;
    const std = Math.sqrt(sq / N) + 1e-8;
    const adv = batch.adv.map((a) => (a - mean) / std);

    const idx = Array.from({ length: N }, (_, i) => i);
    const gMu = new Float64Array(ACT_SIZE);
    const gLogStd = new Float64Array(ACT_SIZE);
    let stats = { policyLoss: 0, valueLoss: 0, clipFrac: 0, n: 0 };

    for (let ep = 0; ep < h.epochs; ep++) {
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      for (let start = 0; start < N; start += h.minibatch) {
        const end = Math.min(N, start + h.minibatch);
        const m = end - start;
        this.actor.zeroGrad();
        this.critic.zeroGrad();
        gLogStd.fill(0);
        for (let k = start; k < end; k++) {
          const s = idx[k];
          const obs = batch.obs[s], a = batch.act[s];
          const mu = this.actor.forward(obs);
          let logp = 0;
          for (let d = 0; d < ACT_SIZE; d++) {
            const z = (a[d] - mu[d]) / Math.exp(this.logStd[d]);
            logp += -0.5 * z * z - this.logStd[d] - 0.5 * LOG_2PI;
          }
          const ratio = Math.exp(logp - batch.logp[s]);
          const A = adv[s];
          const clipped = (A >= 0 && ratio > 1 + h.clip) || (A < 0 && ratio < 1 - h.clip);
          // loss = -min(r A, clip(r) A); gradient only flows through the unclipped branch
          const dLdLogp = clipped ? 0 : -ratio * A / m;
          if (clipped) stats.clipFrac++;
          stats.policyLoss += -Math.min(ratio * A, Math.max(1 - h.clip, Math.min(1 + h.clip, ratio)) * A);
          for (let d = 0; d < ACT_SIZE; d++) {
            const sd = Math.exp(this.logStd[d]);
            const z = (a[d] - mu[d]) / sd;
            gMu[d] = dLdLogp * (z / sd);              // dlogp/dmu = z/σ
            gLogStd[d] += dLdLogp * (z * z - 1) - h.entropyCoef / m; // dlogp/dlogσ = z²−1; entropy bonus
          }
          this.actor.backward(gMu);

          const v = this.critic.forward(obs)[0];
          const err = v - batch.ret[s];
          stats.valueLoss += err * err;
          this.critic.backward([(2 * err * 0.5) / m]);
          stats.n++;
        }
        for (const net of [this.actor, this.critic]) {
          const norm = Math.sqrt(net.gradNormSq());
          if (norm > h.maxGradNorm) net.scaleGrad(h.maxGradNorm / norm);
        }
        this.actor.adamStep(h.lr);
        this.critic.adamStep(h.lr);
        // Adam on logStd
        this.logStdT++;
        const c1 = 1 - 0.9 ** this.logStdT, c2 = 1 - 0.999 ** this.logStdT;
        for (let d = 0; d < ACT_SIZE; d++) {
          this.logStdM[d] = 0.9 * this.logStdM[d] + 0.1 * gLogStd[d];
          this.logStdV[d] = 0.999 * this.logStdV[d] + 0.001 * gLogStd[d] ** 2;
          this.logStd[d] -= (h.lr * this.logStdM[d] / c1) / (Math.sqrt(this.logStdV[d] / c2) + 1e-8);
          this.logStd[d] = Math.max(-3, Math.min(0.5, this.logStd[d]));
        }
      }
    }
    return {
      policyLoss: stats.policyLoss / stats.n,
      valueLoss: stats.valueLoss / stats.n,
      clipFrac: stats.clipFrac / stats.n,
    };
  }

  toJSON() {
    return { hyper: this.h, actor: this.actor.toJSON(), critic: this.critic.toJSON(), logStd: Array.from(this.logStd) };
  }

  static fromJSON(json, seed = 7) {
    const agent = new PPOAgent(json.hyper, seed);
    agent.actor.load(json.actor);
    agent.critic.load(json.critic);
    agent.logStd.set(json.logStd);
    return agent;
  }
}

// Runs rollouts across several environments and updates the agent; one call = one PPO iteration.
export class Trainer {
  constructor(agent, seed = 11) {
    this.agent = agent;
    this.rand = seededRandom(seed);
    this.envs = Array.from({ length: agent.h.numEnvs }, () => new DockingEnv(this.rand));
    this.obs = this.envs.map((e) => e.observe());
    this.epReturn = new Float64Array(this.envs.length);
    this.totalSteps = 0;
    this.iteration = 0;
    this.episodes = 0;
    this.recent = []; // last episodes: { ret, outcome, fuel, steps }
  }

  iterate() {
    const { agent } = this;
    const h = agent.h;
    const E = this.envs.length, T = h.horizon;
    const obs = [], act = [], logp = [], val = [], rew = [], done = [], next = [];
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < E; e++) {
        const env = this.envs[e];
        const o = this.obs[e];
        const { action, logp: lp, value } = agent.act(o);
        const { obs: o2, reward, done: d } = env.step(action);
        obs.push(o); act.push(action); logp.push(lp); val.push(value); rew.push(reward);
        this.epReturn[e] += reward;
        // Timeouts are truncations: bootstrap from the value of the final state.
        let terminal = d;
        if (d && env.outcome === 'timeout') {
          rew[rew.length - 1] += h.gamma * agent.value(o2);
          terminal = true;
        }
        done.push(terminal);
        if (d) {
          this.recent.push({ ret: this.epReturn[e], outcome: env.outcome, fuel: env.fuel, steps: env.steps });
          if (this.recent.length > 200) this.recent.shift();
          this.episodes++;
          this.epReturn[e] = 0;
          this.obs[e] = env.reset();
        } else {
          this.obs[e] = o2;
        }
      }
    }
    const lastVal = this.obs.map((o) => agent.value(o));
    // GAE, laid out as [t][e]
    const N = T * E;
    const adv = new Float64Array(N), ret = new Float64Array(N);
    for (let e = 0; e < E; e++) {
      let gae = 0;
      for (let t = T - 1; t >= 0; t--) {
        const i = t * E + e;
        const nv = t === T - 1 ? lastVal[e] : val[(t + 1) * E + e];
        const nonTerm = done[i] ? 0 : 1;
        const delta = rew[i] + h.gamma * nv * nonTerm - val[i];
        gae = delta + h.gamma * h.lambda * nonTerm * gae;
        adv[i] = gae;
        ret[i] = gae + val[i];
      }
    }
    const losses = agent.update({ obs, act, logp, adv: Array.from(adv), ret: Array.from(ret) });
    this.totalSteps += N;
    this.iteration++;
    return { ...losses, ...this.summary() };
  }

  summary(window = 50) {
    const r = this.recent.slice(-window);
    const n = r.length || 1;
    return {
      iteration: this.iteration,
      totalSteps: this.totalSteps,
      episodes: this.episodes,
      meanReturn: r.reduce((s, x) => s + x.ret, 0) / n,
      successRate: r.filter((x) => x.outcome === 'docked').length / n,
      meanFuel: r.reduce((s, x) => s + x.fuel, 0) / n,
    };
  }
}

// Deterministic evaluation over fresh episodes.
export function evaluate(agent, episodes = 100, seed = 99) {
  const env = new DockingEnv(seededRandom(seed));
  const counts = { docked: 0, crashed: 0, drifted: 0, timeout: 0 };
  let fuel = 0, steps = 0;
  for (let i = 0; i < episodes; i++) {
    let o = env.reset();
    while (!env.done) o = env.step(agent.act(o, true).action).obs;
    counts[env.outcome]++;
    fuel += env.fuel;
    steps += env.steps;
  }
  return { successRate: counts.docked / episodes, counts, meanFuel: fuel / episodes, meanSteps: steps / episodes };
}
