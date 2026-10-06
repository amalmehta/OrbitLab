// Runs PPO training off the main thread. Messages in: init, start, stop. Messages out: progress.

import { PPOAgent, Trainer } from './ppo.js';

let trainer = null;
let running = false;

function loop() {
  if (!running || !trainer) return;
  const stats = trainer.iterate();
  self.postMessage({ type: 'progress', stats, weights: trainer.agent.toJSON() });
  setTimeout(loop, 0);
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    running = false;
    const agent = msg.weights ? PPOAgent.fromJSON({ ...msg.weights, hyper: { ...msg.weights.hyper, ...msg.hyper } }, msg.seed) : new PPOAgent(msg.hyper, msg.seed);
    trainer = new Trainer(agent, msg.seed + 1);
    trainer.totalSteps = msg.startSteps ?? 0;
    self.postMessage({ type: 'ready', weights: agent.toJSON() });
  } else if (msg.type === 'start') {
    if (!running) { running = true; loop(); }
  } else if (msg.type === 'stop') {
    running = false;
  }
};
