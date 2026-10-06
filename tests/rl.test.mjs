import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { MLP, seededRandom } from '../web/src/rl/mlp.js';
import { DockingEnv } from '../web/src/rl/dockingEnv.js';
import { PPOAgent, Trainer, evaluate } from '../web/src/rl/ppo.js';

test('MLP backprop matches finite differences', () => {
  const net = new MLP([3, 5, 2], seededRandom(3));
  const x = [0.3, -0.7, 0.2], g = [1.0, -0.5];
  const loss = () => { const y = net.forward(x); return y[0] * g[0] + y[1] * g[1]; };
  net.zeroGrad(); net.forward(x); net.backward(g);
  for (const [l, i] of [[0, 4], [1, 7], [0, 11]]) {
    const w = net.W[l], old = w[i], eps = 1e-6;
    w[i] = old + eps; const up = loss();
    w[i] = old - eps; const dn = loss();
    w[i] = old;
    assert.ok(Math.abs((up - dn) / (2 * eps) - net.gW[l][i]) < 1e-6);
  }
});

test('docking env: zero thrust from rest drifts but never docks', () => {
  const env = new DockingEnv(seededRandom(5));
  env.reset([0, -30, 0, 0, 0, 0]);
  while (!env.done) env.step([0, 0, 0]);
  assert.notEqual(env.outcome, 'docked');
});

test('docking env: a slow straight approach docks', () => {
  const env = new DockingEnv(seededRandom(5));
  env.reset([0, -3, 0, 0, 0.1, 0]);
  let k = 0;
  while (!env.done && k++ < 100) {
    const s = env.state;
    // hold the approach line and a steady 0.1 m/s closing speed
    env.step([-(s[0] * 0.5 + s[3] * 3), (0.1 - s[4]) * 2, -(s[2] * 0.5 + s[5] * 3)]);
  }
  assert.equal(env.outcome, 'docked');
});

test('PPO learns to dock from scratch (~50k steps)', () => {
  const agent = new PPOAgent({}, 1);
  const trainer = new Trainer(agent, 2);
  for (let i = 0; i < 3; i++) trainer.iterate();
  const before = evaluate(agent, 50, 77).successRate;
  for (let i = 0; i < 25; i++) trainer.iterate();
  const after = evaluate(agent, 50, 77).successRate;
  assert.ok(after >= 0.5 && after > before, `success ${before} → ${after}`);
});

test('shipped pretrained agent docks reliably', { skip: !existsSync('web/assets/pretrained-docking.json') }, () => {
  const agent = PPOAgent.fromJSON(JSON.parse(readFileSync('web/assets/pretrained-docking.json', 'utf8')));
  const ev = evaluate(agent, 100, 1234);
  assert.ok(ev.successRate >= 0.9, `success ${ev.successRate}`);
});
